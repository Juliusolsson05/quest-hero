#!/usr/bin/env bash
# Re-mirror the TrueForge docs into docs/trueforge/.
#
# The docs site publishes a .md variant of every page plus an llms.txt index,
# so the mirror is a plain fetch rather than HTML scraping -- which means it
# survives site redesigns and stays diffable in review.
#
# Run this when TrueForge ships something we need; `git diff` then shows
# exactly what changed upstream.
set -euo pipefail

BASE="https://trueforge.dev"
DEST="$(cd "$(dirname "$0")/.." && pwd)/docs/trueforge"
mkdir -p "$DEST"

curl -fsS "$BASE/llms.txt"      -o "$DEST/llms.txt"
curl -fsS "$BASE/llms-full.txt" -o "$DEST/llms-full.txt"

# llms.txt is the authoritative page list; deriving URLs from it means new
# pages are picked up automatically instead of needing this script edited.
grep -oE "$BASE/[^)]+\.md" "$DEST/llms.txt" | sort -u | while read -r url; do
  rel="${url#"$BASE/"}"
  mkdir -p "$DEST/$(dirname "$rel")"
  curl -fsS "$url" -o "$DEST/$rel"
  echo "  $rel"
done

curl -fsS https://raw.githubusercontent.com/truefoundry/trueforge/main/LICENSE \
  -o "$DEST/LICENSE.upstream"

echo "synced $(find "$DEST" -name '*.md' | wc -l | tr -d ' ') pages"
