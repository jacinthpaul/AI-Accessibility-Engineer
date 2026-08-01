#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { runScanCommand, type ScanCommandOptions } from './commands/scan-command.js';
import { runWcagCommand, type WcagCommandOptions } from './commands/wcag-command.js';
import { DEFAULT_CONFIDENCE_FLOOR } from './findings.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  version: string;
};

const program = new Command();

program
  .name('a11y-engineer')
  .description(
    'WCAG scanner: axe-core for the deterministic pass, an LLM judgment pass for the rest.',
  )
  .version(pkg.version);

program
  .command('scan', { isDefault: true })
  .description('Scan a URL for WCAG 2.2 A/AA issues')
  .requiredOption('--url <url>', 'URL to scan')
  .option('--format <format>', 'output format: pretty | json | sarif', 'pretty')
  .option('-o, --out <path>', 'write the report to a file instead of stdout')
  .option('--no-judgment', 'run only the deterministic axe-core pass (no API key needed)')
  .option('--model <model>', 'model for the judgment pass', 'claude-opus-5')
  .option('--budget <usd>', 'stop the judgment pass once estimated spend exceeds this', parseFloat)
  .option(
    '--confidence-floor <n>',
    'judgment findings below this are reported as review, not violations',
    parseFloat,
    DEFAULT_CONFIDENCE_FLOOR,
  )
  .option('--fail-on <severity>', 'exit non-zero at or above this severity', 'serious')
  .option('--level <level>', 'conformance level to scan: A | AA | AAA', 'AA')
  .option('--headed', 'run with a visible browser window')
  .option('--settle <ms>', 'extra wait after load, for client-rendered pages', parseInt)
  .action(async (options: Omit<ScanCommandOptions, 'toolVersion'>) => {
    process.exitCode = await runScanCommand({ ...options, toolVersion: pkg.version });
  });

program
  .command('wcag')
  .description('Look up WCAG 2.2 success criteria from the local grounding data')
  .argument('[criterion]', 'criterion number, e.g. 1.4.3')
  .option('--list', 'list criteria')
  .option('--level <level>', 'filter or check against a conformance level: A | AA | AAA')
  // Not `--version`: that collides with the program-level version flag and is silently
  // swallowed by it.
  .option('--since <version>', 'filter by introducing WCAG version: 2.0 | 2.1 | 2.2')
  .option('--check <criterion>', 'report whether a criterion is valid to raise a finding against')
  .option('--json', 'emit JSON')
  .action((criterion: string | undefined, options: WcagCommandOptions) => {
    process.exitCode = runWcagCommand(criterion, options);
  });

program.parse();
