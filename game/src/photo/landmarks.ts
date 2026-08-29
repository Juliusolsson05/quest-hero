import type { Island, PropKind } from '../../../shared/protocol';
import type { IslandView } from '../world';

/**
 * Who is standing in front of the lens.
 *
 * The city is a *stylised* San Francisco, not a projection of one, so a
 * building's real identity cannot be derived from its tile coordinates — it
 * has to be declared. Named landmarks are keyed by prop kind; the anonymous
 * city fabric (row houses, storefronts, mid-rise offices) inherits an identity
 * from the district rectangle it stands in, the same rectangles that
 * shared/island.ts lays the map out with.
 *
 * This is the one file that knows the voxel tower on Telegraph Hill is Coit
 * Tower at 37.8024,-122.4058. Everything downstream — the dossier prompt, the
 * DataSF datasets the agent reaches for first — reads it from here, so a
 * mislabelled building is fixed in one place rather than three.
 */

export interface Subject {
  /** Session key for the dossier agent: one per named landmark, one per
   *  (kind, district) pair for fabric, so the archivist keeps a little memory
   *  of the row houses you keep photographing without spawning a session per
   *  house on the map. */
  id: string;
  name: string;
  /** Street address, or the closest thing the real city has to one. */
  where: string;
  district: string;
  lat: number;
  lon: number;
  kind: PropKind;
  /** sf-guide dataset ids worth trying first. A hint, not a restriction — the
   *  agent can list every source itself and often should. */
  sources: string[];
  /** Game-world position of the subject and the point a photographer aims at:
   *  `eye` metres above local ground, `radius` half-width for aim scoring. */
  x: number;
  z: number;
  eye: number;
  radius: number;
}

// ── named landmarks ─────────────────────────────────────────────────────────

type LandmarkDef = Pick<Subject, 'id' | 'name' | 'where' | 'district' | 'lat' | 'lon' | 'sources' | 'eye' | 'radius'>;

const LANDMARKS: Partial<Record<PropKind, LandmarkDef>> = {
  goldengate: {
    id: 'goldengate', name: 'the Golden Gate Bridge',
    where: 'US-101 over the Golden Gate strait', district: 'the Golden Gate',
    lat: 37.8199, lon: -122.4783, eye: 8, radius: 9,
    sources: ['tides', 'sun', 'weather', 'film_locations', 'nearby_landmarks'],
  },
  transamerica: {
    id: 'transamerica', name: 'the Transamerica Pyramid',
    where: '600 Montgomery Street', district: 'the Financial District',
    lat: 37.7952, lon: -122.4028, eye: 7, radius: 2.2,
    sources: ['landmarks', 'businesses', 'popos', 'film_locations'],
  },
  salesforce: {
    id: 'salesforce', name: 'Salesforce Tower',
    where: '415 Mission Street', district: 'South of Market',
    lat: 37.7897, lon: -122.3972, eye: 8, radius: 2.0,
    sources: ['businesses', 'popos', 'muni_stops', 'nearby_landmarks'],
  },
  coit: {
    id: 'coit', name: 'Coit Tower',
    where: '1 Telegraph Hill Boulevard', district: 'Telegraph Hill',
    lat: 37.8024, lon: -122.4058, eye: 4.5, radius: 1.6,
    sources: ['landmarks', 'public_art', 'parks', 'film_locations'],
  },
  sutro: {
    id: 'sutro', name: 'Sutro Tower',
    where: 'La Avanzada Street, atop Mount Sutro', district: 'Twin Peaks',
    lat: 37.7552, lon: -122.4528, eye: 6.5, radius: 1.8,
    sources: ['weather', 'air_quality', 'nearby_landmarks', 'aircraft_noise'],
  },
  paintedladies: {
    id: 'paintedladies', name: 'the Painted Ladies',
    where: '710–720 Steiner Street', district: 'Alamo Square',
    lat: 37.7763, lon: -122.4324, eye: 2.2, radius: 5.2,
    sources: ['landmarks', 'film_locations', 'park_scores', 'street_trees'],
  },
  ferry: {
    id: 'ferry', name: 'the Ferry Building',
    where: '1 Ferry Building, the Embarcadero', district: 'the Embarcadero',
    lat: 37.7955, lon: -122.3937, eye: 3.4, radius: 4.0,
    sources: ['landmarks', 'businesses', 'muni_stops', 'bay_wheels', 'tides'],
  },
  cablecar: {
    id: 'cablecar', name: 'the Powell Street cable car turnaround',
    where: 'Powell & Market Streets', district: 'Union Square',
    lat: 37.7807, lon: -122.4111, eye: 1.2, radius: 1.9,
    sources: ['muni_stops', 'street_closures', 'film_locations', 'landmarks'],
  },
};

// ── districts, for everything without a name of its own ─────────────────────

interface District {
  id: string;
  name: string;
  /** A real street in that district — the fabric's stand-in for an address. */
  street: string;
  lat: number;
  lon: number;
  /** Game-tile rectangle. Checked in array order: first match wins, so the
   *  small specific districts are listed before the big vague ones. */
  x0: number; x1: number; z0: number; z1: number;
}

