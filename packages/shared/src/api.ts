// The read API's contract (issue #9) — the UI's ONLY coupling to the backend.
// Query params in, response shapes out; `apps/api/src/db/rows.ts` stays
// DB-internal so the schema can move without touching React.
//
// Two conventions worth stating once:
//   - camelCase here, snake_case in SQLite. The mapper in the API is the seam;
//     nothing downstream of it should ever see `next_date`.
//   - money is INTEGER cents, everywhere, including query params. `maxPriceCents`
//     is named for its unit because `maxPrice=5000` reading as $50 is exactly
//     the ambiguity that puts a $50 filter on a $5,000 race.

import { z } from "zod";
import { BUCKET_SLUGS, type BucketSlug } from "./buckets";
import { TagSchema, type Tag } from "./tags";

// Each sort carries its own direction: soonest date, cheapest entry, most
// competitive field, coolest morning. There is no `order` param because every
// reverse of these is a view nobody wants (the hottest races, furthest out).
export const RACE_SORTS = ["date", "price", "competitiveness", "heat"] as const;
export type RaceSort = (typeof RACE_SORTS)[number];

// Query strings carry one value; a comma-separated list is the least
// surprising way to spell a set. Splitting BEFORE validation means a bad
// member reports its own index ("exclude.1"), not a wall of unparsed text.
const tagList = z
  .string()
  .transform((raw) =>
    raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(TagSchema));

// `?includePast` with no value is HTML-form idiom for true; the rest is what
// people actually type.
const boolish = z
  .enum(["true", "false", "1", "0", ""])
  .transform((raw) => raw !== "false" && raw !== "0");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The default exclusion, and the whole of it.
 *
 * `not_a_run` is 15 races and an unambiguous signal: NONE of them also carries
 * `road`. Two curling listings, three triathlons, an open-water swim weekend,
 * a plane pull, a stair climb, Nordic walking, and a race directors' meeting.
 *
 * `virtual` is NOT excluded, though the issue proposed it. 51 of the 60
 * virtual-tagged races also carry `road`, and every one of those 51 has a real
 * gun time, a non-virtual event, AND a separate explicitly-virtual event
 * alongside it — Bagel Run sells `5K Registration` at 07:30 and `Virtual Run
 * Registration` from the same page. The tag means "also offers a virtual
 * option". Excluding it drops 52 races including four of the top twenty by
 * competitiveness and the joint-highest-scored race in the corpus (18th Annual
 * Levis JCC Turkey Trot, 75).
 *
 * The genuinely-virtual listings are handled for free by the date filter: of
 * the 9 races tagged `virtual` with no surface tag, 7 are already past-dated
 * and 1 is `not_a_run`. The single survivor is a mis-tag (2026 Hearts For
 * Kylee 5K — one 5,000m event in Cooper City).
 */
export const DEFAULT_EXCLUDED_TAGS: readonly Tag[] = ["not_a_run"];

/**
 * `GET /api/races` params. Strict: an unrecognized param is a 400, not a
 * silent no-op, because `?distence=5k` quietly returning the unfiltered list
 * is worse than an error.
 */
