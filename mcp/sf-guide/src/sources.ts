/**
 * The SF Guide's data catalog.
 *
 * This is configuration, not documentation — the MCP server builds its tools
 * from this list, so it cannot drift away from what the server actually
 * serves. Adding a source here adds a capability to the NPC.
 *
 * Every entry was verified live on 2026-08-29: DataSF ids returned at least
 * one row, and every `rest` endpoint answered without a key. Sources needing
 * an API key are marked and excluded from the default tool set, so the guide
 * never offers something it cannot deliver.
 */

export type Auth = 'none' | 'token-optional' | 'token-required';

export interface SfSource {
  /** Stable id, used to name the generated tool. */
  id: string;
  title: string;
  /** `datasf` resolves through the Socrata SODA API; `rest` is a plain URL. */
  kind: 'datasf' | 'rest';
  /** Socrata resource id for kind='datasf'. */
  resource?: string;
  /** Full endpoint for kind='rest'. */
  url?: string;
  auth: Auth;
  /** What the guide can actually tell a player, in his own terms. */
  blurb: string;
}

/** Socrata resource endpoints all hang off this. An app token raises rate
 *  limits but is not required, which matters on a hackathon clock. */
export const SODA_BASE = 'https://data.sfgov.org/resource';

export const SOURCES: SfSource[] = [
  // ---- Culture and character -------------------------------------------
  { id: 'film_locations', title: 'Film Locations in San Francisco', kind: 'datasf',
    resource: 'yitu-d5am', auth: 'token-optional',
    blurb: 'Which movies were shot on which street corner. Bullitt, Vertigo, Mrs Doubtfire.' },
  { id: 'street_trees', title: 'Street Tree List', kind: 'datasf',
    resource: 'tkzw-k3nq', auth: 'token-optional',
    blurb: 'Every street tree in the city, by species and address. Genuinely ~200k of them.' },
  { id: 'public_art', title: 'Public Art (1% Art Program)', kind: 'datasf',
    resource: 'cf6e-9e4j', auth: 'token-optional',
    blurb: 'Civic art collection — sculptures and murals, with locations and artists.' },
  { id: 'landmarks', title: 'Article 10 Historic Landmarks', kind: 'datasf',
    resource: '97yj-54sx', auth: 'token-optional',
    blurb: 'Officially designated historic landmarks. The buildings worth looking up at.' },
  { id: 'popos', title: 'Privately Owned Public Open Spaces', kind: 'datasf',
    resource: '65ik-7wqd', auth: 'token-optional',
    blurb: 'Rooftop gardens and atriums downtown that are legally public but nobody knows about.' },

  // ---- Eating and drinking ---------------------------------------------
  { id: 'food_trucks', title: 'Mobile Food Facility Permits', kind: 'datasf',
    resource: 'rqzj-sfat', auth: 'token-optional',
    blurb: 'Every permitted food truck, where it parks and what it sells.' },
  { id: 'health_scores', title: 'Restaurant Health Inspection Scores', kind: 'datasf',
    resource: 'pyih-qa8i', auth: 'token-optional',
    blurb: 'Inspection scores. Useful for deciding where not to eat.' },
  { id: 'businesses', title: 'Registered Business Locations', kind: 'datasf',
    resource: 'g8m3-pdis', auth: 'token-optional',
    blurb: 'Every registered business, with start dates — what is new in a neighbourhood.' },

  // ---- Getting around ---------------------------------------------------
  { id: 'muni_stops', title: 'Muni Stops', kind: 'datasf',
    resource: 'i28k-bkz6', auth: 'token-optional',
    blurb: 'Every Muni stop and the routes serving it.' },
  { id: 'bike_racks', title: 'Bicycle Parking Racks', kind: 'datasf',
    resource: 'hn4j-6fx5', auth: 'token-optional',
    blurb: 'Where you can legally lock a bike.' },
  { id: 'parking_meters', title: 'Parking Meters', kind: 'datasf',
    resource: '8vzz-qzz9', auth: 'token-optional',
    blurb: 'Meter locations and rates.' },
  { id: 'street_sweeping', title: 'Street Sweeping Schedule', kind: 'datasf',
    resource: 'yhqp-riqs', auth: 'token-optional',
    blurb: 'The schedule that decides whether your car gets ticketed. Very SF.' },
  { id: 'street_closures', title: 'Temporary Street Closures', kind: 'datasf',
    resource: '8x25-yybr', auth: 'token-optional',
    blurb: 'Streets shut for events and works, right now.' },
  { id: 'curb_ramps', title: 'Curb Ramps', kind: 'datasf',
    resource: 'ch9w-7kih', auth: 'token-optional',
    blurb: 'Accessibility infrastructure, for routing questions that actually matter.' },
  { id: 'bay_wheels', title: 'Bay Wheels bike share (GBFS live)', kind: 'rest',
    url: 'https://gbfs.baywheels.com/gbfs/gbfs.json', auth: 'none',
    blurb: 'Live bike and dock availability at every station. Updates constantly.' },

  // ---- Parks and outdoors ----------------------------------------------
  { id: 'parks', title: 'Recreation and Parks Facilities', kind: 'datasf',
    resource: 'ib5c-xgwu', auth: 'token-optional',
    blurb: 'Every park facility — courts, fields, clubhouses, playgrounds.' },
  { id: 'park_scores', title: 'Annual Park Evaluation Scores', kind: 'datasf',
    resource: 'r33y-seqv', auth: 'token-optional',
    blurb: 'How clean and well-kept each park actually is, scored by the city.' },
  { id: 'pit_stops', title: 'Public Toilets (Pit Stop programme)', kind: 'datasf',
    resource: 'mr6h-cr3u', auth: 'token-optional',
    blurb: 'Staffed public restrooms and their hours. The most practical tourist question there is.' },

  // ---- The city as it is today -----------------------------------------
  { id: 'sf311', title: '311 Cases', kind: 'datasf',
    resource: 'vw6y-z8j6', auth: 'token-optional',
    blurb: 'Live complaints: graffiti, encampments, broken lights. The city talking about itself.' },
  { id: 'police_incidents', title: 'Police Incident Reports (2018–now)', kind: 'datasf',
    resource: 'wg3w-h783', auth: 'token-optional',
    blurb: 'Reported incidents by district and category. For honest safety answers.' },
  { id: 'evictions', title: 'Eviction Notices', kind: 'datasf',
    resource: '5cei-gny5', auth: 'token-optional',
    blurb: 'Eviction filings by neighbourhood. Grim, and very much the real San Francisco.' },
  { id: 'aircraft_noise', title: 'Aircraft Noise Complaints', kind: 'datasf',
    resource: 'q3xd-hfi8', auth: 'token-optional',
    blurb: 'Who complains about SFO flight paths, and how much. Unexpectedly funny.' },
  { id: 'police_stations', title: 'Police Stations', kind: 'datasf',
    resource: 'rwdu-9wb2', auth: 'token-optional',
    blurb: 'Station locations and districts.' },
  { id: 'library_usage', title: 'Library Usage', kind: 'datasf',
    resource: 'qzz6-2jup', auth: 'token-optional',
    blurb: 'How the public library system is actually used.' },
  { id: 'sea_level', title: '100-Year Storm + 24" Sea Level Rise', kind: 'datasf',
    resource: 'esku-ejgv', auth: 'token-optional',
    blurb: 'Which blocks go underwater in the flood scenario. Sobering and very visual.' },

  // ---- Live conditions, no key required --------------------------------
  { id: 'weather', title: 'Weather and visibility (Open-Meteo)', kind: 'rest',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,apparent_temperature,visibility,wind_speed_10m,cloud_cover&timezone=America/Los_Angeles',
    auth: 'none',
    blurb: 'Temperature, wind and visibility — the last one is how you answer "is it foggy".' },
  { id: 'air_quality', title: 'Air quality (Open-Meteo)', kind: 'rest',
    url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=37.7749&longitude=-122.4194&current=us_aqi,pm2_5,pm10',
    auth: 'none',
    blurb: 'US AQI and particulates. Matters in wildfire season.' },
  { id: 'forecast', title: 'National Weather Service forecast', kind: 'rest',
    url: 'https://api.weather.gov/points/37.7749,-122.4194', auth: 'none',
    blurb: 'Official NWS forecast, in prose written by an actual meteorologist.' },
  { id: 'earthquakes', title: 'Recent Bay Area earthquakes (USGS)', kind: 'rest',
    url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=37.77&longitude=-122.42&maxradiuskm=150&minmagnitude=1&orderby=time&limit=10',
    auth: 'none',
    blurb: 'Every quake within 150km, live. Reliably the question tourists ask first.' },
  { id: 'tides', title: 'Tides at Fort Point (NOAA)', kind: 'rest',
    url: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&station=9414290&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&format=json',
    auth: 'none',
    blurb: 'High and low tide under the Golden Gate today.' },
  { id: 'sun', title: 'Sunrise, sunset and golden hour', kind: 'rest',
    url: 'https://api.sunrise-sunset.org/json?lat=37.7749&lng=-122.4194&formatted=0', auth: 'none',
    blurb: 'When to be on the bridge with a camera.' },
  { id: 'nearby_landmarks', title: 'Wikipedia geosearch', kind: 'rest',
    url: 'https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=37.7749%7C-122.4194&gsradius=3000&gslimit=15&format=json',
    auth: 'none',
    blurb: 'Anything with a Wikipedia article near a coordinate. Instant walking tour.' },

  // ---- Needs a free key; excluded from the default tool set -------------
  { id: 'transit_realtime', title: '511 Bay Area real-time transit', kind: 'rest',
    url: 'https://api.511.org/transit/StopMonitoring', auth: 'token-required',
    blurb: 'Live BART, Muni and Caltrain departures. Free token from 511.org/open-data/token.' },
];

/** Sources usable right now with no credentials. The server exposes these by
 *  default so the guide is never in the position of promising data it cannot
 *  reach. */
export const USABLE = SOURCES.filter((s) => s.auth !== 'token-required');
