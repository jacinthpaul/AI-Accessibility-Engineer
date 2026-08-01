/**
 * `a11y-engineer wcag` — query the local WCAG 2.2 grounding data.
 *
 * Useful on its own when you need to look a criterion up, but it exists mainly so the
 * data the scanner validates against is directly inspectable. If a finding cites 2.4.11,
 * you can check what 2.4.11 actually is without leaving the terminal or trusting the
 * tool's own summary of it.
 */
import type { ConformanceLevel } from '../findings.js';
import {
  ALL_CRITERIA,
  checkCriterion,
  getCriterion,
  WCAG_SOURCE,
  WCAG_VERSION,
  type Criterion,
} from '../wcag.js';

const LEVELS: readonly string[] = ['A', 'AA', 'AAA'];

export interface WcagCommandOptions {
  list?: boolean;
  level?: string;
  /** Introducing WCAG version. Named `--since` on the CLI to avoid the global `--version`. */
  since?: string;
  check?: string;
  json?: boolean;
}

function formatCriterionLine(c: Criterion): string {
  const level = (c.obsolete ? 'obsolete' : (c.level ?? '?')).padEnd(8);
  return `  ${c.id.padEnd(7)}${level}${`WCAG ${c.version}`.padEnd(10)}${c.title}`;
}

function printOne(c: Criterion): void {
  console.log('');
  console.log(`  ${c.id}  ${c.title}`);
  console.log('');
  console.log(`  Level        ${c.obsolete ? 'none (obsolete)' : (c.level ?? 'unknown')}`);
  console.log(`  Introduced   WCAG ${c.version}`);
  console.log(`  Principle    ${c.principle}`);
  console.log(`  Guideline    ${c.guideline}`);

  if (c.obsolete) {
    console.log('');
    console.log(`  This criterion was removed in WCAG ${WCAG_VERSION} and cannot be failed.`);
    console.log('  Reporting it as a violation is a false positive.');
  }

  console.log('');
  console.log(`  Understanding  ${c.understandingUrl}`);
  console.log(`  Quick reference ${c.quickrefUrl}`);
  console.log('');
}

/** Returns a process exit code. */
export function runWcagCommand(id: string | undefined, options: WcagCommandOptions): number {
  // --check: show how the scanner would treat a criterion, including why it is rejected.
  if (options.check !== undefined) {
    const level = (options.level ?? 'AA') as ConformanceLevel;
    if (!LEVELS.includes(level)) {
      console.error(`Unknown conformance level "${String(options.level)}". Use A, AA, or AAA.`);
      return 2;
    }

    const result = checkCriterion(options.check, level);

    if (options.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }

    if (result.ok) {
      console.log(`OK  ${result.criterion.id} ${result.criterion.title}`);
      console.log(`    Reportable in a level ${level} scan.`);
      return 0;
    }

    console.log(`REJECTED (${result.reason})`);
    console.log(`    ${result.message}`);
    return 1;
  }

  // Look up a single criterion by number.
  if (id !== undefined) {
    const criterion = getCriterion(id);
    if (criterion === undefined) {
      console.error(`"${id}" is not a WCAG ${WCAG_VERSION} success criterion.`);
      console.error('Run `a11y-engineer wcag --list` to see all 87.');
      return 1;
    }

    if (options.json === true) {
      console.log(JSON.stringify(criterion, null, 2));
      return 0;
    }

    printOne(criterion);
    return 0;
  }

  if (options.list !== true) {
    console.error('Specify a criterion (e.g. `wcag 1.4.3`), or use --list / --check.');
    return 2;
  }

  // --list, optionally filtered.
  let criteria = [...ALL_CRITERIA];

  if (options.level !== undefined) {
    const level = options.level;
    if (!LEVELS.includes(level)) {
      console.error(`Unknown conformance level "${level}". Use A, AA, or AAA.`);
      return 2;
    }
    // Exact level, not cumulative — `--list --level AA` answers "which are AA?", whereas
    // a scan targeting AA covers A as well. criteriaAtLevel() is the cumulative one.
    criteria = criteria.filter((c) => c.level === level);
  }

  if (options.since !== undefined) {
    const version = options.since;
    criteria = criteria.filter((c) => c.version === version);
  }

  if (options.json === true) {
    console.log(JSON.stringify(criteria, null, 2));
    return 0;
  }

  console.log('');
  for (const c of criteria) console.log(formatCriterionLine(c));
  console.log('');
  console.log(`  ${String(criteria.length)} of ${String(ALL_CRITERIA.length)} criteria`);
  console.log(`  Source: w3c/wcag @ ${WCAG_SOURCE.ref}`);
  console.log('');

  return 0;
}
