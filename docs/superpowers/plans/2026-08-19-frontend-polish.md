# Frontend Polish (Theme Stress Test, Scrollbar Fix, Cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Exception: Task 1 (Theme Stress Test) is executed live in the orchestrating session with the user driving the browser inspection — do not dispatch it to a subagent.** Tasks 2 and 3 are independent of each other and of Task 1, and should be dispatched as separate subagent tasks.

**Goal:** Audit and fix theme-token bypasses across `web/`, eliminate phantom/unwanted scrollbars while giving intentional scroll areas a consistent hidden-chrome treatment, and sweep `web/src` for dead code — per `docs/superpowers/specs/2026-08-19-frontend-polish-design.md`.

**Architecture:** Three independent workstreams against the existing React 19 + Vite frontend in `web/`. No new dependencies, no backend changes, no new abstractions — this is an audit-and-fix pass using the codebase's existing per-component CSS file convention (`web/src/components/<Name>.css`) and the existing CSS custom-property theme system (`web/src/index.css`).

**Tech Stack:** React 19, Vite, plain CSS with custom properties (no CSS-in-JS, no Tailwind), `oxlint` for linting.

## Global Constraints

- No new npm dependencies (spec non-goal: "Introducing new dependencies").
- `web/` only — no server/graph-engine/document-engine changes.
- Scrollbar chrome hiding is opt-in per container (`.no-scrollbar` utility class), never a blanket `* { scrollbar-width: none }` override.
- Where a component already has an intentional, themed scrollbar treatment (see Task 2 Step 1 — `Library.css` already does this), preserve/extend that pattern instead of replacing it with full hiding.
- Fixes must resolve root causes (missing `min-height: 0`/`min-width: 0`, hardcoded colors replaced with tokens) rather than papering over symptoms (`overflow: hidden` slapped on to hide a scrollbar without checking why it appeared).
- `web` build (`tsc -b && vite build`) and `oxlint` must both pass clean at the end of every task.

---

## Task 1: Theme Stress Test (interactive — session-executed, not subagent)

