# Space Integration — Wiring the Phases Together, the Box Pass, and Scientific Notation

> **For agentic workers:** execute task-by-task with TDD and one commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** join what S3, S4a, S4b and S5 built in parallel into one working engine:
- `contour:` reaches S4b's level curves;
- S4a's marching tetrahedra serves S4b's three-variable tools;
- S5's boxes join S3's frame loop;
- S4a's coordinate readouts reach S3's probe;
- every box-dependent statement draws into the box the rest of the scene resolves (the "box pass");
- the shared tokenizer reads scientific notation.

**Architecture:**
- **Merges.** S4a (de551e2) and S4b (c9482c3) are already merged into `milestone-a/space` with S3. S5 merges at the PAUSE after Task 3.
- **Then this plan** wires what the phases left as seams.
- **The box pass** makes the kernel two-pass:
  1. statements that define the scene build first;
  2. the kernel resolves the box from their extent with the same function the frame uses;
  3. box-dependent statements build against it.

**Tech Stack:** TypeScript, WebGL2, Vitest. No new dependencies.

**Spec:** Track 3 "Revised 2026-09-26": SP2, SP3, SP4, SP5 (bounds), SP6, SP9. Read the phase plans S3, S4a, S4b and S5 and their ledgers' merge notes:
- S4b: the contour dispatch by arity, `MESH_LEVEL_SURFACE`, and `toolBox`.
- S5: the `gl/backend.ts` reconciliation, and the split `drawBoxes`.
- S4a: the parametric pick `coordinates(p)`, the registry `points` and `registeredBuilder`, and `KeywordRow.parse` returning null.

## Global Constraints

- Everything in the S1–S5 plans' Global Constraints still binds, including:
  - no three.js under `space/`;
  - only `space/gl/` touches WebGL; only `space/ui/` and `SpaceRenderer.ts` touch the DOM;
  - errors are returned and name their line;
  - determinism; exactness is never inferred;
  - proving a test means deleting the behaviour it covers;
  - all three checks clean before every commit;
  - one commit per task, with the trailer EXACTLY `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`;
  - stage explicit paths, never `git stash`, never push.
- **Keyword ownership, agreed with the solid-figure side:**
  - `parseSpaceKeyword` never claims a hyphenated point list;
  - `fill:`, `net:`, `shortest:`, `dihedral:`, `angle:`, `right-angle:`, `segment:`, `tick:`, `cut:` and `section:` are never used at line start.
- **Never use a browser tool.** Look at renders with headless Edge from PowerShell (see the S3 plan), against the review server on 5182 from this worktree.
- **The byte-identity sweep:** every figure-mode example's SVG under every `@view`, and the parse output of every example and test literal. Differences must be named by this plan (only Task 6 may change parse output).

## Load-bearing decisions

**J1 — The box pass.**
- `BuilderEntry` gains an optional `boxDependent: true`.
- **The kernel's order:**
  1. prepare and build every statement that is not box-dependent;
  2. compute the extent (`sceneExtent`);
  3. resolve the box with `frame/bounds.ts` `resolveBox(config.space, extent)`, the same function the renderer's frame uses, so the two agree by construction;
  4. build the box-dependent statements with `context.box` set.
- **When nothing box-independent draws,** the box is `@bounds3d` if given, else [−5, 5]³ (per axis: an authored axis always wins).
- **What is box-dependent:**
  - S4a: `plane:`, `line:`, implicit surfaces, level surfaces, coordinate surfaces, and the frame, osculating and motion arrow scales;
  - S4b: every tool through `toolBox`, which now reads `context.box`;
  - S5: region floors, centroid drop lines, and the Riemann and volume floor.
- **Box-dependent marks are clipped to `context.box`.** So they never stretch it, and the renderer's own `resolveBox` over the full extent gives the same box. Pin that in a test.
- **On `setValue`:** if a rebuilt box-independent statement changes the resolved box, every box-dependent statement rebuilds. Otherwise the S1 identity rule holds. During play and drag, S3's R1 freeze holds the renderer's box. The kernel's box may move, but the dependent statements must then use the FROZEN box passed down by the renderer: add an optional `holdBox` to `setValues`/`setValue`. State this in a comment.
- **Tests,** from the S4b review:
  - `z = x^2+y^2`, `z = -x^2-y^2`, `gradient: x^2 + y^2 at (1, 1)` puts the floor arrow on the resolved floor (z = −50), not z = 0;
  - a surface with its own `for x in [-1, 2], …` domain plus a tool: the tool uses that x range and doesn't stretch it to [−5, 5];
  - a `plane:` beside a surface spans exactly the surface's box.

**J2 — Contours.** S4a's `space:contour` builder dispatches two-variable targets (`targetArity === 2`) to S4b's `contourCurves`. It deletes the "arrives with phase S4b" error and adapts field names to S4b's `ContourForm`. Add the contour example: `f(x, y) = x^2 - y^2`, `z = f(x, y) opacity: 0.5`, `contour: f levels 9 floor labels`, `@bounds3d: x [-2, 2], y [-2, 2]`.

