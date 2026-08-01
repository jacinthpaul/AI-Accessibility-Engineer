/**
 * The unified finding model.
 *
 * Both passes — deterministic (axe-core) and judgment (LLM) — normalise into this
 * shape, and every reporter consumes it. Keeping one schema is what lets a judgment
 * finding sit next to an axe finding in the same report without the reader having to
 * know which produced it.
 */

/** A WCAG 2.2 success criterion, e.g. `1.1.1`. */
export type SuccessCriterion = string;

export type ConformanceLevel = 'A' | 'AA' | 'AAA';

/** Which pass produced a finding. */
export type FindingSource = 'deterministic' | 'judgment';

/**
 * How much a finding should alarm the reader.
 *
 * `review` is the deliberate escape hatch: a judgment finding the model was not
 * confident enough about to assert. Surfacing it as a violation would erode trust in
 * every other finding, so it is flagged for a human instead of hidden.
 */
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor' | 'review';

/** Where in the page a finding lives. Every finding must be anchored to something. */
export interface ElementRef {
  /** CSS selector that resolves to the element at capture time. */
  selector: string;
  /** Truncated outerHTML, for a reader who cannot re-run the scan. */
  snippet: string;
  /** Viewport coordinates at capture time, when the element was rendered. */
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface Finding {
  /** Stable within a run: `${checkId}:${selector}`. Used to dedupe and to diff runs. */
  id: string;
  /** The check that produced this, e.g. `image-alt` (axe) or `alt-text-meaningful`. */
  checkId: string;
  source: FindingSource;

  criterion: SuccessCriterion;
  level: ConformanceLevel;
  severity: Severity;

  /** One sentence, in terms of user impact rather than markup. */
  summary: string;
  /** Who this affects and how — the "why it matters" a developer needs. */
  impact: string;
  /** What to change. Concrete where possible. */
  remediation?: string;

  element: ElementRef;

  /**
   * Judgment findings only: 0–1. Drives the demotion to `review` — see
   * {@link applyConfidenceFloor}. Absent on deterministic findings, which are not
   * probabilistic.
   */
  confidence?: number;
  /** Judgment findings only: why the model reached this verdict. */
  rationale?: string;

  /** Link to the relevant WCAG Understanding document or axe rule help page. */
  helpUrl?: string;
}

/** Everything one scan of one URL produced. */
export interface ScanResult {
  url: string;
  scannedAt: string;
  findings: Finding[];
  /** Present when the judgment pass ran. */
  usage?: JudgmentUsage;
}

/** What the judgment pass cost. Reported so the number in the README stays measured. */
export interface JudgmentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number;
  /** Set when a `--budget` ceiling stopped the pass before every check ran. */
  budgetExhausted?: boolean;
}

/**
 * Below this, a judgment finding is demoted to `review` rather than asserted as a
 * violation. Tuned against `fixtures/` by the eval harness — if precision drops, this
 * is the first dial to turn.
 */
export const DEFAULT_CONFIDENCE_FLOOR = 0.7;

const LEVEL_BASE: Record<ConformanceLevel, Severity> = {
  A: 'serious',
  AA: 'moderate',
  AAA: 'minor',
};

/**
 * Baseline severity from conformance level, before impact and confidence adjust it.
 *
 * Deliberately a pure function rather than something the model decides: a model that
 * both finds the issue and rates its own importance has no independent check on either.
 */
export function baseSeverity(level: ConformanceLevel): Severity {
  return LEVEL_BASE[level];
}

/**
 * Demote a judgment finding the model was unsure about.
 *
 * Deterministic findings pass through untouched — axe is not guessing, so there is no
 * confidence to weigh.
 */
export function applyConfidenceFloor(
  finding: Finding,
  floor: number = DEFAULT_CONFIDENCE_FLOOR,
): Finding {
  if (finding.source !== 'judgment') return finding;
  if (finding.confidence === undefined) return finding;
  if (finding.confidence >= floor) return finding;
  return { ...finding, severity: 'review' };
}

/**
 * Resolve a collision between the two passes in favour of the deterministic one.
 *
 * axe is ground truth where it speaks. A judgment finding that lands on the same
 * element and criterion as an axe finding is dropped rather than reconciled — the
 * alternative is a report that argues with itself.
 */
export function dropJudgmentConflicts(findings: Finding[]): Finding[] {
  const deterministicKeys = new Set(
    findings
      .filter((f) => f.source === 'deterministic')
      .map((f) => `${f.criterion}|${f.element.selector}`),
  );

  return findings.filter(
    (f) =>
      f.source !== 'judgment' || !deterministicKeys.has(`${f.criterion}|${f.element.selector}`),
  );
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
  review: 4,
};

/** Most severe first; `review` always last so it reads as a footnote, not a headline. */
export function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    review: 0,
  };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