export const RaceListQuerySchema = z.strictObject({
  month: z.string().regex(MONTH_RE, "month must be YYYY-MM, e.g. 2026-11").optional(),

  // All 12 bucket slugs, not the 4 INDEXED_BUCKETS: the API surface is
  // deliberately wider than the URL space (PLAN.md). `/south-florida/marathon`
  // 404s; `?distance=marathon` works and lists three races.
  distance: z.enum(BUCKET_SLUGS).optional(),

  maxPriceCents: z.coerce.number().int().min(0).optional(),
  maxHeat: z.coerce.number().int().min(1).max(5).optional(),

  // AND, not OR: these are checkboxes in a filter panel, and a filter narrows.
  tags: tagList.optional(),

  // The default filter, and the reason it's a param instead of a hardcoded
  // rule: `exclude=` turns it off, `exclude=not_a_run,virtual` tightens it.
  // Why `not_a_run` alone — see DEFAULT_EXCLUDED_TAGS above.
  exclude: tagList.default([...DEFAULT_EXCLUDED_TAGS]),

  // Note this necessarily drops every unscored race — 107 of 171 upcoming.
  // That's the honest reading of "at least this competitive", and it's why the
  // filter is opt-in rather than a default floor.
  minCompetitiveness: z.coerce.number().int().min(0).max(100).optional(),

  includePast: boolish.default(false),
  sort: z.enum(RACE_SORTS).default("date"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RaceListQuery = z.infer<typeof RaceListQuerySchema>;

/** One matched event distance, ready to print. */
export type RaceDistance = {
  meters: number;
  /** null when the distance is real but outside every running band. */
  bucket: BucketSlug | null;
  label: string;
};

export type RaceHeat = {
  /** 1–5, dew-point driven. */
  score: number;
  tempF: number | null;
  dewPointF: number | null;
};

export type RaceListItem = {
  /** Natural key, `runsignup:10519` — survives a full pipeline rebuild. */
  id: string;
  name: string;
  /** Canonical public path, `/south-florida/…-10519`. */
  url: string;
  /** The race's own listing upstream. */
  sourceUrl: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  nextDate: string | null;
  /** First real gun time, local `HH:MM`; null when no event publishes one. */
  startTime: string | null;
  /**
   * The distances that MATCHED — the response-shape half of the distance
   * filter. Filter to 5k, get "Miami Marathon Weekend", and without this the
   * filter looks broken. Distinct: Bagel Run has three separate 5,000m events
   * (5K, Eco 5K, Virtual 5K) and must not print "5K · 5K · 5K".
   */
  distances: RaceDistance[];
  /** Cheapest entry still purchasable, over the matched events. */
  priceFromCents: number | null;
  heat: RaceHeat | null;
  /** NULL for 116 of 182 races. Not 0, not missing — unknown. */
  competitiveness: number | null;
  tags: Tag[];
};

export type RacePricePeriod = {
  cents: number;
  opensAt: string | null;
  closesAt: string | null;
};

export type RaceEvent = {
  id: string;
  name: string;
  distanceM: number | null;
  bucket: BucketSlug | null;
  label: string | null;
  date: string | null;
  startTime: string | null;
  /** The price timeline, oldest window first. */
  prices: RacePricePeriod[];
};

export type RaceWeatherHour = {
  hour: number;
  tempF: number | null;
  dewPointF: number | null;
  humidityPct: number | null;
  heatScore: number | null;
};

export type RaceWeather = {
  /** Grid cell the normals came from, ~1km. Nearby races share one. */
  geoKey: string;
  monthDay: string;
  /** The hour the race actually starts, so the UI knows which bar to mark. */
  startHour: number;
  yearsSampled: number;
  /** The whole calendar day, so the panel can show the morning curve. */
  hours: RaceWeatherHour[];
};

export type RaceResult = {
  year: number;
  eventName: string | null;
  distanceM: number | null;
  finishers: number | null;
  winnerSeconds: number | null;
  medianSeconds: number | null;
};

/** Every number behind the score — PLAN.md's "a bare 73 is not trust-me". */
export type RaceCompetitivenessInputs = {
  version: number;
  scoredAt: string;
  years: number[];
  eventName: string | null;
  fieldSize: number | null;
  distanceM: number | null;
  winnerSeconds: number | null;
  medianSeconds: number | null;
  benchmarkSeconds: number | null;
  components: { field: number | null; pace: number | null; depth: number | null };
  weights: { field: number; pace: number; depth: number };
};

export type RaceDetail = RaceListItem & {
  description: string | null;
  address: string | null;
  zip: string | null;
  timezone: string;
  /** Every event, not just matched ones — a detail page has no filter. */
  events: RaceEvent[];
  weather: RaceWeather | null;
  /** Newest year first. */
  results: RaceResult[];
  competitivenessInputs: RaceCompetitivenessInputs | null;
};

export type RaceListResponse = {
  races: RaceListItem[];
  /** Matches before limit/offset. */
  total: number;
  /** The query as actually applied, defaults filled in — so that the UI can
   *  say "upcoming races, excluding non-runs" instead of a default being
   *  invisible to the person reading the list. */
  applied: RaceListQuery;
};

export type ApiError = {
  error: "invalid_query" | "not_found";
  message: string;
  issues?: { path: string; message: string }[];
};