const DISTRICTS: District[] = [
  { id: 'marin', name: 'the Marin Headlands', street: 'Conzelman Road',
    lat: 37.8270, lon: -122.4996, x0: 0, x1: 96, z0: 0, z1: 24 },
  { id: 'marina', name: 'the Marina', street: 'Chestnut Street',
    lat: 37.8030, lon: -122.4360, x0: 36, x1: 56, z0: 25, z1: 34 },
  { id: 'northbeach', name: 'North Beach', street: 'Columbus Avenue',
    lat: 37.8003, lon: -122.4103, x0: 52, x1: 74, z0: 25, z1: 36 },
  { id: 'embarcadero', name: 'the Embarcadero', street: 'the Embarcadero',
    lat: 37.7969, lon: -122.3936, x0: 76, x1: 96, z0: 28, z1: 62 },
  { id: 'fidi', name: 'the Financial District', street: 'Montgomery Street',
    lat: 37.7929, lon: -122.4009, x0: 56, x1: 78, z0: 26, z1: 48 },
  { id: 'union', name: 'Union Square', street: 'Post Street',
    lat: 37.7880, lon: -122.4075, x0: 46, x1: 56, z0: 38, z1: 48 },
  { id: 'soma', name: 'SoMa', street: 'Folsom Street',
    lat: 37.7785, lon: -122.4056, x0: 56, x1: 80, z0: 46, z1: 58 },
  { id: 'potrero', name: 'Potrero Hill', street: '18th Street',
    lat: 37.7576, lon: -122.4004, x0: 56, x1: 80, z0: 58, z1: 72 },
  { id: 'bayview', name: 'the Bayview', street: 'Third Street',
    lat: 37.7299, lon: -122.3900, x0: 56, x1: 92, z0: 72, z1: 96 },
  { id: 'pacheights', name: 'Pacific Heights', street: 'Fillmore Street',
    lat: 37.7925, lon: -122.4382, x0: 32, x1: 46, z0: 28, z1: 40 },
  { id: 'western', name: 'the Western Addition', street: 'Divisadero Street',
    lat: 37.7830, lon: -122.4310, x0: 30, x1: 46, z0: 40, z1: 48 },
  { id: 'richmond', name: 'the Richmond', street: 'Clement Street',
    lat: 37.7800, lon: -122.4800, x0: 8, x1: 32, z0: 28, z1: 48 },
  { id: 'ggpark', name: 'Golden Gate Park', street: 'John F Kennedy Drive',
    lat: 37.7694, lon: -122.4862, x0: 10, x1: 32, z0: 46, z1: 58 },
  { id: 'alamo', name: 'Alamo Square', street: 'Steiner Street',
    lat: 37.7764, lon: -122.4346, x0: 30, x1: 44, z0: 47, z1: 58 },
  { id: 'hayes', name: 'Hayes Valley', street: 'Hayes Street',
    lat: 37.7765, lon: -122.4241, x0: 44, x1: 58, z0: 48, z1: 56 },
  { id: 'twinpeaks', name: 'Twin Peaks', street: 'Twin Peaks Boulevard',
    lat: 37.7544, lon: -122.4477, x0: 22, x1: 38, z0: 58, z1: 76 },
  { id: 'sunset', name: 'the Sunset', street: 'Judah Street',
    lat: 37.7500, lon: -122.4940, x0: 8, x1: 30, z0: 56, z1: 96 },
  { id: 'mission', name: 'the Mission', street: 'Valencia Street',
    lat: 37.7599, lon: -122.4148, x0: 34, x1: 60, z0: 52, z1: 80 },
  { id: 'noe', name: 'Noe Valley', street: '24th Street',
    lat: 37.7509, lon: -122.4331, x0: 30, x1: 56, z0: 74, z1: 96 },
];

const CITY: District = {
  id: 'sf', name: 'San Francisco', street: 'Market Street',
  lat: 37.7749, lon: -122.4194, x0: 0, x1: 96, z0: 0, z1: 96,
};

export function districtAt(x: number, z: number): District {
  return DISTRICTS.find((d) => x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) ?? CITY;
}

// ── city fabric ─────────────────────────────────────────────────────────────

interface FabricDef { name: string; eye: number; radius: number; sources: string[] }

const FABRIC: Partial<Record<PropKind, FabricDef>> = {
  sfhouse: {
    name: 'a Victorian row house', eye: 1.9, radius: 1.3,
    sources: ['landmarks', 'street_trees', 'evictions', 'sf311', 'businesses'],
  },
  shop: {
    name: 'a corner storefront', eye: 1.5, radius: 1.3,
    sources: ['businesses', 'health_scores', 'food_trucks', 'sf311'],
  },
  tower: {
    name: 'a mid-rise office block', eye: 5, radius: 1.7,
    sources: ['businesses', 'popos', 'landmarks', 'muni_stops'],
  },
};

/**
 * Every photographable thing on the map, resolved once at boot — the island is
 * static, so re-deriving this per frame would be work for no news.
 */
