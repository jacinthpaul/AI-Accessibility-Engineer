/**
 * The judgment-check contract.
 *
 * A check is deliberately narrow: one WCAG criterion, one question, its own evidence.
 * The runner owns everything a check must not be trusted with — criterion validation,
 * severity, element anchoring, confidence handling — so a check contributes only the
 * evidence gathering and the question.
 */
import type { Page } from 'playwright';

import type { SuccessCriterion } from '../../findings.js';

export interface Candidate {
  /** CSS selector resolving to the element at capture time. Generated in code, never by the model. */
  selector: string;
  /** Truncated outerHTML for the report. */
  snippet: string;
  /**
   * The check-specific facts shown to the model, keyed by short field names
   * (`alt`, `context`, …). This is the model's entire view of the element.
   */
  evidence: Record<string, string>;
  /**
   * Ground-truth label read from a `data-eval-label` attribute, when present. Used by
   * the eval harness to score verdicts; never included in anything sent to the model.
   */
  evalLabel?: string;
}

export interface JudgmentCheck {
  /** Stable identifier, e.g. `alt-text-meaningful`. Becomes the finding's `checkId`. */
  id: string;
  /** The single criterion this check reports against. Validated by the runner. */
  criterion: SuccessCriterion;
  /** The question, phrased for the model: what constitutes a violation, and what does not. */
  instructions: string;
  /** Collect candidate elements and their evidence from the live page. */
  gather(page: Page): Promise<Candidate[]>;
}
