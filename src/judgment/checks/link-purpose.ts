/**
 * Link purpose in context — WCAG 2.4.4 Link Purpose (In Context).
 *
 * axe checks that a link has *a* name; it cannot tell whether "click here" or "read
 * more" identifies where the link goes. The criterion allows the purpose to come from
 * the link text together with its programmatically determined context (the same
 * sentence, paragraph, list item, or table cell), so the evidence includes both.
 */
import type { Page } from 'playwright';

import type { Candidate, JudgmentCheck } from './check.js';
import { installDomHelpers } from './dom-helpers.js';

const MAX_CANDIDATES = 80;

export const linkPurposeCheck: JudgmentCheck = {
  id: 'link-purpose-in-context',
  criterion: '2.4.4',

  instructions: [
    'Each candidate is a link (<a href>). Judge whether a screen reader user, hearing the',
    'link name plus its immediate context, could determine where the link leads. WCAG',
    '2.4.4 allows the purpose to come from the link text combined with its',
    'programmatically determined context — the surrounding sentence, list item, or table',
    'cell — so a generic name rescued by clear adjacent context is NOT a violation.',
    '',
    'Report a violation when:',
    '- the name is generic ("click here", "read more", "learn more", "link", a bare URL',
    '  hash or number) AND the provided context does not disambiguate the destination;',
    '- the name is an unreadable raw URL where nothing in context describes the target;',
    '- the name actively misdescribes the destination implied by the href.',
    '',
    'Do NOT report a violation when:',
    '- the context field makes the destination clear even though the link text alone is',
    '  generic (e.g. "Read more" inside a list item that names the article);',
    '- the name is short but specific ("Pricing", "Contact", "Download PDF");',
    '- the destination is honestly ambiguous to any user, sighted or not — this criterion',
    '  is about parity of information, not perfect link naming.',
  ].join('\n'),

  async gather(page: Page): Promise<Candidate[]> {
    await installDomHelpers(page);

    // No named function may be declared inside this callback — see dom-helpers.ts.
    return page.evaluate((max: number) => {
      const h = window.__a11yHelpers;
      if (h === undefined) throw new Error('DOM helpers were not installed.');

      const results: {
        selector: string;
        snippet: string;
        evidence: Record<string, string>;
        evalLabel?: string;
      }[] = [];

      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        if (results.length >= max) break;
        if (h.isHidden(a)) continue;

        const name = h.linkName(a, 200);
        // Nameless links are axe's finding (link-name), not this check's.
        if (name === '') continue;

        const label = a.getAttribute('data-eval-label');

        results.push({
          selector: h.cssPath(a),
          snippet: h.truncate(a.outerHTML, 240),
          evidence: {
            name,
            href: h.truncate(a.getAttribute('href') ?? '', 200),
            // The programmatically determined context 2.4.4 allows: the enclosing
            // sentence, list item, table cell, or paragraph.
            context: h.contextText(a, 'li, td, th, p, figcaption, h1, h2, h3, h4, h5, h6', 240),
          },
          ...(label !== null && { evalLabel: label }),
        });
      }
      return results;
    }, MAX_CANDIDATES);
  },
};
