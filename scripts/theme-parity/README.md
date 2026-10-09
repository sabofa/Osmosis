# theme-parity

Visual parity check: `builtin:osmosis` on this branch vs main's default theme, plus a look at the other builtins.
Only the home page is reachable by URL (App.tsx navigation is React state), so that is what is captured.

Needs: headless Edge, node, the feature worktree's node_modules. No PNG library is needed (diff.mjs decodes PNGs itself).

1. Backend from the worktree on a spare port (8081 is the real dev backend; do not use it), fresh DB:
   `cd server; NODE_ROLE=canonical NODE_LABEL=parity PORT=8082 DB_PATH=<tmp>/db.sqlite MCP_AUTH_TOKEN=x ../node_modules/.bin/tsx src/index.ts`
2. Two vite servers whose /api proxy points at 8082 (`vite.parity.config.mjs`, env `PARITY_ROOT` = a web/ dir, `PARITY_API` default http://localhost:8082):
   - main:   `PARITY_ROOT=<main>/web  node <worktree>/node_modules/vite/bin/vite.js --config scripts/theme-parity/vite.parity.config.mjs --port 5190 --strictPort`
   - branch: `PARITY_ROOT=<worktree>/web ... --port 5191 --strictPort`
3. `powershell -File capture.ps1 -Url http://localhost:5190/ -Prefix main -OutDir <dir>` (and `-Url ...:5191/ -Prefix branch`). Writes `<prefix>-home-light.png` and `-dark.png`.
   Light/dark uses `--blink-settings=preferredColorScheme` (1 light, 0 dark); `--force-prefers-color-scheme` is ignored by Edge, and the OS default here is dark.
4. `node diff.mjs <dir>` compares main-* with branch-*; exit code 1 if any pixel differs.
5. Other themes: `curl -X PUT -H 'content-type: application/json' -d '{"id":"builtin:forest"}' localhost:8082/api/themes/active`, capture with `-Prefix branch-forest`, then reset to `builtin:osmosis`.

Edge does not exit after `--screenshot` under `--virtual-time-budget`; capture.ps1 waits up to `-TimeoutSec` then kills only processes using its own throwaway profile.

Themes actually apply: capture `branch-forest`, `branch-ocean`, `branch-ember` (step 5), then `node diff.mjs --themes <dir>`.
It asserts each differs from `branch-home-<mode>.png` (osmosis) in more than 5% of pixels, and that the pixel at (width-3,height-3) (bottom-right page margin, plain canvas; the top-left is avoided because ember paints an accent radial gradient there) is within 10 per channel (body has a 0.25s background transition that headless virtual time can catch mid-flight) of the theme canvas (forest light #ecf0e6 / dark #0f1511, ocean #e9f1f4 / #0a1419, ember #f2ebe0 / #0d0b09). Note the osmosis shot is named `branch-home-*` (prefix `branch`); the theme shots `branch-<theme>-home-*`.

## Workspace layer (foundation 1b)

Helpers: `set-theme.mjs` (`active <id|null> [workspace]`, `save <manifest.json>`, `delete <id>`, `list`; env `PARITY_API`), `compose-check.mjs <manifest.json> [ambience] [mode]` (theme-core `compose` + `toStylesheet`, prints `--radius-md --corner-shape --font-body --color-accent`; needs `npm run build --workspace=theme-core`), and `retro-fixture.json` (workspace-layer fixture with an out-of-layer `seeds` field that must be ignored).

Checks, in order (capture with `capture.ps1`, compare with `node diff.mjs <dir> <a-prefix> <b-prefix>`):
- A. default ambience `builtin:osmosis`: main vs branch must be 0 differing pixels.
- B. `set-theme.mjs active builtin:ws-clean workspace`: branch must still be pixel-identical to main.
- C. `save retro-fixture.json`, `active builtin:forest`, `active retro-fixture workspace`: fonts change (mono headings, serif body), accent stays forest green (workspace seeds ignored); shapes barely change until app CSS migrates from literal radii to tokens.
- D. `active null workspace`, `active builtin:osmosis`, `delete retro-fixture`: pixel-identical to main again.
