# Task 8 review (graph styles A: the Style Lab) — scoped to the diff

Worktree `C:\Users\benif\Osmosis\.claude\worktrees\milestone-a-styles`, branch `milestone-a/styles`. You are a reviewer: you change no code and make no commits. Don't start servers or browsers.

## What to review
`git diff fd2c9ce..HEAD -- review/ graph-engine/` (commits d8c678d, de90ba0 and 999dbbb; d8c678d sits just before fd2c9ce in the log, so include it with `git show d8c678d`).

**Read for the rules, and only these:** `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/task-8-notes.md` (it overrides `task-8-brief.md`), and the Task 8 lines at the end of `progress.md`.

## Acceptance lines
- **T8.1:**
  - The built-in style sets are JSON files, checked by `checkThemeStyles`. Lazy checking on first read is accepted, because of the import cycle.
  - `BUILTIN_THEME_STYLES` behaves as before: the goldens are untouched.
  - The save endpoint is dev-only, with the same origin and Content-Type checks as `/__paint/tuning`, and an allow-listed theme id. There is no path traversal.
  - The body is validated against the registry: ranges, whole numbers, and unknown paths.
  - styleSets round-trips.
- **T8.2/T8.3:**
  - SettingsPanel, LayerSelector and ThemeSwitcher are props-in/events-out, with no lab state.
  - The panel never imports prose: its meanings are passed in.
  - Themes come only through the adapter, with no web/ CSS variables. There is no "no theme".
- **T8.4/T8.5:**
  - The page starts on `defaultTheme('light')`.
  - `fillPaperTiles` is imported by its path, never from an index.
  - The space cell is clean only, and space/ is untouched.
  - The placeholders for graph2d, table and flowchart are there.
  - The edited layer's values reach the figures.
  - Save posts for built-in themes and downloads otherwise.
  - figure/, style/ and space/ runtime code is unchanged, except the accepted builtinStyles change.

## The controller's notes from the shots (verify the cause; don't just repeat them)
1. "Seed" appears twice in the General group of the theme layer's panel: `style.seed`, and paint's seed? Two settings share a label, or a spec is listed twice.
2. In the clean column of figure2d and figure3d, the cream sheet covers only part of the cell. Is the page sizing the SVG wrongly, or is this the clean paper's existing behaviour, as in the contact sheet?
3. The whiteboard's ghost arcs repeat faintly at tile spacing, in `shots/task8-paper-whiteboard-x2.png`. Say whether a cheap fix exists, for example seeding ghost positions so they avoid an obvious grid. It's not a blocker.

## Look for
- XSS or injection in the save endpoint, or in the SVG injection: the SVGs are our own output, but check;
- stale closures, or re-render storms on slider moves;
- a document layer that never reaches renderFigure;
- the preset-injection logic the implementer added: "each column's preset is injected as the theme-all layer's preset". Is precedence still correct for the document and type layers?

Run `npx vitest run --maxWorkers=2 --config ../review/vitest.config.mts --root ../review` and `npx vitest run --maxWorkers=2 src/style/theme`, from graph-engine/.

## Verdict
READY, or findings ranked Critical / Important / Minor, each with file:line, the defect and a failure scenario. Keep it to ≤40 lines. Write it to `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/t8R-review.md` and return it.
