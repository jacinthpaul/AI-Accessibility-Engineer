# Remediation by criterion

What each commonly-reported criterion actually requires, and the fix that works. Read the entry for a criterion before proposing a change, because several have rules that are easy to satisfy incorrectly — a fix that clears the checker while leaving the barrier in place is worse than no fix, since it also removes the signal.

Criteria are listed by how often they show up in practice.

| Criterion                             | Name                      | Level | Typical axe rules                                   |
| ------------------------------------- | ------------------------- | ----- | --------------------------------------------------- |
| [1.4.3](#143-contrast-minimum)        | Contrast (Minimum)        | AA    | `color-contrast`                                    |
| [1.1.1](#111-non-text-content)        | Non-text Content          | A     | `image-alt`, `input-image-alt`, `area-alt`          |
| [4.1.2](#412-name-role-value)         | Name, Role, Value         | A     | `button-name`, `link-name`, `select-name`, `aria-*` |
| [3.3.2](#332-labels-or-instructions)  | Labels or Instructions    | A     | `label`, `form-field-multiple-labels`               |
| [3.1.1](#311-language-of-page)        | Language of Page          | A     | `html-has-lang`, `html-lang-valid`                  |
| [2.4.4](#244-link-purpose-in-context) | Link Purpose (In Context) | A     | judgment pass only                                  |
| [1.3.1](#131-info-and-relationships)  | Info and Relationships    | A     | `list`, `definition-list`, `td-headers-attr`        |
| [2.4.7](#247-focus-visible)           | Focus Visible             | AA    | partial                                             |
| [1.4.11](#1411-non-text-contrast)     | Non-text Contrast         | AA    | partial                                             |
| [2.1.1](#211-keyboard)                | Keyboard                  | A     | `scrollable-region-focusable`                       |

---

## 1.4.3 Contrast (Minimum)

**Requires** 4.5:1 for normal text, 3:1 for large text (18.66px bold or 24px+). Applies to text and images of text.

**Fix at the token, not the element.** A page with ten contrast failures almost always has one or two underlying colour values used in many places — a CSS custom property like `--text-muted`, a Tailwind class like `text-gray-400`, a theme entry. Find the shared value and darken it once.

```css
/* Before — 3.1:1 on white, fails */
:root {
  --text-muted: #9a9a9a;
}
/* After — 4.6:1 on white, passes */
:root {
  --text-muted: #767676;
}
```

`#767676` is the lightest grey that passes 4.5:1 on pure white — a useful anchor when picking a replacement.

Watch for these:

- **Placeholder text** is text. Low-contrast placeholders are a real failure, and placeholder-as-label is a separate 3.3.2 problem.
- **Disabled controls** are exempt, but a control that only _looks_ disabled (styled grey, still operable) is not.
- **Text over images or gradients** is what the scanner reports as undecided. Check it yourself — add a scrim, a solid backing, or a text shadow.
- **Large text** gets the easier 3:1 ratio, so bumping size or weight can be a legitimate fix.

Do not fix contrast by disabling the rule, and do not assume brand colours are immovable — most brand palettes have a compliant darker shade already.

## 1.1.1 Non-text Content

**Requires** a text alternative that serves the equivalent purpose. The attribute existing is not the requirement; automated tools only check that it exists.

Decide what the image _is_:

| Image                                      | Correct alternative                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Conveys information                        | `alt` describing the information, not the picture                      |
| Purely decorative                          | `alt=""` (empty, not missing) so screen readers skip it                |
| Inside a link or button with no other text | `alt` describing the **destination or action**, not the image          |
| Chart or graph                             | Short `alt` with the takeaway, plus the data nearby in text or a table |
| Icon next to visible text                  | `alt=""` — the text already says it, and repeating it is noise         |

```html
<!-- Passes axe, useless to a user -->
<img src="/q3.png" alt="chart.png" />
<!-- Actually equivalent -->
<img src="/q3.png" alt="Q3 revenue up 12% year over year, led by the EU region" />
```

A missing `alt` and an empty `alt=""` are different: missing means unknown and gets announced as a filename by some screen readers; empty is a deliberate "skip this". Never delete an `alt` attribute to fix a finding.

## 4.1.2 Name, Role, Value

**Requires** every interactive control to expose a name, a role, and its current state programmatically.

Most reports are a control with no accessible name — commonly an icon-only button:

```html
<!-- No name: announced as "button" -->
<button class="icon-btn">🔔</button>
<!-- Named -->
<button class="icon-btn" aria-label="Notifications">🔔</button>
<!-- Better when a visible label exists: use it -->
<button><svg aria-hidden="true">…</svg> Notifications</button>
```

Prefer a visible text label over `aria-label`. Speech-input users say what they see, so an accessible name that matches the visible text is what lets them activate the control; an `aria-label` that differs breaks that. When both exist, the visible text should be contained in the accessible name.

Other frequent causes:

- **A `<div>` or `<span>` wired up with a click handler.** It has no role, isn't focusable, and doesn't respond to Enter or Space. Use `<button>`. Reaching for `role="button"` plus `tabindex="0"` plus key handlers reimplements what the element gives you free, and usually imperfectly.
- **`<select>` with no label** — see 3.3.2.
- **Custom widgets** (tabs, comboboxes, dialogs) missing required ARIA states. Follow the [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) pattern for the widget rather than inventing attributes; a partially-implemented pattern often tests worse than a plain semantic fallback.

## 3.3.2 Labels or Instructions

**Requires** a label or instruction wherever user input is needed.

```html
<!-- Placeholder is not a label: it disappears on focus and many AT ignore it -->
<input type="text" placeholder="Search customers" />
<!-- Explicit label -->
<label for="q">Search customers</label>
<input type="text" id="q" />
<!-- Visually hidden label, when the design has no room -->
<label for="q" class="sr-only">Search customers</label>
```

Use a real `<label for>` where you can; `aria-label` is the fallback when no visible label exists. A visually-hidden label (clipped, not `display:none`) is better than `aria-label` because it stays in the DOM for translation and speech input.

Required fields need the requirement conveyed in text or `aria-required`, not by colour alone. Error messages should be associated with `aria-describedby` so they are announced when focus reaches the field.

## 3.1.1 Language of Page

**Requires** a valid language on the root element — set `lang` on the opening `<html>` tag. One attribute, trivially fixed, and it changes which voice a screen reader uses to pronounce the page.

Use a valid BCP 47 tag (`en`, `en-GB`, `fr`, `pt-BR`). Mark passages in another language inline with `lang` on the surrounding element.

## 2.4.4 Link Purpose (In Context)

**Requires** the destination to be determinable from the link text _together with its programmatically determined context_ — the enclosing sentence, list item, paragraph, or table cell.

This is a judgment-pass finding; axe cannot evaluate it. The nuance is that generic text is not automatically a failure:

```html
<!-- Fails: nothing nearby says where this goes -->
<p>For more information, <a href="/pricing">click here</a>.</p>
<!-- Passes: the list item supplies the context -->
<li>Migrating to WCAG 2.2: what changed and why. <a href="/blog/wcag22">Read more</a></li>
<!-- Best: self-describing -->
<a href="/reports/annual.pdf">Download the 2024 annual report (PDF, 2.1 MB)</a>
```

Screen-reader users often navigate by pulling up a list of links stripped of context, so self-describing text is materially better even where context technically satisfies the criterion. Flag the file type and size on document links — that is a courtesy the criterion doesn't require and users appreciate.

## 1.3.1 Info and Relationships

**Requires** structure conveyed visually to also be available programmatically.

- Headings must be real headings (`<h1>`–`<h6>`), not styled `<div>`s. Nesting should not skip levels.
- Lists must be `<ul>`/`<ol>`/`<li>`, not `<div>`s with bullet characters.
- Data tables need `<th>` with `scope`, and a `<caption>` where the table needs a title. Layout tables need `role="presentation"`.
- Groups of related inputs (radio sets, address blocks) belong in `<fieldset>` with a `<legend>`.

Reach for the semantic element first. ARIA can label and describe, but it cannot add behaviour the element doesn't have.

## 2.4.7 Focus Visible

**Requires** a visible focus indicator on every keyboard-focusable control.

The usual cause is a blanket reset:

```css
/* Removes the indicator everywhere — a keyboard user is now lost */
*:focus {
  outline: none;
}
/* Replace it deliberately */
:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}
```

`:focus-visible` shows the ring for keyboard navigation without showing it on mouse click, which is usually what a designer objecting to focus rings actually wants. Under WCAG 2.2, the indicator also needs adequate contrast and size (2.4.11, 2.4.13) — an indicator that exists but is invisible against the background is not a pass. Verify by tabbing through the page yourself; automated coverage here is partial at best.

## 1.4.11 Non-text Contrast

**Requires** 3:1 for the parts of controls and graphics needed to understand them: input borders, toggle states, focus indicators, icon glyphs carrying meaning, chart segments.

Commonly missed on very light input borders (`#e5e5e5` on white is about 1.2:1) and on unselected states in toggles or tabs where the only difference is a faint tint.

## 2.1.1 Keyboard

**Requires** all functionality to be operable by keyboard.

Not fully automatable — test it by tabbing. Look for: click handlers on non-interactive elements, custom widgets that can be focused but not operated with Enter/Space/arrows, drag-only interactions with no keyboard equivalent, and focus that gets trapped in a modal with no way out. A scrollable region with no focusable content inside needs `tabindex="0"` so a keyboard user can scroll it.

---

## Verifying a fix

Re-run the scan and compare counts, then confirm the fix actually helps rather than merely satisfying the rule:

- Tab through the page. Can you reach and operate everything, and always see where you are?
- Zoom to 200%. Does content reflow, or is it cut off?
- Read the accessible name of each control you changed. Would it make sense heard aloud, out of context?

If a finding persists after a fix, re-read the element rather than adding another attribute. Stacked ARIA attributes are a common way to end up with a control that reports one thing and behaves like another.
