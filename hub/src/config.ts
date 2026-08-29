/**
 * Env config. Reads hub/.env manually at module load (tiny parser, no dotenv
 * dep) so keys like TRIPO_API_KEY / overrides live outside the repo history.
 * Everything has a sensible default — the hub must boot with NO env at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export const CONFIG = {
  port: Number(process.env.PORT ?? 7777),
  trueforgeBase: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
  /** '' = auto-pick the first model from GET /api/v1/models */
  trueforgeModel: process.env.TRUEFORGE_MODEL ?? '',
  githubRepo: process.env.GITHUB_REPO ?? 'Juliusolsson05/quest-hero',
  weatherLat: Number(process.env.WEATHER_LAT ?? 37.77),
  weatherLon: Number(process.env.WEATHER_LON ?? -122.42),
} as const;
