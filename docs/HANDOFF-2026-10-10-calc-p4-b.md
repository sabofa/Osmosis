# HANDOFF calc P4 (the frame), part b, 2026-10-10

**Branch / worktree / HEAD:** `milestone-a/calc`, `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`, `012b24d` before the docs commit. Nothing is merged into main or `milestone-a/main`; nothing pushed. Supersedes `docs/HANDOFF-2026-10-10-calc-p4.md` (T1-T4 detail still lives there).

**Done, by task** (`git log 19cf93a..HEAD`)
- T1 directives: `5c01d38` `@xscale/@yscale`, `b2b6e90` log needs positive `@bounds`, `63a78ab` + `cab560b` `@aspect a:b`, `7a8c5b4` pi steps.
- T2 pure frame: `15db007` labels, `483c312` pi, `9faebb8` log ticks, `c163af9` + `e47d0ea` frameTicks/labelAnchors.
- T3 renderer: `c0ef180` gridPlan, `5488548` + `bed6f54` titles, `3bf45c9` svgScene frame.
- T4 log axes by rewrite: `007ef27`, `9667359`, `f78e1f4`, `8a5d6d8`, `c80f865`, `4b7739c`.
- Cleanup `ffb6a44`, `5ab96d6`; merge of 2D handling `e4d413c` (T5.pre).
- T5 camera: `e94e865` PlotView, `5693980` axisZoom, `bcbd95e` Camera2D facade, `9f5daa9` input on view2d + Alt wheel, `5ee809c` frame drives camera, `fb17b55` per-axis px sizes, `8b91377` live frame, `e990677` formatForSpan, `c189866` `@lock`, `5f0e9d3` deep zoom.
- T6 corpus/examples: `9ddd552` corpus rows, `e519d45` Frame example group.
- Visual-check fixes: `f8a34ce`, `43e9db4`, `35217b0`, `6b0f73f`, `ff33950` (constant px widths on unequal axes), `6147b45`, `012b24d` (ribbon px test).
- Docs (this commit): `GRAPH-DSL-REFERENCE.md` (frame section, directive rows), spec "As built (P4)".

**Not done**
- **T7 (Learn 06-engine-host 8.4, layer alphas):** waits for theme-core 8.1 landing in `milestone-a/*`. Do it with SceneRenderer; ask the space chat if it needs `space/` or `SceneRenderer3D`.
- **6.4 final whole-branch review:** not run as of this handoff; T1-T4 were reviewed READY earlier, T5-T6 have had only the controller's checks and headless visual checks.
- Learn sync of the spec and reference (6.3 second half) if not yet copied.
- Leftovers (see the spec): angle-label distance x-only, 7 px/char label collision estimate, Alt+wheel under auto aspect resets on resize.

**Ben's feel check** (needs hands, not testable headless): drag and coast, pinch, double-click reset; Alt+wheel (x) and Alt+Shift+wheel (y) on the 2:1 example (some Linux window managers swallow Alt+wheel); `@lock` (page must scroll over the plot); deep zoom (labels stay distinct, curve smooth); curve weight (taper removed 2026-10-10 on Ben's order: uniform `CURVE_BASE_WIDTH_PX` = 3 px; `CURVE_WEIGHT_INTENSITY` is gone, line character goes to the future graph style engine).

**How to run:** `cd graph-engine && npx vite --port 5183 --host 0.0.0.0`, then the Frame group in the examples (pi ticks, semi-log, log-log, 2:1 aspect with titles, deep zoom, `@lock`).

**Checks**
- `npx vitest run --maxWorkers=2 --testTimeout=30000` (under agent load some tests time out at the default; they pass alone). Last full run: 8305 tests, 8 timeouts under load, all green at `--maxWorkers=1`.
- `npx tsc -p tsconfig.app.json --noEmit` and `-p tsconfig.node.json`; `npx oxlint`.
- Sweep: `.sweep/scenes.mts` is git-ignored. Baseline `.sweep/graph-engine/src` = `milestone-a/main` `6a0ae1f`. Calc-only `GraphConfig` fields (`scales`, `lock`) must be excluded from its parse hash, or it will not print `identical 49; differ 0`. Any new calc-only field needs the same edit.

**Rules:** Sonnet agents, at most 2 heavy ones while Ben uses the PC; never edit `space/` (except the finished grant), `figure/`, `buildScene3d.ts`, `SceneRenderer3D.ts`, `view2d/`, `server/`, `web/`; stage only your own paths; no `git stash`, merges or pushes.
