export {
  applyConfidenceFloor,
  baseSeverity,
  countBySeverity,
  DEFAULT_CONFIDENCE_FLOOR,
  dropJudgmentConflicts,
  sortBySeverity,
} from './findings.js';

export type {
  ConformanceLevel,
  ElementRef,
  Finding,
  FindingSource,
  JudgmentUsage,
  ScanResult,
  Severity,
  SuccessCriterion,
} from './findings.js';

export {
  ALL_CRITERIA,
  checkCriterion,
  criteriaAtLevel,
  getCriterion,
  getCriterionBySlug,
  requireCriterion,
  WCAG_SOURCE,
  WCAG_VERSION,
} from './wcag.js';

export type { Criterion, CriterionRejection } from './wcag.js';
