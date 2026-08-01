# AI Accessibility Engineer

A WCAG 2.2 scanner that pairs **axe-core** with an **LLM judgment pass** for the accessibility criteria automation cannot reach.

Automated tools reliably catch roughly 30–45% of WCAG success criteria. The rest need judgment — is this alt text _meaningful_, does the reading order make sense, is the focus indicator actually visible. This project targets that gap.

> ## ⚠️ Status: early development
>
> **`scan` is not implemented yet.** Phase 0 (foundations) is complete; the scanner itself lands in Phase 1.
>
> What works today: the WCAG grounding data and the `wcag` lookup command. See [Roadmap](#roadmap).

## Why another accessibility tool

Most open-source scanners wrap axe-core and compete on reporting. This one is built around two things nothing else in the space does:

1. **A judgment pass for the criteria automation can't test.** Not "an LLM rewords axe's error messages" — a set of narrow, per-criterion checks with their own evidence and confidence scoring.
2. **Measured accuracy.** An eval harness scores each judgment check against labelled fixtures and reports precision and recall. Those numbers get published rather than asserted.

It runs as a CLI and a GitHub Action, using **your own API key**. There is no hosted service, so there is no per-scan cost to anyone but you, and nothing to sign up for.

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

### `scan` — _not implemented yet (Phase 1)_

The intended interface:

```bash
a11y-engineer --url http://localhost:3000                  # both passes
a11y-engineer --url http://localhost:3000 --no-judgment    # axe only, no API key
a11y-engineer --url http://localhost:3000 --format sarif -o results.sarif
```

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

Running it today prints `not implemented yet (Phase 1)` and exits 1.

## How it will work

```
capture ──▶ deterministic pass ──▶ judgment pass ──▶ score ──▶ report
(Playwright)     (axe-core)            (LLM)                 (pretty/json/sarif)
```

**Capture** collects the DOM, the accessibility tree, screenshots, and a **focus-order trace** — tabbing through the page recording focus at each stop, which is what makes focus and keyboard-trap checks possible at all.

**Deterministic pass** runs axe-core against WCAG 2.2 A/AA. Solved problem; we normalise its output and move on.

**Judgment pass** — the differentiator. Each check is narrow and criterion-specific, not "here's a page, find problems":

| Check                            | Criterion      |
| -------------------------------- | -------------- |
| Alt text meaningfulness          | 1.1.1          |
| Decorative vs informative images | 1.1.1          |
| Link purpose in context          | 2.4.4          |
| Heading structure semantics      | 1.3.1 / 2.4.6  |
| Reading order vs visual order    | 1.3.2          |
| Focus visibility                 | 2.4.7 / 2.4.11 |
| Control name quality             | 4.1.2          |

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
npm test           # unit tests
npm run typecheck
npm run lint
npm run build
npm run format     # prettier --write
```

CI runs format, lint, typecheck, build, and tests on Node 20, 22, and 24.

## Roadmap

| Phase | Scope                                                              | Status  |
| ----- | ------------------------------------------------------------------ | ------- |
| 0     | Foundations: finding model, WCAG grounding data, CLI skeleton, CI  | ✅ Done |
| 1     | Capture + deterministic pass + `pretty`/`json` reporters           | Next    |
| 2     | Judgment pass (2 checks) + eval harness reporting precision/recall |         |
| 3     | Remaining judgment checks                                          |         |
| 4     | SARIF reporter + GitHub Action                                     |         |
| 5     | Docs, demo, first npm release                                      |         |

Phase 1 is deliberately useful on its own: a working scanner with no API key required.

Not in v1: hosted web app, PR auto-fix generation, DOM→source mapping, plugin system.

## Licence

[Apache-2.0](LICENSE).

This project depends on **axe-core**, which is licensed under **MPL-2.0**. MPL-2.0 is file-level copyleft, so using it as an unmodified dependency leaves this project's own source under Apache-2.0. See [NOTICE](NOTICE) for details.
