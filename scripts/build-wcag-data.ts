/**
 * Regenerates `data/wcag.json` from the W3C WCAG specification source.
 *
 * Run with: npm run build:wcag
 *
 * The generated file is committed, so a normal build and a normal scan never touch the
 * network. This script exists so the data has traceable provenance and can be rebuilt
 * when W3C publishes a new Recommendation — not so it runs routinely.
 *
 * Source of truth is the w3c/wcag repository, pinned to a published Recommendation tag
 * rather than a branch, so regenerating always produces the same bytes.
 *
 * Criterion numbering is not stored in the spec source; it is positional. `index.html`
 * nests principle > guideline > success-criterion sections in document order, so the
 * number for each is derived by counting: the Nth principle, its Mth guideline, that
 * guideline's Kth criterion.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A published W3C Recommendation tag. Bump deliberately, then re-run and review the diff. */
const WCAG_REF = 'WCAG22-20241212';

const RAW_BASE = `https://raw.githubusercontent.com/w3c/wcag/${WCAG_REF}/guidelines`;
const REPO_URL = `https://github.com/w3c/wcag/tree/${WCAG_REF}/guidelines`;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(here, '..', 'data', 'wcag.json');

/** Directory name in `guidelines/sc/` -> the WCAG version that introduced the criterion. */
const VERSION_BY_DIR: Record<string, string> = {
  '20': '2.0',
  '21': '2.1',
  '22': '2.2',
};

interface RawCriterion {
  number: string;
  slug: string;
  version: string;
  principle: string;
  guideline: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${String(res.status)} ${res.statusText}`);
  return res.text();
}

/**
 * Walk `index.html` in document order, assigning positional numbers.
 *
 * A single regex over all three section kinds keeps them in one ordered stream, which is
 * what makes the counting correct — matching each kind separately would lose the
 * interleaving that defines which guideline a criterion belongs to.
 */
function parseIndex(html: string): RawCriterion[] {
  const pattern =
    /<section\s+class="principle"\s+id="([^"]+)"|<section\s+class="guideline"\s+id="([^"]+)"|data-include="sc\/(\d{2})\/([^"]+)\.html"/g;

  const criteria: RawCriterion[] = [];
  let principleNo = 0;
  let guidelineNo = 0;
  let criterionNo = 0;
  let principleId = '';
  let guidelineId = '';

  for (const m of html.matchAll(pattern)) {
    const [, principle, guideline, versionDir, slug] = m;

    if (principle !== undefined) {
      principleNo += 1;
      guidelineNo = 0;
      criterionNo = 0;
      principleId = principle;
      continue;
    }

    if (guideline !== undefined) {
      guidelineNo += 1;
      criterionNo = 0;
      guidelineId = guideline;
      continue;
    }

    if (versionDir !== undefined && slug !== undefined) {
      const version = VERSION_BY_DIR[versionDir];
      if (version === undefined) throw new Error(`Unknown SC version directory: ${versionDir}`);

      criterionNo += 1;
      criteria.push({
        number: `${String(principleNo)}.${String(guidelineNo)}.${String(criterionNo)}`,
        slug,
        version,
        principle: principleId,
        guideline: guidelineId,
      });
    }
  }

  return criteria;
}

interface ParsedCriterion {
  title: string;
  /** `null` for obsolete criteria, which have no conformance level to meet. */
  level: string | null;
  obsolete: boolean;
}

function parseCriterionFile(html: string, slug: string): ParsedCriterion {
  const title = /<h4>\s*(.*?)\s*<\/h4>/s.exec(html)?.[1];
  if (title === undefined) throw new Error(`No <h4> title in sc/${slug}.html`);

  // Titles carry inline markup and entities in a few places; strip to plain text.
  const plainTitle = title
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  const level = /<p\s+class="conformance-level">\s*(A+)\s*<\/p>/.exec(html)?.[1];

  // WCAG 2.2 retired 4.1.1 Parsing. It keeps its number so the criteria after it are not
  // renumbered, but it has no conformance level and must never be reported as a
  // violation — tools that still flag it are emitting a known false positive.
  const obsolete = /\(Obsolete and removed\)/i.test(plainTitle);

  if (obsolete) {
    if (level !== undefined) {
      throw new Error(`sc/${slug}.html is marked obsolete but still declares a level`);
    }
    return { title: plainTitle, level: null, obsolete: true };
  }

  if (level === undefined) throw new Error(`No conformance-level in sc/${slug}.html`);
  if (level !== 'A' && level !== 'AA' && level !== 'AAA') {
    throw new Error(`Unexpected conformance level "${level}" in sc/${slug}.html`);
  }

  return { title: plainTitle, level, obsolete: false };
}

/** Bounded concurrency — 80-odd small files, but no reason to open 80 sockets at once. */
async function mapWithPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  });

  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  console.error(`Fetching WCAG source at ${WCAG_REF}...`);
  const index = await fetchText(`${RAW_BASE}/index.html`);
  const raw = parseIndex(index);
  console.error(`  found ${String(raw.length)} success criteria in index.html`);

  const criteria = await mapWithPool(raw, 8, async (c) => {
    const versionDir = Object.entries(VERSION_BY_DIR).find(([, v]) => v === c.version)?.[0];
    const html = await fetchText(`${RAW_BASE}/sc/${String(versionDir)}/${c.slug}.html`);
    const { title, level, obsolete } = parseCriterionFile(html, c.slug);

    return {
      id: c.number,
      slug: c.slug,
      title,
      level,
      obsolete,
      version: c.version,
      principle: c.principle,
      guideline: c.guideline,
      understandingUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${c.slug}.html`,
      quickrefUrl: `https://www.w3.org/WAI/WCAG22/quickref/#${c.slug}`,
    };
  });

  const payload = {
    $schema: './wcag.schema.json',
    generatedBy: 'scripts/build-wcag-data.ts',
    source: {
      repository: 'https://github.com/w3c/wcag',
      ref: WCAG_REF,
      url: REPO_URL,
      specification: 'https://www.w3.org/TR/WCAG22/',
      note: 'Criterion numbering is positional and derived from section order in guidelines/index.html.',
    },
    wcagVersion: '2.2',
    criteriaCount: criteria.length,
    criteria,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const byLevel = criteria.reduce<Record<string, number>>((acc, c) => {
    const key = c.level ?? 'obsolete';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const byVersion = criteria.reduce<Record<string, number>>((acc, c) => {
    acc[c.version] = (acc[c.version] ?? 0) + 1;
    return acc;
  }, {});

  console.error(`Wrote ${OUT_PATH}`);
  console.error(`  ${String(criteria.length)} criteria`);
  console.error(`  by level:   ${JSON.stringify(byLevel)}`);
  console.error(`  by version: ${JSON.stringify(byVersion)}`);
}

await main();
