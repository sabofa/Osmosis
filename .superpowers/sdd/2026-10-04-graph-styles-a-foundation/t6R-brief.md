# Task 6 review (graph styles A: backgrounds) — scoped to the diff

Worktree `C:\Users\benif\Osmosis\.claude\worktrees\milestone-a-styles`, branch `milestone-a/styles`. Code is in `graph-engine/src`. You are a reviewer: you change no code and make no commits.

## What to review
`git diff da2fdad..HEAD -- graph-engine/` (Task 6: the fills fix, the structures, the PNG writer, generated papers, rulings, board settings, host.ts, wiring, the re-pin, the meanings, the tuning). Use `git log --oneline da2fdad..HEAD` for the commit list.

**Read for the rules, and only these:**
- the spec paragraph: `docs/superpowers/specs/2026-10-04-graph-styles-design.md`, lines 226–245 (§7.2 Backgrounds);
- `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/task-6-notes.md` (its rulings override the brief);
- the moved pins: `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/t6.4-pins.md`.

## Acceptance lines
- **T6.1:** fills and shading on dark boards are lighter than the board and ≥1.5:1 as drawn. Light paper is unchanged. cleanGolden is untouched.
- **T6.2:** the structures are seeded, tileable and zero-mean. `encodePng` output decodes, with correct CRC and Adler checksums.
- **T6.3:** the SVG is pure and byte-stable. Light and dark boards are byte-equal. A changed paper colour changes paper tiles, not board tiles. The key is self-describing: `paper-v1:<type>:<seed>:<size>:<texture>:<base hex>`. That is a ruling, so host.ts takes no theme.
- **T6.4:** the old names map to generated types, plus kraft and linen. The tile token is 256–1024, whole numbers, default 512. Every moved pin is listed with a reason. cleanGolden is byte-identical. The board presets' texture is about 1.
- **T6.5:** the tile/type/texture/grid meanings are accurate to the code.
- **T6.6:** the board.* settings change a figure's board colour. The defaults are byte-identical. `NOT_DRAWN_YET` is 4.
- **T6.7:** host.ts is DOM-only, imported by nothing in figure/, the parser or any index. Its tiles match the key.
- **T6.8:** tuning moves no pin.

## Standing rules (the gated owners' conditions)
- Geometry's: `figure/render.ts` edits stay small and local. NO changes to `GraphViewer.tsx` or `FigureView.tsx`. style/** imports nothing from space/, except style/settings/**, which may import only space/paint/params.
- Ben's:
  - clean stays byte-identical;
  - board papers never read the light/dark mode;
  - there is no "no theme": the fallback is `defaultTheme(mode)`;
  - renderFigure stays pure: no DOM, no randomness outside the seeded generators.

## Known and accepted (don't re-raise)
- An explicit `settings.tint` wins on a board paper.
- With the default accent, the blackboard's tilt is about 0.
- Non-default board settings replace a theme's explicit board colours with derived ones.
- `THIN_FLOOR_DARK` is 3.5:1, set by eye.
- A `proseBoundary` test times out at 5s under load.

## Look for
Correctness bugs, determinism leaks (Math.random, Date, iteration order, float formatting), a key/pixel mismatch between generated.ts and host.ts, seams, unbounded loops, missing test coverage for an acceptance line, and meanings that are wrong about the code. Run the targeted tests if you need evidence: `npx vitest run --maxWorkers=2 <files>`, from graph-engine/.

## Verdict
READY, or findings ranked Critical / Important / Minor. Each finding gives file:line, the defect, and a concrete failure scenario. Keep it to ≤40 lines. Write it to `.superpowers/sdd/2026-10-04-graph-styles-a-foundation/t6R-review.md` as well as returning it.
