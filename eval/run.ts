/**
 * The eval harness — measured accuracy, not asserted accuracy.
 *
 * Each labelled fixture in `fixtures/eval/` marks every candidate element with
 * `data-eval-label="violation" | "ok"`. The harness gathers those candidates exactly as
 * a scan would, asks the model the same question a scan would, and scores the verdicts
 * against the labels.
 *
 * The label attribute is stripped from the evidence before anything reaches the model —
 * a harness that leaks the answer measures nothing.
 *
 * Requires ANTHROPIC_API_KEY. Not run in CI: it costs money and is non-deterministic.
 *
 *   npm run eval                      # every check
 *   npm run eval -- --check alt-text-meaningful
 *   npm run eval -- --model claude-sonnet-5
 */
import { pathToFileURL } from 'node:url';

import { capturePage, openSession } from '../src/capture/browser.js';
import type { Candidate, JudgmentCheck } from '../src/judgment/checks/check.js';
import { altTextCheck } from '../src/judgment/checks/alt-text.js';
import { linkPurposeCheck } from '../src/judgment/checks/link-purpose.js';
import { AnthropicModelClient } from '../src/judgment/model.js';
import { buildUserPrompt, VERDICT_SCHEMA } from '../src/judgment/runner.js';

interface EvalCase {
  check: JudgmentCheck;
  fixture: string;
}

const CASES: EvalCase[] = [
  { check: altTextCheck, fixture: 'fixtures/eval/alt-text.html' },
  { check: linkPurposeCheck, fixture: 'fixtures/eval/link-purpose.html' },
];

/** The system prompt must match the runner's — the eval measures the shipped check. */
const SYSTEM_PROMPT = [
  'You are one narrow check inside an accessibility scanner. You will be shown evidence',
  'about candidate elements from a web page and asked one specific question about each.',
  '',
  'Rules:',
  '- Return one verdict per candidate, referencing it only by its index.',
  '- Judge only the question asked. Other accessibility problems are other checks’ jobs.',
  '- Be conservative. A false positive costs a developer the time to disprove it, which',
  '  is worse than staying silent. When the evidence is thin, keep `violation` true only',
  '  if you would defend it to a skeptical developer, and reflect doubt in `confidence`.',
  '- `confidence` is your honest probability (0–1) that a human expert reviewing the',
  '  element would agree it violates the criterion.',
].join('\n');

interface Scored {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  unlabelled: number;
  disagreements: { selector: string; expected: string; got: boolean; rationale: string }[];
}

function parseArgs(argv: string[]): { check?: string; model: string } {
  const model = argv[argv.indexOf('--model') + 1];
  const check = argv[argv.indexOf('--check') + 1];
  return {
    ...(argv.includes('--check') && check !== undefined && { check }),
    model: argv.includes('--model') && model !== undefined ? model : 'claude-opus-5',
  };
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return (numerator / denominator).toFixed(3);
}

async function scoreCase(
  testCase: EvalCase,
  client: AnthropicModelClient,
): Promise<Scored | undefined> {
  const session = await openSession();
  let candidates: Candidate[];
  try {
    const captured = await capturePage(session, pathToFileURL(testCase.fixture).href, {});
    candidates = await testCase.check.gather(captured.page);
  } finally {
    await session.close();
  }

  // Strip the labels before the prompt is built. The model must never see ground truth.
  const blinded: Candidate[] = candidates.map(({ selector, snippet, evidence }) => ({
    selector,
    snippet,
    evidence,
  }));

  const response = await client.complete({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(testCase.check, blinded),
    schema: VERDICT_SCHEMA,
  });

  if (!response.ok) {
    console.error(
      `  ${testCase.check.id}: model call failed (${response.reason}) — ${response.message}`,
    );
    return undefined;
  }

  const verdicts = (
    response.json as { verdicts?: { index: number; violation: boolean; rationale: string }[] }
  ).verdicts;
  if (verdicts === undefined) {
    console.error(`  ${testCase.check.id}: response did not match the schema.`);
    return undefined;
  }

  const byIndex = new Map(verdicts.map((v) => [Math.trunc(v.index), v]));
  const scored: Scored = {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    trueNegatives: 0,
    unlabelled: 0,
    disagreements: [],
  };

  candidates.forEach((candidate, index) => {
    const expected = candidate.evalLabel;
    if (expected !== 'violation' && expected !== 'ok') {
      scored.unlabelled += 1;
      return;
    }
    const verdict = byIndex.get(index);
    // A candidate the model declined to judge counts as "no violation reported" —
    // silently dropping it would flatter the precision number.
    const got = verdict?.violation ?? false;

    if (expected === 'violation' && got) scored.truePositives += 1;
    else if (expected === 'ok' && got) scored.falsePositives += 1;
    else if (expected === 'violation' && !got) scored.falseNegatives += 1;
    else scored.trueNegatives += 1;

    if ((expected === 'violation') !== got) {
      scored.disagreements.push({
        selector: candidate.selector,
        expected,
        got,
        rationale: verdict?.rationale ?? '(no verdict returned)',
      });
    }
  });

  return scored;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (
    process.env.ANTHROPIC_API_KEY === undefined &&
    process.env.ANTHROPIC_AUTH_TOKEN === undefined
  ) {
    console.error('The eval harness needs ANTHROPIC_API_KEY (or an `ant auth login` profile).');
    process.exitCode = 2;
    return;
  }

  const cases = args.check === undefined ? CASES : CASES.filter((c) => c.check.id === args.check);
  if (cases.length === 0) {
    console.error(
      `No check matches "${String(args.check)}". Known: ${CASES.map((c) => c.check.id).join(', ')}`,
    );
    process.exitCode = 2;
    return;
  }

  const client = new AnthropicModelClient(args.model);
  console.log(`\n  Eval — model ${args.model}\n`);

  let anyFailed = false;

  for (const testCase of cases) {
    const scored = await scoreCase(testCase, client);
    if (scored === undefined) {
      anyFailed = true;
      continue;
    }

    const predictedPositive = scored.truePositives + scored.falsePositives;
    const actualPositive = scored.truePositives + scored.falseNegatives;
    const precision = ratio(scored.truePositives, predictedPositive);
    const recall = ratio(scored.truePositives, actualPositive);
    const f1 =
      predictedPositive > 0 && actualPositive > 0 && scored.truePositives > 0
        ? (
            (2 *
              (scored.truePositives / predictedPositive) *
              (scored.truePositives / actualPositive)) /
            (scored.truePositives / predictedPositive + scored.truePositives / actualPositive)
          ).toFixed(3)
        : 'n/a';

    console.log(`  ${testCase.check.id}  (WCAG ${testCase.check.criterion})`);
    console.log(
      `    precision ${precision}   recall ${recall}   F1 ${f1}` +
        `   [TP ${String(scored.truePositives)} FP ${String(scored.falsePositives)} FN ${String(scored.falseNegatives)} TN ${String(scored.trueNegatives)}]`,
    );
    if (scored.unlabelled > 0) {
      console.log(`    ${String(scored.unlabelled)} candidates had no label and were not scored.`);
    }

    for (const d of scored.disagreements) {
      const kind = d.expected === 'violation' ? 'MISSED' : 'FALSE POSITIVE';
      console.log(`    ${kind}  ${d.selector}`);
      console.log(`      model said: ${d.rationale}`);
    }
    console.log('');
  }

  if (anyFailed) process.exitCode = 1;
}

await main();
