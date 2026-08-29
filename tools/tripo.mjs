#!/usr/bin/env node
/**
 * Tripo V3 asset pipeline: text → model (P1 low-poly) → rig → retarget
 * idle/walk/run → GLBs in game/public/assets/models/ + manifest.json.
 *
 * Zero deps, Node 22+. Reads TRIPO_API_KEY from repo-root .env (or env).
 * Task ids are cached in tools/.tripo-cache.json so a re-run resumes instead
 * of re-billing; Tripo download URLs die after 5 minutes, so every artifact
 * is downloaded the moment its task succeeds.
 *
 *   node tools/tripo.mjs            # generate everything missing
 *   node tools/tripo.mjs hero wren  # just these characters
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'game/public/assets/models');
const CACHE_FILE = path.join(ROOT, 'tools/.tripo-cache.json');
const API = 'https://openapi.tripo3d.ai/v3';

const STYLE =
  ', kawaii pastel game character, big round head, tiny body, dot eyes, ' +
  'clean simple shapes, cute, low poly game asset';

const CHARACTERS = [
  { id: 'hero', prompt: 'chibi hero adventurer standing in T-pose with arms straight out, mint green tunic, brown boots, tiny backpack, happy face with blush' + STYLE },
  { id: 'bran', prompt: 'chibi blacksmith man standing in T-pose with arms straight out, brown leather apron, orange bandana, big friendly mustache, sturdy build' + STYLE },
  { id: 'wren', prompt: 'chibi town herald standing in T-pose with arms straight out, sky blue cape and messenger cap with small feather, cheerful face' + STYLE },
  { id: 'suki', prompt: 'chibi shopkeeper girl standing in T-pose with arms straight out, peach apron dress, coral hair bun, sweet smile with blush' + STYLE },
];
const ANIMS = ['idle', 'walk', 'run'];

// ── env / http ─────────────────────────────────────────────────────────────
for (const f of [path.join(ROOT, '.env'), path.join(ROOT, 'hub/.env')]) {
  if (!existsSync(f)) continue;
  for (const line of (await readFile(f, 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const KEY = process.env.TRIPO_API_KEY;
if (!KEY) { console.error('TRIPO_API_KEY missing (.env at repo root)'); process.exit(1); }
const HEADERS = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

async function api(method, p, body) {
  const res = await fetch(API + p, { method, headers: HEADERS, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.data;
}

async function poll(taskId, label) {
  let last = -1;
  for (;;) {
    const d = await api('GET', `/tasks/${taskId}`);
    if (d.status === 'success') { console.log(`  ✓ ${label}`); return d; }
    if (d.status === 'failed' || d.status === 'cancelled') {
      throw new Error(`${label} ${d.status}: ${d.error_message ?? d.error_code ?? '?'}`);
    }
    if (d.progress !== last) { console.log(`  … ${label} ${d.status} ${d.progress ?? 0}%`); last = d.progress; }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${dest}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  ⬇ ${path.relative(ROOT, dest)}`);
}

// ── cache ──────────────────────────────────────────────────────────────────
const cache = existsSync(CACHE_FILE) ? JSON.parse(await readFile(CACHE_FILE, 'utf8')) : {};
async function step(key, make) {
  if (!cache[key]) {
    cache[key] = await make();
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  }
  return cache[key];
}

// ── per-character pipeline ─────────────────────────────────────────────────
async function build(ch) {
  console.log(`▶ ${ch.id}`);
  const genId = await step(`${ch.id}:gen`, () =>
    api('POST', '/generation/text-to-model', {
      prompt: ch.prompt, model: 'P1-20260311', face_limit: 6000, texture: true, pbr: true,
    }).then((d) => d.task_id));
  const gen = await poll(genId, `${ch.id} model`);
  if (gen.output?.model_url) await download(gen.output.model_url, path.join(OUT, `${ch.id}.glb`));
  if (gen.output?.rendered_image_url) await download(gen.output.rendered_image_url, path.join(OUT, `${ch.id}.preview.webp`));

  const checkId = await step(`${ch.id}:check`, () =>
    api('POST', '/animations/rig-check', { input: genId }).then((d) => d.task_id));
  const check = await poll(checkId, `${ch.id} rig-check`);
  const rigType = check.output?.rig_type ?? 'biped';
  if (check.output?.riggable === false) throw new Error(`${ch.id} not riggable`);

  const rigId = await step(`${ch.id}:rig`, () =>
    api('POST', '/animations/rig', {
      input: genId, model: 'v2.5-20260210', rig_type: rigType, spec: 'tripo', out_format: 'glb',
    }).then((d) => d.task_id));
  await poll(rigId, `${ch.id} rig`);

  const retId = await step(`${ch.id}:retarget`, () =>
    api('POST', '/animations/retarget', {
      input: rigId, animations: ANIMS.map((a) => `preset:${a}`),
      out_format: 'glb', bake_animation: true, animate_in_place: true,
    }).then((d) => d.task_id));
  const ret = await poll(retId, `${ch.id} retarget`);

  const urls = ret.output?.model_urls ?? (ret.output?.model_url ? [ret.output.model_url] : []);
  const list = Array.isArray(urls) ? urls : Object.values(urls);
  for (let i = 0; i < list.length; i++) {
    await download(list[i], path.join(OUT, `${ch.id}.${ANIMS[i] ?? `anim${i}`}.glb`));
  }
  return { id: ch.id, anims: ANIMS.slice(0, list.length) };
}

// ── main ───────────────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true });
const only = process.argv.slice(2);
const targets = only.length ? CHARACTERS.filter((c) => only.includes(c.id)) : CHARACTERS;

try {
  const bal = await api('GET', '/account/balance');
  console.log(`balance: ${bal.balance} credits (frozen ${bal.frozen})`);
} catch (e) { console.warn('balance check failed:', e.message); }

const results = await Promise.allSettled(targets.map(build));
const manifest = { generatedAt: new Date().toISOString(), characters: {} };
for (const r of results) {
  if (r.status === 'fulfilled') {
    manifest.characters[r.value.id] = {
      static: `${r.value.id}.glb`,
      ...Object.fromEntries(r.value.anims.map((a) => [a, `${r.value.id}.${a}.glb`])),
    };
  } else {
    console.error('✗', r.reason?.message ?? r.reason);
  }
}
// Merge over an existing manifest so partial runs never erase earlier wins.
const mf = path.join(OUT, 'manifest.json');
if (existsSync(mf)) {
  const prev = JSON.parse(await readFile(mf, 'utf8'));
  manifest.characters = { ...prev.characters, ...manifest.characters };
}
await writeFile(mf, JSON.stringify(manifest, null, 2));
console.log('manifest:', Object.keys(manifest.characters).join(', ') || '(empty)');

try {
  const bal = await api('GET', '/account/balance');
  console.log(`balance after: ${bal.balance} credits`);
} catch { /* fine */ }
