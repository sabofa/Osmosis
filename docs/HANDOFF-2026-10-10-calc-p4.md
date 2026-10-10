# HANDOFF calc P4 (the frame) 2026-10-10

**Branch / worktree / last commit:** `milestone-a/calc`, `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`. T1–T4 were built on top of `19cf93a` (the plan). Nothing is merged into main or `milestone-a/main`.

**Plan and ledger**
- Plan: `docs/superpowers/plans/2026-10-08-calc-p4-the-frame.md`. Read the final section "Revision: log axes by rewriting the expression" (it supersedes the original 4.2–4.5 and 5.2b).
- Ledger (git-ignored, on disk): `.superpowers/sdd/2026-10-08-calc-p4-the-frame/progress.md`. It holds every ruling, commit sha and the minors.
- Spec: `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`, "The frame (P4)". Learn copy: `spec/osmosis/graph-engine/designs/2026-10-01-calc-proofing-design.md`.

**Done (task → commits → review)**
- **T1 directives:** 1.2 `5c01d38` (`@xscale/@yscale`), 1.3 `b2b6e90` (log needs a positive `@bounds`), 1.1 `63a78ab` + 1.1b `cab560b` (`@aspect a:b` as `ratioXY`; 3D refuses it in the kernel; space's scoped grant, which is finished), 1.4 `7a8c5b4` (`@xstep/@ystep` read π multiples).
- **T2 pure frame (`plot/frame/`):** 2.1 `15db007` labels, 2.2 `483c312` π, 2.3 `9faebb8` log ticks, 2.4 `c163af9` + `e47d0ea` `frameTicks` and `labelAnchors`.
- **T3 renderer:** 3.1 `c0ef180` (`gridPlan`, `GridRenderer` on `frameTicks`), 3.2 `5488548` + `bed6f54` (axis titles, drawn only when authored), 3.3 `3bf45c9` (svgScene frame).
- **T4 log axes by expression rewrite:** 4.1 `007ef27` (`scale.ts`), 4.2 `9667359` (`rewrite.ts`), 4.3 `f78e1f4` (curves), 4.4 `8a5d6d8` (implicit and regions), 4.5 `c80f865` + `4b7739c` (other objects, field, features).
- **Review of T1–T4:** READY (Sonnet, no Critical or Important). Controller check at the review point: full vitest 7877 pass, `tsc` app and node clean, `oxlint` clean, sweep `identical 49; differ 0`, contact sheet 80 cases with 0 problems.

**Next 3 actions, in order**
1. **Cleanup batch** from the review's eight minors (listed at the end of the ledger). Three that matter most:
   - `titleLayout` must return `[]` when the view is degenerate (spans or px not finite and positive);
   - a π axis over a huge span must fall back to the nice step instead of returning 10000 ticks;
   - decide whether the log axis line sits at plane 0 (value 1), then state it.

   The others: remove or comment the dead `View.xScale?/yScale?` and `pxMapper`; move the tuned numbers (`ticks.ts` divisions, the 20/14 px label margins duplicated in `svgScene.ts`) into `plot/frame/tuning.ts`; make the strong-line step and `frameTicks`' step agree; add `?? linear` guards on `config.scales`; read the title defaults from `defaultSpaceConfig()`.
2. **T5, the camera, once 2D handling is merged into `milestone-a/main`** (gate G2: Ben's re-check on :5181 and geometry's phase 13 first). Do 5.pre (merge `milestone-a/main` into `milestone-a/calc`; expect conflicts in `GraphViewer.tsx`, `parseConfig.test.ts`, `config.ts`; run the checks and the sweep), then 5.0 (the adapter decision, no code), 5.1–5.6 per the plan. With log axes the camera's bounds are in (u, v), and `buildScene` already takes the viewed plane as its `bounds`. view2d was reassigned to another session (Ben, 2026-10-10: "owned here, tiles"; see memory `view2d-owner-tiles`), so any view2d change is requested from that session.
3. **T6** (corpus rows with `ticks` expectations, a "Frame" example group, docs, the Learn sync, the final whole-branch review). Do it after T5. The corpus and sheet parts that don't need the camera can be done earlier.

**Also queued: T7 = Learn `spec/osmosis/workspace/frontend/06-engine-host.md` §8.4** (2D plots take the layer alphas: premultiplied alpha, `graph-grid-alpha`, region fill onto `graph-region-alpha` at `render/geometryGroup.ts:~459`, publish paper, grid and region layers). It depends on the theming chat's theme-core 8.1 landing (tokens, carriers, `clampTokenValue`, the `engine-host` types package), and on geometry's sign-off for the optional `alphas` in `ThemeSource`. Do it as one unit with T5.2 (both touch `SceneRenderer`), and after T3.1 (done). The ledger's "2026-10-10" section has the full reading of the spec. If 8.4 needs `space/` or `SceneRenderer3D`, ask the space chat.

**Open findings and minors carried**
- The review minors above; P3's final minors (dead `_resolution` param, two tuned constants outside `tuning.ts`, `regionkit.ts` rename).
- **Meaning change to put in the docs:** `@xstep: 2pi` used to parse as 2 (`parseFloat`); it is now 2π.
- **Spec vs code:** the spec writes `@bounds: [0, 2pi] x [-1.2, 1.2]`, but the real syntax is `@bounds: xMin,xMax,yMin,yMax`. Reconcile in the docs.
- **Known limits to document (6.3):** straight world segments, polygons and vectors are drawn straight between their mapped endpoints on a log plane; tangent lines and circles are refused on log axes; polar curves are refused on log axes (write them parametrically); `angle/tick/rightAngle` marks and constructions are left in world coordinates.
- A sweep note: `.sweep/scenes.mts` is git-ignored; I edited it in place to leave `scales` out of the parse hash. Any new calc-only `GraphConfig` field needs the same exclusion before the sweep prints `identical 49`.

**Rules and gates**
- Work under Learn `build/osmosis/AGENT-SYSTEM.md` (Sonnet agents, ≤2 in parallel, ≤150-line subtasks, one review per task, ≤2 fix rounds, hand off at ~400k).
- Never edit `space/` (except the finished grant: `config.ts`, `grammar/directives.ts`, `frame/aspect.ts`, `kernel/index.ts` and their tests), `figure/`, `buildScene3d.ts`, `SceneRenderer3D.ts`, `view2d/`, `server/`, `web/`. `math/` is read-only. Parser edits are additive.
- Agents must run commands in the foreground with timeouts (a hung background full run stalled one earlier); the controller runs the full suite, `tsc`, `oxlint` and the sweep. Stage only your own paths; never `git stash`; no merges into main or `milestone-a/main`; no pushes.

**Ben's open questions:** none new. He answered tonight's: the one-axis zoom modifier is Alt + wheel (x) and Alt + Shift + wheel (y), the log default window is x 0.1..10 (set in 5.1, not yet built), and the build waits for 2D handling to merge for T5 only.

**Ports / previews running:** none. Ben's look: `cd graph-engine && npx vite --port 5183 --host 0.0.0.0`, then Calculus examples. A frame is not in any example yet (T6).
