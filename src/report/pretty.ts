/**
 * Terminal reporter.
 *
 * Written for a developer reading it between other work, so the shape is: what happened,
 * then what to fix, then the detail. Findings lead with user impact rather than the rule
 * name — "screen reader users cannot identify this button" is actionable in a way that
 * "button-name" is not.
 */
import { countBySeverity, sortBySeverity, type Finding, type ScanResult } from '../findings.js';
import { getCriterion } from '../wcag.js';

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  serious: 'SERIOUS',
  moderate: 'MODERATE',
  minor: 'MINOR',
  review: 'REVIEW',
};

export interface PrettyOptions {
  /** Disable ANSI colour. Set automatically when stdout is not a TTY. */
  noColor?: boolean;
  bestPracticeCount?: number;
  incompleteCount?: number;
}

function makeStyler(enabled: boolean) {
  const wrap = (code: string) => (s: string) => (enabled ? `[${code}m${s}[0m` : s);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    red: wrap('31'),
    yellow: wrap('33'),
    blue: wrap('34'),
    cyan: wrap('36'),
    sev: (severity: string, s: string) => {
      if (!enabled) return s;
      const code =
        severity === 'critical' || severity === 'serious'
          ? '31'
          : severity === 'moderate'
            ? '33'
            : severity === 'review'
              ? '36'
              : '2';
      return `[${code}m${s}[0m`;
    },
  };
}

function formatFinding(f: Finding, style: ReturnType<typeof makeStyler>): string[] {
  const criterion = getCriterion(f.criterion);
  const lines: string[] = [];

  const label = SEVERITY_LABEL[f.severity] ?? f.severity.toUpperCase();
  lines.push(`  ${style.sev(f.severity, label.padEnd(9))}${style.bold(f.summary)}`);

  const criterionLine = criterion
    ? `WCAG ${f.criterion} ${criterion.title} (Level ${criterion.level ?? '?'})`
    : `WCAG ${f.criterion}`;
  lines.push(`           ${style.dim(criterionLine)}`);

  lines.push(`           ${f.impact}`);
  lines.push(`           ${style.cyan(f.element.selector)}`);
  lines.push(`           ${style.dim(f.element.snippet)}`);

  // Judgment findings must show their reasoning — a verdict the reader cannot audit is
  // not worth acting on.
  if (f.rationale !== undefined) {
    lines.push(`           ${style.dim(`Why: ${f.rationale}`)}`);
  }
  if (f.confidence !== undefined) {
    lines.push(`           ${style.dim(`Confidence: ${f.confidence.toFixed(2)}`)}`);
  }
  if (f.helpUrl !== undefined) {
    lines.push(`           ${style.dim(f.helpUrl)}`);
  }

  lines.push('');
  return lines;
}

/**
 * Notes that qualify the headline number.
 *
 * Shown whether or not there were findings. A page with zero WCAG failures and three
 * advisory issues must not read as flawless — the advice is the only thing left to act
 * on, so hiding it when the news is good is exactly when it matters most.
 */
function footnotes(options: PrettyOptions, style: ReturnType<typeof makeStyler>): string[] {
  const lines: string[] = [];

  if (options.bestPracticeCount !== undefined && options.bestPracticeCount > 0) {
    lines.push(
      style.dim(
        `  ${String(options.bestPracticeCount)} best-practice issues found — advisory, not WCAG failures.`,
      ),
    );
  }
  if (options.incompleteCount !== undefined && options.incompleteCount > 0) {
    lines.push(
      style.dim(
        `  ${String(options.incompleteCount)} checks axe could not decide — these need human review.`,
      ),
    );
  }

  return lines;
}

export function renderPretty(result: ScanResult, options: PrettyOptions = {}): string {
  const style = makeStyler(options.noColor !== true);
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${style.bold('AI Accessibility Engineer')}  ${style.dim(result.url)}`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push(`  ${style.bold('No WCAG failures detected.')}`);
    lines.push('');
    lines.push(...footnotes(options, style));
    lines.push('');
    lines.push(
      style.dim(
        '  Automated testing covers roughly a third of WCAG. A clean result is not a\n' +
          '  conformance claim — it means nothing testable was found.',
      ),
    );
    lines.push('');
    return lines.join('\n');
  }

  for (const finding of sortBySeverity(result.findings)) {
    lines.push(...formatFinding(finding, style));
  }

  const counts = countBySeverity(result.findings);
  const parts = (['critical', 'serious', 'moderate', 'minor', 'review'] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => style.sev(s, `${String(counts[s])} ${s}`));

  lines.push(`  ${style.bold(`${String(result.findings.length)} findings`)}  ${parts.join('  ')}`);
  lines.push(...footnotes(options, style));
  lines.push('');

  return lines.join('\n');
}
