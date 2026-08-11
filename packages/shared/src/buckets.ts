// Distance buckets — the vocabulary behind `/south-florida/5k` and the read
// API's `distance` filter. Lives here, not in the pipeline, because both
// halves need it: the API bounds its SQL with the bands, the web app builds
// routes from INDEXED_BUCKETS. Parsing free text into meters is a separate,
// pipeline-only job (apps/api/src/ingest/distance.ts).
//
// EVERY BAND IS CLOSED ON BOTH ENDS. There is no open-ended `ultra` and no
// catch-all `other`, because the bands exist less for tolerance than to keep
// non-running distances out of running indexes. The first ingest surfaced,
// in meters: an Olympic Aquabike at 41360 (835 under a marathon), an Olympic
// Triathlon at 51338 (338 over a 50K, and a swim+bike+run sum), 35 "Step/Ride
// 40K/70K/90K" virtual challenges, and a 1500 open-water swim. An open
// `> 43000` bucket collects eight races of which one is a running race.
// Out-of-band is null, matching parseDistanceMeters' refusal to guess.
export const DISTANCE_BUCKETS = [
  { slug: "1k", label: "1K", min: 950, max: 1150 },
  // Starts at 1550 so the 1500 m open-water "metric mile" stays out.
  { slug: "mile", label: "1 Mile", min: 1550, max: 1700 },
  { slug: "5k", label: "5K", min: 4800, max: 5200 },
  // The one band doing real merging work: road racing treats 8000 ("8K") and
  // 8047 ("5 Mile") as one slot. Stops short of 8690 (a 5.4-mile novelty race).
  { slug: "8k", label: "8K / 5 Mile", min: 7900, max: 8300 },
  { slug: "10k", label: "10K", min: 9700, max: 10400 },
  { slug: "15k", label: "15K", min: 14700, max: 15300 },
  { slug: "10-mile", label: "10 Mile", min: 15900, max: 16300 },
  // Wide enough for all three spellings the parser emits: "1/2 Marathon"
  // (21000), "Half Marathon" (21097), and one stray 21098.
  { slug: "half-marathon", label: "Half Marathon", min: 20500, max: 21500 },
  // Starts at 41500: 40000 is a step challenge, 41360 is an Aquabike.
  { slug: "marathon", label: "Marathon", min: 41500, max: 42900 },
  // Stops at 51000, which is what keeps the 51338 Olympic Triathlon out.
  { slug: "50k", label: "50K", min: 49000, max: 51000 },
  { slug: "50-mile", label: "50 Mile", min: 79000, max: 82000 },
  { slug: "100-mile", label: "100 Mile", min: 159000, max: 163000 },
] as const;

export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number];
export type BucketSlug = DistanceBucket["slug"];

export const BUCKET_SLUGS = DISTANCE_BUCKETS.map((b) => b.slug) as BucketSlug[];

// The buckets that get their own URL. Hand-checked against the corpus at the
// 10-upcoming-races threshold, NOT evaluated per request: a data-driven
// threshold makes a URL 404 one week and 200 the next as races age out, which
// is the worst signal to send Google and inbound links. Same reasoning as the
// competitiveness scale being absolute rather than a curve over this metro.
//
// At the first ingest the upcoming-race counts were 5k 152, 10k 62, mile 45,
// half-marathon 41, then a cliff to 8k 4, marathon 3, 1k 3. Any threshold from
// 5 to 40 picks these same four, so the number is not load-bearing. Everything
// else is reachable as `?distance=` on the metro index, noindex.
export const INDEXED_BUCKETS = [
  "mile",
  "5k",
  "10k",
  "half-marathon",
] as const satisfies readonly BucketSlug[];

export type IndexedBucketSlug = (typeof INDEXED_BUCKETS)[number];

export function isBucketSlug(value: string): value is BucketSlug {
  return DISTANCE_BUCKETS.some((b) => b.slug === value);
}

export function isIndexedBucket(value: string): value is IndexedBucketSlug {
  return (INDEXED_BUCKETS as readonly string[]).includes(value);
}

export function bucketBySlug(slug: string): DistanceBucket | null {
  return DISTANCE_BUCKETS.find((b) => b.slug === slug) ?? null;
}

// Bands don't overlap, so first match wins and order is presentational only.
export function distanceBucket(meters: number | null | undefined): BucketSlug | null {
  if (meters == null) return null;
  const hit = DISTANCE_BUCKETS.find((b) => meters >= b.min && meters <= b.max);
  return hit ? hit.slug : null;
}

// Display inverse of the pipeline's parseDistanceMeters, and deliberately NOT
// bucket-based: an event has to be printable whether or not it landed in a
// band, so the 8690m "5.4 Funky Run" reads "8.7K" rather than vanishing.
// Canonical race distances get their household names, then anything that
// divides evenly into kilometres or miles gets that unit, and the rest falls
// back to one decimal.
export function distanceLabel(meters: number): string {
  if (meters === 21097) return "Half";
  if (meters === 42195) return "Marathon";
  if (meters % 1000 === 0) return `${meters / 1000}K`;
  const miles = meters / 1609.344;
  if (Math.abs(miles - Math.round(miles)) < 0.01) return `${Math.round(miles)}mi`;
  return meters < 1000 ? `${meters}m` : `${(meters / 1000).toFixed(1)}K`;
}
