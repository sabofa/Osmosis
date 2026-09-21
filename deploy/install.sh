#!/usr/bin/env bash
# Osmosis canonical-node installer for a Debian/Ubuntu-style Linux host.
#
# Idempotent: safe to re-run after `git pull` to rebuild and restart. Run as a
# user with sudo. Expects Node >= 22.13 (node:sqlite unflagged); Node 24 LTS is
# what this was tested with.
#
#   sudo -v && bash deploy/install.sh
#
# What it does:
#   1. installs dependencies and builds engines, web, server (as the invoking user)
#   2. creates the `osmosis` system user and /var/lib/osmosis (db + uploads)
#   3. writes /etc/osmosis/canonical.env on first run (generates MCP_AUTH_TOKEN
#      and MCP_PRESENTER_TOKEN)
#   4. installs + starts the osmosis systemd service
#   5. if a cloudflared tunnel named `osmosis` exists, installs its config +
#      service so only /mcp is public (see deploy/cloudflared.yml)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR=/opt/osmosis
DATA_DIR=/var/lib/osmosis
ENV_FILE=/etc/osmosis/canonical.env
SERVICE=osmosis

log() { printf '\n==> %s\n' "$*"; }

# ---- 0. preflight -----------------------------------------------------------
if ! command -v node >/dev/null; then
  echo "node not found. Install Node 24 LTS first (https://nodejs.org/en/download)." >&2
  exit 1
fi
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 22 )) || { (( NODE_MAJOR == 22 )) && (( NODE_MINOR < 13 )); }; then
  echo "Node $(node -v) is too old: node:sqlite needs >= 22.13 (24 LTS recommended)." >&2
  exit 1
fi
if ! node -e 'require("node:sqlite")' 2>/dev/null; then
  echo "This node build cannot load node:sqlite." >&2
  exit 1
fi

# ---- 1. code: copy repo to /opt/osmosis and build ---------------------------
if [[ "$REPO_DIR" != "$INSTALL_DIR" ]]; then
  log "Syncing $REPO_DIR -> $INSTALL_DIR"
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(id -u):$(id -g)" "$INSTALL_DIR"
  if command -v rsync >/dev/null; then
    rsync -a --delete --exclude node_modules --exclude .git --exclude '*/dist' "$REPO_DIR/" "$INSTALL_DIR/"
  else
    (cd "$REPO_DIR" && tar --exclude=node_modules --exclude=.git --exclude='*/dist' -cf - .) | (cd "$INSTALL_DIR" && tar -xf -)
  fi
fi
cd "$INSTALL_DIR"

log "Installing dependencies"
npm ci --no-audit --no-fund

log "Building graph-engine and document-engine libraries"
npm run build:lib --workspace=graph-engine
npm run build:lib --workspace=document-engine

log "Building web app"
npm run build --workspace=web

log "Building server"
npm run build --workspace=server

# ---- 2. user + data dir -----------------------------------------------------
if ! id -u osmosis >/dev/null 2>&1; then
  log "Creating system user 'osmosis'"
  sudo useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin osmosis
fi
sudo mkdir -p "$DATA_DIR/uploads"
sudo chown -R osmosis:osmosis "$DATA_DIR"
sudo chmod 750 "$DATA_DIR"
# The service user needs read access to the code and the web build.
sudo chown -R "$(id -u):osmosis" "$INSTALL_DIR"
sudo chmod -R g+rX "$INSTALL_DIR"

# ---- 3. env file ------------------------------------------------------------
# OSMOSIS_ROLE=local REMOTE_URL=http://<server-tailscale-ip>:8081 bash deploy/install.sh
# installs a local node (a laptop that holds downloaded slices and syncs up)
# instead of the canonical node. The env file's role is fixed on first run.
ROLE="${OSMOSIS_ROLE:-canonical}"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Writing $ENV_FILE (first run, role=$ROLE)"
  sudo mkdir -p "$(dirname "$ENV_FILE")"
  if [[ "$ROLE" == "local" ]]; then
    if [[ -z "${REMOTE_URL:-}" ]]; then
      echo "A local node needs REMOTE_URL (e.g. REMOTE_URL=http://100.86.89.59:8081)." >&2
      exit 1
    fi
    sed -e "s|^REMOTE_URL=.*|REMOTE_URL=$REMOTE_URL|" \
        -e "s|^NODE_LABEL=.*|NODE_LABEL=$(uname -n | cut -d. -f1)|" \
        "$INSTALL_DIR/server/.env.local.example" | sudo tee "$ENV_FILE" >/dev/null
  else
    TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
    # Second, independent secret for the reduced presenter surface. Generated
    # separately rather than derived from the first: the two must differ (the
    # server refuses to boot otherwise) and rotating one must not touch the
    # other.
    PRESENTER_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
    sed -e "s|^MCP_AUTH_TOKEN=.*|MCP_AUTH_TOKEN=$TOKEN|" \
        -e "s|^MCP_PRESENTER_TOKEN=.*|MCP_PRESENTER_TOKEN=$PRESENTER_TOKEN|" \
        -e "s|^NODE_LABEL=.*|NODE_LABEL=$(uname -n | cut -d. -f1)|" \
        "$INSTALL_DIR/server/.env.canonical.example" | sudo tee "$ENV_FILE" >/dev/null
  fi
  sudo chown root:osmosis "$ENV_FILE"
  sudo chmod 640 "$ENV_FILE"
