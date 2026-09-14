# Deploying Osmosis

One Linux host runs the canonical node: the API, the MCP endpoint, and the built
web app, all from a single `node` process on port 8081. Local nodes (laptops)
are optional and point at it over Tailscale with `NODE_ROLE=local`.

## Network model

| Surface | Who reaches it | How |
|---|---|---|
| `/mcp/<token>` | claude.ai connector, Claude Code | Cloudflare tunnel, hostname of your choice, only this path is routed |
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
`MCP_AUTH_TOKEN`, and starts `osmosis.service`. State lives entirely in
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

## Updating

```bash
cd ~/Osmosis && git pull && bash deploy/install.sh
```

Migrations run automatically on start. Re-running the script keeps the
existing env file and token.

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

## Rotating the MCP token

Edit `MCP_AUTH_TOKEN` in `/etc/osmosis/canonical.env`, restart the service,
paste the new URL into the connector dialog. The old URL 404s immediately.

## Local nodes

A laptop runs the same server with `NODE_ROLE=local` and
`REMOTE_URL=http://<server-tailscale-ip>:8081`, pulls tag slices from the
Library page, and pushes attempts back when online. Live tutor items only
work against the canonical node's app, since they are created there.
