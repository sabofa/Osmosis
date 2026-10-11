# HANDOFF 2D handling (view2d), 2026-10-10

Supersedes the in-flight list in `HANDOFF-2026-10-07-2d-handling.md`. That file is still the record of the view2d core, so read it for history.

**Owner:** the session Ben handed the engine to on 2026-10-10 ("take over for this engine").
**Branch:** `milestone-a/geometry`, worktree `.claude/worktrees/milestone-a-geometry`.
**Merged into `milestone-a/main`** at `6a0ae1f`, on Ben's go after he checked it by hand ("2d is smooth"). The commits after it on this branch are not merged yet.

## What changed and why

Ben's report was that styled figures lagged, which he blamed on the code, and that zooming in and then panning showed white bars and lines out of place.

**Cause (measured, not guessed).** The figure was a DOM `<svg>` whose window (viewBox) changed as the view moved. Every change made the browser repaint everything: the chalk and paper-grain `feTurbulence` filters and about 900 hatch strokes. The CSS-transform "live view" that came before it still re-committed the viewBox every 250 ms and at rest, and each of its three layers did so at a different time. Raster fell behind, which caused the blanks and the drift. Main-thread frames were about 7 ms the whole time, so the cost sat in the raster/GPU stage, where rAF timing can't see it.

**Fix: a tile renderer** (`07cea0a`, then `63b50e1`).
- `view2d/tiles.ts` (pure, tested) holds the tile math:
  - levels at √2 steps (`levelFor`), 512 px tiles;
  - `drawList`: a hole is covered by a finer or coarser level;
  - `wantList`: nothing while moving; at rest, the screen, a ring around it, and level ±1;
  - `mayPaint`: at most one tile per frame, and none while frames come late;
  - an LRU cache (`TileCache`).
- `view2d/dom/svgTiles.ts` paints and composites onto one `<canvas>`, in planes (paper, grid, content), each with its own alpha. Plus two overviews per plane, as the stand-ins of last resort.
  - A styled figure is decoded once per plane, and each tile is a vector crop of it.
  - A clean figure parses each tile separately, so `non-scaling-stroke` holds.
- `FigureView` splits the figure with `figure/layers.ts` into paper / grid / content (tiled) and live (points and labels, kept as a live svg).
  - It takes `paperAlpha` and `gridAlpha` (06-engine-host §4). An alpha change only recomposites.
- Papers report their ruling apart (`PaperOutput.grid`). A styled figure writes it as `<g data-layer="grid">`.

**Why nothing is painted while moving.** The GPU rasterises tiles in the same queue it presents frames from. A typical tile is about 5 ms there, but the first tile at a new level costs 50–100 ms (shader and pattern warm-up). Painting during a zoom caused exactly the spikes Ben saw. So a moving view runs on stand-ins and sharpens about ¼ s after it stops.

**Numbers** (Brave, RTX 3050, 144 Hz; deep zoom in and out over chalk crosshatch on rough graph paper):
- Before: 70–120 ms input-to-screen, spikes over 100 ms, blank bars.
- After: no stalls, p90 8.4 ms, p99 10.7–13 ms.
- A long drag: p50 7.0 ms.

## How to measure

`node graph-engine/scripts/handling-trace.mjs <label> <url>` (see its header for scenarios). It runs its own Brave and reads the GPU's buffer swaps. Don't trust these for this engine:
- rAF timing and the compositor's DrawAndSwap, which don't show GPU stalls;
- Event Timing, which has no pointermove;
- a tab Ben has open, which draws no frames while hidden.

## Removed

Removed: `liveTransform.ts` (commitDue, overscan, scale drift), `onLive`/`overscan` and the commit state in `useView2d`, `OVERSCAN`/`SETTLE_MS`/`COMMIT_*`, `overscanLayout`/`applyOverscan`, and the stale `handling-probe` scripts. `useView2d` now calls `onApply` whenever the camera or the screen changes, so `onApply` must stay cheap.

## Open, in order

0. **QUEUED, do not start until the inventory sends a start message** (Learn `spec/osmosis/workspace/frontend/08-port-review.md` §7.2; low priority; it may go to a terminal builder per AGENT-SYSTEM §0):
   - (a) consume `host.tokens.alphas` (the 06 layer alphas, on `main` since `0ec634b`) for the paper, grid and content planes;
   - (b) a graph frame plus legend and caption, like the demo's figure block (Learn `frontend/live/`).

   **Prerequisite:** `main` (`0ec634b`, deployed) has the tile renderer (`07cea0a`), but NOT `63b50e1` (the planes and the `paperAlpha`/`gridAlpha` props), `cb67a70` or `a661ccd` (the region-highlight bridge fix). These must reach main first, with Ben's go.

1. **Hover and selection look**, not yet checked by eye on tiles. The overlay is drawn into the live svg from hit shapes, and the outermost-class step now only finds elements in the live svg (labels and points).
2. **The old list's leftovers:**
   - H5 (reduced motion) is moot: nothing is committed any more.
   - H6's tuning is replaced by `REST_MS`, `TILE_BUDGET` and `MOVING`.
   - H7: leader lines have no hit item; the DSL doc says spaces are free but `zoom` needs one.
   - H8: the docs and spec for tiles (spec `docs/superpowers/specs/2026-10-04-2d-handling-design.md` and the Learn copy).
3. **Geometry's merge list:**
   - phase 13 (excircles, nine-point circle, radical axes, cevian concurrency);
   - open items #2 (migration sweep) and #5 (the Vector example's mode).
4. **The engine-host work** (Learn `spec/osmosis/workspace/frontend/06-engine-host.md` §4 and §7):
   - `callout-alpha` once annotation boxes exist;
   - publish the layers through `EngineHost.layers` once the types package lands (theming `theming/engine-layers` `79d4175`, not merged);
   - `ThemeSource.alphas` was signed off on three conditions: it is optional and sanitised; it is not part of `ThemeInput.key`; it never reaches the markup.
5. **The graph theme adapter spec** (07 v7 §14), low priority: write it in Learn `spec/osmosis/graph-engine/` and send the hook names to the shell chat. The styles chat signs off when it resumes.
6. **The plots.** GraphViewer plots render through three.js/WebGL and are not tiled. Whether they need `alpha: true` is an open owner question in 06 §7.

## Rules

- Sonnet 5.5 for any agent; at most two at once.
- Stage paths explicitly, and never use `git stash`.
- Merge into `milestone-a/main` only on Ben's go.
- The headless Edge and Brave instances each kill only their own PID tree.
- Don't touch `space/`, `paint-*`, or :5182.
