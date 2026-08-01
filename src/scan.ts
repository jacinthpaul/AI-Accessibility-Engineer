/**
 * Scan orchestration: capture, run the passes, reconcile, score.
 *
 * Reporting is deliberately not done here — this returns a result and lets the caller
 * decide how to render it, which is what keeps the CLI, the Action, and the eval harness
 * sharing one code path.
 */
import { openSession, type CaptureOptions } from './capture/browser.js';
import { capturePage } from './capture/browser.js';
import { runAxePass } from './deterministic/run-axe.js';
import {
  applyConfidenceFloor,
  DEFAULT_CONFIDENCE_FLOOR,
  dropJudgmentConflicts,
  sortBySeverity,
  type ConformanceLevel,
  type ScanResult,
  type Severity,
} from './findings.js';

export interface ScanOptions extends CaptureOptions {
  level?: ConformanceLevel;
  /** Phase 2. When false — the default today — only the deterministic pass runs. */
  judgment?: boolean;
  confidenceFloor?: number;
}

export interface ScanOutcome {
  result: ScanResult;
  bestPracticeCount: number;
  incompleteCount: number;
}

export async function scan(url: string, options: ScanOptions = {}): Promise<ScanOutcome> {
  const level = options.level ?? 'AA';
  const session = await openSession(options);

  try {
    const captured = await capturePage(session, url, options);
    const axe = await runAxePass(captured.page, { level });

    // The judgment pass slots in here in Phase 2. Its findings join the same array and
    // go through the same reconciliation below.
    let findings = [...axe.findings];

    findings = dropJudgmentConflicts(findings);
    findings = findings.map((f) =>
      applyConfidenceFloor(f, options.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR),
    );

    return {
      result: {
        // The URL after redirects, so the report names what was actually scanned.
        url: captured.finalUrl,
        scannedAt: new Date().toISOString(),
        findings: sortBySeverity(findings),
      },
      bestPracticeCount: axe.bestPracticeCount,
      incompleteCount: axe.incompleteCount,
    };
  } finally {
    await session.close();
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
  review: 0,
};

/**
 * Whether a scan should fail the build.
 *
 * `review` findings never fail a build on their own: they are the ones the tool was not
 * confident about, and blocking a merge on a maybe is how a checker gets switched off.
 */
export function shouldFail(result: ScanResult, failOn: Severity): boolean {
  const threshold = SEVERITY_RANK[failOn];
  if (threshold === 0) return false;

  return result.findings.some((f) => SEVERITY_RANK[f.severity] >= threshold);
}