**Files:**
- Modify: any of `web/src/**/*.tsx`, `web/src/**/*.css` found to hardcode colors (exact list produced by Step 1's grep, not known in advance)
- Reference: `web/src/index.css:1-22` (light tokens), `:23-45` (dark, prefers-color-scheme), `:47-66` (explicit dark), `:68-86` (explicit light)
- Reference: `web/src/hooks/useTheme.ts`, `web/src/components/ThemeEditor.tsx` (preset switching UI)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks depend on — this task's output is fixed source files, not a new interface.

- [ ] **Step 1: Grep audit for hardcoded colors outside the token system**

Run from `web/`:

```bash
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" src --include="*.css" --include="*.tsx" | grep -v "src/index.css"
```

This will over-match somewhat (e.g. box-shadow alpha values that legitimately use `rgba()` for a fixed shadow color are fine — shadows aren't theme-sensitive the same way foreground/background/accent colors are). Triage the output into two buckets:
- **Real bypasses** — a color that should visually adapt to the active theme (text, background, border, accent, status colors) but is hardcoded instead of using `var(--token)`.
- **Legitimate literals** — fixed shadow/overlay alpha values, one-off brand colors that are intentionally theme-invariant (e.g. a colored heatmap swatch that's data, not chrome).

Write the "real bypasses" list down (file:line) before moving to Step 2 — this is the punch list.

- [ ] **Step 2: Start the dev server and open it in the Browser pane**

Use `preview_start` with `name` pointing at a `.claude/launch.json` entry for `web`'s dev server (create the entry if it doesn't exist: `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "dev"]`, working directory `web/`, `port` matching Vite's default or whatever `web/vite.config.ts` sets).

- [ ] **Step 3: Fix each item on the Step 1 punch list**

For each real bypass, replace the hardcoded value with the appropriate `var(--token)` from `web/src/index.css`. After each fix, reload the browser and check it under at least the light and dark presets via `ThemeEditor` before moving to the next item.

- [ ] **Step 4: Live preset cycle with the user, screen by screen**

Go through Home, Bank, Library, Take, Review, Results, Settings, and the Graph/Desmos/Document panels (reachable from a question with those fields set). For each screen, cycle every built-in preset in `ThemeEditor`, then apply at least one deliberately extreme custom combination (near-identical foreground/background; an inverted/clashing accent). The user calls out anything that looks wrong (unreadable text, invisible icon, border that disappears, shadow that looks wrong in dark mode); fix inline and re-check before moving to the next screen.

- [ ] **Step 5: Verify build**

```bash
cd web && npm run build
```

Expected: succeeds with no TypeScript or build errors.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "fix: replace hardcoded colors with theme tokens, fix theme-dependent visual bugs"
```

(If Steps 3-4 touched many unrelated files across a long live session, it's fine to commit incrementally per screen instead of one final commit — use your judgment, but each commit should represent a coherent, working state.)

---

## Task 2: Scrollbar Fix (subagent task)

**Files:**
- Modify: `web/src/index.css` (add `.no-scrollbar` utility)
- Modify: any of the files below that need a `min-height: 0` / `min-width: 0` fix or the `.no-scrollbar` class applied:
  - `web/src/components/Bank.css:63`
  - `web/src/components/Home.css:48`, `:444`
  - `web/src/components/Library.css:205-206`, `:587-588` (already has themed thin-scrollbar treatment at `:12-24` — see Step 1)
  - `web/src/components/QuestionDetail.css:34`, `:68`
  - `web/src/components/QuestionPanel.css:74`, `:112`
  - `web/src/components/Rail.css:52`, `:114`
  - `web/src/components/Results.css:120`
  - `web/src/components/Review.css:23`, `:72`, `:98`, `:359`
  - `web/src/components/Settings.css:302-303`, `:377-378`
  - `web/src/components/TagDetail.css:34`, `:139`, `:147`, `:234`
  - `web/src/components/Take.css:8`, `:99`, `:193`
  - `web/src/components/TemplateDetail.css:34`
- Test: manual browser verification (no automated test framework covers CSS layout in this repo — see Step 5)

**Interfaces:**
- Consumes: nothing from Task 1 or Task 3.
- Produces: `.no-scrollbar` utility class in `web/src/index.css`, usable by any future component.

- [ ] **Step 1: Read the existing scrollbar precedent**

Read `web/src/components/Library.css:1-30`. It already implements a themed, always-thin (not fully hidden) scrollbar via `scrollbar-width: thin` + `scrollbar-color: var(--line-strong) transparent` plus a `::-webkit-scrollbar` block, applied to `.library-grid` and `.library-detail-questions`. This is a deliberate, already-good pattern — do not replace it with full hiding in Step 3. Instead, Step 3's `.no-scrollbar` utility is for containers that currently show the bare, unstyled OS-default scrollbar and should hide it entirely.

- [ ] **Step 2: Grep for every overflow container and classify it**

```bash
cd web && grep -rn "overflow" src/components --include="*.css"
```

For each match with `auto` or `scroll` (ignore `overflow: hidden` and `text-overflow: ellipsis` matches — those aren't scroll containers), open the surrounding rule and its immediate parent in the corresponding `.tsx` file. Classify each as:
- **(a) Legitimate scroll area, unstyled** → gets `.no-scrollbar` in Step 4.
- **(b) Legitimate scroll area, already thin-themed like Library** → leave as-is.
- **(c) Suspicious — scrollbar shouldn't appear at all, or appears intermittently** → root-cause in Step 3.

- [ ] **Step 3: Fix root causes for category (c) containers**

For each container flagged suspicious, check whether it (or an ancestor between it and its nearest flex/grid container) is missing `min-height: 0` or `min-width: 0`. In CSS flexbox/grid, a child's default `min-height`/`min-width` is `auto`, which means it refuses to shrink below its content's intrinsic size — this forces the *parent* to overflow and show a scrollbar even though the parent's own `overflow` rule looks correct. Add the missing `min-height: 0` (for vertical scroll contexts) or `min-width: 0` (for horizontal) on the flex/grid child that's refusing to shrink. Verify in the browser (scrollbar disappears, content still lays out correctly, still scrolls if content genuinely exceeds the container).

- [ ] **Step 4: Add and apply the `.no-scrollbar` utility**

Add to `web/src/index.css` (near the bottom, after the existing keyframes/utility rules):

```css
.no-scrollbar {
  scrollbar-width: none;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
```

Apply the `no-scrollbar` class to each category (a) container's JSX element (not a blanket selector — add the class name directly to the element in the corresponding `.tsx` file, e.g. `<div className="bank-list no-scrollbar">`).

- [ ] **Step 5: Verify visually**

Start the dev server (`preview_start`, reuse the `web` launch config from Task 1 if it exists, or create it) and open the Browser pane. For each screen touched in Steps 3-4 (at minimum: Home, Take, Review, Bank, Library, Settings), confirm:
- No scrollbar chrome is visible on `.no-scrollbar` containers, but scrolling via mouse wheel still works (test with `computer` scroll action).
- No unexpected/phantom scrollbar appears on any screen at the default window size.
- Content that's supposed to be scrollable (e.g. a long question list) is still fully reachable by scrolling.

- [ ] **Step 6: Verify build and lint**

```bash
cd web && npm run build && npm run lint
```

Expected: both succeed with no new errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/index.css web/src/components
git commit -m "fix: eliminate phantom scrollbars, add opt-in scrollbar-hiding utility"
```

---

## Task 3: General Cleanup Sweep (subagent task)

**Files:**
- Delete: `web/src/data/templates.ts`
- Modify: any `web/src/**/*.tsx` or `web/src/**/*.ts` file with unused imports/exports, dead components, stray `console.log`/`console.debug` calls, or commented-out code found during the sweep (exact list produced by Steps 2-3, not known in advance)

**Interfaces:**
- Consumes: nothing from Task 1 or Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Confirm and delete the dead mock-data file**

```bash
cd web && grep -rn "data/templates" src --include="*.tsx" --include="*.ts"
```

Expected: no matches (confirmed clean as of the 2026-08-19 repo survey; re-verify here in case of drift since then — if it now has importers, stop and report back instead of deleting).

```bash
rm src/data/templates.ts
```

- [ ] **Step 2: Run oxlint and address warnings**

```bash
cd web && npm run lint
```

For each warning: if it's a genuine unused import/variable/dead code, fix it directly. If oxlint flags something that's actually load-bearing (e.g. an export used only by another workspace package, or a type-only import), leave it and note why in the task's final report rather than force-fixing it.

- [ ] **Step 3: Sweep for unused exports, stray console calls, and commented-out code**

```bash
cd web && grep -rn "console\.\(log\|debug\)" src --include="*.tsx" --include="*.ts"
```

Remove any stray debug logging left over from development (leave intentional `console.warn`/`console.error` used for real error reporting).

```bash
cd web && grep -rn "^\s*//.*[a-zA-Z]" src --include="*.tsx" --include="*.ts" | grep -viE "eslint|@ts-|TODO|http|license"
```

Review matches for commented-out code blocks (not explanatory prose comments) and remove them. For each component file, also check whether every named export is imported anywhere else in `web/src` — an export used only within its own file should be un-exported (not `export`ed) rather than left as dead public surface. Flag anything ambiguous (e.g. an export that looks unused but might be an intentional public API surface for future use) instead of guessing — list these in the final report rather than deleting them.

- [ ] **Step 4: Verify build and lint**

```bash
cd web && npm run build && npm run lint
```

Expected: both succeed clean (or only pre-existing/acknowledged warnings remain, listed explicitly).

- [ ] **Step 5: Commit**

```bash
git add -A web/src
git commit -m "chore: remove dead mock data and sweep unused code from web/src"
```

---

## Self-Review Notes

- **Spec coverage:** Theme stress test → Task 1 (grep + live pass, matches spec exactly). Scrollbar removal (hide chrome + fix phantom) → Task 2 Steps 3-4. Cleanup (delete mock file + general sweep) → Task 3. Execution model (interactive theme audit, subagent-dispatched scrollbar/cleanup) → plan header and Task 1's dispatch note. All spec sections covered.
- **Placeholder scan:** No TBD/TODO markers. Exact file:line references given for every known-in-advance file; tasks whose exact fix targets are audit-dependent (Task 1 color fixes, Task 3 unused-code fixes) say so explicitly rather than faking placeholder code, and give the exact grep commands that will produce the real list at execution time.
- **Type consistency:** N/A — no new functions/types/interfaces are introduced across tasks; the only shared artifact is the `.no-scrollbar` CSS class name, used consistently in Task 2 Steps 4-5.
