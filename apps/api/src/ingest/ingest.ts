import { db } from "../db/index";
import { CachedFetcher } from "../lib/fetch";
import { geocodeZip } from "../lib/geocode";
import type { Coords } from "../lib/geocode";
import { median } from "../lib/stats";
import { parseDistanceMeters } from "./distance";
import {
  durationToSeconds,
  moneyToCents,
  stripHtml,
  usDateTimeParts,
  usDateTimeToIso,
  usDateToIso,
} from "./parse";
import {
  RESULTS_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  raceDetailUrl,
  resultSetsUrl,
  resultsUrl,
  searchUrl,
} from "./runsignup";
import type {
  RsuRace,
  RsuRaceDetailResponse,
  RsuResultSet,
  RsuResultSetsResponse,
  RsuSearchResponse,
} from "./runsignup";

// How far back to look for published results. Competitiveness scoring wants
// recent fields, not a decade of history, and each past event costs a
// result-set lookup on cold runs.
const RESULTS_YEARS = 3;

export type IngestOptions = {
  zip: string;
  radiusMiles: number;
  maxAgeHours: number;
  limit?: number;
};

export type IngestSummary = {
  races: number;
  events: number;
  pricePeriods: number;
  raceResults: number;
  zipsGeocoded: number;
  zipsUnresolved: number;
  networkFetches: number;
  cacheHits: number;
  failedFetches: number;
};

const upsertRace = db.prepare(
  `INSERT INTO races (
     id, source, source_race_id, name, description_text, url, address,
     city, state, zip, lat, lon, next_date, timezone, raw,
     first_seen_at, last_seen_at
   ) VALUES (
     @id, 'runsignup', @sourceRaceId, @name, @descriptionText, @url, @address,
     @city, @state, @zip, @lat, @lon, @nextDate, @timezone, @raw,
     @now, @now
   )
   ON CONFLICT (id) DO UPDATE SET
     name = excluded.name,
     description_text = excluded.description_text,
     url = excluded.url,
     address = excluded.address,
     city = excluded.city,
     state = excluded.state,
     zip = excluded.zip,
     lat = COALESCE(excluded.lat, lat),
     lon = COALESCE(excluded.lon, lon),
     next_date = excluded.next_date,
     timezone = excluded.timezone,
     raw = excluded.raw,
     last_seen_at = excluded.last_seen_at`,
  // Deliberately untouched on conflict: first_seen_at, and the columns owned
  // by later pipeline stages (tags, tag_meta, competitiveness*). lat/lon
  // COALESCE so a transiently failed geocode can't erase known coordinates.
);

const deleteEvents = db.prepare("DELETE FROM events WHERE race_id = ?");

