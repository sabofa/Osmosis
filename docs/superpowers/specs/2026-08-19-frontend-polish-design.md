# Frontend Polish: Theme Stress Test, Scrollbar Fix, Cleanup

Date: 2026-08-19

## Context

The Osmosis frontend (`web/`) is functionally complete — all planned screens
exist and are wired to the real API (see repo-orientation notes from
2026-08-19). The user's broader polish wishlist had six items; this spec
covers three of them. The other three are split into their own future specs
because each is substantial enough to deserve independent design:

- Responsive layout across many screen formats / phone resolution — spun off,
  not started (app currently assumes one desktop viewport and breaks below
  roughly 4:3).
- Settings area redo — spun off; it's a redesign, not a fix.
- Desmos panel conflict resolution — explicitly deferred by the user to when
  the MCP `readme()`/`bootstrap()` labeling work happens.

This spec covers only:

1. Theme stress test
2. Scrollbar removal (hide chrome + fix phantom scrollbars)
3. General frontend cleanup sweep

## Goals

- Every screen renders correctly (readable, no broken contrast, no
  mode-assuming visual bugs) across all built-in theme presets and reasonable
  custom combinations.
- No component uses a hardcoded color that bypasses the theme token system.
- Intentional scroll areas hide native scrollbar chrome via an opt-in
  utility class; nothing else has its scrollbar silently suppressed.
- No element shows a scrollbar it shouldn't — particularly the "appears out
  of nowhere" class of bug, which is almost always a missing
  `min-height: 0` / `min-width: 0` on a flex/grid child forcing an ancestor
  to overflow.
- `web/src/data/templates.ts` (dead mock data, confirmed zero importers as of
  the 2026-08-19 repo survey) is deleted.
- A general dead-code/lint sweep of `web/src` removes or flags unused
  exports/imports, dead components, stray `console.log`s, commented-out
  code, and `oxlint` warnings.

## Non-goals

- Responsive/phone layout work (separate spec).
- Settings screen redesign (separate spec).
- Desmos panel decisions (deferred to readme/bootstrap labeling work).
- Backend changes of any kind — this is `web/` only.
- Introducing new dependencies (no scrollbar libraries, no CSS-in-JS churn) —
  fixes should use plain CSS within the existing token/theme system.

## Design

### 1. Theme stress test — interactive, not delegated

Run live in this session, not as a subagent task, because the user wants to
be the one actively inspecting and directing.

**Step 1 — grep audit.** Search `web/src` for literal `#hex`, `rgb(`,
`rgba(`, `hsl(` color values outside `lib/themeTokens.ts` and any theme CSS
files. This produces a concrete punch list of hardcoded-color usages that
bypass the token system and will misrender under a custom theme.

**Step 2 — live visual pass.** Start the Vite dev server via
`preview_start`, open it in the Browser pane, and go screen-by-screen
(Home, Bank, Library, Take, Review, Results, Settings, plus the
Graph/Desmos/Document panels where reachable) while cycling:

- every built-in preset in `ThemeEditor`
- at least one deliberately extreme custom combination (e.g. near-identical
  foreground/background, an inverted accent) to stress contrast logic

The user drives which combinations to check and calls out what looks wrong;
fixes happen inline as issues are found rather than batched into a report
at the end. Each fix from Step 1's punch list also gets verified visually
here (swap the color for a token, confirm it still looks right in at least
two presets).

**Exit criteria:** grep punch list is empty (every color traces to a token),
and a full preset cycle across all screens produces no readability or
mode-assuming visual bugs the user flags as worth fixing.

### 2. Scrollbar removal — subagent task

**Systemic pass first.** Grep for `overflow`, `overflow-y`, `overflow-x`
(`auto`/`scroll` values) across `web/src`. For each scroll container found,
trace its flex/grid ancestors and check for missing `min-height: 0` /
`min-width: 0` — the standard cause of a flex/grid child refusing to shrink,
forcing an ancestor to overflow and produce an unexpected scrollbar. Fix the
constraint at the layout level, not by hiding the symptom.

**Utility class.** Add an opt-in `.no-scrollbar` CSS utility:

```css
.no-scrollbar {
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
```

Apply it deliberately to containers that are meant to scroll but shouldn't
show scrollbar chrome (e.g. panel bodies, the Take question list, Library
folder trees). Do not apply a global `* { scrollbar-width: none }` override
— that would silently hide scrollbars in places where showing one is
correct affordance (e.g. a long dropdown), which is explicitly what the user
wants avoided ("they appear out of nowhere so be careful" — the fix must be
targeted, not blanket).

**Case-by-case remainder.** After the systemic min-height/min-width pass,
visually sweep remaining screens for any scrollbar that shouldn't exist at
all and fix each root cause individually.

**Verification.** Screenshot key screens (Home, Take, Review, Bank/Library
with long content, Settings) in the Browser pane before/after to confirm no
regressions and no newly-hidden-but-still-needed scrollbars.

### 3. General cleanup — subagent task

- Delete `web/src/data/templates.ts`; grep-confirm zero remaining imports
  before removing (already confirmed clean as of the 2026-08-19 survey, but
  re-verify at execution time in case of drift).
- Run `oxlint` (`web`'s existing lint script) and address its warnings.
- Sweep `web/src` for: unused exports/imports, components no longer
  referenced anywhere, stray `console.log`/`console.debug` calls left from
  development, commented-out code blocks.
- Fix what's unambiguous. Flag anything ambiguous (e.g. an export that looks
  unused but might be an intentional public surface) back to the user rather
  than guessing and deleting.

## Execution model

Per `subagent-driven-development`: scrollbar removal and cleanup are
independent of each other (different concerns, mostly different files
touched — CSS/layout vs. dead-code) and run as separate subagent tasks, each
verified (visually for scrollbars, via lint/build for cleanup) before being
marked done. The theme stress test is excluded from delegation and runs
live in the current session with the user driving inspection.

## Testing / verification

- Theme audit: grep punch list empty; live visual pass across all presets
  and screens with no user-flagged issues remaining.
- Scrollbars: before/after screenshots of key screens show no phantom
  scrollbars and correct chrome-hiding on intentional scroll areas; a manual
  scroll-wheel check on `.no-scrollbar` containers confirms scrolling still
  functions despite hidden chrome.
- Cleanup: `oxlint` passes clean (or only pre-existing/acknowledged
  warnings remain), `web` build (`tsc -b && vite build`) succeeds, no
  broken imports.

## Open questions

None outstanding — scope, mechanism, and execution model were confirmed
with the user during brainstorming.
