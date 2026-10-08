# HANDOFF 2D handling and geometry, 2026-10-07

**Branch / worktree / last commit:** `milestone-a/geometry`, in `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-geometry`, last commit `ae3815b` (perf(view2d): …). Base of the unmerged work is `d1a8ef4` (the Milestone A integration merge on `milestone-a/main`).

**Plan + ledger paths:**
- Plan: `docs/superpowers/plans/2026-10-04-2d-handling.md`. Spec: `docs/superpowers/specs/2026-10-04-2d-handling-design.md` (copy in Learn: `spec/osmosis/graph-engine/designs/2026-10-04-2d-handling-design.md`).
- Ledger (git-ignored scratch): `.superpowers/sdd/2026-10-04-2d-handling/progress.md`. It holds every ruling (`Ruling:`) and deferred minor (`minor (deferred)`).
- Perf and multi-select brief and report: `C:/Users/benif/AppData/Local/Temp/claude/C--Users-benif-Osmosis/71195cb8-02df-4ba0-b4b7-b128ba7415d4/scratchpad/handling-perf/{brief,report}.md`.
- Geometry's overall handoff: `docs/HANDOFF-2026-09-23-graph-engine-v2.md`.

## Done (task → commit → review verdict)

| Task | Commit | Review |
|---|---|---|
| view2d core: camera, limits, smoothing, coasting, eased moves | 72b89de | clean |
| Gestures and pointing | 7dcd4ad, b9397e5 | clean after 1 fix round |
| `@focus:` and the readout formatting | 1caf56d | clean |
| Figure frame and hit items (SVG byte-identical, 624 renders) | 320647d | clean |
| Browser layer, FigureView and GraphViewer on view2d | 6b52e96, 3ee43ad, 55372a7, f0e7ef4 | clean after 1 fix round |
| Coordinate tool and docs | 1b77be0, e993edf, ae4a771 | clean after 2 fix rounds |
| Less slippery coasting (COAST_TAU 150, COAST_STOP 20) | 970e765 | none (a tune) |
| Open item #3 (`r = bisector` refused with a rename message) | 3341a64 | approved |
| Perf and shift multi-select (H1–H3 below) | c5c5752, ae3815b | **none; Ben's hands-on check is the review** |

The final whole-branch review was skipped on purpose, at Ben's request. Don't run it unless Ben asks.

## Ben's critiques, verbatim (2026-10-07, after hands-on use)

> "already when i select a scrible or something with a bunch or texture or particles it lags out bad, second id like the functionality when i press shift it can multiple select. the handling needs to be more optimized it lags out witht he chalk on rough graph paper. this is my critiques so far"

Earlier, after the first hands-on pass: "can you change how slippery it is real quick" (done: 970e765).

## In flight: subtask checklist

H1–H3 are built (ae3815b, c5c5752) but **unverified by Ben**. The fresh chat starts by getting his verdict on :5181, then does H4–H8 as needed. Each subtask is at most about 150 lines and ≤4 files, test-first, one Sonnet implementer.

- [x] **H1. A cheap live view while moving.** While dragging, zooming or coasting, slide and scale the already-drawn svg with a CSS transform and commit the real `viewBox` on settle (100 ms), throttled at 250 ms or when the scale drifts ×2. Files: `view2d/liveTransform.ts`, `view2d/dom/useView2d.ts`, `FigureView.tsx`, `view2d/feel.ts`. Test: `liveTransform.test.ts` (content points land where the live camera says, to 1e-9). **Acceptance:** panning and zooming chalk on rough graph paper stays smooth, and the figure is sharp once it rests. **Open: Ben's feel check.**
- [x] **H2. Cheap highlights.** Only the outermost matching element gets `figure-hovered` or `figure-selected`; the filter region is the window plus a small margin, resized at commit only. Files: `figure/highlight.ts`, `FigureView.tsx`. Test: `highlight.test.ts` (outermost choice, region size). **Acceptance:** selecting a scribble or chalk fill doesn't lag. **Open: Ben's feel check.**
- [x] **H3. Shift multi-select.** `PointerSelection` is a set; shift + click toggles, a plain click selects one, a click on empty space or Esc clears; `onSelect` reports an array. Files: `view2d/input.ts`, `view2d/pointing.ts`, `FigureView.tsx`, `GraphViewer.tsx`. Test: `pointing.test.ts`, `input.test.ts`. **Acceptance:** Ben can build a multi-selection with shift. **Open: Ben's feel check.**
- [ ] **H4. A frame-time probe** (only if Ben still reports lag). A script that drives a heavy example (chalk on rough graph paper, "Square minus its circle" under `@style: blackboard`) with synthetic wheel events and records frame times, using headless Edge. Always set a timeout, and never kill processes. Files: `graph-engine/scripts/handling-probe.ts` plus the page it drives. Test: the pure frame-time summary (percentiles). **Acceptance:** before-and-after numbers for H1 in the report; p95 frame time under 20 ms during a wheel zoom.
- [ ] **H5. Reduced motion still lags.** With `prefers-reduced-motion`, H1 commits every frame, so a drag has the old lag. Keep reduced motion for *smoothing and coasting*, but still use the live transform for the drag. Files: `view2d/dom/useView2d.ts`. Test: a pure commit-rule test for reduced motion. **Acceptance:** with reduced motion on, drags don't commit every frame.
- [ ] **H6. Tune the knobs Ben may feel.** `OVERSCAN` (30%, may hitch on a commit), `SETTLE_MS` (100), the 250 ms throttle, and the snap of labels, dots and halos at commit. Change only what Ben asks. Files: `view2d/feel.ts`. **Acceptance:** Ben says it feels right.
- [ ] **H7. Carried small fixes in view2d:**
  - the camera is published to React every frame (re-renders FigureView), so gate it;
  - `useView2d.ts` doc comment at lines 46–48 is misplaced and inaccurate;
  - leader lines (`data-object="leader-…"`) get no hit item;
  - the DSL doc says "spaces are free" but `zoom` needs a following space;
  - publishing the pointer doesn't follow a keyboard pan or coast.

  Files: the ones named. Test: a test per fix. **Acceptance:** the ledger's deferred-minor list for Tasks 5–6 is empty or ruled.
