/**
 * `a11y-engineer scan` — run a scan and render the result.
 */
import { writeFile } from 'node:fs/promises';

import type { ConformanceLevel, Severity } from '../findings.js';
import { renderJson } from '../report/json.js';
import { renderPretty } from '../report/pretty.js';
import { scan, shouldFail } from '../scan.js';

const SEVERITIES: readonly string[] = ['critical', 'serious', 'moderate', 'minor', 'review'];
const LEVELS: readonly string[] = ['A', 'AA', 'AAA'];

export interface ScanCommandOptions {
  url: string;
  format?: string;
  out?: string;
  judgment?: boolean;
  level?: string;
  model?: string;
  budget?: number;
  confidenceFloor?: number;
  failOn?: string;
  headed?: boolean;
  settle?: number;
  toolVersion: string;
}

/** Returns a process exit code. */
export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const format = options.format ?? 'pretty';
  if (!['pretty', 'json', 'sarif'].includes(format)) {
    console.error(`Unknown format "${format}". Use pretty, json, or sarif.`);
    return 2;
  }
  if (format === 'sarif') {
    console.error('SARIF output is not implemented yet (Phase 4). Use pretty or json.');
    return 2;
  }

  const level = (options.level ?? 'AA') as ConformanceLevel;
  if (!LEVELS.includes(level)) {
    console.error(`Unknown conformance level "${String(options.level)}". Use A, AA, or AAA.`);
    return 2;
  }

  const failOn = (options.failOn ?? 'serious') as Severity;
  if (!SEVERITIES.includes(failOn)) {
    console.error(
      `Unknown severity "${String(options.failOn)}". Use one of: ${SEVERITIES.join(', ')}.`,
    );
    return 2;
  }

  // The judgment pass arrives in Phase 2. Say so rather than silently ignoring the flag —
  // a user who asked for it should not believe they got it.
  if (options.judgment === true) {
    console.error('Note: the judgment pass is not implemented yet (Phase 2).');
    console.error('      Running the deterministic axe-core pass only.\n');
  }

  let outcome;
  try {
    outcome = await scan(options.url, {
      level,
      judgment: false,
      ...(options.confidenceFloor !== undefined && { confidenceFloor: options.confidenceFloor }),
      ...(options.headed !== undefined && { headed: options.headed }),
      ...(options.settle !== undefined && { settleMs: options.settle }),
    });
  } catch (error) {
    console.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const rendered =
    format === 'json'
      ? renderJson(outcome.result, {
          toolVersion: options.toolVersion,
          bestPracticeCount: outcome.bestPracticeCount,
          incompleteCount: outcome.incompleteCount,
        })
      : renderPretty(outcome.result, {
          noColor: options.out !== undefined || !process.stdout.isTTY,
          bestPracticeCount: outcome.bestPracticeCount,
          incompleteCount: outcome.incompleteCount,
        });

  if (options.out !== undefined) {
    await writeFile(options.out, rendered, 'utf8');
    console.error(`Wrote ${options.out}`);
  } else {
    console.log(rendered);
  }

  return shouldFail(outcome.result, failOn) ? 1 : 0;
}
