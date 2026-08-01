import { describe, expect, it } from 'vitest';

import {
  BEST_PRACTICE_TAG,
  knownCriterionTags,
  mapAxeTags,
  tagForCriterion,
} from '../src/deterministic/axe-tags.js';
import { ALL_CRITERIA } from '../src/wcag.js';

describe('tag generation', () => {
  it('builds axe-style digit-concatenated tags', () => {
    expect(tagForCriterion('1.4.3')).toBe('wcag143');
    expect(tagForCriterion('4.1.2')).toBe('wcag412');
    expect(tagForCriterion('2.4.11')).toBe('wcag2411');
  });

  it('returns nothing for a criterion that does not exist', () => {
    expect(tagForCriterion('1.4.14')).toBeUndefined();
  });

  it('generates a unique tag per criterion', () => {
    // The reason this module generates tags rather than parsing them: `wcag1410` is
    // ambiguous read left-to-right (1.4.10 or 14.1.0). Generating from the authoritative
    // list is only safe if no two criteria collide, so assert that they do not.
    const tags = knownCriterionTags();
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toHaveLength(ALL_CRITERIA.length);
  });
});

describe('mapAxeTags', () => {
  it('maps a real axe rule tag set to its criterion', () => {
    // Verbatim from axe-core's `image-alt` rule.
    const mapping = mapAxeTags(['cat.text-alternatives', 'wcag2a', 'wcag111', 'section508', 'ACT']);

    expect(mapping.criteria.map((c) => c.id)).toEqual(['1.1.1']);
    expect(mapping.bestPractice).toBe(false);
  });

  it('ignores conformance-level tags, which are not criteria', () => {
    // `wcag2a` / `wcag21aa` look like criterion tags but denote a level.
    const mapping = mapAxeTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    expect(mapping.criteria).toHaveLength(0);
  });

  it('returns every criterion a rule cites', () => {
    const mapping = mapAxeTags(['wcag141', 'wcag143']);
    expect(mapping.criteria.map((c) => c.id)).toEqual(['1.4.1', '1.4.3']);
  });

  it('does not duplicate a criterion cited twice', () => {
    const mapping = mapAxeTags(['wcag111', 'wcag111']);
    expect(mapping.criteria).toHaveLength(1);
  });

  it('flags best-practice rules and finds no criterion for them', () => {
    // Verbatim from axe-core's `heading-order` rule — advice, not a WCAG requirement.
    const mapping = mapAxeTags(['cat.semantics', BEST_PRACTICE_TAG]);

    expect(mapping.bestPractice).toBe(true);
    expect(mapping.criteria).toHaveLength(0);
  });

  it('ignores vendor and framework tags', () => {
    const mapping = mapAxeTags([
      'cat.color',
      'wcag143',
      'TTv5',
      'TT13.c',
      'EN-301-549',
      'EN-9.1.4.3',
      'RGAAv4',
      'RGAA-3.2.1',
    ]);

    // EN-9.1.4.3 encodes the same criterion in EN 301 549 numbering. It must not become a
    // second finding for one defect.
    expect(mapping.criteria.map((c) => c.id)).toEqual(['1.4.3']);
  });

  it('never offers the obsolete criterion as reportable', () => {
    // 4.1.1 Parsing was removed in WCAG 2.2; axe's tag for it would be `wcag411`. It is
    // partitioned out rather than dropped, so a rule citing only it is distinguishable
    // from advice.
    const mapping = mapAxeTags(['wcag411']);

    expect(mapping.criteria).toHaveLength(0);
    expect(mapping.obsoleteCriteria.map((c) => c.id)).toEqual(['4.1.1']);
    expect(mapping.bestPractice).toBe(false);
  });

  it('keeps reportable criteria when a rule cites an obsolete one alongside them', () => {
    const mapping = mapAxeTags(['wcag411', 'wcag412']);

    expect(mapping.criteria.map((c) => c.id)).toEqual(['4.1.2']);
    expect(mapping.obsoleteCriteria.map((c) => c.id)).toEqual(['4.1.1']);
  });

  it('handles an empty tag list', () => {
    expect(mapAxeTags([])).toEqual({
      criteria: [],
      obsoleteCriteria: [],
      bestPractice: false,
    });
  });
});
