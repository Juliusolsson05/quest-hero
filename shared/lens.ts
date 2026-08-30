/**
 * The Lens — the wire shape of a photograph, and nothing else.
 *
 * This is the game↔hub boundary for photo mode: the client resolves which
 * building is in frame and how it was framed, and posts that. Everything about
 * how the agent is *asked* — the persona, the brief — lives with the only side
 * that talks to the harness, in hub/src/photo.ts.
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
