/**
 * Helpers that run inside the page, shared by every check's gatherer.
 *
 * Two constraints shape this file, and both are easy to trip over:
 *
 * 1. `page.evaluate` serialises its callback and runs it in the browser, so a callback
 *    cannot close over anything from this module. The helpers must already exist on the
 *    page — {@link installDomHelpers} puts them there, and gatherers read them off
 *    `window.__a11yHelpers`.
 *
 * 2. The helper bodies are delivered as **source text**, not as a TypeScript function.
 *    esbuild — which backs both `tsx` (`npm run dev`, `npm run eval`) and vitest —
 *    rewrites named function expressions to `__name(fn, "…")` to preserve `Function.name`.
 *    That helper exists in the bundle, not in the page, so a serialised callback
 *    containing `const f = () => …` dies with `ReferenceError: __name is not defined` at
 *    runtime. Source text is never transformed, so it is immune.
 *
 * The same hazard applies to gatherers: a callback passed straight to `page.evaluate`
 * is fine, but declaring a named function *inside* it is not. Call a helper from here
 * instead of introducing one locally.
 */
import type { Page } from 'playwright';

export interface DomHelpers {
  /** A CSS selector that resolves to this element. Generated in code — never by a model. */
  cssPath(el: Element): string;
  /** Collapse whitespace and cut to `max` characters, for report-sized snippets. */
  truncate(s: string, max: number): string;
  /** Whether the element is hidden from assistive technology, and so out of scope. */
  isHidden(el: Element): boolean;
  /** Text of the nearest enclosing container matching `selectors`, truncated. */
  contextText(el: Element, selectors: string, max: number): string;
  /** Text of the enclosing `<figure>`'s caption, or `''` when there is none. */
  captionText(el: Element, max: number): string;
  /**
   * Approximation of a link's accessible name: `aria-label` when present, else the
   * visible text plus the alt text of any image inside it.
   */
  linkName(el: Element, max: number): string;
}

declare global {
  interface Window {
    __a11yHelpers?: DomHelpers;
  }
}

/**
 * The helper implementations, as source text.
 *
 * Deliberately written without template literals so the surrounding TypeScript template
 * does not interpolate `${…}` meant for the browser.
 */
const HELPERS_SOURCE = `
(() => {
  const truncate = (s, max) => {
    const collapsed = String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    return collapsed.length <= max ? collapsed : collapsed.slice(0, max - 1) + '\\u2026';
  };

  const cssPath = (el) => {
    if (el.id !== '') return '#' + CSS.escape(el.id);

    const parts = [];
    let node = el;

    // Six levels is enough to disambiguate in practice, and keeps the selector
    // readable in a report.
    while (node !== null && parts.length < 6) {
      if (node.id !== '') {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }

      let part = node.nodeName.toLowerCase();
      const parent = node.parentElement;
      if (parent !== null) {
        const current = node;
        const siblings = Array.prototype.filter.call(
          parent.children,
          (c) => c.nodeName === current.nodeName,
        );
        if (siblings.length > 1) {
          part += ':nth-of-type(' + String(siblings.indexOf(current) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = parent;
    }

    return parts.join(' > ');
  };

  const isHidden = (el) => {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const style = window.getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  };

  const contextText = (el, selectors, max) => {
    const container = el.closest(selectors);
    return truncate(container === null ? '' : container.textContent, max);
  };

  const captionText = (el, max) => {
    const figure = el.closest('figure');
    if (figure === null) return '';
    const caption = figure.querySelector('figcaption');
    return caption === null ? '' : truncate(caption.textContent, max);
  };

  const linkName = (el, max) => {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel !== null && ariaLabel.trim() !== '') return truncate(ariaLabel, max);
    const alts = Array.prototype.map
      .call(el.querySelectorAll('img'), (img) => img.getAttribute('alt') || '')
      .join(' ');
    return truncate((el.textContent || '') + ' ' + alts, max);
  };

  window.__a11yHelpers = {
    cssPath: cssPath,
    truncate: truncate,
    isHidden: isHidden,
    contextText: contextText,
    captionText: captionText,
    linkName: linkName,
  };
})();
`;

/**
 * Define the helpers on `window`.
 *
 * Idempotent, and must be called after navigation — the helpers live on the page's
 * window object and do not survive a page load.
 */
export async function installDomHelpers(page: Page): Promise<void> {
  await page.evaluate(HELPERS_SOURCE);
}
