# HANDOFF calc P3 (implicit curves and regions) 2026-10-07

**Branch / worktree / last commit:** `milestone-a/calc`, at `C:/Users/benif/Osmosis/.claude/worktrees/milestone-a-calc`. Last commit `cab5532` (P3 Task 4). Nothing is merged anywhere.

**Plan and ledger paths**
- Plan: `docs/superpowers/plans/2026-10-04-calc-p3-implicit-and-regions.md`
- Spec: `docs/superpowers/specs/2026-10-01-calc-proofing-design.md`, under "Implicit curves and regions (P3)" (including "Decided before P3"), plus "As built (P2)".
- Ledger: `.superpowers/sdd/2026-10-04-calc-p3-implicit-and-regions/progress.md`. It is git-ignored but on disk in this worktree, and holds every ruling, each task's commits and the parked minors.
- P2's ledger: `.superpowers/sdd/2026-10-03-calc-p2-adaptive-sampler/progress.md` (P2's rulings and parked minors).

**Done** (task → commits → review verdict):
- **T1**, region contract and renderer (outlines with holes, dashed curves, earcut start-vertex guard): `3d5cc7d..9e35c58`, review clean.
- **T2**, quadtree (classifier-driven, level-order uniform stop, verdict on leaves, √2 leaf sizing): `9e35c58..116bcc5`, review clean.
- **T3**, contour and chains (bisected edge-keyed crossings, pole rejection, certified X including grid-line nodes, touch points, domain-edge cuts, piece check): `116bcc5..aa1d3f6`, review clean.

**In flight: T4**, regions plus the `sampleImplicit` and `sampleRegion` entry points.
- Implemented and committed: `aa1d3f6..cab5532` (`3bfa29f` holds the pole-line midpoint rule and the quadtree `budget.cells`; `cab5532` holds regions, the outline, the entry points and the per-statement budget). Annulus area 9.42481 against 3π; half-disk 6.28298 against 2π. Budgets: FULL 1.2M points / 400k intervals, COARSE 300k / 100k.
- **Review not done.** An Opus review started and was stopped under Ben's new rules, with no findings delivered.
- The implementer's own concerns:
  - `leftOut` leaves carry no note (60 at the jumps of `y > floor(x)`);
  - pole crowds are truncated at COARSE (in-view leaves go first);
  - leaves are cut by planar faces, not Sutherland–Hodgman, so `or`/`not` are exact;
  - code was written before its tests (mutation-checked);
  - one Task 3 test changed from 1 to 2 twin evaluations.

**Next 3 actions, in order:**
1. **Review T4 with a Sonnet reviewer** on `git diff aa1d3f6..cab5532`.
   - Acceptance lines: plan T4's tests, plus the five rulings carried in its dispatch (ledger line "Task 4: implementer … carried").
   - Areas against analytic values; fill and boundary agree; undefined areas unshaded; Rule 1 (no fill or curve across poles or undefined cells); the `if` clipping of implicit curves; the cap and notes; determinism.
   - At most two fix rounds; Sonnet fixer.
2. **Split T5** (into the engine) into ≤150-line subtasks in the ledger, then dispatch batches. Items:
   - `buildScene` calls `sampleImplicit`/`sampleRegion`, with the condition from op/chain plus `where`;
   - remove `traceImplicit*`, the `resolution` use and `DRAG_RESOLUTION`, plus the legacy `triangles` kind;
   - overscan the slope field;
   - notes (turn T4's `leftOut`/refused/bad-view flags into truthful notes);
   - replace the marching-squares tests, each with a note.
3. **Then T6** (transform during a gesture), **then T7** (corpus, conic property test, svgScene regions/dashed, contact sheet, examples, docs). Then the final whole-branch review (Sonnet), and a Learn spec sync.

**Open findings and minors carried** (details in the ledger):
- **T1:** `triangulate` keeps an extreme start when a ring repeats its first vertex (band path; nothing produces it today). Dash corner notch / closed-chain seam. Earcut cost on many-holed outlines → T7. svgScene doesn't draw regions or dashed curves → T7. Dashed-curve index buffer reallocation → T6.
- **T2:** capped leaves take the root's aspect ratio. Expanded double-root forms to be pinned at more than one window in T7.
- **T3:** nearly parallel arms (`y² = sin(kx)²`) miss X's at COARSE. Tiny lemniscates vanish at COARSE. Plateau X gap of 0.83 px. `x^y = y^x`'s y = x line ends a leaf short. Crowd cost: `y − tan x` over 200 units costs 344k contour twin evaluations.
- **T4:** the concerns above, pending review.
- **Parked (pre-existing, not fixed):** a Unicode `θ` in a polar curve fails in the tokenizer.
- P2's parked list lives in P2's ledger.

**Rules and gates:**
- Work under Learn `build/osmosis/AGENT-SYSTEM.md`: subtasks of ≤150 lines and ≤4 files; fresh Sonnet implementers per batch; Sonnet reviewers; one review per task on its diff; at most two fix rounds; hand off at about 400k context.
- Never edit `graph-engine/src/space/`, `src/figure/`, `scene/buildScene3d.ts`, `render/SceneRenderer3D.ts`, `server/` or `web/`. `render/marchingSquares.ts` stays unchanged (space imports it). `math/` is read-only.
- No merges into main or `milestone-a/main`, no deploys, no pushes to main.
- Do NOT merge `milestone-a/space-calc-compat2` until Ben says so.
- Vitest at most 2 workers. Headless Edge only, with a timeout and kill. Check usage between tasks and stop dispatching at 90% of the 5-hour window.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Ben's open questions:**
- **P2's finishing option.** Recommended: keep the branch and keep building, merging later.
- **Merge space's polar fix** (`milestone-a/space-calc-compat2`, one commit to space/kernel/curves.ts, cut from calc 9ec2402) into calc? When merging, run the scene sweep and space's polarTurn test.

**Ports and previews running:** none. For Ben's own look, give him `cd graph-engine && npx vite --port 5183 --host 0.0.0.0`; launching it in the terminal panel fails.