export function buildSubjects(island: Island): Subject[] {
  const out: Subject[] = [];
  for (const p of island.props) {
    const named = LANDMARKS[p.kind];
    if (named) {
      out.push({ ...named, kind: p.kind, x: p.pos.x, z: p.pos.z });
      continue;
    }
    const fabric = FABRIC[p.kind];
    if (!fabric) continue; // trees, lamps, fences: scenery, not a subject
    const d = districtAt(p.pos.x, p.pos.z);
    out.push({
      id: `${p.kind}:${d.id}`,
      name: `${fabric.name} in ${d.name}`,
      where: `off ${d.street}`,
      district: d.name,
      lat: d.lat, lon: d.lon,
      kind: p.kind,
      sources: fabric.sources,
      x: p.pos.x, z: p.pos.z,
      eye: fabric.eye, radius: fabric.radius,
    });
  }
  return out;
}

/**
 * The district itself, as a subject — what the lens falls back to when the
 * viewfinder holds no building at all. A photograph of a street corner is
 * still a photograph of somewhere real.
 */
export function districtSubject(x: number, z: number): Subject {
  const d = districtAt(x, z);
  return {
    id: `district:${d.id}`,
    name: d.name,
    where: `around ${d.street}`,
    district: d.name,
    lat: d.lat, lon: d.lon,
    kind: 'sfhouse',
    sources: ['sf311', 'businesses', 'street_trees', 'film_locations', 'nearby_landmarks'],
    x, z, eye: 1.6, radius: 2,
  };
}

// ── aiming ──────────────────────────────────────────────────────────────────

/** Nothing further than this is a subject — at 150m a row house is four
 *  pixels and the archivist would be guessing which one you meant. */
const MAX_RANGE = 150;

export interface Aim { subject: Subject; distance: number; miss: number }

/**
 * What the camera is pointed at: the subject closest to the centre of frame,
 * with ties broken toward the nearer one.
 *
 * Scoring is angular rather than a mesh raycast on purpose — the world is
 * merged into a handful of per-colour meshes, so a hit tells you "you hit the
 * cream-coloured mesh", not which building. Angles work on the prop list,
 * which is exactly the list that carries identity.
 */
export function aimAt(
  subjects: Subject[],
  cam: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  fovRad: number,
  island: IslandView,
): Aim | null {
  // Two passes: score everything with cheap trigonometry, then walk the
  // shortlist in order and pay for a line-of-sight march only until one of
  // them is actually visible. The alternative — marching every candidate — is
  // a few hundred ray walks a second for an answer that never changes.
  const shortlist: { aim: Aim; score: number; y: number }[] = [];

  for (const s of subjects) {
    const groundY = island.heightAt(s.x, s.z);
    const tx = s.x - cam.x, ty = groundY + s.eye - cam.y, tz = s.z - cam.z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > MAX_RANGE || dist < 0.5) continue;

    const cos = (tx * dir.x + ty * dir.y + tz * dir.z) / dist;
    if (cos <= 0) continue; // behind the photographer
    const angle = Math.acos(Math.min(1, cos));
    // How far outside the subject's own silhouette the crosshair sits. A wide
    // subject up close (the bridge) is forgiving; a distant one is not.
    const half = Math.atan2(s.radius, dist);
    const miss = Math.max(0, angle - half * 0.9);
    if (miss > fovRad * 0.4) continue;

    // Centred beats near, but only just — a house filling the frame should win
    // over a tower half a mile behind it that happens to sit dead centre.
    shortlist.push({ aim: { subject: s, distance: dist, miss }, score: miss * 6 + dist * 0.0035, y: groundY + s.eye });
  }

  shortlist.sort((a, b) => a.score - b.score);
  for (const c of shortlist.slice(0, 12)) {
    if (clearSight(cam, { x: c.aim.subject.x, y: c.y, z: c.aim.subject.z }, c.aim.subject, island)) return c.aim;
  }
  return null;
}

/** Is there anything between the lens and the subject? Terrain (hills eat the
 *  skyline from street level) and other buildings' collision circles, treated
 *  as ~5m columns. The subject's own circle is skipped, or it would occlude
 *  itself. */
function clearSight(
  cam: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  subject: Subject,
  island: IslandView,
): boolean {
  const blockers = island.island.blockers ?? [];
  const dx = to.x - cam.x, dy = to.y - cam.y, dz = to.z - cam.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.min(120, Math.ceil(dist / 1.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = cam.x + dx * t, py = cam.y + dy * t, pz = cam.z + dz * t;
    if (island.heightAt(px, pz) > py + 0.5) return false;
    // Stop short of the subject so its neighbours' footprints, which a wide
    // building overlaps, do not veto it.
    if ((1 - t) * dist < subject.radius + 1.2) break;
    for (const b of blockers) {
      if (Math.hypot(b.x - subject.x, b.z - subject.z) < subject.radius + 0.6) continue;
      if (Math.hypot(px - b.x, pz - b.z) < b.r * 0.85 && py < island.heightAt(b.x, b.z) + 5) return false;
    }
  }
  return true;
}
