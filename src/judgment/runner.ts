/**
 * The judgment pass runner.
 *
 * Everything that keeps a judgment finding trustworthy is enforced here, in code:
 *
 * - the model only ever refers to candidates by index — selectors and snippets come
 *   from the gatherer, so a finding cannot cite an element that was never examined;
 * - every check's criterion goes through `checkCriterion()` before its findings are
 *   accepted, so a hallucinated or out-of-scope criterion rejects the whole check;
 * - severity is policy (`baseSeverity` of the criterion's level), never model output;
 * - a failed or refused model call skips the check with a warning — it never guesses;
 * - the `--budget` ceiling is checked between checks, and a stopped pass says so.
 */
import type { Page } from 'playwright';

import {
  baseSeverity,
  type ConformanceLevel,
  type Finding,
  type JudgmentUsage,
} from '../findings.js';
import { checkCriterion } from '../wcag.js';
import type { Candidate, JudgmentCheck } from './checks/check.js';
import { estimateCostUsd, type JudgmentModelClient, type UsageDelta } from './model.js';

export interface JudgmentPassOptions {
  client: JudgmentModelClient;
  checks: JudgmentCheck[];
  level?: ConformanceLevel;
  /** Estimated-spend ceiling in USD. Checked before each model call. */
  budgetUsd?: number;
}

export interface JudgmentPassResult {
  findings: Finding[];
  usage: JudgmentUsage;
  /** Checks that could not produce a verdict, and why. Surfaced, never swallowed. */
  warnings: string[];
}

/** The shape every check's model response must conform to (structured outputs). */
export const VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Candidate index this verdict is about.' },
          violation: { type: 'boolean' },
          confidence: { type: 'number', description: '0 to 1. How sure you are.' },
          summary: {
            type: 'string',
            description: 'One sentence, in terms of user impact rather than markup.',
          },
          impact: { type: 'string', description: 'Who this affects and how.' },
          remediation: { type: 'string', description: 'What to change. Concrete.' },
          rationale: { type: 'string', description: 'Why you reached this verdict.' },
        },
        required: [
          'index',
          'violation',
          'confidence',
          'summary',
          'impact',
          'remediation',
          'rationale',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

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

export function buildUserPrompt(check: JudgmentCheck, candidates: Candidate[]): string {
  const lines: string[] = [
    `Check: ${check.id} (WCAG ${check.criterion})`,
    '',
    check.instructions,
    '',
    `Candidates (${String(candidates.length)}):`,
    '',
  ];
  candidates.forEach((candidate, index) => {
    lines.push(`[${String(index)}]`);
    for (const [key, value] of Object.entries(candidate.evidence)) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push('');
  });
  lines.push('Return a verdict for every candidate index.');
  return lines.join('\n');
}

interface RawVerdict {
  index: number;
  violation: boolean;
  confidence: number;
  summary: string;
  impact: string;
  remediation: string;
  rationale: string;
}

/** Defensive parse: structured outputs should guarantee this shape, but the guarantee
 * is worth keeping local rather than assumed. */
function parseVerdicts(json: unknown): RawVerdict[] | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const verdicts = (json as { verdicts?: unknown }).verdicts;
  if (!Array.isArray(verdicts)) return undefined;
  return verdicts.filter((v): v is RawVerdict => {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    return (
      typeof o.index === 'number' &&
      typeof o.violation === 'boolean' &&
      typeof o.confidence === 'number' &&
      typeof o.summary === 'string' &&
      typeof o.impact === 'string' &&
      typeof o.remediation === 'string' &&
      typeof o.rationale === 'string'
    );
  });
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function addUsage(total: JudgmentUsage, delta: UsageDelta, model: string): void {
  total.inputTokens += delta.inputTokens;
  total.outputTokens += delta.outputTokens;
  total.cacheReadTokens += delta.cacheReadTokens;
  total.cacheCreationTokens += delta.cacheCreationTokens;
  total.estimatedCostUsd = Number(
    (total.estimatedCostUsd + estimateCostUsd(model, delta)).toFixed(6),
  );
}

/**
 * Turn one check's verdicts into findings. Exported for the eval harness, which needs
 * the same anchoring and validation on pre-gathered candidates.
 */
export function verdictsToFindings(
  check: JudgmentCheck,
  candidates: Candidate[],
  verdicts: RawVerdict[],
  level: ConformanceLevel,
): Finding[] {
  const criterion = checkCriterion(check.criterion, level);
  if (!criterion.ok) return [];

  const severity = baseSeverity(criterion.criterion.level ?? 'A');
  const findings: Finding[] = [];

  for (const verdict of verdicts) {
    if (!verdict.violation) continue;
    // Anchoring: a verdict that does not resolve to a gathered candidate is dropped.
    const candidate = candidates[Math.trunc(verdict.index)];
    if (candidate === undefined) continue;

    findings.push({
      id: `${check.id}:${candidate.selector}`,
      checkId: check.id,
      source: 'judgment',
      criterion: check.criterion,
      level: criterion.criterion.level ?? 'A',
      severity,
      summary: verdict.summary,
      impact: verdict.impact,
      remediation: verdict.remediation,
      element: {
        selector: candidate.selector,
        snippet: candidate.snippet,
      },
      confidence: clamp01(verdict.confidence),
      rationale: verdict.rationale,
      helpUrl: criterion.criterion.understandingUrl,
    });
  }
  return findings;
}

export async function runJudgmentPass(
  page: Page,
  options: JudgmentPassOptions,
): Promise<JudgmentPassResult> {
  const level = options.level ?? 'AA';
  const findings: Finding[] = [];
  const warnings: string[] = [];
  const usage: JudgmentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: 0,
  };

  for (const check of options.checks) {
    // A check with an invalid criterion is a bug in the check, not a page problem.
    // Rejecting it here is what "no invented criteria" means for check authors.
    const verdict = checkCriterion(check.criterion, level);
    if (!verdict.ok) {
      warnings.push(`Check ${check.id} skipped: ${verdict.message}`);
      continue;
    }

    if (options.budgetUsd !== undefined && usage.estimatedCostUsd >= options.budgetUsd) {
      usage.budgetExhausted = true;
      warnings.push(
        `Budget of $${String(options.budgetUsd)} reached; check ${check.id} and later checks skipped.`,
      );
      break;
    }

    const candidates = await check.gather(page);
    if (candidates.length === 0) continue;

    const response = await options.client.complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(check, candidates),
      schema: VERDICT_SCHEMA,
    });

    addUsage(usage, response.usage, options.client.model);

    if (!response.ok) {
      warnings.push(`Check ${check.id} skipped (${response.reason}): ${response.message}`);
      continue;
    }

    const verdicts = parseVerdicts(response.json);
    if (verdicts === undefined) {
      warnings.push(`Check ${check.id} skipped: the model response did not match the schema.`);
      continue;
    }

    findings.push(...verdictsToFindings(check, candidates, verdicts, level));
  }

  return { findings, usage, warnings };
}
