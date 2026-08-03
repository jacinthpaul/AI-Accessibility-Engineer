/**
 * Judgment-pass integration tests.
 *
 * These drive a real browser — the gatherers run in a real page, against the labelled
 * eval fixtures — but the model is scripted, so the tests stay deterministic and need no
 * API key. What they protect is everything the unit tests cannot see: that the browser
 * side of a check actually runs, and that its selectors point at real elements.
 *
 * The browser-side code is the reason this file exists. It is serialised and executed in
 * a different runtime, so a mistake there cannot be caught by the type checker.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { capturePage, openSession } from '../src/capture/browser.js';
import { altTextCheck } from '../src/judgment/checks/alt-text.js';
import type { Candidate } from '../src/judgment/checks/check.js';
import { linkPurposeCheck } from '../src/judgment/checks/link-purpose.js';
import type { JudgmentModelClient } from '../src/judgment/model.js';
import { buildUserPrompt } from '../src/judgment/runner.js';
import { scan } from '../src/scan.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixtureUrl = (name: string) => pathToFileURL(join(fixtures, name)).href;

const TIMEOUT = 60_000;

/** Gather from a fixture through a real browser, the way a scan would. */
async function gatherFrom(
  check: typeof altTextCheck,
  fixture: string,
): Promise<{ candidates: Candidate[]; selectorCounts: number[] }> {
  const session = await openSession();
  try {
    const captured = await capturePage(session, fixtureUrl(fixture), {});
    const candidates = await check.gather(captured.page);
    const selectorCounts = await Promise.all(
      candidates.map((c) => captured.page.locator(c.selector).count()),
    );
    return { candidates, selectorCounts };
  } finally {
    await session.close();
  }
}

describe('alt-text gatherer', () => {
  it(
    'collects only images with non-empty alt, anchored to resolvable selectors',
    async () => {
      const { candidates, selectorCounts } = await gatherFrom(altTextCheck, 'eval/alt-text.html');

      expect(candidates.length).toBeGreaterThan(0);
      for (const [i, candidate] of candidates.entries()) {
        expect(candidate.selector).not.toBe('');
        expect(candidate.snippet).not.toBe('');
        expect(candidate.evidence.alt).toBeTruthy();
        // An anchor that matches zero or many elements is not an anchor.
        expect(selectorCounts[i]).toBe(1);
      }
    },
    TIMEOUT,
  );

  it(
    'prefers a figure caption over the enclosing block for context',
    async () => {
      const { candidates } = await gatherFrom(altTextCheck, 'eval/alt-text.html');
      const inFigure = candidates.find((c) => c.evidence.alt === 'graphic');

      expect(inFigure?.evidence.context).toContain('Support ticket volume');
    },
    TIMEOUT,
  );

  it(
    'ignores decorative and missing alt, which belong to axe',
    async () => {
      // clean.html has correct markup; violations.html plants a missing-alt image.
      const { candidates } = await gatherFrom(altTextCheck, 'violations.html');

      for (const candidate of candidates) {
        expect((candidate.evidence.alt ?? '').trim()).not.toBe('');
      }
    },
    TIMEOUT,
  );
});

describe('link-purpose gatherer', () => {
  it(
    'collects named links with their programmatic context',
    async () => {
      const { candidates, selectorCounts } = await gatherFrom(
        linkPurposeCheck,
        'eval/link-purpose.html',
      );

      expect(candidates.length).toBeGreaterThan(0);
      for (const [i, candidate] of candidates.entries()) {
        expect(candidate.evidence.name).not.toBe('');
        expect(selectorCounts[i]).toBe(1);
      }
    },
    TIMEOUT,
  );

  it(
    'includes the list-item text that rescues a generic link name',
    async () => {
      const { candidates } = await gatherFrom(linkPurposeCheck, 'eval/link-purpose.html');
      const rescued = candidates.filter((c) => c.evidence.name === 'Read more');

      // One "Read more" sits bare in a paragraph, two sit in list items that name the
      // article. The context field is what lets the model tell them apart.
      const withArticleContext = rescued.filter((c) =>
        (c.evidence.context ?? '').includes('WCAG 2.2'),
      );
      expect(withArticleContext).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe('eval fixtures', () => {
  it(
    'label every candidate, so the eval harness scores all of them',
    async () => {
      for (const [check, fixture] of [
        [altTextCheck, 'eval/alt-text.html'],
        [linkPurposeCheck, 'eval/link-purpose.html'],
      ] as const) {
        const { candidates } = await gatherFrom(check, fixture);
        for (const candidate of candidates) {
          expect(['violation', 'ok']).toContain(candidate.evalLabel);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'never leak their labels into the prompt',
    async () => {
      const { candidates } = await gatherFrom(altTextCheck, 'eval/alt-text.html');
      const prompt = buildUserPrompt(altTextCheck, candidates);

      expect(prompt).not.toContain('data-eval-label');
      expect(prompt).not.toContain('evalLabel');
    },
    TIMEOUT,
  );
});

describe('scan with the judgment pass', () => {
  /** Flags every candidate, to prove the wiring end to end. */
  const alwaysViolating: JudgmentModelClient = {
    model: 'test-model',
    complete: (request) =>
      Promise.resolve({
        ok: true,
        json: {
          verdicts: [...request.user.matchAll(/^\[(\d+)\]$/gm)].map((match) => ({
            index: Number(match[1]),
            violation: true,
            confidence: 0.95,
            summary: 'Test finding.',
            impact: 'Test impact.',
            remediation: 'Test remediation.',
            rationale: 'Test rationale.',
          })),
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      }),
  };

  it(
    'merges judgment findings alongside axe findings and reports usage',
    async () => {
      const { result } = await scan(fixtureUrl('eval/alt-text.html'), {
        judgment: true,
        judgmentClient: alwaysViolating,
        judgmentChecks: [altTextCheck],
      });

      const judgment = result.findings.filter((f) => f.source === 'judgment');
      expect(judgment.length).toBeGreaterThan(0);
      for (const finding of judgment) {
        expect(finding.criterion).toBe('1.1.1');
        expect(finding.element.selector).not.toBe('');
        expect(finding.rationale).toBe('Test rationale.');
      }
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.estimatedCostUsd).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'demotes low-confidence judgment findings to review',
    async () => {
      const unsure: JudgmentModelClient = {
        model: 'test-model',
        complete: (request) =>
          Promise.resolve({
            ok: true,
            json: {
              verdicts: [...request.user.matchAll(/^\[(\d+)\]$/gm)].map((match) => ({
                index: Number(match[1]),
                violation: true,
                confidence: 0.3,
                summary: 'Unsure finding.',
                impact: 'Test impact.',
                remediation: 'Test remediation.',
                rationale: 'Not confident.',
              })),
            },
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
          }),
      };

      const { result } = await scan(fixtureUrl('eval/alt-text.html'), {
        judgment: true,
        judgmentClient: unsure,
        judgmentChecks: [altTextCheck],
        confidenceFloor: 0.7,
      });

      const judgment = result.findings.filter((f) => f.source === 'judgment');
      expect(judgment.length).toBeGreaterThan(0);
      for (const finding of judgment) {
        expect(finding.severity).toBe('review');
      }
    },
    TIMEOUT,
  );

  it(
    'runs no judgment pass when no client is supplied',
    async () => {
      const { result } = await scan(fixtureUrl('eval/alt-text.html'), { judgment: true });

      expect(result.findings.every((f) => f.source === 'deterministic')).toBe(true);
      expect(result.usage).toBeUndefined();
    },
    TIMEOUT,
  );
});
