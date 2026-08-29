/**
 * The photo-endpoint shapes: what the game sends the hub when the player takes
 * a photograph (`POST /api/photo`, see docs/API.md).
 *
 * Types only. The persona the archivist is given and the brief it is handed
 * live in hub/src/photo.ts, next to the session that runs them — the hub is
 * the only thing in this repo that speaks to the harness.
 */

/** A real San Francisco building, resolved from the voxel one the player is
 *  pointing at. See game/src/landmarks.ts for how identity is assigned. */
export interface LensSubject {
  id: string;
  name: string;
  where: string;
  district: string;
  lat: number;
  lon: number;
  /** sf-guide dataset ids worth trying first — a hint, not a restriction. */
  sources: string[];
}

/** How the photograph was framed. Distance and focal length tell the archivist
 *  whether this is a portrait of one building or a view containing one. */
export interface LensShot {
  distanceM: number;
  bearing: string;
  focalMm: number;
}

/** The game's clock and sky, which mirror the real city's. */
export interface LensWorld {
  hour: number;
  weather: string;
  tempC: number;
}
