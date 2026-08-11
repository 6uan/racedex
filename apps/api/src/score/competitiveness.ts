// The competitiveness score (issue #8): one 0-100 number answering "is this a
// real race or a stroller parade?", from the only three facts RunSignup's
// results endpoints reliably give us — how many finished, how fast the winner
// was, and how far behind the middle of the field was.
//
// No I/O here. The bands below are the opinionated part of the stage, so they
// live in one pure function with tests; score.ts does the DB work.
//
// Every number that produced a score is stored next to it in
// competitiveness_inputs, because a bare 73 is not something a runner (or a
// reviewer of this repo) should have to trust blind.

import { median } from "../lib/stats";
import type { RaceResultRow } from "../db/rows";

// Bump when a band or weight changes: stored inputs carry the version, so a
// mixed-version table is detectable instead of silently incomparable.
export const SCORE_VERSION = 1;

// Field size, log-scaled: the jump from 25 to 250 finishers says as much about
// a race as 250 to 2500 does. Below 25 finishers there is no field to speak of.
const FIELD_MIN = 25;
const FIELD_MAX = 2500;

// Winner benchmark: a 15:00 5K, scaled to other distances with Riegel's
// t2 = t1 * (d2/d1)^1.06 (1:09 half, 2:24 marathon). This is deliberately a
// strong-regional-winner reference, not a world-class one — it's the line
// where a local race stops being a fun run and starts drawing actual runners.
const BENCHMARK_5K_SECONDS = 900;
const RIEGEL_EXPONENT = 1.06;

// Riegel is only honest from ~1500m to the marathon; ultras and mis-parsed
// distances (a "31.9 mile" relay leg, a triathlon) fall outside and skip the
// pace component rather than getting a fictional benchmark.
const PACE_MIN_DISTANCE_M = 1500;
const PACE_MAX_DISTANCE_M = 42195;

// Pace score band, as a fraction of the benchmark time. 1.0 = hit the
// benchmark = 100; 0.6 = a 25:00 5K winner = 0, which in this dataset is a
// walk-up field.
const PACE_FLOOR_RATIO = 0.6;

// Outside these ratios the number is describing something other than a race
// run on foot at the distance we think it is, so the component is dropped
// rather than scored. Above 1.1 (a 13:38 5K) nothing in this dataset is a
// running result: it's a triathlon whose "distance" is swim+bike+run summed,
// or a virtual race where someone logged a 3:52 "5K". Below 0.4 the winner is
// slower than 12:00/mile, which means a mis-parsed distance rather than a
// genuinely slow winner. The fastest real local winner we have sits at 1.04
// (a 14:27 5K), so the fast gate keeps its headroom.
const PACE_IMPLAUSIBLE_FAST_RATIO = 1.1;
const PACE_IMPLAUSIBLE_SLOW_RATIO = 0.4;

// Depth: median finish as a multiple of the winner's time. Dimensionless, so
// it works on any distance. 1.5x = everyone out there is racing; 2.6x = the
// median entrant is walking it (Miami's big turkey trots sit right at 2.6).
const DEPTH_BEST_RATIO = 1.5;
const DEPTH_WORST_RATIO = 2.6;

// Below this many finishers a median is one or two people, and at a field of
// one it's the winner themselves — a tautological 1.0x that would score a
// four-person charity walk as the deepest field in the county. The component
// drops out instead.
const DEPTH_MIN_FIELD = 10;

// Field carries the most weight because it is the one input with no parsing
// risk; depth the least because a single slow winner skews the whole ratio.
// Weights are renormalized over whichever components a race actually has.
const WEIGHTS = { field: 0.4, pace: 0.35, depth: 0.25 } as const;

export type ScoreInput = {
  /** Median across years of the primary event's finishers. */
  fieldSize: number | null;
  /** Distance of the primary event, or null if it never parsed. */
  distanceM: number | null;
  /** Median across years of the primary event's winning time, in seconds. */
  winnerSeconds: number | null;
  /** Median across years of the primary event's median finish, in seconds. */
  medianSeconds: number | null;
};

export type ScoreComponents = {
  field: number | null;
  pace: number | null;
  depth: number | null;
};

