/**
 * Judgment-pass unit tests.
 *
 * These drive the runner with a scripted model client, so they are deterministic and
 * never touch the network. What they cover is not "does the model judge well" — that is
 * the eval harness's job — but "can a model response cause the runner to emit a finding
 * that breaks one of the project's rules". Each rule gets a test that tries to break it.
 */
import { describe, expect, it } from 'vitest';

import type { ConformanceLevel } from '../src/findings.js';
import type { Candidate, JudgmentCheck } from '../src/judgment/checks/check.js';
import {
  estimateCostUsd,
  type JudgmentModelClient,
  type JudgmentResponse,
} from '../src/judgment/model.js';
import { buildUserPrompt, runJudgmentPass, verdictsToFindings } from '../src/judgment/runner.js';

/** A model client that replays scripted responses, one per call, in order. */
function scriptedClient(
  responses: JudgmentResponse[],
  model = 'claude-opus-5',
): JudgmentModelClient {
  let call = 0;
  return {
    model,
    complete: () => {
      const response = responses[call];
      call += 1;
      if (response === undefined) throw new Error('scripted client ran out of responses');
      return Promise.resolve(response);
    },
  };
}

const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

function ok(verdicts: unknown[]): JudgmentResponse {
  return { ok: true, json: { verdicts }, usage: { ...ZERO, inputTokens: 100, outputTokens: 50 } };
}

function verdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index: 0,
    violation: true,
    confidence: 0.9,
    summary: 'Alt text does not describe the image.',
    impact: 'Screen reader users get no useful description.',
    remediation: 'Replace the filename with a description of the image content.',
    rationale: 'The alt text is the source filename.',
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    selector: 'main > img',
    snippet: '<img src="/a.jpg" alt="a.jpg">',
    evidence: { alt: 'a.jpg', filename: 'a.jpg', context: 'Our team.' },
    ...overrides,
  };
}

/** A check whose gatherer returns fixed candidates — no browser needed. */
function fakeCheck(candidates: Candidate[], overrides: Partial<JudgmentCheck> = {}): JudgmentCheck {
  return {
    id: 'alt-text-meaningful',
    criterion: '1.1.1',
    instructions: 'Judge the alt text.',
    gather: () => Promise.resolve(candidates),
    ...overrides,
  };
}

// The runner only ever calls `gather(page)`, so a stub stands in for a real Page.
const fakePage = {} as never;

async function run(
  check: JudgmentCheck,
  responses: JudgmentResponse[],
  options: { level?: ConformanceLevel; budgetUsd?: number } = {},
) {
  return runJudgmentPass(fakePage, {
    client: scriptedClient(responses),
    checks: [check],
    ...options,
  });
}

describe('runJudgmentPass — findings', () => {
  it('turns a violation verdict into an anchored judgment finding', async () => {
    const { findings } = await run(fakeCheck([candidate()]), [ok([verdict()])]);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.source).toBe('judgment');
    expect(f.checkId).toBe('alt-text-meaningful');
    expect(f.criterion).toBe('1.1.1');
    // Anchoring comes from the gatherer, never the model.
    expect(f.element.selector).toBe('main > img');
    expect(f.element.snippet).toBe('<img src="/a.jpg" alt="a.jpg">');
    expect(f.id).toBe('alt-text-meaningful:main > img');
    expect(f.rationale).toBe('The alt text is the source filename.');
    expect(f.helpUrl).toContain('w3.org');
  });

  it('emits nothing for a non-violation verdict', async () => {
    const { findings } = await run(fakeCheck([candidate()]), [ok([verdict({ violation: false })])]);
    expect(findings).toEqual([]);
  });

  it('derives severity from the criterion level, ignoring anything the model says', async () => {
    // 1.1.1 is level A, so severity is `serious` regardless of the verdict payload.
    const { findings } = await run(fakeCheck([candidate()]), [
      ok([verdict({ severity: 'critical', level: 'AAA' })]),
    ]);
    expect(findings[0]!.severity).toBe('serious');
    expect(findings[0]!.level).toBe('A');
  });
});

describe('runJudgmentPass — rules enforced in code', () => {
  it('drops a verdict whose index does not resolve to a gathered candidate', async () => {
    // The model can only cite candidates it was shown; an invented index is not a finding.
    const { findings } = await run(fakeCheck([candidate()]), [
      ok([verdict({ index: 7 }), verdict({ index: -1 })]),
    ]);
    expect(findings).toEqual([]);
  });

  it('rejects a check whose criterion does not exist', async () => {
    const { findings, warnings } = await run(fakeCheck([candidate()], { criterion: '1.4.14' }), []);

    expect(findings).toEqual([]);
    expect(warnings[0]).toContain('1.4.14');
  });

  it('rejects a check citing a criterion WCAG 2.2 removed', async () => {
    const { findings, warnings } = await run(fakeCheck([candidate()], { criterion: '4.1.1' }), []);

    expect(findings).toEqual([]);
    expect(warnings[0]).toMatch(/removed/i);
  });

  it('rejects a check whose criterion is above the scanned level', async () => {
    // 1.4.6 Contrast (Enhanced) is AAA; an AA scan must not report it.
    const { findings, warnings } = await run(fakeCheck([candidate()], { criterion: '1.4.6' }), [], {
      level: 'AA',
    });

    expect(findings).toEqual([]);
    expect(warnings[0]).toContain('AAA');
  });

  it('clamps a confidence outside 0–1 rather than trusting it', async () => {
    const { findings } = await run(fakeCheck([candidate(), candidate({ selector: 'p > img' })]), [
      ok([verdict({ index: 0, confidence: 4.2 }), verdict({ index: 1, confidence: -3 })]),
    ]);

    expect(findings[0]!.confidence).toBe(1);
    expect(findings[1]!.confidence).toBe(0);
  });
});

