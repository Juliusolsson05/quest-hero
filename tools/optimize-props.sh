#!/usr/bin/env bash
# Optimize the Tripo prop pack for the game: 512px webp textures + meshopt
# geometry. ~1MB/67MB-VRAM per raw GLB → ~150KB/4MB-VRAM optimized.
# Sources: ~/Hackathon/{kawaii-village-props,voxel-vehicles}/models/*.glb
# Output:  game/public/assets/models/props/<slug>.glb
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="game/public/assets/models/props"
mkdir -p "$OUT"

KAWAII="/Users/stan/Hackathon/kawaii-village-props/models"
VOXEL="/Users/stan/Hackathon/voxel-vehicles/models"

PROPS=(
  "$KAWAII/mushroom-cottage.glb" "$KAWAII/strawberry-mailbox.glb"
  "$KAWAII/teapot-fountain.glb"  "$KAWAII/cloud-bench.glb"
  "$KAWAII/cat-lamppost.glb"     "$KAWAII/boba-water-tower.glb"
  "$KAWAII/sunflower-planter.glb" "$KAWAII/frog-umbrella-stand.glb"
  "$KAWAII/dango-signpost.glb"   "$KAWAII/bread-cart.glb"
  "$KAWAII/icecream-lamp.glb"    "$KAWAII/snail-wheelbarrow.glb"
  "$VOXEL/yellow-taxi.glb"       "$VOXEL/waymo-robotaxi.glb"
  "$VOXEL/waymo-minivan.glb"     "$VOXEL/bicycle.glb"
  "$VOXEL/vespa-scooter.glb"
)

for src in "${PROPS[@]}"; do
  slug="$(basename "$src")"
  npx -y @gltf-transform/cli optimize "$src" "$OUT/$slug" \
    --compress meshopt --texture-compress webp --texture-size 512 >/dev/null
  echo "✓ $slug → $(du -h "$OUT/$slug" | cut -f1)"
done
echo "done: $(ls "$OUT" | wc -l | tr -d ' ') props in $OUT"