const insertEvent = db.prepare(
  `INSERT INTO events (id, race_id, name, distance_m, date, start_time, raw)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

const insertPricePeriod = db.prepare(
  `INSERT INTO price_periods (event_id, price_cents, opens_at, closes_at)
   VALUES (?, ?, ?, ?)`,
);

const upsertRaceResult = db.prepare(
  `INSERT INTO race_results (
     race_id, source_event_id, year, event_name, distance_m,
     finishers, winner_seconds, median_seconds, raw
   ) VALUES (
     @raceId, @sourceEventId, @year, @eventName, @distanceM,
     @finishers, @winnerSeconds, @medianSeconds, @raw
   )
   ON CONFLICT (race_id, source_event_id) DO UPDATE SET
     year = excluded.year,
     event_name = excluded.event_name,
     distance_m = excluded.distance_m,
     finishers = excluded.finishers,
     winner_seconds = excluded.winner_seconds,
     median_seconds = excluded.median_seconds,
     raw = excluded.raw`,
);

// Race + its events + their prices land atomically: events are replaced
// wholesale (delete cascades to price_periods), which makes delisted events
// disappear instead of lingering. Returns counts for the summary.
const upsertRaceTx = db.transaction(
  (
    race: RsuRace,
    coords: Coords | null,
    now: string,
  ): { events: number; pricePeriods: number } => {
    const raceId = `runsignup:${race.race_id}`;
    const address =
      [race.address?.street, race.address?.street2]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", ") || null;

    upsertRace.run({
      id: raceId,
      sourceRaceId: String(race.race_id),
      name: race.name,
      descriptionText: stripHtml(race.description),
      url: race.url ?? null,
      address,
      city: race.address?.city ?? null,
      state: race.address?.state ?? null,
      zip: race.address?.zipcode ?? null,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      nextDate: usDateToIso(race.next_date),
      timezone: race.timezone ?? "America/New_York",
      raw: JSON.stringify(race),
      now,
    });

    deleteEvents.run(raceId);
    let events = 0;
    let pricePeriods = 0;
    for (const event of race.events ?? []) {
      const eventId = `runsignup:${event.event_id}`;
      const start = usDateTimeParts(event.start_time);
      insertEvent.run(
        eventId,
        raceId,
        event.name,
        parseDistanceMeters(event.distance, event.name),
        start?.date ?? null,
        start?.time ?? null,
        JSON.stringify(event),
      );
      events += 1;

      for (const period of event.registration_periods ?? []) {
        // price = race_fee only; the processing fee varies by cart and isn't
        // what a runner comparison-shops on.
        const priceCents = moneyToCents(period.race_fee);
        if (priceCents === null) continue;
        insertPricePeriod.run(
          eventId,
          priceCents,
          usDateTimeToIso(period.registration_opens),
          usDateTimeToIso(period.registration_closes),
        );
        pricePeriods += 1;
      }
    }
    return { events, pricePeriods };
  },
);

// Fetches all pages of one result set and reduces them to the three numbers
// race_results keeps. finishers counts every listed result, including ones
// whose time didn't parse (DNF blanks etc. still finished per the timer).
async function fetchResultSetStats(
  fetcher: CachedFetcher,
  raceId: number,
  eventId: number,
  set: RsuResultSet,
): Promise<{ finishers: number; seconds: number[] }> {
  let finishers = 0;
  const seconds: number[] = [];
  for (let page = 1; ; page++) {
    const data = await fetcher.getJson<RsuResultSetsResponse>(
      resultsUrl(raceId, eventId, set.individual_result_set_id, page),
    );
    const results = data?.individual_results_sets?.[0]?.results ?? [];
    finishers += results.length;
    for (const result of results) {
      const time =
        durationToSeconds(result.chip_time) ??
        durationToSeconds(result.clock_time);
      if (time !== null && time > 0) seconds.push(time);
    }
    if (results.length < RESULTS_PAGE_SIZE) break;
  }
  return { finishers, seconds };
}

// Prior-year results for one race: detail fetch → past events in the window →
// result sets per event → best (largest) public set becomes the race_results
// row. Most races publish nothing here; that's expected, not an error.
async function ingestResults(
  fetcher: CachedFetcher,
  race: RsuRace,
  todayIso: string,
): Promise<number> {
  const detail = await fetcher.getJson<RsuRaceDetailResponse>(
    raceDetailUrl(race.race_id),
  );
  const minYear = Number(todayIso.slice(0, 4)) - RESULTS_YEARS;
  const pastEvents = (detail?.race?.events ?? []).flatMap((event) => {
    const start = usDateTimeParts(event.start_time);
    if (!start || start.date >= todayIso) return [];
    const year = Number(start.date.slice(0, 4));
    return year >= minYear ? [{ event, year }] : [];
  });

  let rows = 0;
  for (const { event, year } of pastEvents) {
    const setsResponse = await fetcher.getJson<RsuResultSetsResponse>(
      resultSetsUrl(race.race_id, event.event_id),
    );
    const sets = (setsResponse?.individual_results_sets ?? []).filter(
      (set) => set.public_results !== "F",
    );

    let best: { set: RsuResultSet; finishers: number; seconds: number[] } | null =
      null;
    for (const set of sets) {
      const stats = await fetchResultSetStats(
        fetcher,
        race.race_id,
        event.event_id,
        set,
      );
      if (stats.finishers > (best?.finishers ?? 0)) best = { set, ...stats };
    }
    if (!best) continue;

    // median() is exact; median_seconds is a STRICT INTEGER column, so an
    // even-count midpoint (x.5) must be rounded here.
    const medianSeconds = median(best.seconds);
    upsertRaceResult.run({
      raceId: `runsignup:${race.race_id}`,
      sourceEventId: String(event.event_id),
      year,
      eventName: event.name,
      distanceM: parseDistanceMeters(event.distance, event.name),
      finishers: best.finishers,
      winnerSeconds: best.seconds.length ? Math.min(...best.seconds) : null,
      medianSeconds: medianSeconds === null ? null : Math.round(medianSeconds),
      // Full result listings stay in fetch_cache; duplicating thousands of
      // rows per race here would bloat the DB for no reader.
      raw: JSON.stringify({
        individual_result_set_id: best.set.individual_result_set_id,
        individual_result_set_name: best.set.individual_result_set_name ?? null,
        results_url: resultsUrl(
          race.race_id,
          event.event_id,
          best.set.individual_result_set_id,
          1,
        ),
      }),
    });
    rows += 1;
  }
  return rows;
}

export async function runIngest(
  opts: IngestOptions,
  log: (message: string) => void = console.log,
): Promise<IngestSummary> {
  const fetcher = new CachedFetcher(opts.maxAgeHours);

  const byId = new Map<number, RsuRace>();
  for (let page = 1; ; page++) {
    const data = await fetcher.getJson<RsuSearchResponse>(
      searchUrl(opts.zip, opts.radiusMiles, page),
    );
    if (!data) throw new Error(`RunSignup race search failed on page ${page}`);
    const batch = (data.races ?? []).map((wrapper) => wrapper.race);
    for (const race of batch) {
      if (race.is_draft_race === "T" || race.is_private_race === "T") continue;
      byId.set(race.race_id, race);
    }
    log(`search page ${page}: ${batch.length} races`);
    if (batch.length < SEARCH_PAGE_SIZE) break;
  }

  const races = [...byId.values()].slice(0, opts.limit);
  const todayIso = new Date().toISOString().slice(0, 10);
  const zipCache = new Map<string, Coords | null>();
  const summary: IngestSummary = {
    races: races.length,
    events: 0,
    pricePeriods: 0,
    raceResults: 0,
    zipsGeocoded: 0,
    zipsUnresolved: 0,
    networkFetches: 0,
    cacheHits: 0,
    failedFetches: 0,
  };

  for (const [index, race] of races.entries()) {
    const coords = await geocodeZip(fetcher, zipCache, race.address?.zipcode);
    const counts = upsertRaceTx(race, coords, new Date().toISOString());
    summary.events += counts.events;
    summary.pricePeriods += counts.pricePeriods;
    summary.raceResults += await ingestResults(fetcher, race, todayIso);
    if ((index + 1) % 20 === 0 || index === races.length - 1) {
      log(`processed ${index + 1}/${races.length} races`);
    }
  }

  for (const coords of zipCache.values()) {
    if (coords) summary.zipsGeocoded += 1;
    else summary.zipsUnresolved += 1;
  }
  summary.networkFetches = fetcher.networkFetches;
  summary.cacheHits = fetcher.cacheHits;
  summary.failedFetches = fetcher.failedFetches;
  return summary;
}
