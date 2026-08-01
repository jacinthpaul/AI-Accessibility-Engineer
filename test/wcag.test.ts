import { describe, expect, it } from 'vitest';

import {
  ALL_CRITERIA,
  checkCriterion,
  criteriaAtLevel,
  getCriterion,
  getCriterionBySlug,
  requireCriterion,
  WCAG_SOURCE,
  WCAG_VERSION,
} from '../src/wcag.js';

describe('dataset integrity', () => {
  it('carries all 87 WCAG 2.2 success criteria', () => {
    expect(ALL_CRITERIA).toHaveLength(87);
    expect(WCAG_VERSION).toBe('2.2');
  });

  it('records provenance pinned to a published Recommendation, not a branch', () => {
    expect(WCAG_SOURCE.repository).toBe('https://github.com/w3c/wcag');
    expect(WCAG_SOURCE.ref).toMatch(/^WCAG\d{2}-\d{8}$/);
  });

  it('splits by introducing version as W3C published them', () => {
    const byVersion = (v: string) => ALL_CRITERIA.filter((c) => c.version === v).length;
    expect(byVersion('2.0')).toBe(61);
    expect(byVersion('2.1')).toBe(17);
    expect(byVersion('2.2')).toBe(9);
  });

  it('has unique, well-formed criterion numbers', () => {
    const ids = ALL_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('gives every non-obsolete criterion a level, and obsolete ones none', () => {
    for (const c of ALL_CRITERIA) {
      if (c.obsolete) expect(c.level).toBeNull();
      else expect(['A', 'AA', 'AAA']).toContain(c.level);
    }
  });
});

describe('getCriterion', () => {
  it('resolves criteria with correct level and title', () => {
    expect(getCriterion('1.1.1')).toMatchObject({ title: 'Non-text Content', level: 'A' });
    expect(getCriterion('1.4.3')).toMatchObject({ title: 'Contrast (Minimum)', level: 'AA' });
    expect(getCriterion('4.1.2')).toMatchObject({ title: 'Name, Role, Value', level: 'A' });
  });

  it('resolves criteria WCAG 2.2 introduced', () => {
    expect(getCriterion('2.4.11')).toMatchObject({
      title: 'Focus Not Obscured (Minimum)',
      level: 'AA',
      version: '2.2',
    });
    expect(getCriterion('2.5.8')).toMatchObject({ title: 'Target Size (Minimum)', level: 'AA' });
  });

  it('returns undefined for a criterion that does not exist', () => {
    expect(getCriterion('1.4.14')).toBeUndefined();
    expect(getCriterion('9.9.9')).toBeUndefined();
  });

  it('resolves by slug too', () => {
    expect(getCriterionBySlug('contrast-minimum')?.id).toBe('1.4.3');
    expect(getCriterionBySlug('not-a-real-slug')).toBeUndefined();
  });

  it('links to the W3C Understanding document', () => {
    expect(getCriterion('1.1.1')?.understandingUrl).toBe(
      'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    );
  });
});

describe('checkCriterion', () => {
  it('accepts an in-scope criterion', () => {
    const result = checkCriterion('1.4.3', 'AA');
    expect(result.ok).toBe(true);
  });

  it('rejects a hallucinated criterion as unknown', () => {
    const result = checkCriterion('1.4.14', 'AA');
    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('rejects 4.1.1 Parsing, which WCAG 2.2 removed', () => {
    // Several shipping scanners still report this. Doing so is a false positive.
    const result = checkCriterion('4.1.1', 'AA');
    expect(result).toMatchObject({ ok: false, reason: 'obsolete' });
  });

  it('rejects an AAA criterion during an AA scan', () => {
    // 2.4.13 Focus Appearance is AAA — easy to reach for when writing a focus check.
    expect(getCriterion('2.4.13')?.level).toBe('AAA');
    expect(checkCriterion('2.4.13', 'AA')).toMatchObject({ ok: false, reason: 'out-of-scope' });
  });

  it('accepts an AAA criterion when the scan targets AAA', () => {
    expect(checkCriterion('2.4.13', 'AAA').ok).toBe(true);
  });

  it('rejects an AA criterion during an A-only scan', () => {
    expect(checkCriterion('1.4.3', 'A')).toMatchObject({ ok: false, reason: 'out-of-scope' });
  });

  it('defaults to an AA scope', () => {
    expect(checkCriterion('1.4.3').ok).toBe(true);
    expect(checkCriterion('2.4.13').ok).toBe(false);
  });

  it('explains itself in the rejection message', () => {
    const result = checkCriterion('4.1.1', 'AA');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('removed in WCAG 2.2');
  });
});

describe('criteriaAtLevel', () => {
  it('includes lower levels, as conformance requires', () => {
    const a = criteriaAtLevel('A');
    const aa = criteriaAtLevel('AA');
    const aaa = criteriaAtLevel('AAA');

    expect(aa.length).toBeGreaterThan(a.length);
    expect(aaa.length).toBeGreaterThan(aa.length);
    expect(aa.map((c) => c.id)).toEqual(expect.arrayContaining(a.map((c) => c.id)));
  });

  it('never includes the obsolete criterion at any level', () => {
    for (const level of ['A', 'AA', 'AAA'] as const) {
      expect(criteriaAtLevel(level).some((c) => c.id === '4.1.1')).toBe(false);
    }
  });

  it('covers every active criterion at AAA', () => {
    expect(criteriaAtLevel('AAA')).toHaveLength(ALL_CRITERIA.filter((c) => !c.obsolete).length);
  });
});

describe('requireCriterion', () => {
  it('returns the criterion when valid', () => {
    expect(requireCriterion('1.1.1').title).toBe('Non-text Content');
  });

  it('throws on an invalid criterion', () => {
    expect(() => requireCriterion('1.4.14')).toThrow(/not a WCAG 2.2 success criterion/);
  });
});
