import type { CachedFetcher } from "./fetch";

// Zip-centroid geocoding (GOAL.md blesses this for v1): RunSignup returns no
// coordinates, Zippopotam.us maps zip → centroid for free. Centroids don't
// move, so cached responses stay valid for a year regardless of the run's
// --max-age-hours; if one is ever wrong, delete its fetch_cache rows.
const GEOCODE_MAX_AGE_HOURS = 24 * 365;

export type Coords = { lat: number; lon: number };

type ZippopotamResponse = {
  places?: { latitude?: string; longitude?: string }[];
};

export function zippopotamUrl(zip: string): string {
  return `https://api.zippopotam.us/us/${zip}`;
}

// `cache` is run-scoped memoization (one lookup per unique zip per run);
// fetch_cache behind it makes the lookup itself a network call at most once
// a year.
export async function geocodeZip(
  fetcher: CachedFetcher,
  cache: Map<string, Coords | null>,
  rawZip: string | null | undefined,
): Promise<Coords | null> {
  const zip = rawZip?.trim().slice(0, 5);
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  const cached = cache.get(zip);
  if (cached !== undefined) return cached;

  const data = await fetcher.getJson<ZippopotamResponse>(
    zippopotamUrl(zip),
    GEOCODE_MAX_AGE_HOURS,
  );
  const place = data?.places?.[0];
  const lat = Number(place?.latitude);
  const lon = Number(place?.longitude);
  const coords =
    Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  cache.set(zip, coords);
  return coords;
}
