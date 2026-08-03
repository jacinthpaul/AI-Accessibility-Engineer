# STATUS

Cross-session memory for this project. **Read this first; update it before ending any session that changes project state.** Keep it short — this is a logbook, not documentation (that lives in `README.md` and `docs/USER-GUIDE.md`).

_Last updated: 2026-08-03_

## Where we are

| Phase | Scope                                                        | Status      |
| ----- | ------------------------------------------------------------ | ----------- |
| 0     | Finding model, WCAG grounding data, CLI skeleton, CI         | ✅ Done     |
| 1     | Capture + deterministic axe pass + `pretty`/`json` reporters | ✅ Done     |
| 2     | Judgment pass (2 checks) + eval harness (precision/recall)   | ✅ Done     |
| 3     | Remaining judgment checks                                    | ⬅️ Next     |
| 4     | SARIF reporter + GitHub Action                               | Not started |
| 5     | Docs, demo, first npm release                                | Not started |

Working today: `a11y-engineer wcag …` (offline lookup) and `a11y-engineer --url …` (axe pass, plus the judgment pass when `ANTHROPIC_API_KEY` is set — without a key it prints a notice and runs the deterministic pass alone). `--model`, `--budget`, and `--confidence-floor` are all live.

## Verified state (2026-08-03)

- Typecheck, lint, build: pass. **Tests: 116/116 pass**, integration suite included.
- The integration tests need a browser. Playwright's download is proxy-blocked in the cloud container and its pinned revision (1234) isn't present, so run them against the container's Chromium:
  `A11Y_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm test`
- The eval harness has **not** been run — no `ANTHROPIC_API_KEY` was available in the session that built it. Its precision/recall numbers are therefore unmeasured, and the prompts are untuned. **This is the first thing to do next.**
- Branch: `claude/project-status-check-fge3c3`.

## Decisions on record

- **axe wins** over judgment findings on the same criterion+selector (`dropJudgmentConflicts`).
- Judgment findings below the confidence floor (default **0.7**) demote to `review`; `review` never fails a build.
- Every finding passes `checkCriterion()` — unknown / obsolete (4.1.1) / out-of-scope criteria rejected in code.
- The model refers to candidates **only by index**; selectors and snippets come from the gatherer, so no finding can cite an element that was never examined.
- Severity is policy (criterion level + axe impact), never chosen by the model. Confidence is clamped to 0–1.
- A refused/failed/malformed model call **skips the check with a warning** — the pass never guesses, and a coverage gap is always reported.
- `model.ts` is the only file that talks to the API; everything else takes a `JudgmentModelClient`, so tests and evals stay offline.
- Best-practice axe rules are counted, never reported as WCAG failures.
- `data/wcag.json` is generated from W3C tag `WCAG22-20241212`; regenerate only via `npm run build:wcag`.
- `fixtures/clean.html` must always produce zero findings — the false-positive guard.
- Default judgment model: `claude-opus-5`, with the server-side refusal fallback opted into. Users bring their own key; no hosted service.

## Gotcha that cost time (don't rediscover it)

**Never declare a named function inside a `page.evaluate` callback.** esbuild (behind `tsx` and vitest) rewrites `const f = () => …` into `__name(fn, "f")`; that helper doesn't exist in the browser, so the callback throws `ReferenceError: __name is not defined` at runtime. `tsc` builds are unaffected, and typecheck never catches it. Shared browser-side code lives in `src/judgment/checks/dom-helpers.ts`, which ships its bodies as **source text** to stay immune; call those helpers off `window.__a11yHelpers`.

## Next steps

1. **Run `npm run eval` with a real API key** and tune the two check prompts against the results. The fixtures and harness are ready; the numbers are not yet known.
2. Publish the measured precision/recall in the README once they are real.
3. Phase 3: the remaining judgment checks (decorative images, heading semantics, reading order, focus visibility, control names). Focus/reading-order checks need richer capture — screenshots and a focus-order trace — which `capture/browser.ts` does not collect yet.
4. Backlog: SARIF reporter + GitHub Action (Phase 4); npm publish (Phase 5).

## Session log

- **2026-08-03** — Added `CLAUDE.md`, `docs/USER-GUIDE.md`, `STATUS.md`. Built Phase 2: judgment infrastructure (`src/judgment/`), the alt-text (1.1.1) and link-purpose (2.4.4) checks, labelled eval fixtures, the eval harness, and 30 new tests. Added `A11Y_CHROMIUM_PATH` so the integration suite can run against a system Chromium.
- **(earlier)** — `7de7091` Phase 1: deterministic scanner. `1a4a096` Phase 0: foundations, WCAG data, CLI skeleton.
