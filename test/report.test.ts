import { describe, expect, it } from 'vitest';

import type { Finding, ScanResult } from '../src/findings.js';
import { renderJson } from '../src/report/json.js';
import { renderPretty } from '../src/report/pretty.js';

function result(findings: Finding[] = []): ScanResult {
  return {
    url: 'https://example.com/',
    scannedAt: '2026-08-01T00:00:00.000Z',
    findings,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'image-alt:img',
    checkId: 'image-alt',
    source: 'deterministic',
    criterion: '1.1.1',
    level: 'A',
    severity: 'critical',
    summary: 'Images must have alternative text',
    impact: 'Screen reader users get no description of this image.',
    element: { selector: 'img.hero', snippet: '<img class="hero">' },
    ...overrides,
  };
}

describe('renderPretty', () => {
  const opts = { noColor: true };

  it('names the criterion and its level, not just the rule', () => {
    const out = renderPretty(result([finding()]), opts);

    expect(out).toContain('WCAG 1.1.1 Non-text Content (Level A)');
    expect(out).toContain('img.hero');
  });

  it('leads with user impact rather than the rule id', () => {
    const out = renderPretty(result([finding()]), opts);
    expect(out).toContain('Screen reader users get no description');
  });

  it('caveats a clean result instead of implying conformance', () => {
    // A clean automated scan is not a conformance claim, and saying so is the difference
    // between a useful tool and a misleading one.
    const out = renderPretty(result([]), opts);

    expect(out).toContain('No WCAG failures detected');
    expect(out).toContain('not a\n  conformance claim');
  });

  it('surfaces advisory issues even when there are no failures', () => {
    // Otherwise a page with six advisory issues and no failures reads as flawless.
    const out = renderPretty(result([]), { ...opts, bestPracticeCount: 6 });

    expect(out).toContain('6 best-practice issues found');
    expect(out).toContain('advisory, not WCAG failures');
  });

  it('surfaces advisory issues alongside failures too', () => {
    const out = renderPretty(result([finding()]), { ...opts, bestPracticeCount: 2 });
    expect(out).toContain('2 best-practice issues found');
  });

  it('flags checks that need a human', () => {
    const out = renderPretty(result([]), { ...opts, incompleteCount: 3 });
    expect(out).toContain('3 checks axe could not decide');
  });

  it('shows reasoning and confidence for judgment findings', () => {
    const out = renderPretty(
      result([
        finding({
          source: 'judgment',
          confidence: 0.82,
          rationale: 'The alt text repeats the filename rather than describing the image.',
        }),
      ]),
      opts,
    );

    expect(out).toContain('Why: The alt text repeats the filename');
    expect(out).toContain('Confidence: 0.82');
  });

  it('omits confidence for deterministic findings', () => {
    const out = renderPretty(result([finding()]), opts);
    expect(out).not.toContain('Confidence:');
  });

  it('emits no ANSI escapes when colour is disabled', () => {
    const out = renderPretty(result([finding()]), opts);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\[/);
  });

  it('summarises counts by severity', () => {
    const out = renderPretty(
      result([finding({ id: 'a' }), finding({ id: 'b', severity: 'serious' })]),
      opts,
    );

    expect(out).toContain('2 findings');
    expect(out).toContain('1 critical');
    expect(out).toContain('1 serious');
  });
});

describe('renderJson', () => {
  const opts = { toolVersion: '1.2.3' };

  it('records which standard edition and tool version produced the report', () => {
    // A stored report is uninterpretable later without both.
    const parsed = JSON.parse(renderJson(result([finding()]), opts)) as Record<string, never>;

    expect(parsed).toMatchObject({
      tool: { name: 'ai-accessibility-engineer', version: '1.2.3' },
      standard: { wcagVersion: '2.2', source: 'WCAG22-20241212' },
    });
  });

  it('summarises severities and separates advisory counts', () => {
    const json = renderJson(result([finding()]), {
      ...opts,
      bestPracticeCount: 4,
      incompleteCount: 2,
    });
    const parsed = JSON.parse(json) as { summary: Record<string, unknown> };

    expect(parsed.summary).toMatchObject({
      total: 1,
      bestPracticeNotReported: 4,
      needsHumanReview: 2,
    });
  });

  it('is valid JSON with a trailing newline', () => {
    const json = renderJson(result([finding()]), opts);
    expect(json.endsWith('\n')).toBe(true);
    expect(() => {
      JSON.parse(json);
    }).not.toThrow();
  });

  it('orders findings by severity', () => {
    const json = renderJson(
      result([finding({ id: 'a', severity: 'minor' }), finding({ id: 'b', severity: 'critical' })]),
      opts,
    );
    const parsed = JSON.parse(json) as { findings: { id: string }[] };

    expect(parsed.findings.map((f) => f.id)).toEqual(['b', 'a']);
  });
});
