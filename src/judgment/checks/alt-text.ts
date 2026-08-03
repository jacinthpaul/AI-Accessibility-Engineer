/**
 * Alt text meaningfulness — WCAG 1.1.1 Non-text Content.
 *
 * axe verifies that an `alt` attribute exists; it cannot tell `alt="Chart showing Q3
 * revenue up 12%"` from `alt="IMG_4032.jpg"`. Both pass the deterministic pass. This
 * check asks the question axe cannot: does the alt text serve as a substitute for the
 * image, for someone who cannot see it?
 *
 * Scope: images that *have* non-empty alt text. Missing alt is axe's finding
 * (`image-alt`), and `alt=""` is a deliberate decorative marker this check must not
 * second-guess without seeing the rendered image.
 */
import type { Page } from 'playwright';

import type { Candidate, JudgmentCheck } from './check.js';
import { installDomHelpers } from './dom-helpers.js';

const MAX_CANDIDATES = 50;

export const altTextCheck: JudgmentCheck = {
  id: 'alt-text-meaningful',
  criterion: '1.1.1',

  instructions: [
    'Each candidate is an <img> element that has non-empty alt text. Judge whether that',
    'alt text works as a text alternative — whether it gives a person who cannot see the',
    'image the information the image conveys in its context.',
    '',
    'Report a violation when the alt text is:',
    '- a filename or URL fragment (e.g. "IMG_4032.jpg", "photo-final-v2");',
    '- placeholder or generic text that describes nothing (e.g. "image", "photo", "graphic", "icon");',
    '- redundant restatement of adjacent text, adding noise instead of information;',
    '- clearly unrelated to what the surrounding context implies the image shows.',
    '',
    'Do NOT report a violation when:',
    '- the alt text is short but plausibly descriptive ("Company logo" on a header logo is fine);',
    '- you cannot tell whether the alt text matches the image — you see only the markup,',
    '  not the rendered image, so uncertainty must lower your confidence, not raise it;',
    '- the alt text is imperfect but a reasonable person would still call it a usable substitute.',
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

      for (const img of Array.from(document.querySelectorAll('img'))) {
        if (results.length >= max) break;

        const alt = img.getAttribute('alt');
        // Missing alt belongs to axe; empty alt is a decorative marker. Both out of scope.
        if (alt === null || alt.trim() === '') continue;
        if (h.isHidden(img)) continue;

        const src = img.getAttribute('src') ?? '';
        const label = img.getAttribute('data-eval-label');
        // A figure's caption describes the image better than its enclosing block does.
        const caption = h.captionText(img, 200);

        results.push({
          selector: h.cssPath(img),
          snippet: h.truncate(img.outerHTML, 240),
          evidence: {
            alt: h.truncate(alt, 300),
            filename: src.split('/').pop()?.split('?')[0] ?? '',
            context:
              caption !== ''
                ? caption
                : h.contextText(img, 'p, li, td, th, a, button, section, article, div', 200),
          },
          ...(label !== null && { evalLabel: label }),
        });
      }
      return results;
    }, MAX_CANDIDATES);
  },
};