export type ScoreResult = {
  score: number;
  components: ScoreComponents;
  /** Benchmark the winner was measured against, seconds; null if not scored. */
  benchmarkSeconds: number | null;
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Winner time a benchmark runner would post at this distance, in seconds. */
export function benchmarkSeconds(distanceM: number): number {
  return BENCHMARK_5K_SECONDS * (distanceM / 5000) ** RIEGEL_EXPONENT;
}

function fieldScore(finishers: number | null): number | null {
  if (finishers === null || finishers <= 0) return null;
  const span = Math.log(FIELD_MAX) - Math.log(FIELD_MIN);
  return clamp01((Math.log(finishers) - Math.log(FIELD_MIN)) / span) * 100;
}

function paceScore(
  distanceM: number | null,
  winnerSeconds: number | null,
): { score: number | null; benchmark: number | null } {
  if (
    distanceM === null ||
    winnerSeconds === null ||
    winnerSeconds <= 0 ||
    distanceM < PACE_MIN_DISTANCE_M ||
    distanceM > PACE_MAX_DISTANCE_M
  ) {
    return { score: null, benchmark: null };
  }
  const benchmark = benchmarkSeconds(distanceM);
  const ratio = benchmark / winnerSeconds;
  if (ratio > PACE_IMPLAUSIBLE_FAST_RATIO || ratio < PACE_IMPLAUSIBLE_SLOW_RATIO) {
    return { score: null, benchmark: null };
  }
  const span = 1 - PACE_FLOOR_RATIO;
  return { score: clamp01((ratio - PACE_FLOOR_RATIO) / span) * 100, benchmark };
}

function depthScore(
  winnerSeconds: number | null,
  medianSeconds: number | null,
  fieldSize: number | null,
): number | null {
  if (
    winnerSeconds === null ||
    medianSeconds === null ||
    winnerSeconds <= 0 ||
    medianSeconds < winnerSeconds || // median faster than the winner: junk row
    fieldSize === null ||
    fieldSize < DEPTH_MIN_FIELD
  ) {
    return null;
  }
  const span = DEPTH_WORST_RATIO - DEPTH_BEST_RATIO;
  const ratio = medianSeconds / winnerSeconds;
  return clamp01((DEPTH_WORST_RATIO - ratio) / span) * 100;
}

/**
 * Weighted score over whichever components survived. Returns null when none
 * did — a results row with nothing usable in it is still "no data", and the
 * schema's NULL says so honestly rather than inventing a 0.
 */
export function scoreRace(input: ScoreInput): ScoreResult | null {
  const pace = paceScore(input.distanceM, input.winnerSeconds);
  const components: ScoreComponents = {
    field: fieldScore(input.fieldSize),
    pace: pace.score,
    depth: depthScore(input.winnerSeconds, input.medianSeconds, input.fieldSize),
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const key of ["field", "pace", "depth"] as const) {
    const value = components[key];
    if (value === null) continue;
    weighted += value * WEIGHTS[key];
    totalWeight += WEIGHTS[key];
  }
  if (totalWeight === 0) return null;

  return {
    score: Math.round(weighted / totalWeight),
    components: {
      field: components.field === null ? null : Math.round(components.field),
      pace: components.pace === null ? null : Math.round(components.pace),
      depth: components.depth === null ? null : Math.round(components.depth),
    },
    benchmarkSeconds: pace.benchmark === null ? null : Math.round(pace.benchmark),
  };
}

/** The race_results columns the score reads. */
export type ResultRow = Pick<
  RaceResultRow,
  | "year"
  | "event_name"
  | "distance_m"
  | "finishers"
  | "winner_seconds"
  | "median_seconds"
>;

export type PrimaryEvent = ScoreInput & {
  years: number[];
  eventName: string | null;
};

/**
 * Reduce one race's result rows to the single event the score describes.
 *
 * The unit is the race's *primary event* — its biggest, by median finishers
 * across years — so field size, winner time and median finish all describe the
 * same start line rather than averaging a 5K with the half that ran beside it.
 * Rows group by parsed distance where there is one (event ids and names churn
 * year to year, distances don't) and by event name otherwise, which keeps a
 * race's triathlon and duathlon from being blended into one phantom event.
 *
 * Medians across years, per the project's median-not-mean habit: one freak
 * year — a washed-out edition, a one-off elite showing up — shouldn't decide
 * what a race is.
 */
export function primaryEvent(rows: ResultRow[]): PrimaryEvent | null {
  const groups = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const key =
      row.distance_m === null
        ? `name:${row.event_name ?? ""}`
        : `distance:${row.distance_m}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let best: { rows: ResultRow[]; size: number } | null = null;
  for (const group of groups.values()) {
    const size = medianOf(group, (row) => row.finishers) ?? 0;
    // Ties (equal fields, or no finisher counts at all) go to the group with
    // more years behind it — the better-evidenced event.
    if (
      best === null ||
      size > best.size ||
      (size === best.size && group.length > best.rows.length)
    ) {
      best = { rows: group, size };
    }
  }
  if (best === null) return null;

  // Distance and name come from the most recent edition: if a race changed
  // either, the current one is what a runner is signing up for.
  const latest = best.rows.reduce((a, b) => (b.year > a.year ? b : a));
  const round = (n: number | null) => (n === null ? null : Math.round(n));
  return {
    fieldSize: round(best.size === 0 ? null : best.size),
    distanceM: latest.distance_m,
    winnerSeconds: round(medianOf(best.rows, (row) => row.winner_seconds)),
    medianSeconds: round(medianOf(best.rows, (row) => row.median_seconds)),
    years: [...new Set(best.rows.map((row) => row.year))].sort((a, b) => a - b),
    eventName: latest.event_name,
  };
}

function medianOf(
  rows: ResultRow[],
  get: (row: ResultRow) => number | null,
): number | null {
  return median(
    rows.flatMap((row) => {
      const value = get(row);
      return value === null ? [] : [value];
    }),
  );
}

/**
 * What lands in races.competitiveness_inputs — the "why" behind the score.
 * snake_case like tag_meta: these are DB values, queryable with json_extract.
 */
export type CompetitivenessInputs = {
  version: number;
  scored_at: string;
  /** Result years the medians were taken over, oldest first. */
  years: number[];
  /** The event the pace/depth numbers came from (the race's biggest). */
  event_name: string | null;
  field_size: number | null;
  distance_m: number | null;
  winner_seconds: number | null;
  median_seconds: number | null;
  benchmark_seconds: number | null;
  components: ScoreComponents;
  weights: typeof WEIGHTS;
};

export const SCORE_WEIGHTS = WEIGHTS;
