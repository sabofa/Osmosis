# T8.R review (Task 8, d8c678d + de90ba0 + 999dbbb) — READY, with one Important to fix or accept

Suites: review/ 27/27 pass; src/style/theme 107/107 pass. I changed no code (two throwaway probe tests, deleted).
Acceptance T8.1–T8.5: all met. Checked: JSON sets via checkThemeStyles (lazy, accepted); BUILTIN_THEME_STYLES
goldens green; save endpoint apply:'serve', refuseTuningRequest (method, sec-fetch-site, Origin==Host, JSON type),
styleSetPath allow-list (regex AND known id), body cap, parse-then-canonical-write, so no traversal; panel/selector/
switcher take props and emit events, panel never imports prose (guideAt is passed in from StylesPage); themes only via
adapter, controls.css vars are the lab's own with fallbacks, none from web/; starts on light; fillPaperTiles imported by
path; space cell clean only; figure/, style/, space/ runtime untouched except builtinStyles.ts. SVG injection: input is our
renderFigure output of constant example specs; document-layer values pass checkLayer, custom colours are hex-regexed. Safe.
Precedence of the preset injection is correct: withPreset (Showcase.tsx:36) replaces only theme-all's preset, keeps its
`set`, and byType and the document stay above it. The document layer does reach renderFigure (Showcase.tsx:41 -> base).
Because withPreset always hands the adapter an object, clearing a built-in's last setting really clears it in the figures.

## Important
1. Showcase.tsx:81-89 and 45-51 with host.ts:41-52 — every slider tick redraws all 16 figures synchronously (no
   debounce/useDeferredValue) and refills every paper. Paper keys carry tint/texture/seed, so dragging Texture, Tint or
   Seed makes a NEW key per step: a main-thread 512px generatePaper plus a PNG blob, held forever in blobUrls and never
   revoked (the Task 6 carry-forward, now hit by the lab). Scenario: drag Paper > Texture for 20 s, the page stutters and
   holds dozens of ~1 MB blobs. Fix: useDeferredValue on the theme/layer props, and revoke a key's blob URL when it leaves
   the page (host.ts is geometry's file: tell geometry).

## Minor
2. Seed twice (note 1), cause confirmed: two real specs, style.seed ("Seed", appliesTo all types) and paint.seed ("Seed",
   space only), same group "General". The theme-all layer shows both; the 'theme / figure2d' layer shows one. Not a
   duplicated spec. It is the only duplicate label in the registry. Cheap fix: label paint.seed "Paint seed" in registry
   (style/ file, geometry), or make groupSpecs append the path when a label repeats (lab-side).
3. Clean cell does not fill (note 2), cause confirmed: the page. figureDocument (figure/document.ts:415) draws the
   clean paper rect over the viewBox only, with preserveAspectRatio meet; StylesPage.css:14-15 forces every cell to 4/3 and
   svg height:100%, so a figure whose viewBox is not 4:3 letterboxes and the page cream shows round the sheet. Clean's own
   pen paints no paper (pen.ts:112); this is not clean's behaviour. Styled looks hide it because their tiles/boards read as
   the cell. Fix in the page: drop aspect-ratio and use svg height:auto, or set .sc-figure background to the theme surface.
4. Whiteboard ghosts repeat (note 3): inherent to a periodic 512 tile with only 3-6 ghosts (whiteboard.ts:77); seeding
   positions cannot remove it, since the whole tile repeats. Cheap mitigations: count 8-14 at depth scaled by ~0.5 (more,
   fainter ghosts hide the lattice), or default style.paper.tile 1024. Geometry's file; not a blocker.
5. SettingsPanel.tsx:80 — the number box is controlled by the clamped, step-snapped, formatted value, so typing a decimal
   fights the field ("0" snaps to "0.00", then "." breaks). Sliders work. Fix: keep a local draft string, commit on blur/Enter.
6. StylesPage.tsx:97-107 — onChange builds from render-time `own` (fine per event, but the theme/themeType writes use
   functional setState while the layer base does not); a themeType layer holding its own preset makes every column identical
   for that type (intended, but unlabelled). After Save, re-picking a built-in in the same session reloads the pre-save
   module until the page is reloaded (HMR is blocked on purpose). No error boundary: a throw in renderFigure blanks the page.
7. StylesPage.tsx:87 — leaving a built-in for light/dark/custom (or back) silently drops the layers being edited.
