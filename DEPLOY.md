# Deploying Osmosis

One Linux host runs the canonical node: the API, the MCP endpoint, and the built
web app, all from a single `node` process on port 8081. Local nodes (laptops)
are optional and point at it over Tailscale with `NODE_ROLE=local`.

## Network model

| Surface | Who reaches it | How |
|---|---|---|
| `/mcp/<MCP_AUTH_TOKEN>` | claude.ai connector, Claude Code — the full authoring surface | Cloudflare tunnel, hostname of your choice, only this path is routed |
| `/mcp/<MCP_PRESENTER_TOKEN>` | the tutor server, and nothing else — the reduced live-teaching surface | same route; see "The two MCP tokens" below |
| `/api`, `/` (web app) | you, from any Tailscale device | Tailscale only, no auth |
| `/sync` | local nodes | Tailscale only, no auth |

Nothing but `/mcp/` is reachable from the public internet. The tunnel returns a
bare 404 for every other path, the same as a wrong token.

## First install

On the server, as a sudo-capable user, with Node 24 LTS installed:

```bash
git clone https://github.com/sabofa/Osmosis.git ~/Osmosis
cd ~/Osmosis
bash deploy/install.sh
```

That copies the repo to `/opt/osmosis`, builds everything, creates the
`osmosis` system user, writes `/etc/osmosis/canonical.env` with a generated
`MCP_AUTH_TOKEN` and `MCP_PRESENTER_TOKEN`, and starts `osmosis.service`. State lives entirely in
`/var/lib/osmosis` (SQLite file + uploads).

Then the web app is at `http://<tailscale-ip>:8081/`.

## Public MCP endpoint

Once, on the server (this opens a browser login to your Cloudflare account,
which only you can do):

```bash
cloudflared tunnel login
cloudflared tunnel create osmosis
MCP_HOSTNAME=osmosis.yourdomain.com bash deploy/install.sh
```

The script writes `/etc/cloudflared/config.yml` from `deploy/cloudflared.yml`,
creates the DNS record, installs cloudflared as a service, and prints the
connector URL to paste into claude.ai. Re-running the script later without
`MCP_HOSTNAME` leaves the tunnel alone.

### Host that already runs a cloudflared tunnel

If `/etc/cloudflared/config.yml` already belongs to another tunnel, do not run
the script's tunnel step. Add one ingress entry to that config, above its
final `http_status:404` catch-all, and route the hostname to that tunnel:

```yaml
  - hostname: osmosis.yourdomain.com
    path: ^/mcp/
    service: http://127.0.0.1:8081
    originRequest:
      connectTimeout: 30s
```

```bash
sudo cloudflared tunnel ingress validate --config /etc/cloudflared/config.yml
cloudflared tunnel route dns <existing-tunnel-name> osmosis.yourdomain.com
sudo systemctl restart <that-tunnel's-service>
```

The connector URL is then `https://osmosis.yourdomain.com/mcp/<MCP_AUTH_TOKEN>`
with the token from `/etc/osmosis/canonical.env`.

## The two MCP tokens

`/mcp/:token` resolves the token to a **scope**, in constant time, and 404s
anything it doesn't recognise — the same bare 404 a wrong token has always got.

| Env var | Scope | Tools |
|---|---|---|
| `MCP_AUTH_TOKEN` | `full` | everything (the authoring connector) |
| `MCP_PRESENTER_TOKEN` | `presenter` | `readme`, `create_session`, `create_questions`, `present_item`, `await_item_outcome`, `get_attempt`, `end_session`, `grade_response` |

`install.sh` generates both on first run. **The tutor server gets only
`MCP_PRESENTER_TOKEN`** — it runs the live teaching loop and never needs to
retire a question, edit a template, rewrite config or touch a theme, so it
holds a credential that cannot do any of those things. `readme()` reports
`scope` and lists exactly the tools that scope has, so the tutor can assert
what it is holding rather than discovering it on a refused call.

`MCP_PRESENTER_TOKEN` is optional: leave it unset and the presenter surface
simply doesn't exist. Setting it to the same value as `MCP_AUTH_TOKEN` is
refused at boot with a clear message — identical tokens would collapse the two
surfaces into one.

`/mcp/<token>/upload` (the plain multipart route) accepts **either** token.

### Restricting the presenter surface to Tailscale

