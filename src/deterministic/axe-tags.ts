/**
 * Mapping axe-core rule tags to WCAG success criteria.
 *
 * axe encodes criteria as digit-concatenated tags: `wcag143` is 1.4.3, `wcag412` is
 * 4.1.2. Parsing those digits directly is ambiguous — `wcag1410` could split as 1.4.10
 * or 14.1.0 — so this module works the other way round: it generates the expected tag
 * for each of the 87 criteria in the grounding data and builds a reverse lookup. Every
 * entry is therefore a real criterion by construction, and there is nothing to guess.
 *
 * Not every axe rule maps to a criterion. Rules tagged `best-practice` (heading-order,
 * landmark-one-main, region) are accessibility advice that no WCAG criterion requires.
 * Reporting them as conformance failures overstates the result, so they are separated
 * out rather than folded in.
 */
import { ALL_CRITERIA, getCriterion, type Criterion } from '../wcag.js';

/** `1.4.3` -> `wcag143`. Mirrors axe's own tag construction. */
function criterionToTag(id: string): string {
  return `wcag${id.replace(/\./g, '')}`;
}

const TAG_TO_CRITERION = new Map<string, Criterion>();
for (const criterion of ALL_CRITERIA) {
  TAG_TO_CRITERION.set(criterionToTag(criterion.id), criterion);
}

/**
 * Tags that describe a conformance *level* rather than a criterion (`wcag2a`,
 * `wcag21aa`, ...). They look like criterion tags but are not, so they are excluded
 * explicitly rather than left to fail the lookup silently.
 */
const LEVEL_TAG = /^wcag2\d*a{1,3}$/;

/** axe's marker for rules that are advice, not WCAG requirements. */
export const BEST_PRACTICE_TAG = 'best-practice';

export interface RuleMapping {
  /**
   * Reportable criteria this rule maps to. Empty for best-practice rules, and for rules
   * that map only to an obsolete criterion.
   */
  criteria: Criterion[];
  /**
   * Criteria the rule cites that have been retired from WCAG 2.2 — in practice only
   * 4.1.1 Parsing.
   *
   * Kept separate rather than merged into `criteria` so a rule that maps *only* to an
   * obsolete criterion is distinguishable from advice. Both produce no finding, but for
   * different reasons, and silently conflating them would hide a rule disappearing from
   * the report entirely.
   */
  obsoleteCriteria: Criterion[];
  /** True when axe classifies the rule as advice rather than a conformance requirement. */
  bestPractice: boolean;
}

/**
 * Resolve an axe rule's tags to WCAG criteria.
 *
 * A rule can carry several criterion tags (axe's `link-in-text-block` covers both 1.4.1
 * and 1.4.3), so this returns all of them rather than picking one.
 *
 * Obsolete criteria are partitioned out here rather than downstream: a finding can never
 * validly be raised against one, so keeping them out of `criteria` means no caller has to
 * remember to re-check.
 */
export function mapAxeTags(tags: readonly string[]): RuleMapping {
  const criteria: Criterion[] = [];
  const obsoleteCriteria: Criterion[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    if (LEVEL_TAG.test(tag)) continue;

    const criterion = TAG_TO_CRITERION.get(tag);
    if (criterion === undefined || seen.has(criterion.id)) continue;

    seen.add(criterion.id);
    if (criterion.obsolete) obsoleteCriteria.push(criterion);
    else criteria.push(criterion);
  }

  return {
    criteria,
    obsoleteCriteria,
    bestPractice: tags.includes(BEST_PRACTICE_TAG),
  };
}

/**
 * The axe tag for a criterion, if axe could plausibly emit one.
 *
 * Exposed mainly so tests can assert the mapping round-trips.
 */
export function tagForCriterion(id: string): string | undefined {
  return getCriterion(id) === undefined ? undefined : criterionToTag(id);
}

/** Every criterion tag this build recognises. Used by tests to check for collisions. */
export function knownCriterionTags(): string[] {
  return [...TAG_TO_CRITERION.keys()];
}
