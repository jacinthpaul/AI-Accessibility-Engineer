# STATUS

Cross-session memory for this project. **Read this first; update it before ending any session that changes project state.** Keep it short — this is a logbook, not documentation (that lives in `README.md` and `docs/USER-GUIDE.md`).

_Last updated: 2026-08-03_

## Where we are

| Phase | Scope                                                            | Status         |
| ----- | ---------------------------------------------------------------- | -------------- |
| 0     | Finding model, WCAG grounding data, CLI skeleton, CI             | ✅ Done        |
| 1     | Capture + deterministic axe pass + `pretty`/`json` reporters     | ✅ Done        |
| 2     | Judgment pass (first 2 checks) + eval harness (precision/recall) | 🚧 In progress |
| 3     | Remaining judgment checks                                        | Not started    |
| 4     | SARIF reporter + GitHub Action                                   | Not started    |
| 5     | Docs, demo, first npm release                                    | Not started    |

Working today (no API key): `a11y-engineer wcag …` (offline criterion lookup, `--list`/`--check`/`--json`) and `a11y-engineer --url …` (full axe scan, severity exit codes, best-practice kept advisory). `--model`, `--budget`, `--confidence-floor` are parsed but inert until Phase 2.

## Verified state (2026-08-03)

- Typecheck, lint, build: pass.
- Tests: 78/86 pass locally in the cloud container. The 8 failures are all `test/scan.integration.test.ts` and are **environmental** — the container's pre-installed Chromium revision (1194) doesn't match Playwright 1.62.1's pinned revision (1234). They pass where `npx playwright install chromium` has run (CI does this).
- Branch: work happens on `claude/project-status-check-fge3c3`; `main` and the branch were identical at commit `7de7091` before this session's docs.

## Decisions on record

- **axe wins** over judgment findings on the same criterion+selector (`dropJudgmentConflicts`).
- Judgment findings below the confidence floor (default **0.7**) demote to severity `review`; `review` never fails a build (`shouldFail`).
- Every finding passes `checkCriterion()` — unknown / obsolete (4.1.1) / out-of-scope criteria are rejected in code.
- Best-practice axe rules are counted, never reported as WCAG failures.
- Severity is policy (level-based + axe impact), never chosen by the model.
- `data/wcag.json` is generated from W3C tag `WCAG22-20241212`; regenerate only via `npm run build:wcag`.
- `fixtures/clean.html` must always produce zero findings — the false-positive guard.
- Default judgment model: `claude-opus-5`. Users bring their own `ANTHROPIC_API_KEY`; no hosted service.

## Phase 2 plan (agreed scope)

1. **Judgment infrastructure** (`src/judgment/`): Anthropic client wrapper, per-check runner, structured JSON output, criterion validation via `checkCriterion`, element anchoring, token/cost accounting (`JudgmentUsage`), `--budget` enforcement, findings merged through the existing reconciliation in `scan.ts`.
2. **Check 1 — alt-text meaningfulness (1.1.1)**: gather `<img>` candidates (alt, surrounding context) at capture time; judge whether alt is meaningful vs filename/placeholder/redundant.
3. **Check 2 — link purpose in context (2.4.4)**: gather links with accessible name + programmatic context; judge whether purpose is determinable ("click here", bare URLs, duplicate names → different targets).
4. **Eval harness** (`eval/run.ts` — `npm run eval` already points there): labelled fixtures with known-good/known-bad cases per check; report precision/recall per check; runs only when `ANTHROPIC_API_KEY` is set (not in CI).
5. **Tests**: unit tests with a mocked model client (no network in CI); fixtures for both checks.
6. Wire `--judgment` in `scan-command.ts` (currently prints a "not yet" notice).

## Session log

- **2026-08-03** — Reviewed project state after break; confirmed Phases 0–1 done and pushed. Added `CLAUDE.md`, `docs/USER-GUIDE.md`, and this file. Started Phase 2.
- **(earlier)** — `7de7091` Phase 1: working deterministic scanner. `1a4a096` Phase 0: foundations, WCAG grounding data, CLI skeleton.

## Next steps

- Finish Phase 2 per the plan above; update the README roadmap table and this file when it lands.
- After Phase 2: publish measured precision/recall numbers in the README.
- Backlog: SARIF reporter + GitHub Action (Phase 4); npm publish (Phase 5).
