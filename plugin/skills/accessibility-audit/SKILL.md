---
name: accessibility-audit
description: Scan a web page or running app for WCAG 2.2 accessibility failures and fix what it finds, using the a11y-engineer scanner (axe-core plus an optional LLM judgment pass). Use this whenever the user mentions accessibility, a11y, WCAG, screen readers, colour contrast, keyboard navigation, alt text, ARIA, an accessibility audit or lawsuit risk, ADA/Section 508/EAA compliance, or asks whether a page or component is accessible — even if they don't name a tool. Also use it when someone asks you to review or build UI and wants it to be accessible, or asks why a contrast/label/landmark check is failing in CI.
---

# Accessibility audit

Find real WCAG 2.2 failures on a page, explain them in terms of who they affect, and fix the cause rather than the symptom.

The scanner runs two passes. The **deterministic pass** (axe-core) catches the mechanical failures — missing alt attributes, unlabelled controls, contrast ratios below threshold. The **judgment pass** (an LLM, optional) covers criteria automation cannot reach: whether alt text is _meaningful_, whether a link's purpose is determinable. Automated testing of any kind reaches roughly a third of WCAG, so treat a clean report as "nothing detectable was found", never as a conformance claim.

## 1. Get the scanner

Check whether it is already available:

```bash
a11y-engineer --help 2>/dev/null || npx --yes github:jacinthpaul/AI-Accessibility-Engineer --help
```

`npx github:jacinthpaul/AI-Accessibility-Engineer` builds on install and needs no clone. If the user will run scans repeatedly, a clone is faster:

```bash
git clone https://github.com/jacinthpaul/AI-Accessibility-Engineer.git
cd AI-Accessibility-Engineer && npm install && npm run build && npm link
```

The scanner drives real Chromium through Playwright. If it reports that the executable doesn't exist, run `npx playwright install chromium`. Where that download is blocked (locked-down CI, some containers), point `A11Y_CHROMIUM_PATH` at a system Chromium instead.

The deterministic pass needs no API key. The judgment pass runs only when `ANTHROPIC_API_KEY` is set, and bills to the user's own key — if it isn't set, the scan says so and continues with axe alone. Don't set a key the user didn't ask you to use, and mention the cost before enabling the judgment pass on a large page.

## 2. Point it at a page that has actually rendered

Most bugs in accessibility scanning come from scanning the wrong thing, not from the scanner.

For a local app, start the dev server first and scan its URL (`http://localhost:3000`). A production URL works too. A `file://` path works for static HTML.

**If the app is client-rendered (React, Vue, Svelte, Angular), pass `--settle`.** Without it the scan can run before hydration, against an empty `<div id="root">`, and report a page that is perfectly accessible because it is perfectly empty:

```bash
a11y-engineer --url http://localhost:3000 --settle 3000
```

A suspiciously clean report on a rich app is the signature of this mistake. When a result looks too good, confirm the page rendered — `--headed` shows you the browser, and a quick check that the finding count and best-practice count aren't both zero is usually enough.

A scan covers one URL and one viewport (1280×800). Auth-gated pages, other routes, and mobile layouts are not covered unless scanned separately.

## 3. Run it

```bash
a11y-engineer --url <url>                       # default: WCAG A + AA
a11y-engineer --url <url> --format json -o a11y.json
a11y-engineer --url <url> --level A             # level A only
a11y-engineer --url <url> --no-judgment         # axe only, no API key used
```

Exit codes are `0` clean, `1` findings at or above `--fail-on` (default `serious`), `2` bad usage or a scan error. Use `--format json` when you want to work through findings programmatically.

## 4. Read the report correctly

This is where an audit most often goes wrong, because three numbers in the report look like failures and are not.

**`review` findings are not violations.** A judgment finding the model wasn't confident about is demoted to severity `review` rather than hidden. It never fails a build. Treat it as a to-check list for a human, and say so — presenting a `review` item as a confirmed defect will send someone chasing a non-problem.

**Best-practice issues are not WCAG failures.** axe rules like `heading-order` and `landmark-one-main` are good advice that no success criterion requires. They are counted separately and deliberately excluded from the failure total. Reporting them as violations tells a team their conformant page is broken.

**"Checks axe could not decide" need a human.** Usually contrast against a background image or gradient. Not a pass, not a fail — look at them yourself.

**A clean scan is not conformance.** Say plainly that automated testing covers roughly a third of WCAG and that keyboard-only navigation and a screen-reader pass are still needed.

Judgment findings carry a `rationale` and a `confidence`. Show the rationale when reporting one — a verdict the developer cannot audit isn't worth acting on. When axe and the judgment pass disagree about the same element and criterion, axe wins and the judgment finding is dropped, so anything you see has already survived that.

## 5. Fix causes, not instances

Findings are anchored to individual elements, which makes a systemic problem look like a dozen separate ones. Before fixing anything, group them.

Contrast failures especially: ten failing elements are usually one CSS custom property, one utility class, or one theme token used in ten places. Fixing the token clears the whole cluster and prevents the next one; patching ten call sites leaves the cause in place and the next component inherits it. The same holds for a component rendered in a loop — one missing label in a list of twenty rows is one bug in one component.

Read `references/remediation.md` for what each common criterion actually requires and the fixes that work. Consult it before proposing a fix for a criterion you are not certain about — several have non-obvious rules, and the wrong fix often passes the checker while leaving the barrier in place.

Three fixes to avoid, because they make the report green without helping anyone:

- Adding `aria-hidden="true"` or `role="presentation"` to silence a finding on content a user actually needs.
- Adding an `aria-label` that duplicates or contradicts visible text — the visible label should be the accessible name, so a speech-input user saying what they see actually activates the control.
- Adding alt text that names the file or restates adjacent prose. `alt="chart.png"` passes axe and tells a screen-reader user nothing.

After fixing, re-run the scan and report the before/after counts. If a finding persists, read the element again rather than layering another attribute onto it.

## 6. Wire it into CI

The deterministic pass is fast, free, and deterministic, which makes it a reasonable merge gate. The judgment pass is neither free nor deterministic — keep it out of required checks and run it on demand.

```yaml
- run: npm ci && npx playwright install --with-deps chromium
- run: npm start & npx wait-on http://localhost:3000
- run: npx --yes github:jacinthpaul/AI-Accessibility-Engineer \
    --url http://localhost:3000 --no-judgment --fail-on serious
```

Pick `--fail-on` for the bar the team is ready to block merges on; `review` findings never fail a build regardless. Raising the bar to `critical` at first and tightening later is a reasonable way to adopt this on an existing codebase without blocking every PR on day one.

## What this cannot tell you

Be straight with the user about the boundary. The scanner cannot judge whether a focus indicator is _visible enough_, whether reading order matches visual order, whether an error message is _understandable_, or whether a custom widget behaves correctly under a real screen reader. It sees one URL at one viewport in one state — not the modal that opens on click, not the error state of a form, not the mobile layout.

If someone needs a conformance claim (a VPAT, an EAA or ADA obligation, a procurement requirement), tell them this is a starting point that finds real bugs cheaply, and that a claim needs manual testing by someone who knows the standard. Overstating what a scan proves is how organisations end up with a green dashboard and an inaccessible product.
