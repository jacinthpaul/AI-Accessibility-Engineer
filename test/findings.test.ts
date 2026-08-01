import { describe, expect, it } from 'vitest';

import {
  applyConfidenceFloor,
  baseSeverity,
  countBySeverity,
  dropJudgmentConflicts,
  sortBySeverity,
  type Finding,
} from '../src/findings.js';

/** A judgment finding — carries a confidence, since the model is estimating. */
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'test:1',
    checkId: 'test',
    source: 'judgment',
    criterion: '1.1.1',
    level: 'A',
    severity: 'serious',
    summary: 'Alt text does not describe the image.',
    impact: 'Screen reader users get no useful description of this content.',
    element: { selector: 'img.hero', snippet: '<img class="hero" alt="image">' },
    confidence: 0.9,
    ...overrides,
  };
}

/** A deterministic finding — `confidence` is absent, not undefined. axe does not guess. */
function axeFinding(overrides: Partial<Finding> = {}): Finding {
  const { confidence: _confidence, ...rest } = finding(overrides);
  return { ...rest, source: 'deterministic' };
}

describe('baseSeverity', () => {
  it('scales severity with conformance level', () => {
    expect(baseSeverity('A')).toBe('serious');
    expect(baseSeverity('AA')).toBe('moderate');
    expect(baseSeverity('AAA')).toBe('minor');
  });
});

describe('applyConfidenceFloor', () => {
  it('demotes low-confidence judgment findings to review', () => {
    const result = applyConfidenceFloor(finding({ confidence: 0.4 }));
    expect(result.severity).toBe('review');
  });

  it('leaves confident judgment findings asserted', () => {
    const result = applyConfidenceFloor(finding({ confidence: 0.95 }));
    expect(result.severity).toBe('serious');
  });

  it('treats the floor as inclusive', () => {
    const result = applyConfidenceFloor(finding({ confidence: 0.7 }), 0.7);
    expect(result.severity).toBe('serious');
  });

  it('never demotes deterministic findings, which carry no confidence', () => {
    expect(applyConfidenceFloor(axeFinding()).severity).toBe('serious');
  });

  it('respects a caller-supplied floor', () => {
    expect(applyConfidenceFloor(finding({ confidence: 0.8 }), 0.9).severity).toBe('review');
    expect(applyConfidenceFloor(finding({ confidence: 0.8 }), 0.5).severity).toBe('serious');
  });
});

describe('dropJudgmentConflicts', () => {
  it('drops a judgment finding that collides with axe on the same element and criterion', () => {
    const findings = [axeFinding({ id: 'axe:1' }), finding({ id: 'judge:1' })];

    const result = dropJudgmentConflicts(findings);

    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('deterministic');
  });

  it('keeps a judgment finding on the same element under a different criterion', () => {
    const findings = [
      axeFinding({ id: 'axe:1', criterion: '1.1.1' }),
      finding({ id: 'judge:1', criterion: '2.4.4' }),
    ];

    expect(dropJudgmentConflicts(findings)).toHaveLength(2);
  });

  it('keeps a judgment finding on a different element under the same criterion', () => {
    const findings = [
      axeFinding({ id: 'axe:1' }),
      finding({
        id: 'judge:1',
        element: { selector: 'img.thumb', snippet: '<img class="thumb" alt="x">' },
      }),
    ];

    expect(dropJudgmentConflicts(findings)).toHaveLength(2);
  });

  it('never drops deterministic findings', () => {
    const findings = [axeFinding({ id: 'axe:1' }), axeFinding({ id: 'axe:2' })];

    expect(dropJudgmentConflicts(findings)).toHaveLength(2);
  });
});

describe('sortBySeverity', () => {
  it('orders most severe first and parks review last', () => {
    const findings = [
      finding({ id: 'a', severity: 'review' }),
      finding({ id: 'b', severity: 'minor' }),
      finding({ id: 'c', severity: 'critical' }),
      finding({ id: 'd', severity: 'moderate' }),
      finding({ id: 'e', severity: 'serious' }),
    ];

    expect(sortBySeverity(findings).map((f) => f.id)).toEqual(['c', 'e', 'd', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const findings = [
      finding({ id: 'a', severity: 'review' }),
      finding({ id: 'b', severity: 'critical' }),
    ];
    sortBySeverity(findings);
    expect(findings.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('countBySeverity', () => {
  it('reports zero for absent severities', () => {
    expect(countBySeverity([])).toEqual({
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
      review: 0,
    });
  });

  it('tallies each severity', () => {
    const counts = countBySeverity([
      finding({ severity: 'critical' }),
      finding({ severity: 'critical' }),
      finding({ severity: 'review' }),
    ]);

    expect(counts.critical).toBe(2);
    expect(counts.review).toBe(1);
    expect(counts.serious).toBe(0);
  });
});
