import { altTextCheck } from './checks/alt-text.js';
import type { JudgmentCheck } from './checks/check.js';
import { linkPurposeCheck } from './checks/link-purpose.js';

/** The checks a default scan runs. Grows as Phase 3 lands more of them. */
export const DEFAULT_CHECKS: JudgmentCheck[] = [altTextCheck, linkPurposeCheck];

export { altTextCheck } from './checks/alt-text.js';
export type { Candidate, JudgmentCheck } from './checks/check.js';
export { linkPurposeCheck } from './checks/link-purpose.js';
export {
  AnthropicModelClient,
  estimateCostUsd,
  type JudgmentModelClient,
  type JudgmentRequest,
  type JudgmentResponse,
  type UsageDelta,
} from './model.js';
export {
  buildUserPrompt,
  runJudgmentPass,
  VERDICT_SCHEMA,
  verdictsToFindings,
  type JudgmentPassOptions,
  type JudgmentPassResult,
} from './runner.js';
