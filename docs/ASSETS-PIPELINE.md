# Tripo asset pipeline — cheatsheet

Condensed from API research 2026-08-29. Runner: `node tools/tripo.mjs` (Node 22, zero deps;
reads `TRIPO_API_KEY` from repo-root `.env`). Outputs land in `game/public/assets/models/`
plus a `manifest.json` the client reads to swap placeholders for GLBs.

## The API that matters (V3 — v2 shuts down 2026-11-01)

- Base `https://openapi.tripo3d.ai/v3`, header `Authorization: Bearer $TRIPO_API_KEY`
  (`tcli_` keys are CLI-minted API keys; they work on v3 REST).
- Every call returns `{code: 0, data: {...}}`; tasks poll at `GET /v3/tasks/{id}`
  (status `queued|running|success|failed|cancelled`, `progress` 0-100). Poll ~3s.
- **Output URLs expire after 5 minutes** — download immediately after `success`.
- Poll with the same key that created the task. Balance: `GET /v3/account/balance`.

## Character pipeline (the official game-ready recipe)

1. `POST /v3/generation/text-to-model` — `{prompt, model: "P1-20260311", face_limit: 6000,
   texture: true, pbr: true}`. P1 is the low-poly game-asset model (fast, clean shapes —
   reads great next to our voxel terrain). T-pose wording in the prompt improves rigging.
2. `POST /v3/animations/rig-check` — `{input: <gen task id>}` (free) → `output.riggable`,
   `output.rig_type` (expect `biped`; `quadruped`/`avian`/… also exist on the v2.5 rig).
3. `POST /v3/animations/rig` — `{input: <gen id>, model: "v2.5-20260210", rig_type,
   spec: "tripo", out_format: "glb"}` (25 credits). `spec: tripo` because retarget
   requires it; use `mixamo` only for external animation work.
4. `POST /v3/animations/retarget` — `{input: <rig id>, animations: ["preset:idle",
   "preset:walk", "preset:run"], out_format: "glb", bake_animation: true,
   animate_in_place: true}` (10 credits/animation, max 5/batch) → `output.model_urls`,
   one GLB per animation with geometry + baked clip. `animate_in_place` because the game
   drives locomotion.

Cost ≈ 95 credits (~$0.95) per character. Preset names on the v2.5 rig are a short
whitelist (`idle walk run jump slash shoot hurt fall dive climb turn` + per-species
`quadruped:walk` etc.); the huge 101-anim list belongs to the old biped-only v1.0 rig.

## Client-side consumption

Load `<id>.idle.glb` as the base scene; the walk/run GLBs share the same skeleton, so we
lift their `AnimationClip`s and play all three through one `AnimationMixer`. If a character
is missing from the manifest, the game keeps its kawaii voxel-box placeholder — assets are
an upgrade, never a dependency.

## Don'ts (learned from docs)

- Don't run mesh ops (`decimate`, `segment`, `convert quad=true`) after rigging — they strip
  the skeleton. Generate → rig → retarget, in that order, nothing between.
- Don't stack `stylize_model` (voxel/lego) into the rig chain today — ordering vs. skinning
  is unverified. The chibi-P1 look + voxel terrain already reads coherent.
- Don't mix keys: a task polled with a different key than created it 404s.
