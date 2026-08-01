import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWcagCommand } from '../src/commands/wcag-command.js';

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const stdout = () => out.join('\n');
const stderr = () => err.join('\n');

describe('lookup', () => {
  it('prints a criterion and exits 0', () => {
    expect(runWcagCommand('1.4.3', {})).toBe(0);
    expect(stdout()).toContain('Contrast (Minimum)');
    expect(stdout()).toContain('AA');
  });

  it('exits 1 for a criterion that does not exist', () => {
    expect(runWcagCommand('1.4.14', {})).toBe(1);
    expect(stderr()).toContain('not a WCAG 2.2 success criterion');
  });

  it('warns that the obsolete criterion cannot be failed', () => {
    expect(runWcagCommand('4.1.1', {})).toBe(0);
    expect(stdout()).toContain('false positive');
  });

  it('exits 2 when given nothing to do', () => {
    expect(runWcagCommand(undefined, {})).toBe(2);
  });
});

describe('--check', () => {
  it('exits 0 for an in-scope criterion', () => {
    expect(runWcagCommand(undefined, { check: '1.4.3', level: 'AA' })).toBe(0);
    expect(stdout()).toContain('OK');
  });

  it('exits 1 and names the reason for each rejection', () => {
    expect(runWcagCommand(undefined, { check: '1.4.14' })).toBe(1);
    expect(stdout()).toContain('unknown');

    out = [];
    expect(runWcagCommand(undefined, { check: '4.1.1' })).toBe(1);
    expect(stdout()).toContain('obsolete');

    out = [];
    expect(runWcagCommand(undefined, { check: '2.4.13', level: 'AA' })).toBe(1);
    expect(stdout()).toContain('out-of-scope');
  });

  it('accepts an AAA criterion when the scan targets AAA', () => {
    expect(runWcagCommand(undefined, { check: '2.4.13', level: 'AAA' })).toBe(0);
  });

  it('exits 2 on an unknown conformance level', () => {
    expect(runWcagCommand(undefined, { check: '1.4.3', level: 'AAAA' })).toBe(2);
    expect(stderr()).toContain('Unknown conformance level');
  });

  it('emits machine-readable output under --json', () => {
    expect(runWcagCommand(undefined, { check: '4.1.1', json: true })).toBe(1);
    const parsed = JSON.parse(stdout()) as { ok: boolean; reason: string };
    expect(parsed).toMatchObject({ ok: false, reason: 'obsolete' });
  });
});

describe('--list', () => {
  it('lists every criterion by default', () => {
    expect(runWcagCommand(undefined, { list: true })).toBe(0);
    expect(stdout()).toContain('87 of 87 criteria');
  });

  it('filters to the nine criteria WCAG 2.2 introduced', () => {
    expect(runWcagCommand(undefined, { list: true, since: '2.2' })).toBe(0);
    expect(stdout()).toContain('9 of 87 criteria');
    expect(stdout()).toContain('Focus Not Obscured (Minimum)');
  });

  it('filters to an exact level', () => {
    expect(runWcagCommand(undefined, { list: true, level: 'AA', json: true })).toBe(0);
    const parsed = JSON.parse(stdout()) as { level: string }[];
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((c) => c.level === 'AA')).toBe(true);
  });

  it('combines filters', () => {
    expect(runWcagCommand(undefined, { list: true, level: 'AA', since: '2.2', json: true })).toBe(
      0,
    );
    const parsed = JSON.parse(stdout()) as { id: string }[];
    expect(parsed.map((c) => c.id)).toEqual(['2.4.11', '2.5.7', '2.5.8', '3.3.8']);
  });

  it('records data provenance in the human-readable output', () => {
    expect(runWcagCommand(undefined, { list: true, since: '2.2' })).toBe(0);
    expect(stdout()).toContain('w3c/wcag @ WCAG22-');
  });

  it('exits 2 on an unknown conformance level', () => {
    expect(runWcagCommand(undefined, { list: true, level: 'B' })).toBe(2);
  });
});