describe('runJudgmentPass — failures are surfaced, never guessed', () => {
  it('skips the check and warns when the model refuses', async () => {
    const { findings, warnings } = await run(fakeCheck([candidate()]), [
      { ok: false, reason: 'refusal', message: 'declined', usage: ZERO },
    ]);

    expect(findings).toEqual([]);
    expect(warnings[0]).toContain('refusal');
  });

  it('skips the check and warns when the call errors', async () => {
    const { findings, warnings } = await run(fakeCheck([candidate()]), [
      { ok: false, reason: 'error', message: 'connection reset', usage: ZERO },
    ]);

    expect(findings).toEqual([]);
    expect(warnings[0]).toContain('connection reset');
  });

  it('skips the check when the response does not match the schema', async () => {
    const { findings, warnings } = await run(fakeCheck([candidate()]), [
      { ok: true, json: { nonsense: true }, usage: ZERO },
    ]);

    expect(findings).toEqual([]);
    expect(warnings[0]).toMatch(/schema/i);
  });

  it('ignores malformed verdicts inside an otherwise valid response', async () => {
    const { findings } = await run(fakeCheck([candidate()]), [
      ok([{ index: 0, violation: true }, verdict()]),
    ]);

    // The well-formed verdict survives; the one missing required fields does not.
    expect(findings).toHaveLength(1);
  });

  it('makes no model call when a check gathers no candidates', async () => {
    // The scripted client throws if called, so an empty response list proves it was not.
    const { findings, warnings } = await run(fakeCheck([]), []);

    expect(findings).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('runJudgmentPass — usage and budget', () => {
  it('accumulates token usage and an estimated cost across checks', async () => {
    const { usage } = await runJudgmentPass(fakePage, {
      client: scriptedClient([ok([verdict({ violation: false })]), ok([])]),
      checks: [
        fakeCheck([candidate()]),
        fakeCheck([candidate()], { id: 'link-purpose-in-context', criterion: '2.4.4' }),
      ],
    });

    expect(usage.inputTokens).toBe(200);
    expect(usage.outputTokens).toBe(100);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(usage.budgetExhausted).toBeUndefined();
  });

  it('stops once the budget is exhausted and says so', async () => {
    const expensive: JudgmentResponse = {
      ok: true,
      json: { verdicts: [] },
      usage: { ...ZERO, inputTokens: 1_000_000, outputTokens: 1_000_000 },
    };

    const { usage, warnings } = await runJudgmentPass(fakePage, {
      // Only one response is scripted: a second model call would throw.
      client: scriptedClient([expensive]),
      checks: [
        fakeCheck([candidate()]),
        fakeCheck([candidate()], { id: 'link-purpose-in-context', criterion: '2.4.4' }),
      ],
      budgetUsd: 1,
    });

    expect(usage.budgetExhausted).toBe(true);
    expect(warnings[0]).toContain('Budget');
  });
});

describe('buildUserPrompt', () => {
  it('shows evidence by index and never leaks the eval label', () => {
    const prompt = buildUserPrompt(fakeCheck([]), [
      candidate({ evalLabel: 'violation' }),
      candidate({ selector: 'p > img' }),
    ]);

    expect(prompt).toContain('[0]');
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('alt: a.jpg');
    // Ground truth must not reach the model — that would measure nothing.
    expect(prompt).not.toContain('violation');
    expect(prompt).not.toContain('evalLabel');
    // Selectors are the runner's business, not the model's.
    expect(prompt).not.toContain('main > img');
  });
});

describe('verdictsToFindings', () => {
  it('returns nothing when the criterion is out of scope for the level', () => {
    const findings = verdictsToFindings(
      fakeCheck([], { criterion: '2.4.13' }),
      [candidate()],
      [
        {
          index: 0,
          violation: true,
          confidence: 1,
          summary: 's',
          impact: 'i',
          remediation: 'r',
          rationale: 'x',
        },
      ],
      'AA',
    );
    expect(findings).toEqual([]);
  });
});

describe('estimateCostUsd', () => {
  it('prices tokens by model family', () => {
    const usage = { ...ZERO, inputTokens: 1_000_000, outputTokens: 1_000_000 };

    expect(estimateCostUsd('claude-opus-5', usage)).toBeCloseTo(30, 5);
    expect(estimateCostUsd('claude-sonnet-5', usage)).toBeCloseTo(18, 5);
    expect(estimateCostUsd('claude-haiku-4-5', usage)).toBeCloseTo(6, 5);
    expect(estimateCostUsd('claude-fable-5', usage)).toBeCloseTo(60, 5);
  });

  it('charges cache reads at a tenth of the input rate', () => {
    const cost = estimateCostUsd('claude-opus-5', { ...ZERO, cacheReadTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.5, 5);
  });

  it('falls back to Opus pricing for an unknown model, overestimating rather than under', () => {
    const usage = { ...ZERO, inputTokens: 1_000_000 };
    expect(estimateCostUsd('some-future-model', usage)).toBeCloseTo(5, 5);
  });
});
