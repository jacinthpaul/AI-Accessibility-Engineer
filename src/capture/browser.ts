/**
 * Browser lifecycle and page capture.
 *
 * Phase 1 needs only a loaded, settled page for axe to run against. The richer capture
 * the judgment pass depends on — screenshots, accessibility tree, focus-order trace —
 * builds on this same session in Phase 2.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface CaptureOptions {
  /** Run with a visible browser window. Useful when debugging why a page fails to settle. */
  headed?: boolean;
  /** Milliseconds to wait for navigation before giving up. */
  timeout?: number;
  /** Viewport to render at. Affects contrast, reflow, and anything layout-dependent. */
  viewport?: { width: number; height: number };
  /** Extra settle time after load, for pages that hydrate or animate in. */
  settleMs?: number;
  /**
   * Chromium binary to drive, instead of the one Playwright downloads. Defaults to
   * `A11Y_CHROMIUM_PATH`. Needed where that download is unavailable — locked-down CI,
   * containers with a preinstalled browser, distro-packaged Chromium.
   */
  executablePath?: string;
}

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface CapturedPage {
  page: Page;
  /** The URL after redirects — what was actually scanned, which may not be what was asked for. */
  finalUrl: string;
  title: string;
}

export interface CaptureSession {
  browser: Browser;
  context: BrowserContext;
  close(): Promise<void>;
}

export async function openSession(options: CaptureOptions = {}): Promise<CaptureSession> {
  const executablePath = options.executablePath ?? process.env.A11Y_CHROMIUM_PATH;

  const browser = await chromium.launch({
    headless: options.headed !== true,
    ...(executablePath !== undefined && executablePath !== '' && { executablePath }),
  });

  // axe-core/playwright requires a browser context rather than a bare page, and a fixed
  // viewport keeps layout-dependent rules (contrast, reflow, target size) reproducible
  // across machines.
  const context = await browser.newContext({
    viewport: options.viewport ?? DEFAULT_VIEWPORT,
  });

  return {
    browser,
    context,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

/**
 * Navigate to a URL and wait for it to settle.
 *
 * Waits for `load` rather than `networkidle`: `networkidle` never fires on pages holding
 * an open socket (analytics beacons, live chat widgets, dev-server HMR), which would hang
 * a scan on exactly the local dev servers this tool is aimed at. `settleMs` covers
 * client-rendered content that arrives after load.
 */
export async function capturePage(
  session: CaptureSession,
  url: string,
  options: CaptureOptions = {},
): Promise<CapturedPage> {
  const page = await session.context.newPage();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  const response = await page.goto(url, { waitUntil: 'load', timeout });

  if (response !== null && !response.ok()) {
    // Not fatal: a 404 page is still a page, and its accessibility still matters. But the
    // caller should know they may be scanning an error page rather than the real thing.
    process.emitWarning(
      `${url} returned HTTP ${String(response.status())}. Scanning the response anyway.`,
    );
  }

  const settleMs = options.settleMs ?? 0;
  if (settleMs > 0) await page.waitForTimeout(settleMs);

  return {
    page,
    finalUrl: page.url(),
    title: await page.title(),
  };
}
