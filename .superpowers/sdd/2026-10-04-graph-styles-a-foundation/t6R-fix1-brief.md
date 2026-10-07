# Task 6 fix round 1 (graph styles A)

Worktree `C:\Users\benif\Osmosis\.claude\worktrees\milestone-a-styles`, branch `milestone-a/styles`. Code is in `graph-engine/src`. You are the only implementer running.

## Fix these (test first where it says so)
1. **IMPORTANT: half-width graph lines** (`style/papers/rulings.ts:48-55`). The `k=0` lines sit exactly on the pattern tile's edge, and an SVG pattern clips to its tile. So every tenth line on graph and rough-graph renders at half width.
   - **The fix:** draw the edge lines a second time at `tile`, or shift the pattern by half a stroke, whichever keeps the waver continuous across the wrap.
   - **The test:** in the rulings or `generated.test.ts`, every line that touches the tile edge also has its wrapped copy, or no line sits within half a stroke of the edge.
2. **The board tray dust is fake** (in `style/papers/generated.ts`). It draws a row of soft ovals and blobs, which read as bubbles.
   - **Make it fine chalk dust:**
     - a soft gradient that thickens toward the bottom edge of the view box;
     - many tiny specks (sub-unit to ~2 units, varied opacity), denser near the bottom edge and thinning upward;
     - a few faint sideways smears, long and thin, low opacity.
   - Seeded as now, blackboard and greenboard only, pure and byte-stable.
   - "Hand-drawn means imperfect": uneven, clustered, never a regular row.
   - Keep the SVG size reasonable: at most a few hundred elements, or one pattern of specks.
   - **Shoot it:** re-run the T6.8 shot script. It is in the scratch dir `C:\Users\benif\AppData\Local\Temp\claude\C--Users-benif-Osmosis\a83b6e26-b23c-4f9b-975c-a349df1d981c\scratchpad`. Look for the papers/boards script there, and use `shot.ps1`.
   - Write `shots/task6-boards-fix1.png`, and LOOK at it, at the 2× crop, before you commit.
3. **Minor: a cached failure in `host.ts`.** On a rejected tile promise, drop it from the `blobUrls` cache. `fillPaperTiles` must skip a bad key, so one bad key never leaves the other papers empty.
4. **Minor: coverage.**
   - Add a guard test: no file under `src/figure`, `src/parser`, or any `index.ts` imports `style/papers/host`. Model it on `style/boundary.test.ts`, which has helpers in `importSpecifiers.testkit.ts`.
   - In `host.test.ts`: a changed texture, seed or base hex in the key each change `tilePixels`.
5. **Minor: tint in keys.** Normalise the tint to lowercase `#rrggbb` before building the key in `generated.ts` (there is probably a hex helper in `style/color.ts`), and test a 3-digit input. This must not move any pin: check that presetGolden stays green.

Leave the unrevoked blob URLs alone: they are logged.

## Commands (from graph-engine/)
- `npx vitest run --maxWorkers=2 src/style src/figure src/proseBoundary.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`
- presetGolden and cleanGolden: the rulings fix may move pins for graph and rough-graph papers. If so, re-pin with `npx vite-node graph-engine/scripts/preset-golden.ts`, run from the repo root, and APPEND each moved pin with its reason to `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/t6.4-pins.md`, under a heading "fix round 1". The tray dust also changes the board presets' pins if they are pinned: list those too. cleanGolden must stay byte-identical.

## Rules
- Commit: `fix(style): graph rulings wrap at the tile edge, fine tray dust, host.ts skips a bad tile, tint keys normalised (Task 6 fix round 1)`. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit only your paths.
- No push, no merge, no new dependencies.
- Never stage `cli/bin/osmosis.js` or `shots/`. Never use bare `git stash`.
- No vite server, no browser pane. Use headless Edge via `shot.ps1` only, and leave no Edge running.

Return at most 15 lines: the sha, the test counts, the pins moved (if any), the shot path, and anything you couldn't do.