**J3 — Level surfaces for S4b.** `MESH_LEVEL_SURFACE` in `kernel/surfaceTools/levelSurface.ts` becomes an adapter over S4a's marching tetrahedra.
- `gradient: … surface` draws the level surface through the point, and its "arrives with S4a" error goes.
- Three-variable Lagrange draws S4a's mesh and seeds from its vertices (up to 64 evenly spaced), honouring `res:` (S4b's M5).
- The two copies of the point-list rule in `keyword.ts` were already collapsed to one, keyword-aware for lowercase names, in merge c9482c3. Keep `pointList.test.ts` green.

**J4 — Boxes in the frame loop.**
- Opaque boxes draw in S3's opaque pass.
- Translucent boxes go through OIT: `shaders/box.ts` gains the OIT outputs, box clipping and the depth cue, and sorting per instance remains only for the fallback without the extension.
- Polygon offset matches meshes.
- Remove S2's box skip.
- **Fake-GL tests:**
  - an opaque box draws before a translucent mesh;
  - a translucent box goes through the OIT accumulate program;
  - dispose leaves nothing.
- A headless shot of S5's Riemann example with a translucent plane: the plane tints the boxes.

**J5 — Readouts.**
- S3's `pick/readout.ts` appends the parametric pick's optional `coordinates(p)` as a row, e.g. (r, θ, z) or (ρ, θ, φ).
- An implicit pick shows |∇F|.

**J6 — Scientific notation in the shared tokenizer.** This closes handoff open item 4, and the rule was agreed with the solid-figure side.
- **The rule:** a lowercase `e` counts as an exponent only when it immediately follows a numeral (no space) and is immediately followed by an optional sign and a digit: `1e-12`, `2e3`, `1.5e+6`.
- **Uppercase `E` is never an exponent:** `2E3` keeps today's parse.
- **Unchanged, each with a test:** `2e`, `e`, `3e x`, `2e^x`, `e^(-x)`, and `e` inside identifiers (`net`, `sec`, `center`).
- **The sweep lists every changed literal.** Expected: none among existing examples and tests apart from lines that contained such literals. List them.
- Update the handoff's open item 4 to closed, with the commit.

---

### Task 1: Contours and level surfaces wired (J2, J3)
- [ ] Failing tests:
  - `contour: f levels …` on a two-variable f produces S4b's curves;
  - `gradient: F at (1, 1, 1) surface` draws a level surface through the point;
  - three-variable Lagrange seeds from S4a's mesh and honours `res:`;
- [ ] Prove it: delete the dispatch, and the contour test fails.
- [ ] Commit `feat(graph-engine): space contour and level surfaces wired across S4a and S4b`.

### Task 2: Readouts for coordinates and implicit surfaces (J5)
- [ ] Failing tests: a cylindrical pick at (0, 2, 1) shows (r, θ, z) = (2, 1.571, 1); an implicit pick shows |∇F|.
- [ ] Commit `feat(graph-engine): space readouts show coordinate systems and gradients`.

### Task 3: Scientific notation (J6)
- [ ] Failing tests: every J6 case.
- [ ] Run the sweep and list the changes.
- [ ] Update the handoff item.
- [ ] Prove it: delete the digit-follows check, and `2e^x` breaks.
- [ ] Commit `fix(graph-engine): the tokenizer reads scientific notation; uppercase E and bare e keep their meaning`.

### PAUSE: the controller merges S5
After Task 3, send the controller a message (`SendMessage` to "main") and WAIT for its reply. The controller merges `milestone-a/space-s5` into this branch, and Tasks 4–6 then run on the merged tree.

### Task 4: Boxes join the frame loop (J4)
- [ ] Failing fake-GL tests (J4). Headless shot described in the report.
- [ ] Prove it: move the opaque boxes after OIT, and the order test fails.
- [ ] Commit `feat(graph-engine): space boxes draw in the opaque pass and through OIT`.

### Task 5: The box pass (J1)
- [ ] Failing tests: J1's three scenarios, the clip-to-box invariant, the rebuild-on-box-change rule, and `holdBox`.
- [ ] Migrate S4a, S4b and S5's box-dependent builders. Each keeps its existing tests green or updates them with a stated reason.
- [ ] Prove it: delete the second pass (build everything in one pass), and the two-surfaces-plus-gradient test fails.
- [ ] Commit `feat(graph-engine): space builds box-dependent statements against the resolved box`.

### Task 6: Handoff and examples pass
- [ ] Update `docs/HANDOFF-2026-09-23-graph-engine-v2.md`:
  - Track 3's status and what shipped;
  - "space is hand-made WebGL2" in the worktree table and the two-engines paragraph;
  - how to verify (headless shots, not the browser pane);
  - the per-phase lessons worth keeping.

  This file is shared: keep the edit to the space sections and the table row.
- [ ] Headless-shoot every space example in light and dark. Fix anything broken; list anything ugly for S6.
- [ ] Commit `docs: handoff for space S1–S5 and the integration pass`.

## Verification
- All three checks clean.
- The byte-identity sweep, with only Task 5's listed changes.
- Headless shots of every space example.

## Out of scope
- S6 visual polish (parked items from the ledgers are its input).
- Vector calculus and Physics C (sub-project 3).
- Quant (sub-project 4).