- [ ] **H8. Docs.** Update the spec, the handoff's "2D handling" section, `GRAPH-DSL-REFERENCE.md` if needed, and the Learn copy (`spec/osmosis/graph-engine/designs/2026-10-04-2d-handling-design.md`) for: shift multi-select (`onSelect` now reports an array), the live transform and commit rule, and the feel constants. Then tick the geometry lines in Learn `build/osmosis/CHECKLIST.md`. **Acceptance:** spec, code and Learn agree.

## Next 3 actions, in order

1. Get Ben's verdict on H1–H3 at :5181 (the harness picks up changes live). If it's good, move to the merge steps below. If not, do H4–H6 for what he reports.
2. H7 and H8, then one Sonnet review of the whole range `3341a64..HEAD` per AGENT-SYSTEM.md §3.
3. Before merging into `milestone-a/main`: phase 13 (competition constructions: excircles, nine-point circle, radical axes, cevian concurrency) and open items #2 (migration sweep of stored geometry questions) and #5 (the Vector example's mode). Then merge, with Ben's OK.

## What's left before `milestone-a/geometry` can merge into `milestone-a/main`

- Ben's OK after he re-checks on :5181. **No merge without it.**
- Phase 13, open items #2 and #5. (#3 is fixed; #4, scientific notation, was fixed by the space session.)
- The merge itself: keep-both conflicts are expected in `parseStatement.test.ts`, and in `render.ts` once graph styles A lands. Other conflicts may also appear in `HANDOFF-2026-09-23-graph-engine-v2.md`, `config.ts` and `parseConfig.test.ts`. After merging, send the merge SHA to the space and calc sessions so they can re-verify.

## Open findings / minors carried

- View2d deferred minors: see H7 and the ledger. Also: the setScreen/ease.to re-clamp, a wheel during a drag cancels the drag's coast samples, `HALO_GAIN` makes selection a wash under translucent fills, the rotated-ellipse filter region at high zoom, and `COAST_HOLD` has no failing test.
- Open item #3's small leftovers: a malformed construction loses its own error in the message; `r = 1 + cos(θ)` with a typed θ fails in the tokenizer (an older gap).

## Rules and gates (who signs off what; never touch …)

- **AGENT-SYSTEM rules** (Learn `build/osmosis/AGENT-SYSTEM.md`): Sonnet for every agent, at most 2 at once, stage only your own paths with explicit `git add`, never `git stash`, no push, no merge into `milestone-a/main` without Ben's OK after he re-checks on :5181.
- **Reviews:** review → fix → re-review → fix → re-review, then stop. Reviews are scoped to the diff. **Never kill processes.**
- **Geometry signs off `style/` and `figure/`** changes made by the styles session (milestone-a/styles). The standing conditions:
  - clean output stays byte-identical (`figure/cleanGolden.test.ts` untouched);
  - ink is variance, not grain: no speckle, pinholes or dry-brush on the ink line, and `ink.texture()` stays null;
  - the figure renderer stays pure: any GPU or DOM work (paper tiles, painted fills) is a keyed slot plus a deterministic fallback in the SVG, filled by the host;
  - old paper and preset names stay as aliases;
  - `@style-set` refuses out-of-range values with the range in the message;
  - `render.ts` edits stay small and local, with no changes to `GraphViewer.tsx` or `FigureView.tsx` in graph styles A (their wiring lands later, on top of view2d);
  - every role, including authors' own colours, comes from the medium, and boards read well in light chalk (≥1.5:1 for fills, ≥3.5:1 for chalk shading);
  - moved pins are listed with reasons (Ben's ruling: there is no "no theme"; the default Osmosis theme is the fallback, so presets following it is deliberate).
- **Never touch** `view2d/` from the styles session, or `space/` and `style/` from geometry without the owner's agreement. Don't touch ports 5182 and the paint worktree.

## Graph styles: paused (the space session owns it)

- Branch `milestone-a/styles`, worktree `.claude/worktrees/milestone-a-styles`, tip `999dbbb` at my last look. Spec `docs/superpowers/specs/2026-10-04-graph-styles-design.md` (on that branch); plan `docs/superpowers/plans/2026-10-04-graph-styles-a-foundation.md`.
- Signed off by geometry so far: Tasks 1–6 (theme adapter, media, settings registry, six-layer stack, presets and role colours, backgrounds), including the board-fill fix.
- **Tasks 7–8 (the settings sweep and the generated guide; the Style Lab) still need geometry's look when the styles work resumes.** Also before `host.ts` is wired into FigureView: it must revoke its blob URLs.
- Part 3 of figure styles (the written guideline) is folded into graph styles' generated guide.

## Ben's open questions

- The marker used to be a blue felt-tip, and now follows the theme (near-black). Should the marker keep its own blue unless a theme sets a colour?
- Should coloured pencil's lines carry colour from the theme, so it doesn't look like graphite?
- Does the 2D handling feel right (smoothness on heavy textures, coasting, shift-select, double-click reset)?

## Ports / previews running

- :5181 is the geometry review harness, started from this worktree. It may still be running; **leave it running** and don't kill processes. If it isn't, start it from the worktree with `npm run review -- --port 5181 --host 0.0.0.0`.
- :5182 is Ben's pinned space view. Don't touch it.
