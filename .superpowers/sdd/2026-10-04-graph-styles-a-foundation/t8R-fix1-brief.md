# Task 8 fix round 1 (graph styles A)

Worktree `C:\Users\benif\Osmosis\.claude\worktrees\milestone-a-styles`, branch `milestone-a/styles`. You are the only implementer running. The review is in `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/t8R-review.md`: read it.

## Fix
1. **IMPORTANT: blob URLs are never revoked.** This is also geometry's carry-forward from Task 6.
   - In `graph-engine/src/style/papers/host.ts`, revoke a key's blob URL once no `<image data-paper-key>` in the document uses it any more. For example, `fillPaperTiles(root)` takes the keys under `root`, a separate exported `releaseUnusedPaperTiles(doc: ParentNode = document)` revokes every cached key not found in `doc`, and the cache entry is dropped.
   - Keep it DOM-only, and keep its pure helpers testable.
   - **The test** (vitest is node: stub `URL.revokeObjectURL` and use a fake root, as the existing `host.test.ts` does):
     - a key no longer on the page is revoked and dropped;
     - a key still in use is kept;
     - a failed tile never reaches revoke.
2. **IMPORTANT, same item: the re-render storm.** In `review/src/styles/Showcase.tsx`, render the figures from a deferred value (`useDeferredValue`) of the stack and theme. After each fill, call `releaseUnusedPaperTiles`.
3. **Minor: two settings labelled "Seed".** Relabel `paint.seed` "Paint seed" where its label comes from: find it in `graph-engine/src/style/settings/registry.ts`, or in the paint params' labels. Then regenerate the guide (`npx tsx tools/build-guide.mts`, from graph-engine/), so the drift test stays green. Check that no registry test pins the label.
4. **Minor: the clean cells don't fill.** In `review/src/styles/StylesPage.css`, a cell must not letterbox the figure's sheet. Drop the forced `aspect-ratio`, or give the cell background the figure's own paper colour, whichever looks right.

Leave the whiteboard ghost repeats alone (they go to Ben), and the other Minors (logged).

## Commands (from graph-engine/)
- `npx vitest run --maxWorkers=2 src/style src/figure src/proseBoundary.test.ts`
- `npx vitest run --maxWorkers=2 --config ../review/vitest.config.mts --root ../review`
- `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`, plus the review typecheck through a temporary tsconfig that extends `tsconfig.app.json` (delete it afterwards).
- **One shot:** start `npx vite --config review/vite.config.mts --port 5191 --strictPort` from the repo root. Run `powershell -File C:\Users\benif\AppData\Local\Temp\claude\C--Users-benif-Osmosis\a83b6e26-b23c-4f9b-975c-a349df1d981c\scratchpad\shot.ps1 -Url http://localhost:5191/styles.html -Out <ledger>/shots/task8-fix1.png -Width 1800 -Height 2000`. LOOK at it (the clean cells), then STOP the vite server. Never port 5182, never the browser pane.

## Rules
- Commit: `fix(review): the Style Lab defers its figures and releases unused paper tiles; paint seed relabelled; cells don't letterbox (Task 8 fix round 1)`. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit only your paths.
- No push, no merge, no new dependencies.
- Never stage `cli/bin/osmosis.js` or `shots/`. Never use bare `git stash`. vitest at ≤2 workers.

Return at most 15 lines: the sha, the test counts, the shot path with what you saw, and anything you couldn't do.
