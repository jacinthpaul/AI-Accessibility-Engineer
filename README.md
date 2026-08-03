# AI Accessibility Engineer

A WCAG 2.2 scanner that pairs **axe-core** with an **LLM judgment pass** for the accessibility criteria automation cannot reach.

Automated tools reliably catch roughly 30–45% of WCAG success criteria. The rest need judgment — is this alt text _meaningful_, does the reading order make sense, is the focus indicator actually visible. This project targets that gap.

> ## ⚠️ Status: early development
>
> **The deterministic scanner works.** `a11y-engineer --url <url>` runs axe-core against WCAG 2.2 and reports findings — no API key required.
>
> **The judgment pass runs its first two checks** (alt-text meaningfulness and link purpose) when `ANTHROPIC_API_KEY` is set. The remaining checks land in Phase 3. See [Roadmap](#roadmap).

## Why another accessibility tool

Most open-source scanners wrap axe-core and compete on reporting. This one is built around two things nothing else in the space does:

1. **A judgment pass for the criteria automation can't test.** Not "an LLM rewords axe's error messages" — a set of narrow, per-criterion checks with their own evidence and confidence scoring.
2. **Measured accuracy.** An eval harness scores each judgment check against labelled fixtures and reports precision and recall. Those numbers get published rather than asserted. The harness is built; the numbers are not measured yet, so none are claimed here.

It runs as a CLI, using **your own API key** — a GitHub Action follows in Phase 4. There is no hosted service, so there is no per-scan cost to anyone but you, and nothing to sign up for.

## Requirements

- **Node.js 20 or newer**
- An `ANTHROPIC_API_KEY` — only for the judgment pass. The deterministic pass needs no key.

## Install

Not published to npm yet. To run from source:

```bash
git clone https://github.com/jacinthpaul/AI-Accessibility-Engineer.git
cd AI-Accessibility-Engineer
npm install
npm run build
```

Then invoke it with `node dist/cli.js`, or `npm link` to get an `a11y-engineer` command on your PATH.

## Usage

### `wcag` — look up success criteria

Queries the local WCAG 2.2 dataset. Works offline; no API key.

```bash
# Look up one criterion
a11y-engineer wcag 1.4.3

# List all 87, or filter
a11y-engineer wcag --list
a11y-engineer wcag --list --level AA          # exactly level AA
a11y-engineer wcag --list --since 2.2         # the 9 criteria WCAG 2.2 added

# Ask whether a criterion may be reported in a given scan
a11y-engineer wcag --check 4.1.1              # exit 1 — removed in WCAG 2.2
a11y-engineer wcag --check 2.4.13 --level AA  # exit 1 — that criterion is AAA

# Machine-readable
a11y-engineer wcag --list --since 2.2 --json
```

Example:

```
$ a11y-engineer wcag 2.4.11

  2.4.11  Focus Not Obscured (Minimum)

  Level        AA
  Introduced   WCAG 2.2
  Principle    operable
  Guideline    navigable

  Understanding  https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
  Quick reference https://www.w3.org/WAI/WCAG22/quickref/#focus-not-obscured-minimum
```

**Exit codes:** `0` valid · `1` not found or rejected · `2` bad usage. `--check` is scriptable in CI.

### `scan` — scan a page

```bash
a11y-engineer --url http://localhost:3000                   # scan a running dev server
a11y-engineer --url http://localhost:3000 --format json     # machine-readable
a11y-engineer --url http://localhost:3000 --level A         # level A only
a11y-engineer --url http://localhost:3000 --fail-on critical
a11y-engineer --url http://localhost:3000 --settle 2000     # wait for client rendering
```

Example — scanning the bundled fixture of deliberate violations:

```
$ a11y-engineer --url file:///path/to/fixtures/violations.html

  AI Accessibility Engineer  file:///path/to/fixtures/violations.html

  CRITICAL Buttons must have discernible text
           WCAG 4.1.2 Name, Role, Value (Level A)
           Ensure buttons have discernible text
           button
           <button></button>
           https://dequeuniversity.com/rules/axe/4.12/button-name

  SERIOUS  Elements must meet minimum color contrast ratio thresholds
           WCAG 1.4.3 Contrast (Minimum) (Level AA)
           Ensure the contrast between foreground and background colors meets
           WCAG 2 AA minimum contrast ratio thresholds
           p
           <p style="color: #999999; background-color: #ffffff"> This paragraph…

  5 findings  3 critical  2 serious
```

**Exit codes:** `0` clean · `1` findings at or above `--fail-on` · `2` bad usage or scan error.

| Flag                     | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `--url <url>`            | Page to scan (required)                                       |
| `--format <fmt>`         | `pretty` (default), `json`, `sarif`                           |
| `-o, --out <path>`       | Write to a file instead of stdout                             |
| `--no-judgment`          | Deterministic pass only — no API key needed                   |
| `--model <model>`        | Judgment model (default `claude-opus-5`)                      |
| `--budget <usd>`         | Stop the judgment pass past this estimated spend              |
| `--confidence-floor <n>` | Below this, findings are reported as `review` (default `0.7`) |
| `--fail-on <severity>`   | Exit non-zero at or above this severity (default `serious`)   |
| `--level <level>`        | Conformance level to scan: `A`, `AA` (default), `AAA`         |
| `--headed`               | Run with a visible browser window                             |
| `--settle <ms>`          | Extra wait after load, for client-rendered pages              |

The judgment pass runs by default when `ANTHROPIC_API_KEY` is set. Without a key the scan prints a notice and runs the deterministic pass alone, rather than failing or pretending it ran. `--no-judgment` skips it explicitly.

If a check cannot produce a verdict — the model refused, the call failed, the response did not match the schema — the scan says which check was skipped and why. A gap in coverage is reported, never guessed at.

Set `A11Y_CHROMIUM_PATH` to drive a system Chromium instead of the one Playwright downloads, for locked-down CI or containers with a preinstalled browser.

### What a clean result means

A scan reporting no failures is **not** a conformance claim. Automated testing reaches roughly a third of WCAG; the rest needs human judgment, which is exactly the gap this project is being built to narrow. The reporter says so on every clean run rather than letting a green tick imply more than it should.

Two things are counted but deliberately kept out of the failure total:

- **Best-practice issues.** axe rules like `heading-order` and `landmark-one-main` are reasonable advice, but no WCAG criterion requires them. Counting them as violations reports failures on a conformant page, so they are surfaced separately as advisory.
- **Checks axe could not decide.** Usually contrast against a background image. These need a human — and are prime candidates for the judgment pass.

## How it works

```
capture ──▶ deterministic pass ──▶ judgment pass ──▶ score ──▶ report
(Playwright)     (axe-core)            (LLM)                 (pretty/json/sarif)
```

**Capture** loads the page in Chromium at a fixed viewport and waits for it to settle, then hands the live page to both passes — each judgment check queries the DOM for its own evidence rather than working from one generic snapshot.

The checks still to be built need more than the DOM: screenshots for focus visibility, and a **focus-order trace** — tabbing through the page recording focus at each stop, which is what makes focus and keyboard-trap checks possible at all. Collecting those is part of Phase 3.

**Deterministic pass** runs axe-core against WCAG 2.2 A/AA. Solved problem; we normalise its output and move on.

**Judgment pass** — the differentiator. Each check is narrow and criterion-specific, not "here's a page, find problems":

| Check                            | Criterion      | Status   |
| -------------------------------- | -------------- | -------- |
| Alt text meaningfulness          | 1.1.1          | ✅ Built |
| Link purpose in context          | 2.4.4          | ✅ Built |
| Decorative vs informative images | 1.1.1          | Phase 3  |
| Heading structure semantics      | 1.3.1 / 2.4.6  | Phase 3  |
| Reading order vs visual order    | 1.3.2          | Phase 3  |
| Focus visibility                 | 2.4.7 / 2.4.11 | Phase 3  |
| Control name quality             | 4.1.2          | Phase 3  |

Four rules keep it trustworthy, and they are enforced in code rather than requested in a prompt:

- **Every finding cites a specific element** — CSS selector plus DOM snippet. No unanchored claims.
- **Uncertain findings are demoted, not hidden.** Below the confidence floor a finding is reported as `review`, never asserted as a violation.
- **axe wins.** A judgment finding on the same element and criterion as an axe finding is dropped rather than reconciled — a report that argues with itself is worse than one that says less.
- **No invented criteria.** See below.

## The WCAG grounding data

`data/wcag.json` holds all **87** WCAG 2.2 success criteria — number, title, level, introducing version, and W3C URLs. It is generated from the [w3c/wcag](https://github.com/w3c/wcag) repository pinned to the **`WCAG22-20241212` Recommendation tag**, and committed. Scans are offline and byte-identical for every contributor.

Criterion numbering is not stored anywhere in the specification source — it is positional — so the generator derives it by walking `guidelines/index.html` counting principle → guideline → criterion in document order.

This makes _"never invent a success criterion"_ a constraint the code enforces. Every finding passes through `checkCriterion()`, which rejects three distinct failures:

| Rejection      | Meaning                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `unknown`      | The criterion does not exist — a model hallucination, or a typo in a check                                            |
| `obsolete`     | **4.1.1 Parsing**, removed in WCAG 2.2. Several shipping scanners still report it; doing so is a known false positive |
| `out-of-scope` | Real and current, but above the conformance level being scanned                                                       |

To regenerate after a new W3C Recommendation, bump `WCAG_REF` in `scripts/build-wcag-data.ts`, then:

```bash
npm run build:wcag   # rewrites data/wcag.json — review the diff before committing
```

## Development

```bash
npm install
npx playwright install chromium   # integration tests drive a real browser
npm test
npm run typecheck
npm run lint
npm run build
npm run format     # prettier --write
```

CI runs format, lint, typecheck, build, and tests on Node 20, 22, and 24. The tests need no API key — the judgment pass is driven by a scripted model client, so the suite is deterministic and offline.

Where `npx playwright install` is unavailable, point `A11Y_CHROMIUM_PATH` at a system Chromium and the integration tests run against that instead:

```bash
A11Y_CHROMIUM_PATH=/path/to/chrome npm test
```

### Fixtures

`fixtures/` holds pages with deliberately labelled behaviour, and the integration tests assert against them:

| Fixture                   | Asserts                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `violations.html`         | Every planted violation is found, mapped to the right criterion   |
| `clean.html`              | Correct markup yields **zero** findings — the false-positive test |
| `best-practice-only.html` | Advisory issues are counted but **not** reported as WCAG failures |

`clean.html` matters as much as `violations.html`. A scanner that invents problems costs a developer the time to disprove each one, which is worse than missing them.

`fixtures/eval/` holds the labelled pages the eval harness scores against. Every candidate element carries `data-eval-label="violation"` or `"ok"`, and the harness strips those labels before anything reaches the model.

### Measuring the judgment checks

```bash
export ANTHROPIC_API_KEY=...
npm run eval                                  # every check
npm run eval -- --check alt-text-meaningful   # one check
npm run eval -- --model claude-sonnet-5       # compare models
```

The harness reports precision, recall, and F1 per check, and prints every disagreement with the model's own rationale — which is what makes a bad prompt debuggable rather than merely visible. It costs API tokens and is non-deterministic, so it is not part of `npm test` and does not run in CI.

## Roadmap

| Phase | Scope                                                              | Status  |
| ----- | ------------------------------------------------------------------ | ------- |
| 0     | Foundations: finding model, WCAG grounding data, CLI skeleton, CI  | ✅ Done |
| 1     | Capture + deterministic pass + `pretty`/`json` reporters           | ✅ Done |
| 2     | Judgment pass (2 checks) + eval harness reporting precision/recall | ✅ Done |
| 3     | Remaining judgment checks                                          | Next    |
| 4     | SARIF reporter + GitHub Action                                     |         |
| 5     | Docs, demo, first npm release                                      |         |

Phase 1 is deliberately useful on its own: a working scanner with no API key required.

Not in v1: hosted web app, PR auto-fix generation, DOM→source mapping, plugin system.

## Licence

[Apache-2.0](LICENSE).

This project depends on **axe-core**, which is licensed under **MPL-2.0**. MPL-2.0 is file-level copyleft, so using it as an unmodified dependency leaves this project's own source under Apache-2.0. See [NOTICE](NOTICE) for details.
