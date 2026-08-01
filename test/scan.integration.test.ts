/**
 * End-to-end scans against the labelled fixtures.
 *
 * These launch a real browser and run real axe-core, so they are slower than the unit
 * tests — but they are the only place the whole pipeline is exercised together, and the
 * only place a false positive would actually show up.
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scan, shouldFail } from '../src/scan.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixtureUrl = (name: string) => pathToFileURL(join(fixtures, name)).href;

// A browser launch plus an axe run needs more than vitest's 5s default.
const TIMEOUT = 60_000;

describe('violations fixture', () => {
  it(
    'finds every planted violation, and nothing else',
    async () => {
      const { result } = await scan(fixtureUrl('violations.html'));

      const criteria = [...new Set(result.findings.map((f) => f.criterion))].sort();

      // Each is planted deliberately in the fixture and commented there.
      expect(criteria).toEqual(['1.1.1', '1.4.3', '2.4.4', '4.1.2']);
      expect(result.findings).toHaveLength(5);
    },
    TIMEOUT,
  );

  it(
    'anchors every finding to an element and a real criterion',
    async () => {
      const { result } = await scan(fixtureUrl('violations.html'));

      for (const f of result.findings) {
        expect(f.element.selector).not.toBe('');
        expect(f.element.snippet).not.toBe('');
        expect(f.criterion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(f.source).toBe('deterministic');
        // axe does not guess, so deterministic findings carry no confidence score.
        expect(f.confidence).toBeUndefined();
      }
    },
    TIMEOUT,
  );

  it(
    'reports the URL actually scanned',
    async () => {
      const { result } = await scan(fixtureUrl('violations.html'));
      expect(result.url).toContain('violations.html');
    },
    TIMEOUT,
  );
});

describe('clean fixture', () => {
  it(
    'reports nothing on correct markup',
    async () => {
      // The false-positive test. A scanner that invents problems here costs a developer
      // the time to disprove each one, which is worse than missing them.
      const { result, bestPracticeCount } = await scan(fixtureUrl('clean.html'));

      expect(result.findings).toEqual([]);
      expect(bestPracticeCount).toBe(0);
    },
    TIMEOUT,
  );
});

describe('best-practice fixture', () => {
  it(
    'counts advisory issues without calling them WCAG failures',
    async () => {
      const { result, bestPracticeCount } = await scan(fixtureUrl('best-practice-only.html'));

      // The whole point: axe fires here, but no success criterion is failed. Counting
      // these as violations would report failures on a conformant page.
      expect(result.findings).toEqual([]);
      expect(bestPracticeCount).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

describe('conformance level', () => {
  it(
    'excludes AA criteria from an A-only scan',
    async () => {
      const { result } = await scan(fixtureUrl('violations.html'), { level: 'A' });
      const criteria = result.findings.map((f) => f.criterion);

      // 1.4.3 Contrast (Minimum) is AA, so an A-only scan must not raise it.
      expect(criteria).not.toContain('1.4.3');
      expect(criteria).toContain('1.1.1');
    },
    TIMEOUT,
  );
});

describe('shouldFail', () => {
  it(
    'fails the build at or above the threshold',
    async () => {
      const { result } = await scan(fixtureUrl('violations.html'));

      expect(shouldFail(result, 'critical')).toBe(true);
      expect(shouldFail(result, 'serious')).toBe(true);
      expect(shouldFail(result, 'minor')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'passes a clean page at every threshold',
    async () => {
      const { result } = await scan(fixtureUrl('clean.html'));

      for (const level of ['critical', 'serious', 'moderate', 'minor'] as const) {
        expect(shouldFail(result, level)).toBe(false);
      }
    },
    TIMEOUT,
  );
});