else
  log "Keeping existing $ENV_FILE"
  # MCP_PRESENTER_TOKEN arrived after this host was first installed, and the
  # branch above only runs on a first run — so an upgrade would otherwise keep
  # an env file with no presenter token and leave that surface silently off.
  # Append one if it isn't there. Never rewrite an existing line: that would
  # rotate a token the tutor server is already configured with.
  if [[ "$ROLE" != "local" ]] && ! sudo grep -q '^MCP_PRESENTER_TOKEN=' "$ENV_FILE"; then
    PRESENTER_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
    {
      echo ""
      echo "# Added by deploy/install.sh: reduced presenter MCP surface (see DEPLOY.md)."
      echo "MCP_PRESENTER_TOKEN=$PRESENTER_TOKEN"
    } | sudo tee -a "$ENV_FILE" >/dev/null
    log "Added a generated MCP_PRESENTER_TOKEN to $ENV_FILE (presenter surface was off)"
  fi
fi

# ---- 4. systemd -------------------------------------------------------------
log "Installing systemd unit"
sed "s|__NODE_BIN__|$NODE_BIN|" "$INSTALL_DIR/deploy/osmosis.service" | sudo tee /etc/systemd/system/$SERVICE.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null
sudo systemctl restart "$SERVICE"
sleep 2
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "Service failed to start. Last log lines:" >&2
  sudo journalctl -u "$SERVICE" -n 30 --no-pager >&2
  exit 1
fi
PORT="$(sudo grep '^PORT=' "$ENV_FILE" | cut -d= -f2)"
curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null && log "osmosis is up on port $PORT"

# ---- 5. cloudflared (optional) ----------------------------------------------
if command -v cloudflared >/dev/null && [[ -n "${MCP_HOSTNAME:-}" ]]; then
  TUNNEL_ID="$(cloudflared tunnel list --name osmosis --output json 2>/dev/null | node -pe 'const t=JSON.parse(require("fs").readFileSync(0,"utf8"));t[0]?t[0].id:""' || true)"
  if [[ -z "$TUNNEL_ID" ]]; then
    echo "No tunnel named 'osmosis'. Run: cloudflared tunnel login && cloudflared tunnel create osmosis, then re-run with MCP_HOSTNAME set." >&2
  else
    log "Installing cloudflared config for tunnel $TUNNEL_ID -> $MCP_HOSTNAME (only /mcp/ exposed)"
    sudo mkdir -p /etc/cloudflared
    sudo cp "$HOME/.cloudflared/$TUNNEL_ID.json" /etc/cloudflared/
    sed -e "s|__TUNNEL_ID__|$TUNNEL_ID|g" -e "s|__MCP_HOSTNAME__|$MCP_HOSTNAME|g" \
        "$INSTALL_DIR/deploy/cloudflared.yml" | sudo tee /etc/cloudflared/config.yml >/dev/null
    cloudflared tunnel route dns --overwrite-dns osmosis "$MCP_HOSTNAME"
    if ! systemctl list-unit-files cloudflared.service >/dev/null 2>&1 || ! systemctl is-enabled --quiet cloudflared; then
      sudo cloudflared service install
    fi
    sudo systemctl restart cloudflared
    TOKEN="$(sudo grep '^MCP_AUTH_TOKEN=' "$ENV_FILE" | cut -d= -f2)"
    log "MCP connector URL: https://$MCP_HOSTNAME/mcp/$TOKEN"
  fi
else
  log "Skipping cloudflared (set MCP_HOSTNAME=osmosis.example.com to expose /mcp publicly)"
fi

log "Done. Logs: sudo journalctl -u $SERVICE -f"
