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
