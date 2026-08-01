/**
 * JSON reporter — the machine-readable contract.
 *
 * Includes the WCAG source ref and tool version so a stored report stays interpretable
 * later: a finding means little if you cannot tell which edition of the standard, or
 * which build of the tool, produced it.
 */
import { countBySeverity, sortBySeverity, type ScanResult } from '../findings.js';
import { WCAG_SOURCE, WCAG_VERSION } from '../wcag.js';

export interface JsonReportOptions {
  toolVersion: string;
  bestPracticeCount?: number;
  incompleteCount?: number;
}

export function renderJson(result: ScanResult, options: JsonReportOptions): string {
  const payload = {
    tool: {
      name: 'ai-accessibility-engineer',
      version: options.toolVersion,
    },
    standard: {
      wcagVersion: WCAG_VERSION,
      source: WCAG_SOURCE.ref,
      specification: WCAG_SOURCE.specification,
    },
    url: result.url,
    scannedAt: result.scannedAt,
    summary: {
      total: result.findings.length,
      bySeverity: countBySeverity(result.findings),
      bestPracticeNotReported: options.bestPracticeCount ?? 0,
      needsHumanReview: options.incompleteCount ?? 0,
    },
    usage: result.usage ?? null,
    findings: sortBySeverity(result.findings),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}
