#!/bin/sh
# Two processes, one lifecycle: TrueForge boots first on loopback :8790 with
# its SQLite on the /data volume, then the hub takes the public $PORT. The
# NPC session map is symlinked onto the volume too — that file is why an NPC
# still remembers you after a redeploy.
set -eu

mkdir -p /data
export SQLITE_PATH="${SQLITE_PATH:-/data/db.sqlite}"
[ -s /data/trueforge-sessions.json ] || echo '{}' > /data/trueforge-sessions.json
ln -sf /data/trueforge-sessions.json /app/hub/.trueforge-sessions.json

trueforge &

# Wait for the harness before the hub boots, so the boot-time seed (models +
# MCP connectors) and agent registration land on a listening server. The hub
# is fail-soft about the harness regardless — worst case NPCs serve canned
# lines until it settles.
i=0
until curl -sf http://localhost:8790/api/v1/models >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && echo "[start] trueforge not up after 60s — continuing anyway" && break
  sleep 1
done

export TRUEFORGE_BASE_URL="http://localhost:8790"
export PORT="${PORT:-7777}"
cd /app/hub
exec npm start
