# SDD ledger — plan: docs/superpowers/plans/2026-10-04-graph-styles-a-foundation.md
Spec: docs/superpowers/specs/2026-10-04-graph-styles-design.md (approved by Ben 2026-10-04; amended with geometry e03d011). Branch milestone-a/styles (worktree milestone-a-styles), based on paint-bake 528d895.
Gate: geometry reviews this plan before Task 1, and signs off on the branch before merge.
Geometry reviewed plan 4cf1f66: SIGNED OFF with 8 fixes, all folded in (850970d): the precedence sentence; no-theme defaults per medium; generated papers only with a theme (option a); @style-set refuses out-of-range values; renderFigure's optional trailing theme; the full role list including authors' colours; 512 tiles with CompressionStream; host.ts out of the index. Geometry builds none of it; it reviews the branch before merge and is pinged before any pin moves.
Pre-flight scan (task pairs sharing files):
- 1→2 ThemeInput/RoleKey/MediumName: consistent.
- 2→5 noThemeColours: defined in 2, consumed in 5.
- 3↔4 REGISTRY/settingAt: consistent.
- 4↔5 resolve.ts/presets.ts/tokens.ts: 4 touches resolve and parseConfig, 5 touches tokens and presets, sequential.
- 5↔6 the no-theme golden: resolved by the generated-papers-only-with-a-theme rule.
- 6↔5 tokens.ts (paper.tile, colour.medium): both add tokens — run 6 after 5, or merge carefully. Ruling: run 6 AFTER 5 (not alongside), so tokens.ts and the snapshots move once each.
- 7 needs 3, 4, 6; 8 needs 1, 3, 4, 6.
Ruling: tasks run sequentially, 1 → 8, because tokens.ts, presets.test and the lab snapshots are shared by 5 and 6 — if wrong, a little lost parallelism.
Task 1: dispatched (sonnet, agent a4e241c8547d23be1), BASE 850970d.
Ben's corrections (relayed by geometry, 2026-10-04): no "no theme" (defaultTheme(mode), with the app's default tokens as constants plus a drift test); noThemeColours dropped; generated papers always (option a reversed); pins may move to improve realism (re-pin with reasons, list them for geometry); clean exact; ink line no grain; chalk takes every role. Folded into spec and plan (2b4deb8). The Task 1 agent was told to add defaultTheme + defaults.ts.
Task 1 implementer: DONE_WITH_CONCERNS (4880996; style/ 523 tests; full suite 1 failure, fixed: determinism.test forbids render/ imports under style/, so a structural PaletteLike plus copies with drift tests).
Ruling: good/bad series slots are contrast-fitted (the theme's own good/bad stay as given) — data colours must read.
Ruling: one fallback, defaultTheme(mode) (the app tokens), not the engine's built-in palettes — Ben: the fallback theme is the default theme.
Ruling: bidirectional fitLightness accepted.
Resumed the implementer for these two fixes; then an Opus task review.
Task 1 rulings round (d1cdb1e): good/bad fitted in the series; defaultTheme is the one fallback; fitLightness commented. 5624 tests (vitest exits 1 on a worker RPC timeout under load, not a test failure).
Ruling: the derived accent-wash when the accent differs from the default's is accepted; the derived wash for built-in themes (Palette has no wash slot) is accepted until the theming overhaul supplies it.
Ruling: an achromatic accent (C < 0.02) must not tilt the boards — added to the review's fix list.
Task 1 review package: review-850970d..d1cdb1e.diff (the plan commit 2b4deb8 in range is docs only). Opus task review dispatched.
Task 1 review (opus): CHANGES REQUESTED. Spec passes. Important: the board tilt flips at the opposite hue — the default theme's blackboard swings 44.6° between light and dark (the brief's own formula). Ruled: the achromatic accent tilt (float hue residue). Minor: styles by reference (stale key); the default wash chosen on the accent alone; good==bad duplicate; step ≤ 0 loops. Note: index.css --good/--bad unchecked (theming overhaul).
Ruling: the tilt fades to 0 near the opposite hue (×clamp((180−|Δ|)/40,0,1)) and fades in over accent C 0.02-0.04; series start from the default accent's hue when C < 0.02; styles cloned and frozen; the token wash only when both the accent AND the surface are defaults; skip bad when it equals good; guard step > 0.
Fix round 1 dispatched (resume a4e241c8547d23be1).
Task 1 fix round 1 (98a976c; style/ 535 tests; full suite 5632 passed, vitest exit 1 on a worker RPC timeout only). Scoped re-review by the controller (small diff): the tilt fades near the opposite hue and fades in over chroma 0.02-0.04 (smoothstep), continuous; series start from the default accent hue when C < 0.02; styles cloned and frozen; the wash rule needs both defaults; good==bad skipped; step guard. Default blackboard #1a2930 in both modes. READY.
Task 1: complete.
Task 2: dispatched (sonnet, fresh agent), BASE 98a976c.
Task 2 implementer: DONE_WITH_CONCERNS (9f27479; 11 new files in style/media; style/ 596 tests; full 5693 passed).
Ruling: board neutrals for the ink and muted roles on chalk/whiteboard, a chroma lift fading with the base chroma, the contrast floor winning on mid-tone papers, dryness→skips — all accepted.
Ruling: board media fit from ThemeInput.boardColours = the theme's LIGHT-mode colours (lightColours from the host; the default theme; built-in themes by preset id, copied with a drift test; else the current colours, interim) — Ben: light/dark must not change the blackboard, coloured chalk included — if wrong, a custom theme's chalk shifts slightly between modes until the overhaul passes both.
Fix round 0 dispatched (resume ae936f1064b0a46a7).
Task 2 fix round 0 (37ed65c; style/ 625 tests; full 5722 passed): boardColours = the theme's light-mode colours (lightColours / default / built-in by preset id / else current), into the key; chalk and whiteboard fit from them; boards also derive from boardColours.accent (closes a 1-unit mode difference). Accepted: built-in light wash derived; the default-theme match compares the 7 tokens only; custom themes without lightColours are interim. NEXT: Opus task review of Task 2 (850970d..37ed65c range: review 98a976c..37ed65c), then Task 3.
Task 2 review package: review-98a976c..37ed65c.diff. Opus task review dispatched (2026-10-04, after the usage reset).
Task 2 review (opus): CHANGES REQUESTED.
Spec passes. Verified: boards are byte-equal across modes (default and built-ins); every role meets its floor on the solid colour; red on a blackboard is #ffa193; 3 deletions caught.
Important: the marker collapses line/auxiliary on dark themes (ΔE 0.006); the floors fail once a stroke is blended at the medium's opacity (graphite 15/21, coloured pencil 11/21, whiteboard 13/21).
Minor: the default-theme detection ignores good/bad and series.
Ruling: readability is measured on the blended stroke (hex at opacity over its surface) — what Ben sees, not the solid hex.
Ruling: marker neutrals; every medium keeps line vs auxiliary ΔE ≥ 0.05.
Notes for Task 5: a no-CSS path uses defaultTheme(mode) (render DARK_PALETTE muted ≠ token). Note for B: `overlap` is stroke on stroke, never on paper.
Fix round 1 dispatched (resume ae936f1064b0a46a7).
Task 2 fix round 1 (7f95462; style/ 640 tests; full 5737 passed): the marker's own neutrals (line vs auxiliary ΔE ≥ 0.099 everywhere); floors measured as drawn (blendOver in 8-bit sRGB, as canvas/SVG composite) — 0 roles below the floor on default/built-ins; the default detection compares good/bad and keeps an explicit series; 13 pins moved with reasons (to list for geometry). Scoped re-review by the controller: correct. READY.
Task 2: complete. Notes carried: Task 5 — a no-CSS path uses defaultTheme(mode), and renderers must draw at MediumColour.opacity; B — overlap is stroke on stroke.
Task 3: dispatched (sonnet, fresh agent), BASE 7f95462.
Task 3 implementer: DONE (025947e; 256 settings: style 24, paint 219 (PARAM 213 + CURVE 6), media 9, board 4; style/ 694 tests; full 5779 passed, vitest exit 1 on onTaskUpdate timeouts only).
Concerns: exported BOARD_BASES from theme/derive.ts; the board settings are registered but not wired (Task 4); some meanings say "no effect today" (dab/line density, edge/line curvature, media grain) and go stale as later tasks wire them; style/ now imports space/paint/params (the "style stands alone" test passes; geometry may want that rule revisited).
NEXT (after Ben's usage pause): an Opus task review of Task 3 (range 7f95462..025947e), spot-checking meanings against code (esp. the 10 least-sure in task-3-report.md); then Tasks 4-8.
2026-10-07 (inventory session in charge overnight): Task 3 review dispatched (opus, review-7f95462..025947e.diff). Then Tasks 4-8; message geometry as each lands; stop when the 5h limit reaches 90%.
Task 3 review (opus): CHANGES REQUESTED. Structure PASS (256 entries; unique paths; defaults in range; built from sources; tests catch breakage); the style/→space/paint/params import is acceptable (no cycle, no GL or DOM).
Problem: 7 of 40 sampled meanings wrong or misleading (bounce, targetPer10kPx and the width template, wCurvature.1/2, halfLo, valueHold, edgeMinContrast, unwired media and board grain claimed visible). Minor: 219 one-way interactions plus 2 false pairs and missing ones; the underpaint's half-strength mix unmentioned; wording; repeated numbers; BOARD_BASES mutable; a test title; canvas.weave and dragDensity unregistered.
Ruling: fix the 7, then RE-CHECK every paint.* and media meaning against the code (sample error ~17%); interactions symmetric by construction; "Not drawn yet:" prefix for unwired media and board settings (Tasks 5 and 6 remove it); a completeness test over every DEFAULT_PAINT_PARAMS leaf (extras registered without new lab sliders); the first sentence stands alone in ≤ 200 chars; no "default <number>" in prose.
Fix round 1 dispatched (resume a3d580054307c1058).
Task 3 fix round 1 (c57dbaf; 258 entries; style/+params 705 tests; full 5790 exit 0): the 7 corrected (28 entries); B re-check changed 66 more meanings (29 non-role, 24 role, 13 edge-weight), listed in the report; interactions symmetric by construction with a test; EXTRA_PAINT_SETTINGS (canvas.weave, dragDensity) and a completeness test over every DEFAULT_PAINT_PARAMS leaf; "Not drawn yet:" on 13 media/board settings; first sentence ≤ 200 chars.
Found: in the bake, planeMinPx below the 216 px² merge floor does nothing (live path unaffected) — a note for Ben, now in its meaning.
Scoped Opus re-review dispatched (review-t3-fix1.diff).
Task 3 fix-round-1 re-review (opus): NOT READY. 8 of 45 sampled wrong. Passes: the 7 corrections; 518 links all two-way; "Not drawn yet" exactly 13; planeMinPx confirmed; both tests catch deletions; all 15 unchanged picks right.
Wrong: flipHue/flipChroma and loadMin/loadMax/loadBreakPx (bake vs live); line.load "loaded start"; devL/devC/devH reach (about 4×); wDepth.* (authored eye); canvas.texture (relief, not weave).
Ruling: every paint meaning holds for both the baked and the live path, or says where they differ; remove 2 weak links.
Fix round 2 dispatched (resume a3d580054307c1058).
Task 3 fix round 2 (86bb8a5; 707 style tests; full 5792 passed): the 8 fixed plus a pass over 13 more; path differences stated (wFocal, wShadowDist, edgeReachPx, planeCellDeg, edge kinds); 504 links, all two-way; tests hold out the weak pairs and assert that path-dependent meanings name both paths. Controller spot-check (flipHue, line.load, canvas.texture, light.shadows): correct. READY.
Found, for the BAKE follow-up: light.shadows does nothing in the baked painting (bake/plan.ts always casts) — the Shadows toggle is inert with baking on. Also wDepth.1 has no effect on baked outlines (silhouettes have no depth term, by design).
Ruling: the extra removals (planeStepA/B, hAdjust from shiftMax) are accepted — they add, they don't cap.
Task 3: complete. Geometry told (style/ now imports space/paint/params; Task 2 moved 13 pins).
Task 4: dispatched (sonnet, fresh), BASE 86bb8a5.
Geometry SIGNED OFF Tasks 1-3 (98a976c, 7f95462, 86bb8a5). Condition: an import-boundary guard — style/** imports nothing from space/, except style/settings/** which may import only space/paint/params. Folded into Task 4 (message sent to the running agent). Before Task 5 touches figure/: message geometry with the moved-pin list.
Task 4 implementer: DONE (39d0df2; 5897 tests; resolve/presets/cleanGolden untouched; 49/49; no pins moved; renderFigure unchanged; the guard is style/boundary.test.ts, proved by deletion; toPaintParams lives in settings/paintParams.ts).
Ruling (for the fix round): split the registry into a prose-free spec table (what resolve/@style-set need) and the meanings (only the guide and lab import them), so the 2D figure bundle doesn't ship ~100 KB of prose.
Ruling: integer settings — registry entries derived from an integral source (step 1: seed, bristles, worldFixed…) get `integer: true`, and @style-set refuses non-integers.
Accepted: themeStylesOf narrowing on read (Task 5 uses it); paint/media/board @style-set carried but not yet rendered (Tasks 5 and 6, and the space side).
Opus task review dispatched (review-86bb8a5..39d0df2.diff).
Task 4 review (opus): CHANGES REQUESTED. Spec PASS (precedence exact; resolveStyle identical on odd cases; @style-set refusals worded like @style-*; paint paths round-trip; geometry's conditions met); 1096 tests; 3 deletions caught.
Important (already ruled, confirmed and sized): the bundle — figure 216→327 KB and parser 101→214 KB because of the 86 KB of prose; whole numbers — mark the ~13 truly integral settings by meaning, NOT step 1 (azimuth 22.5 must pass).
Minor: the guard misses backtick import(), import.meta.glob, and a // inside a string; resolveSettings ignores TYPE_DEFAULTS when typeDefaults is omitted; BUILTIN_THEME_STYLES is mutable; the report overclaims.
Ruling revised: integer by meaning, not step.
Fix round 1 dispatched (resume acbd1fc4605a61f4e).
Task 4 fix round 1 (ebd7fc3; 5945 tests; 49/49; no pins moved): the registry split (figure 243 KB, parser 129 KB, guarded by src/proseBoundary.test.ts); integer by meaning (15); the guard reads TS syntax; TYPE_DEFAULTS reaches resolveStyle; BUILTIN_THEME_STYLES frozen. Controller spot-check: correct. READY.
Task 4: complete. Geometry told before Task 5 (pins so far: none of theirs).
Task 5: dispatched (sonnet, fresh), BASE ebd7fc3; notes task-5-notes.md.
Geometry heads-up: milestone-a/geometry (unmerged) changes render.ts (returns {svg,errors,frame,items}, Projection.centre, author3, new frame/hit/highlight files) and rewrites FigureView/GraphViewer onto view2d. Ruling: Task 5's render.ts edits stay small and local (theme?, pen choice, role colours; no body or return restructuring); GraphViewer/FigureView untouched in A. Relayed to the Task 5 agent.
Task 5 implementer: DONE_WITH_CONCERNS (141d2e3 the before-golden; 9aafff1 presets and role colours; 6018 tests; contact sheet 127/0 errors; 49/49; cleanGolden, fill pins and ink pins untouched; 25 pins moved, listed in the report).
Ruling: the medium's opacity REPLACES the line type's factor (no double count); the user's line/fill opacity still multiplies.
Ruling: the marker's ink is near-black (L≈0.22) on light paper and near-white (L≈0.92) on dark; muted 0.15 nearer the paper; coloured roles keep 0.45-0.65 (the old #555555 marker line was too pale).
Accepted: board papers in PAPER_TYPES as flat sheets now (Task 6 replaces them); hidden and auxiliary share the auxiliary role until render.ts can pass a role after geometry's merge; GraphViewer/FigureView unwired.
Fix round 0 dispatched (resume add2652a9d89d996f); then an Opus task review; then send geometry the final moved-pin list.
Task 5 rulings round (ad7deb9; 6048 tests; contact sheet OK; 49/49; cleanGolden untouched): the medium's opacity replaces the line type's factor; the marker ink is near-black/near-white; plus a marker on a dark surface drawn normally (multiply would vanish) — accepted. 31 pins moved, listed in the report.
Ruling: the pencil and marker presets' line.opacity 0.85 → 1 (the medium supplies the translucency; the floors must hold for every role) — goes into the review's fix round.
Opus task review dispatched (review-ebd7fc3..ad7deb9.diff).
Task 5 review (opus): CHANGES REQUESTED. Passes: role coverage (142 board examples, every element light); color:red → #f4a79e; light/dark boards byte-equal; render.ts change minimal; 5 media settings really wired; 31 pins justified; the marker normal blend confined; 2247 tests.
Important: (1) the 0.6 auxiliary fade × the medium's opacity breaks every floor; (2) opposite-lightness pages collapse line vs auxiliary (ΔE ≤ 0.007), and no-theme ≠ defaultTheme.
Minor: the 0.85→1 ruling is needed but needs a backdrop exemption; themeStylesOf not wired; @style-paper: blackboard on clean lays cream; 2 test blind spots; the report understates shading opacity.
Ruling: in a medium, the auxiliary fade is dropped (muted colour + dash mark secondary).
Ruling: ink/muted from the surface's side; the medium built from the host's mode.
Ruling: BACKDROP EXEMPTION — fills, shading, chalk dust and pooled ends are backdrop texture below the floors by design.
Ruling: wire themeStylesOf now; board papers always take the board colour.
Fix round 1 dispatched (resume add2652a9d89d996f).
Task 5 fix round 1 (e5b8a1a; 6085 tests; 49/49; cleanGolden untouched; 38 pins moved, listed): auxiliary 3.05-7.69:1 as drawn; line vs auxiliary ΔE ≥ 0.149; no theme == defaultTheme(mode); presets at opacity 1 plus the backdrop exemption; themeStylesOf wired; board paper colour; blind spots closed (27 and 3 tests fail on deletion).
Ruling: solid figures resolve as figure3d (local render.ts change); presets.test:58 moved (listed); light themes on a dark page use defaultTheme('dark') as an interim.
Resumed for the figure3d fix; then a scoped Opus re-review.
Task 5 figure3d addition (eff8d21; 2295 focused tests; no pins moved). Scoped Opus re-review dispatched (review-t5-fix1.diff, ad7deb9..eff8d21).
Task 5 fix-round-1 re-review (opus): NOT READY on one Important item. Passes: floors as drawn (142 examples × 7 presets × modes × themes × papers); no-theme == defaultTheme in 14208/14208 renders; board light/dark byte-equal; themeStylesOf and figure3d; render.ts ~27 lines, local; 38 pins; deletions caught.
Important: a custom dark theme without lightColours collapses line vs auxiliary on a light page (fittedTheme assumes boardColours are light).
Minor (pre-existing): board media are fitted to their own board, not the page drawn on (chalk on a whiteboard 1.04:1).
Ruling: the reviewer's one-clause fittedTheme fix; board media fit against the actual page when it isn't their board.
Fix round 2 dispatched (resume add2652a9d89d996f).
Task 5 fix round 2 (da2fdad; 6183 tests; 49/49; contact sheet OK; cleanGolden untouched; 38 pins total, none new): the custom dark theme fix (the reviewer's clause; ΔE 0.230-0.283); board media fit to the actual page (neutralsOn in fit.ts, marker byte-identical; floors2 probe 0 below); the drawnIn regex nit. The reviewer's READY condition met (its clause plus a dark-custom test). READY.
Task 5: complete. Geometry sent the 38-pin list.
CHECKPOINT (usage 83%, context 96%): Task 6 NOT dispatched. NEXT: Task 6 (backgrounds) — extract the brief with the task-brief script, carry the notes (board papers already flat in PAPER_TYPES; replace the PAPERS entries; ruling colours from the theme; board.* settings wired, dropping "Not drawn yet:"; tile 512; generated papers always, the default theme; host.ts DOM-only and out of the index; renderFigure pure — keyed patterns over a flat rect; geometry's merge constraint: small local render.ts edits, no GraphViewer/FigureView). Then Tasks 7, 8.
Geometry SIGNED OFF Task 5's code (141d2e3..da2fdad); the 38 pins are accepted. From its contact-sheet render (C:/Users/benif/AppData/Local/Temp/claude/C--Users-benif-Osmosis/71195cb8-02df-4ba0-b4b7-b128ba7415d4/scratchpad/styles-task5/presets-1.png):
- IMPORTANT, to fix FIRST in Task 6 (or as a Task 5 follow-up commit): fills on boards are dark (the region hatching in "Square minus its circle" and "Circle vocabulary" is dark brown/red on the blackboard/greenboard). Cause: styledPen shades fills with deepen(paint, SHADE_DEPTH), which goes the wrong way on a dark board. Fix: the fill and shading roles come from the medium; "deepen" means AWAY FROM THE PAGE (lighter/pastel on chalk). Send geometry a re-shot of the boards after.
- TASTE, for Ben (not decided): (a) marker lost its identity (blue felt-tip → near-black); a medium could carry its own default hue that a theme overrides only when it sets one. (b) coloured pencil's line work reads like graphite (neutral grey); its line role may need the accent/series hue.
Task 6 dispatched (sonnet, BASE da2fdad; notes in task-6-notes.md: fills fix first, then backgrounds). Geometry told.
CHECKPOINT 2026-10-07 (Ben's AGENT-SYSTEM rule: hand off to a fresh chat; Sonnet reviewers): the Task 6 implementer was stopped at a checkpoint. 917b972 is the fills fix; ca5414e is the structures and PNG writer. The rest of Task 6 is split into subtasks T6.3–T6.R in HANDOFF-2026-10-07.md (copy them here first). The Task 7 and 8 notes are written.
Ruling: the tile key is self-describing (paper-v1:<type>:<seed>:<size>:<texture>:<base hex>), so fillPaperTiles(root) and inlinePaperTiles(svg) take no theme — the key carries the resolved page colour, tint and texture, which a theme can't supply — if wrong, add an unused theme? param.
Ruling: the thin-chalk floor THIN_FLOOR_DARK is 3.5:1, set by eye — chalk needs it to read on the boards — if wrong, it is one constant for geometry to change.
2026-10-07 (fresh chat, under AGENT-SYSTEM.md): Task 6 resumed as subtasks. Checklist (details in task-6-report.md §(c) and task-6-notes.md):
- [x] T6.1 fills fix — 917b972.
- [x] T6.2 nine structures + PNG writer — ca5414e.
- [ ] T6.3 generated.ts + rulings.ts (report items 1, 2; PaperInput gains theme, seed). Files style/papers/{generated,rulings,types}.ts, generated.test.ts. Test: SVG pure and byte-stable; light/dark boards byte-equal; changed paper colour changes paper tiles, not board tiles. Accept: tests green, both tsc clean. Gated.
- [ ] T6.4 wire papers + re-pin (items 3, 7, 8), with T6.5 batched (items 4: registry meanings, tile unit). Needs T6.3. Accept: every moved pin listed with a reason; cleanGolden byte-identical; board presets' texture ≈ 1. Gated.
- [ ] T6.6 board settings wired (item 6): deriveBoards(accent,{tilt,chromaCap}), themeWithBoardSettings, boardSettingsOf in layers.ts, one small render.ts edit; NOT_DRAWN_YET 8→4. Accept: board.* changes a figure's board colour; render.ts diff small and local. Gated.
- [ ] T6.7 style/papers/host.ts (item 5), DOM-only, pure key helpers unit-tested. Accept: not imported from figure/, parser or any index.
- [ ] T6.8 shots + tuning (item 9), port 5191, full suite --maxWorkers=2, 49/49, both guards.
- [ ] T6.R one Sonnet review of da2fdad..HEAD (≤2 fix rounds), then wake geometry ONCE with range, moved-pin list, shots.
Ruling: the tile key is self-describing (paper-v1:<type>:<seed>:<size>:<texture>:<base hex>), so fillPaperTiles(root)/inlinePaperTiles(svg) take no theme — if wrong, add an unused theme? param.
Ruling: THIN_FLOOR_DARK 3.5:1 by eye — if wrong, one constant for geometry.
T6.3 and T6.6 dispatched in parallel (sonnet, fresh agents).
T6.3 DONE bb08907 (generated.ts, rulings.ts, PaperInput theme+seed; 1738 tests; not test-first; tile defaults 512 via a cast until T6.4; input.colour not applied to the base — the tint is already saturated). T6.7 dispatched (sonnet); T6.4+T6.5 waits on T6.6 for a clean re-pin.
T6.7 DONE 8edaebb (host.ts: tilePixels, setHrefs, fillPaperTiles, inlinePaperTiles; 7 tests; nothing imports it; proseBoundary 'guide read the meanings' times out at 5s under load only — minor for T6.R).
T6.6 DONE b560696 (deriveBoards opts; boardSettingsOf/themeWithBoardSettings in layers.ts; render.ts 2 lines via figureBoardTheme in medium.ts; NOT_DRAWN_YET 4; 2555 tests; no pins moved). Minors for T6.R: with the default accent the blackboard's tilt is ~0, so the figure test uses the greenboard; with non-default board settings a theme's explicit boards are replaced by re-derived ones. T6.4+T6.5 dispatched (sonnet).
T6.4 DONE 51fb4dc, T6.5 DONE 83ed2bc (papers wired; kraft, linen; tile token 512; board textures ~1; dead SVG papers deleted; 18 pins moved (ink/pencil/marker; reason: generated keyed paper), list in t6.4-pins.md; cleanGolden byte-identical; 2575 tests). Deviations accepted: an explicit settings.tint wins on a board paper (the existing styledPen test's rule); generatedPaper gains a waver arg. T6.8 dispatched (sonnet).
T6.8 DONE e0e41c3 (kraft fibres 3200 + flecks; board haze warp 90; structures.test kraft sd bound 0.03→0.04; full suite 6376/6376 in 254 files + 1 worker RPC timeout; tsc clean; contact sheet 129/0; 3D sweep 49/49; guards 19/19; no pins moved). Shots shots/task6-{papers,boards}-{before,after}.png, task6-rulings-before.png. Controller look at boards-after: the haze reads; the TRAY DUST is a row of soft oval bubbles — fake. Ruling: the tray dust becomes fine dust (many tiny specks, denser toward the bottom edge, smeared sideways, a soft gradient) — goes into the T6.R fix round. Note for Ben: chalk lines show near-black specks inside, darker than the board (the Task 5 chalk texture). T6.R dispatched (sonnet).
T6.R review (sonnet): no Critical. Important: graph rulings' k=0 lines on the tile edge render half width (rulings.ts:48-55). Minor: host.ts caches a rejected tile forever; blob URLs never revoked (LOGGED, not fixed); coverage (no host.ts import guard, no pixel-change test); tint in keys unnormalised. 564 tests in 18 files pass; acceptance T6.1–T6.8 hold; 18 pins all listed. Fix round 1 dispatched (sonnet): the Important item, the tray dust ruling, and minors 2, 4, 5.
Fix round 1 DONE 4cbdc0e (rulings wrap at the tile edge; fine tray dust — controller looked at shots/task6-boards-fix1.png: reads as dust; host.ts drops a failed tile; hostBoundary.test.ts; pixel-change tests; tint keys normalised; 2593 tests; 6 marker pins moved again (notebook rule's wrapped copy), listed in t6.4-pins.md; cleanGolden byte-identical). Controller scoped re-review of the fix: correct (random draw order unchanged). Task 6 READY. Logged minor: host.ts never revokes blob URLs. Geometry woken with the sign-off package.
