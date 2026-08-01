/**
 * The WCAG 2.2 grounding data, and the rules that keep findings tied to it.
 *
 * `data/wcag.json` is generated from the W3C specification source by
 * `scripts/build-wcag-data.ts` and committed, so lookups are local, offline, and
 * identical for every contributor.
 *
 * This module is what turns "never invent a success criterion" from a line in a prompt
 * into something the code enforces. Any finding — from either pass — must name a
 * criterion that exists here, is not obsolete, and is in scope for the run. A model that
 * hallucinates "WCAG 1.4.14" gets its finding rejected rather than reported.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConformanceLevel, SuccessCriterion } from './findings.js';

export interface Criterion {
  /** Dotted number, e.g. `1.4.3`. */
  id: SuccessCriterion;
  /** Spec slug, e.g. `contrast-minimum`. Used to build W3C URLs. */
  slug: string;
  title: string;
  /** `null` for obsolete criteria, which have no level to conform to. */
  level: ConformanceLevel | null;
  /** WCAG 2.2 removed 4.1.1 Parsing. Obsolete criteria are never reportable. */
  obsolete: boolean;
  /** The WCAG version that introduced this criterion: `2.0`, `2.1`, or `2.2`. */
  version: string;
  principle: string;
  guideline: string;
  understandingUrl: string;
  quickrefUrl: string;
}

interface WcagData {
  source: { repository: string; ref: string; url: string; specification: string };
  wcagVersion: string;
  criteriaCount: number;
  criteria: Criterion[];
}

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '..', 'data', 'wcag.json'), 'utf8')) as WcagData;

const BY_ID = new Map<string, Criterion>(data.criteria.map((c) => [c.id, c]));
const BY_SLUG = new Map<string, Criterion>(data.criteria.map((c) => [c.slug, c]));

/** Which W3C Recommendation this build was generated from. Surfaced in reports. */
export const WCAG_SOURCE = data.source;
export const WCAG_VERSION = data.wcagVersion;

/** Every criterion, in specification order. */
export const ALL_CRITERIA: readonly Criterion[] = Object.freeze(data.criteria);

export function getCriterion(id: string): Criterion | undefined {
  return BY_ID.get(id);
}

export function getCriterionBySlug(slug: string): Criterion | undefined {
  return BY_SLUG.get(slug);
}

/** Criteria at or below the given level — `AA` includes `A`, as conformance requires. */
export function criteriaAtLevel(level: ConformanceLevel): Criterion[] {
  const included: ConformanceLevel[] =
    level === 'A' ? ['A'] : level === 'AA' ? ['A', 'AA'] : ['A', 'AA', 'AAA'];

  return data.criteria.filter((c) => c.level !== null && included.includes(c.level));
}

export type CriterionRejection =
  | { ok: true; criterion: Criterion }
  | { ok: false; reason: 'unknown' | 'obsolete' | 'out-of-scope'; message: string };

/**
 * Decide whether a finding may be reported against this criterion.
 *
 * Called on every finding before it reaches a reporter. The three rejections map to
 * three distinct failure modes worth telling apart when debugging a check:
 *
 * - `unknown`      — the criterion does not exist. A hallucination, or a typo in a check.
 * - `obsolete`     — real, but retired in WCAG 2.2 (only 4.1.1 Parsing). Reporting it is
 *                    a false positive that several shipping tools still emit.
 * - `out-of-scope` — real and current, but above the conformance level being scanned.
 *                    Most often an AAA criterion surfacing in an A/AA run.
 */
export function checkCriterion(
  id: string,
  targetLevel: ConformanceLevel = 'AA',
): CriterionRejection {
  const criterion = BY_ID.get(id);

  if (criterion === undefined) {
    return {
      ok: false,
      reason: 'unknown',
      message: `"${id}" is not a WCAG ${WCAG_VERSION} success criterion.`,
    };
  }

  if (criterion.obsolete || criterion.level === null) {
    return {
      ok: false,
      reason: 'obsolete',
      message: `${id} ${criterion.title} was removed in WCAG ${WCAG_VERSION} and cannot be failed.`,
    };
  }

  const allowed: ConformanceLevel[] =
    targetLevel === 'A' ? ['A'] : targetLevel === 'AA' ? ['A', 'AA'] : ['A', 'AA', 'AAA'];

  if (!allowed.includes(criterion.level)) {
    return {
      ok: false,
      reason: 'out-of-scope',
      message: `${id} ${criterion.title} is level ${criterion.level}, outside a level ${targetLevel} scan.`,
    };
  }

  return { ok: true, criterion };
}

/** Convenience for check authors: throws rather than returning a result. */
export function requireCriterion(id: string, targetLevel: ConformanceLevel = 'AA'): Criterion {
  const result = checkCriterion(id, targetLevel);
  if (!result.ok) throw new Error(result.message);
  return result.criterion;
}
