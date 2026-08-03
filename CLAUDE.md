# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session memory

Read `STATUS.md` at the start of a session — it records what is done, what is verified, and the agreed next steps. Update it before ending a session that changed the state of the project.

## Commands

```bash
npm run dev -- --url <url>        # run the CLI from source (tsx), no build needed
npm run dev -- wcag 1.4.3         # the wcag subcommand, from source
npm test                          # vitest, all tests
npx vitest run test/wcag.test.ts  # a single test file
npm run test:watch                # watch mode
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint
npm run format                    # prettier --write (CI enforces format:check)
npm run build                     # tsc -p tsconfig.build.json → dist/
npm run eval                      # eval harness (tsx eval/run.ts)
npm run build:wcag                # regenerate data/wcag.json from the W3C spec source
```

CI (`.github/workflows/ci.yml`) runs format:check, lint, typecheck, build, and tests on Node 20/22/24 — run all of those before pushing.

The `*.integration.test.ts` files drive a real Chromium via Playwright (`npx playwright install chromium` locally). Where that download is unavailable — the Claude Code cloud container pins a different revision, and the download is proxy-blocked — set `A11Y_CHROMIUM_PATH` to a system Chromium and the whole suite runs:

```bash
A11Y_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm test
```

## Architecture

Pipeline, all passes normalising into one shared model:

```
capture (Playwright) → deterministic pass (axe-core) → judgment pass (LLM)
    → reconcile/score (findings.ts) → report (pretty | json | sarif)
```

- **`src/findings.ts`** — the unified `Finding` model both passes emit and every reporter consumes. Also the scoring rules: `applyConfidenceFloor` (judgment findings below the floor are demoted to severity `review`, never hidden and never asserted), `dropJudgmentConflicts` ("axe wins": a judgment finding on the same criterion+selector as an axe finding is dropped), `sortBySeverity` (`review` always last).
- **`src/wcag.ts` + `data/wcag.json`** — the WCAG 2.2 grounding data (all 87 criteria) and `checkCriterion()`, which every finding must pass before reaching a reporter. Rejections are `unknown` (hallucinated/typo), `obsolete` (4.1.1 Parsing, removed in 2.2), `out-of-scope` (above the scanned level). This is how "never invent a success criterion" is enforced in code rather than requested in a prompt.
- **`src/scan.ts`** — orchestration only; returns a `ScanResult` and deliberately does no reporting, so the CLI, the eval harness, and the future GitHub Action share one code path. `shouldFail` never fails a build on `review` findings.
- **`src/capture/browser.ts`** — browser lifecycle. Waits for `load`, not `networkidle` (which never fires on pages holding a socket open — dev servers, analytics). `settleMs` covers client-rendered content.
- **`src/deterministic/run-axe.ts` + `axe-tags.ts`** — normalises axe output. Best-practice rules are run but partitioned out of findings (counted as advisory, not WCAG failures); rules citing only retired criteria are silent; multi-criterion rules report against one primary criterion to avoid duplicate findings.
- **`src/judgment/`** — the LLM pass. `runner.ts` is where the trust rules live: the model refers to candidates only by index (selectors and snippets come from the gatherer, so no finding can cite an unexamined element), each check's criterion is validated before its findings are accepted, severity comes from the criterion level, confidence is clamped, and a refused or failed call skips the check with a warning rather than guessing. `model.ts` is the only file that talks to the API — everything else takes a `JudgmentModelClient`, which is how tests and the eval harness stay offline. `checks/` holds one narrow check per criterion.
- **`src/commands/`** — CLI command handlers; `src/cli.ts` is flag parsing only.
- **`src/report/`** — reporters consuming `ScanResult`. A clean scan explicitly says it is not a conformance claim.
- **`eval/run.ts`** — scores checks against labelled fixtures and reports precision/recall. Needs an API key; deliberately outside `npm test` and CI.

## Conventions and constraints

- ESM throughout; relative imports use `.js` extensions (`./findings.js`) even from `.ts` files.
- `exactOptionalPropertyTypes` is on: build optional fields with conditional spread (`...(x != null && { key: x })`), never assign `undefined`.
- `data/wcag.json` is generated — never hand-edit. Regenerate with `npm run build:wcag` (pinned to a W3C Recommendation tag via `WCAG_REF` in `scripts/build-wcag-data.ts`) and review the diff.
- Severity is policy, not model output: base severity derives from conformance level (`baseSeverity`), axe's impact is trusted for deterministic findings, and confidence only ever demotes to `review`. Don't let a judgment check pick its own severity.
- **Never declare a named function inside a `page.evaluate` callback.** esbuild — which backs `tsx` (`npm run dev`, `npm run eval`) and vitest — rewrites `const f = () => …` to `__name(fn, "f")`, and that helper does not exist in the browser, so the callback dies with `ReferenceError: __name is not defined`. Typecheck and `tsc` builds do not catch it. Shared browser-side logic goes in `checks/dom-helpers.ts`, which ships its bodies as source text for exactly this reason; call those helpers off `window.__a11yHelpers` instead of writing local ones.
- Every finding must be anchored to an element (`selector` + `snippet`). No unanchored claims.
- `fixtures/clean.html` is the false-positive test and matters as much as `violations.html`: a scanner that invents problems is worse than one that misses them. Changes that make `clean.html` produce findings are wrong until proven otherwise.
- axe-core is MPL-2.0 and must stay an unmodified dependency (see `NOTICE`); don't vendor or patch it.
