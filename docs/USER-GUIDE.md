# AI Accessibility Engineer — User Guide

A command-line WCAG 2.2 scanner that pairs **axe-core** (the industry-standard deterministic engine) with an **LLM judgment pass** for the accessibility criteria automation cannot reach.

> **Where the project stands:** the deterministic scanner and the WCAG lookup tool work today, with no API key. The judgment pass — the headline feature — is under development (Phase 2 of the [roadmap](../README.md#roadmap)). Flags that belong to it (`--model`, `--budget`, `--confidence-floor`) are accepted but inert until it lands.

---

## 1. What this tool is

Automated accessibility tools reliably test roughly 30–45% of WCAG success criteria — the mechanical ones, like "does this image have an `alt` attribute" or "is this contrast ratio at least 4.5:1". The rest require judgment: is that alt text _meaningful_, or is it `alt="image123.jpg"`? Does "click here" tell a screen-reader user where the link goes? Is the focus indicator actually visible against this background?

This tool targets that gap with a two-pass design:

1. **Deterministic pass** — axe-core runs against WCAG 2.2 A/AA. Fast, free, no API key, no false positives worth arguing about. This works today.
2. **Judgment pass** _(in development)_ — a set of narrow, per-criterion LLM checks, each with its own evidence gathering and confidence scoring, using **your own Anthropic API key**. Not "here's a page, find problems" — each check asks one specific question about specific elements.

There is no hosted service, no sign-up, and no per-scan cost to anyone but you.

### What makes it trustworthy

Four rules are enforced in code, not requested in a prompt:

- **Every finding cites a specific element** — a CSS selector plus a DOM snippet. No unanchored claims like "the page has poor headings".
- **Uncertain findings are demoted, not hidden.** A judgment finding below the confidence floor is reported with severity `review` — flagged for a human, never asserted as a violation, and never able to fail your build on its own.
- **axe wins.** If the judgment pass and axe both flag the same element for the same criterion, the judgment finding is dropped. A report that argues with itself is worse than one that says less.
- **No invented criteria.** Every finding is validated against a local dataset of all 87 WCAG 2.2 success criteria, generated from the W3C specification source. A hallucinated criterion number, the retired 4.1.1 Parsing criterion, or an AAA criterion in an AA scan are all rejected before they reach the report.

---

## 2. Installation

**Requirements:**

- Node.js **20 or newer**
- An `ANTHROPIC_API_KEY` environment variable — _only_ for the judgment pass. Everything documented as working today needs no key.

Not yet published to npm. From source:

```bash
git clone https://github.com/jacinthpaul/AI-Accessibility-Engineer.git
cd AI-Accessibility-Engineer
npm install
npx playwright install chromium   # the browser the scanner drives
npm run build
npm link                          # optional: puts `a11y-engineer` on your PATH
```

Without `npm link`, substitute `node dist/cli.js` wherever this guide says `a11y-engineer`.

---

## 3. Scanning a page: `scan`

`scan` is the default command — `a11y-engineer --url …` and `a11y-engineer scan --url …` are the same thing.

```bash
# Scan a running dev server
a11y-engineer --url http://localhost:3000

# A local file works too
a11y-engineer --url file:///absolute/path/to/page.html

# Client-rendered app? Give it time to hydrate after load
a11y-engineer --url http://localhost:3000 --settle 2000

# Machine-readable output, written to a file
a11y-engineer --url http://localhost:3000 --format json -o report.json

# Only level A, and only fail the build on critical issues
a11y-engineer --url http://localhost:3000 --level A --fail-on critical

# Watch the browser do it (debugging a page that won't settle)
a11y-engineer --url http://localhost:3000 --headed
```

### Flags

| Flag                     | Purpose                                                      | Default         |
| ------------------------ | ------------------------------------------------------------ | --------------- |
| `--url <url>`            | Page to scan (required)                                      | —               |
| `--format <fmt>`         | `pretty`, `json`, or `sarif`                                 | `pretty`        |
| `-o, --out <path>`       | Write the report to a file instead of stdout                 | stdout          |
| `--level <level>`        | Conformance level: `A`, `AA`, `AAA`                          | `AA`            |
| `--fail-on <severity>`   | Exit non-zero at or above this severity                      | `serious`       |
| `--settle <ms>`          | Extra wait after `load`, for client-rendered pages           | `0`             |
| `--headed`               | Run with a visible browser window                            | headless        |
| `--no-judgment`          | Deterministic pass only — no API key needed                  | (current mode)  |
| `--model <model>`        | Judgment model _(inert until Phase 2)_                       | `claude-opus-5` |
| `--budget <usd>`         | Stop the judgment pass past this estimated spend _(Phase 2)_ | —               |
| `--confidence-floor <n>` | Below this, judgment findings become `review` _(Phase 2)_    | `0.7`           |

### Exit codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | No findings at or above the `--fail-on` severity           |
| `1`  | Findings at or above `--fail-on`                           |
| `2`  | Bad usage or scan error (page unreachable, invalid flag …) |

This is what makes the scanner CI-friendly: `a11y-engineer --url … --fail-on serious` in a pipeline step fails the build exactly when it should.

### Reading a report

Each finding shows, in order: severity, a one-line summary, the WCAG criterion it fails (number, name, level), the impact, the element's CSS selector, a DOM snippet, and a help URL.

Severities, most to least alarming:

- `critical` / `serious` / `moderate` / `minor` — asserted violations, calibrated by axe's impact ratings (and, later, by conformance level for judgment findings).
- `review` — _judgment findings only_: the model saw something but wasn't confident past the floor. Always listed last, never fails a build. Treat these as a to-check list, not a defect list.

Two counts appear in the summary line but are deliberately **not** violations:

- **Best-practice issues** — axe rules like `heading-order` and `landmark-one-main` are good advice, but no WCAG criterion requires them. Counting them as failures would report violations on a conformant page, so they're surfaced separately as advisory.
- **Undecided checks** — things axe couldn't determine, usually contrast against a background image. These need a human (and are prime candidates for the judgment pass).

### What a clean result means

A scan with no failures is **not** a conformance claim, and the reporter says so on every clean run. Automated testing covers roughly a third of WCAG; a green tick means "nothing detectable is wrong", not "this page is accessible". Manual testing — keyboard-only navigation, a screen reader session — is still the other two-thirds.

---

## 4. Looking up criteria: `wcag`

An offline reference for all 87 WCAG 2.2 success criteria, backed by data generated from the W3C specification source. No network, no key.

```bash
a11y-engineer wcag 1.4.3                      # one criterion: level, version, links
a11y-engineer wcag --list                     # all 87
a11y-engineer wcag --list --level AA          # exactly level AA
a11y-engineer wcag --list --since 2.2         # the 9 criteria WCAG 2.2 added
a11y-engineer wcag --list --json              # machine-readable
```

The `--check` form answers "may a finding be reported against this criterion in this scan?" and is scriptable (exit `0` yes / `1` no / `2` bad usage):

```bash
a11y-engineer wcag --check 4.1.1              # exit 1 — removed in WCAG 2.2
a11y-engineer wcag --check 2.4.13 --level AA  # exit 1 — that criterion is AAA
a11y-engineer wcag --check 1.4.3 --level AA   # exit 0 — valid
```

Fun fact this dataset encodes: **4.1.1 Parsing** no longer exists in WCAG 2.2, yet several shipping scanners still report it. This tool structurally cannot.

---

## 5. Using it in CI

Until the GitHub Action ships (Phase 4), a plain pipeline step works:

```yaml
- run: npm ci && npx playwright install --with-deps chromium && npm run build
- run: npm start & npx wait-on http://localhost:3000 # your app
- run: node dist/cli.js --url http://localhost:3000 --fail-on serious --format json -o a11y.json
```

Notes:

- `--fail-on` controls the exit code; pick the severity your team is ready to block merges on. `review` findings never fail a build.
- `--format sarif` is planned for Phase 4, which will let findings annotate PRs via GitHub code scanning.
- Scans are deterministic per page state; flaky results usually mean the page wasn't settled — add `--settle`.

---

## 6. The judgment pass (what's coming)

When Phase 2 lands, `scan` will additionally run per-criterion LLM checks, starting with two and growing to:

| Check                            | Criterion      |
| -------------------------------- | -------------- |
| Alt text meaningfulness          | 1.1.1          |
| Decorative vs informative images | 1.1.1          |
| Link purpose in context          | 2.4.4          |
| Heading structure semantics      | 1.3.1 / 2.4.6  |
| Reading order vs visual order    | 1.3.2          |
| Focus visibility                 | 2.4.7 / 2.4.11 |
| Control name quality             | 4.1.2          |

You'll control it with the flags that exist today: `--model` picks the Claude model, `--budget` caps estimated spend (the pass stops cleanly when exceeded and says so in the report), and `--confidence-floor` tunes how sure the model must be before a finding is asserted rather than marked `review`. Reports will include measured token usage and estimated cost.

Accuracy will be measured, not asserted: an eval harness scores every judgment check against labelled fixtures and reports precision and recall, and those numbers get published with the project.

---

## 7. Troubleshooting

| Symptom                                        | Likely cause and fix                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Executable doesn't exist` on scan             | Playwright's browser isn't installed: `npx playwright install chromium`                                  |
| Scan hangs then times out                      | Page never fires `load` — check the URL is reachable from where you're running                           |
| Findings for content that "isn't on the page"  | It is at 1280×800 (the fixed scan viewport), or arrives after load — try `--headed` to see what axe sees |
| Missing findings on a client-rendered app      | Scan ran before hydration — add `--settle 2000` (or more)                                                |
| `HTTP 4xx/5xx` warning but a report anyway     | Deliberate: an error page is still a page and its accessibility still matters — but check the URL        |
| A criterion you expected is missing from scans | Check its level: AAA criteria are out of scope unless you pass `--level AAA`                             |

---

## 8. Further reading

- [README](../README.md) — project rationale, roadmap, licence
- [W3C: How to Meet WCAG (Quick Reference)](https://www.w3.org/WAI/WCAG22/quickref/)
- [axe-core rule descriptions](https://dequeuniversity.com/rules/axe/)
