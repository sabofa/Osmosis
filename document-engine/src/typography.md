# Document typography contract (engine side)

The engine owns the document's typographic ROLES and exposes them as semantic
hooks plus CSS custom properties. It hard-codes no theme: a workspace theme or
the theme adapter restyles by setting properties. Defaults are the `var()`
fallbacks inside the rules, so a property may be set on ANY ancestor of the
viewer (frame, sheet, the viewer root). Values that reference engine tokens
(`var(--de-accent)`, `var(--de-font-mono)`) must be set on the viewer root
(`.document-viewer`) or below, where those tokens are defined.

## Semantic hooks (read mode and live-preview editor)

| Attribute | On |
| --- | --- |
| `data-role="title"` | the first H1 |
| `data-role="lede"` | the paragraph directly after the title (no block between) |
| `data-role="section"` + `data-section-index="1..n"` | every H2, document order |
| `data-level="1..6"` | every heading |

Top-level blocks only (headings in quotes never count). Setext headings count in
the editor. Pure helper: `documentRoles(blocks)` in `documentRoles.ts`. In the
editor the same attributes sit on the line (`.cm-line`); the title/lede/section
lines also carry `cm-lp-title` / `cm-lp-lede` / `cm-lp-section`. A setext heading
carries the role on its first line only.

## Properties (default)

| Property | Default |
| --- | --- |
| `--de-title-font` | `var(--de-font-display)` |
| `--de-title-size` | `1.9em` |
| `--de-title-weight` | `600` |
| `--de-title-leading` | `1.12` |
| `--de-title-tracking` | `-0.015em` |
| `--de-lede-size` | `1.2em` |
| `--de-lede-color` | `var(--de-text-muted)` |
| `--de-lede-leading` | `1.5` |
| `--de-section-font` | `var(--de-font-display)` |
| `--de-section-size` | `1.3em` |
| `--de-section-weight` | `700` |
| `--de-section-mark` | `none` (a CSS `content` value) |
| `--de-section-mark-gap` | `0.5em` |
| `--de-section-mark-bg` | `transparent` |
| `--de-section-mark-color` | `currentColor` |
| `--de-section-mark-radius` | `0` |
| `--de-section-mark-width` / `-height` | `auto` |
| `--de-section-mark-padding` | `0` |
| `--de-section-mark-font` / `-size` / `-weight` | `inherit` |

## Section mark

`[data-role=section]::before`, an inline-block pseudo-element (not a flex row:
the heading's text sits in spans, and a flex line would split them into
separate items and break wrapping). It is never part of the text, so selection,
highlight and anchor offsets do not change with it. The read-mode root does
`counter-reset: de-section` and each section `counter-increment: de-section`, so
a theme can number with `--de-section-mark: counter(de-section, decimal-leading-zero)`.
The editor virtualises lines, so each section line sets
`counter-set: de-section var(--de-section-index)` from its own number instead.

## Two example variable sets

```docs
Clean (serif title, accent bar before each section):
  --de-title-font: var(--f-serif);  --de-title-size: 2.5em;  --de-title-weight: 600;
  --de-title-leading: 1.08;         --de-title-tracking: -0.018em;
  --de-lede-size: 1.19em;
  --de-section-mark: "";  --de-section-mark-width: 14px;  --de-section-mark-height: 2px;
  --de-section-mark-bg: var(--de-accent);

Retro (display-font title, numbered badge before each section):
  --de-title-size: 1.8em;  --de-lede-size: 1.1em;  --de-section-size: 1em;
  --de-section-mark: counter(de-section, decimal-leading-zero);
  --de-section-mark-font: var(--de-font-mono);  --de-section-mark-size: 0.7em;
  --de-section-mark-padding: 0.15em 0.45em;
  --de-section-mark-bg: var(--de-accent);  --de-section-mark-color: var(--de-page);
  --de-section-mark-radius: var(--de-radius-sm);
```

The review harness emulates both: `?case=normal&typo=clean|retro`.

## Tokens

`tokensToCssVars` passes an OPTIONAL `typography` object through when the tokens
carry one (read defensively; `DocumentTokens` in theme-core does not declare it
yet): `titleFont`, `titleSize`, `titleWeight`, `ledeSize`, `ledeColor`,
`sectionMark` map onto the properties above. Absent or blank means the defaults
stay.

Request these token names from theming (`doc-` prefix, mapped to the fields
above): `doc-font-title`, `doc-title-size`, `doc-title-weight`, `doc-lede-size`,
`doc-lede-color`, `doc-section-mark`.
