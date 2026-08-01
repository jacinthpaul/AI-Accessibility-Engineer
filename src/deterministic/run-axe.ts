/**
 * The deterministic pass: axe-core, normalised into the shared finding model.
 *
 * axe is treated as ground truth. Nothing here second-guesses its verdicts; the work is
 * mapping its output onto WCAG criteria, dropping what is not a conformance failure, and
 * describing the result in terms of who it affects.
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';

import type { ConformanceLevel, ElementRef, Finding, Severity } from '../findings.js';
import { checkCriterion } from '../wcag.js';
import { mapAxeTags } from './axe-tags.js';

/** axe rule tags selecting the WCAG criteria in scope for each conformance level. */
const TAGS_BY_LEVEL: Record<ConformanceLevel, string[]> = {
  A: ['wcag2a', 'wcag21a'],
  AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  AAA: [
    'wcag2a',
    'wcag2aa',
    'wcag2aaa',
    'wcag21a',
    'wcag21aa',
    'wcag21aaa',
    'wcag22aa',
    'wcag22aaa',
  ],
};

/**
 * Best-practice rules are requested alongside the WCAG ones so their count can be
 * reported, then partitioned out of the findings below.
 *
 * Leaving them out of the run entirely would be simpler, but then a page with no WCAG
 * failures and three advisory issues reads as flawless — the user never learns the advice
 * exists. Running them and separating them is the honest version: the conformance number
 * stays correct, and the advice is still surfaced as advice.
 */
const BEST_PRACTICE_TAGS = ['best-practice'];

export interface AxePassOptions {
  level?: ConformanceLevel;
}

export interface AxePassResult {
  findings: Finding[];
  /**
   * axe rules that fired but describe advice rather than a WCAG requirement. Counted and
   * surfaced separately so the conformance number stays honest — folding these in is how
   * a scan reports more failures than the standard actually defines.
   */
  bestPracticeCount: number;
  /**
   * Rules axe could not decide, typically because a computed style or background image
   * defeats automated contrast checking. These are real candidates for the judgment pass.
   */
  incompleteCount: number;
  /**
   * Nodes flagged by a rule whose only criterion WCAG 2.2 retired. Zero against current
   * axe versions; tracked so that if a future axe reintroduces such a rule, the nodes
   * show up in accounting rather than vanishing.
   */
  obsoleteRuleCount: number;
}

/** axe's impact vocabulary matches ours; it is well calibrated, so it is used directly. */
function severityFromImpact(impact: string | null | undefined): Severity {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'serious';
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    default:
      return 'moderate';
  }
}

function truncate(html: string, max = 240): string {
  const collapsed = html.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/** axe returns selectors that may be nested (for iframes); join them the way axe displays them. */
function flattenTarget(target: readonly unknown[]): string {
  return target
    .map((t) => (Array.isArray(t) ? t.join(' ') : String(t)))
    .join(' >>> ')
    .trim();
}

export async function runAxePass(page: Page, options: AxePassOptions = {}): Promise<AxePassResult> {
  const level = options.level ?? 'AA';

  const results = await new AxeBuilder({ page })
    .withTags([...TAGS_BY_LEVEL[level], ...BEST_PRACTICE_TAGS])
    .analyze();

  const findings: Finding[] = [];
  let bestPracticeCount = 0;
  let obsoleteRuleCount = 0;

  for (const violation of results.violations) {
    const mapping = mapAxeTags(violation.tags);

    if (mapping.criteria.length === 0) {
      // Two different reasons a rule yields no finding, kept apart so neither is
      // misreported as the other:
      //
      // - advice, which is worth surfacing as a count;
      // - a rule citing only a criterion WCAG 2.2 retired (4.1.1 Parsing), which is not
      //   a failure under this edition of the standard and is correctly silent.
      if (mapping.bestPractice) bestPracticeCount += violation.nodes.length;
      else if (mapping.obsoleteCriteria.length > 0) obsoleteRuleCount += violation.nodes.length;
      continue;
    }

    // Report against the most specific criterion axe cites. A rule spanning several
    // criteria (link-in-text-block covers 1.4.1 and 1.4.3) would otherwise produce
    // duplicate findings for one defect.
    const primary =
      mapping.criteria.find((c) => checkCriterion(c.id, level).ok) ?? mapping.criteria[0];

    if (primary === undefined) continue;

    // Should not happen — axe was filtered by level — but the guarantee is worth keeping
    // local rather than assumed.
    const verdict = checkCriterion(primary.id, level);
    if (!verdict.ok) continue;

    for (const node of violation.nodes) {
      const selector = flattenTarget(node.target);
      const element: ElementRef = {
        selector,
        snippet: truncate(node.html),
      };

      findings.push({
        id: `${violation.id}:${selector}`,
        checkId: violation.id,
        source: 'deterministic',
        criterion: primary.id,
        level: verdict.criterion.level ?? 'A',
        severity: severityFromImpact(node.impact ?? violation.impact),
        summary: violation.help,
        impact: violation.description,
        element,
        helpUrl: violation.helpUrl,
        // Spread rather than assign undefined: exactOptionalPropertyTypes distinguishes
        // "absent" from "present but undefined", and the schema means the former.
        ...(node.failureSummary != null && { remediation: node.failureSummary }),
      });
    }
  }

  return {
    findings,
    bestPracticeCount,
    incompleteCount: results.incomplete.length,
    obsoleteRuleCount,
  };
}