"The tutor server reaches the presenter token over Tailscale only" is a
cloudflared **ingress** choice, not something the server enforces — the server
answers both tokens on the same route. If you want the presenter token
unreachable from the public internet, publish the two on different hostnames
and route only the authoring one through the tunnel; the tutor then talks to
`http://<tailscale-ip>:8081/mcp/<MCP_PRESENTER_TOKEN>` directly, with no tunnel
involved. That needs no config change at all: `/api` and `/sync` already work
that way.

`deploy/cloudflared.yml`'s ingress is deliberately left as-is (this host's
tunnel is shared and hand-edited). An ingress rule that exposed only a
specific path prefix would look like:

```yaml
ingress:
  - hostname: osmosis.yourdomain.com
    path: ^/mcp/
    service: http://localhost:8081
```

`path` is a regex over the request path, so there is no way to express "this
one token but not that one" there without putting a secret in a config file —
which is why the split is by hostname/network, not by ingress rule.

## Updating

```bash
cd ~/Osmosis && git pull && bash deploy/install.sh
```

Migrations run automatically on start. Re-running the script keeps the
existing env file and token.

Update canonical before any local node: local nodes call `/sync/*` routes
(template-draw, daily-draw) that a not-yet-updated canonical won't have, and a
local node ahead of canonical sees cloud tests fail as "needs a connection".

## Optional: model grading

Add `DEEPSEEK_API_KEY=...` to `/etc/osmosis/canonical.env`, then
`sudo systemctl restart osmosis`, then flip "Written grading" to "Model when
online" in the app's Settings.

## Backups

Everything is in `/var/lib/osmosis`. Copy it while the service is stopped, or
use SQLite's online backup:

```bash
sudo -u osmosis sqlite3 /var/lib/osmosis/canonical.db ".backup /var/lib/osmosis/canonical-$(date +%F).db"
```

## Rotating the MCP tokens

Edit `MCP_AUTH_TOKEN` in `/etc/osmosis/canonical.env`, restart the service,
paste the new URL into the connector dialog. The old URL 404s immediately.
`MCP_PRESENTER_TOKEN` rotates the same way — edit, restart, update the tutor
server's configured URL. The two must never be equal; the service refuses to
start if they are.

## Local nodes (your own devices)

The server is the bank. Each device you study on runs its own **local node**:
the same server program with `NODE_ROLE=local`, its own SQLite file, and the
web app at `http://localhost:8081/`. It works without any network for every
test you have **downloaded** in Library; everything else (cloud tests, daily
draws, syncing your results up) uses the server over Tailscale when it can
reach it. Two devices never share state except through the server.

What lives where:

| | Local node (this device) | Server |
|---|---|---|
| Downloaded tests | run offline | — |
| Cloud tests, daily question/quiz | need a connection | resolves the draw |
| Your results | recorded locally, pushed up when online | authoritative |
| Live tutoring sessions | not available; the Live page links to the server app | created here by the tutor |

### Windows (once per device)

Node 24 LTS and git installed, Tailscale connected. In PowerShell:

```powershell
git clone https://github.com/sabofa/Osmosis.git $HOME\Osmosis
cd $HOME\Osmosis
powershell -ExecutionPolicy Bypass -File deploy\install-local.ps1 -RemoteUrl http://100.86.89.59:8081
```

That builds everything, writes `server\.env.local`, and registers a Scheduled
Task **"Osmosis Local Node"** that starts the node at logon (no console
window) and restarts it if it dies. Open `http://localhost:8081/`. To update:
`git pull` then run the same command again. To stop it for good:
`Unregister-ScheduledTask "Osmosis Local Node"`.

### Linux (once per device)

```bash
git clone https://github.com/sabofa/Osmosis.git ~/Osmosis
cd ~/Osmosis
OSMOSIS_ROLE=local REMOTE_URL=http://100.86.89.59:8081 bash deploy/install.sh
```

Same installer as the server, in local mode: state under `/var/lib/osmosis`
(`local.db`), env in `/etc/osmosis/canonical.env` (the file name is shared;
its `NODE_ROLE` says what the node is), service `osmosis`. Update with
`git pull && bash deploy/install.sh` — the role is fixed on first run.

### Using a device offline

In Library, open a test and click **Download**: its tags become slices held
on this device and pulled on every sync. The card shows `downloaded`; a test
without a download shows `cloud` and its Start button is disabled while the
device is offline. **Delete** removes the download and the test goes back to
cloud. Settings shows the held slices and the outbox of results waiting to be
pushed.

Update the server before any local node: local nodes call `/sync/*` routes
that an older server won't have.
