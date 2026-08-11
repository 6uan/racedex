import { db } from "../db/index";
import {
  SCORE_VERSION,
  SCORE_WEIGHTS,
  primaryEvent,
  scoreRace,
  type CompetitivenessInputs,
  type ResultRow,
} from "./competitiveness";

// The competitiveness stage (issue #8): read race_results, write one score per
// race that has them and the honest NULL for every race that doesn't.
//
// Unlike weather and tagging this stage costs nothing — no network, no tokens,
// pure arithmetic over rows already in the DB — so it always recomputes rather
// than skipping work that is already there. That makes it safe to re-run after
// any band change, and it is the only way the NULL state stays truthful when a
// race's results change or disappear upstream.

const resultsStmt = db.prepare(`
  SELECT race_id, year, event_name, distance_m, finishers,
         winner_seconds, median_seconds
  FROM race_results
  ORDER BY race_id, year
`);

const racesTotalStmt = db.prepare("SELECT COUNT(*) AS n FROM races");

const updateStmt = db.prepare(
  "UPDATE races SET competitiveness = ?, competitiveness_inputs = ? WHERE id = ?",
);

// Races whose results vanished upstream must not keep a stale number. Runs
// every time, so races.competitiveness can't drift out of agreement with
// race_results.
const clearStaleStmt = db.prepare(`
  UPDATE races SET competitiveness = NULL, competitiveness_inputs = NULL
  WHERE competitiveness IS NOT NULL
    AND id NOT IN (SELECT race_id FROM race_results)
`);

export type ScoreOptions = {
  limit?: number;
  dryRun?: boolean;
};

export type ScoreSummary = {
  racesTotal: number;
  candidates: number; // races with at least one race_results row
  scored: number;
  unscorable: number; // results present, nothing usable in them → NULL
  noResults: number; // the honest no-data majority → NULL
  cleared: number; // stale scores removed (results gone upstream)
  bands: number[]; // scored races per 20-point band, 0-19 … 80-100
};

export function runScore(
  opts: ScoreOptions = {},
  log: (message: string) => void = console.log,
): ScoreSummary {
  const byRace = new Map<string, ResultRow[]>();
  for (const row of resultsStmt.all() as (ResultRow & { race_id: string })[]) {
    byRace.set(row.race_id, [...(byRace.get(row.race_id) ?? []), row]);
  }

  const racesTotal = (racesTotalStmt.get() as { n: number }).n;
  const candidates = [...byRace.entries()].slice(0, opts.limit);
  const summary: ScoreSummary = {
    racesTotal,
    candidates: candidates.length,
    scored: 0,
    unscorable: 0,
    noResults: racesTotal - byRace.size,
    cleared: 0,
    bands: [0, 0, 0, 0, 0],
  };

  const scoredAt = new Date().toISOString();
  const writes: { id: string; score: number | null; inputs: string | null }[] =
    [];

  for (const [raceId, rows] of candidates) {
    const event = primaryEvent(rows);
    const result = event === null ? null : scoreRace(event);

    if (event === null || result === null) {
      // Results exist but carry no usable number (a virtual race whose only
      // "5K" was logged at 3:52, a result set with no finishers): NULL, not an
      // invented 0. Written, not skipped — a race can lose its usable rows.
      summary.unscorable += 1;
      writes.push({ id: raceId, score: null, inputs: null });
      log(`— ${raceId} results present but unscorable`);
      continue;
    }

    const inputs: CompetitivenessInputs = {
      version: SCORE_VERSION,
      scored_at: scoredAt,
      years: event.years,
      event_name: event.eventName,
      field_size: event.fieldSize,
      distance_m: event.distanceM,
      winner_seconds: event.winnerSeconds,
      median_seconds: event.medianSeconds,
      benchmark_seconds: result.benchmarkSeconds,
      components: result.components,
      weights: SCORE_WEIGHTS,
    };
    summary.scored += 1;
    summary.bands[Math.min(4, Math.floor(result.score / 20))]! += 1;
    writes.push({
      id: raceId,
      score: result.score,
      inputs: JSON.stringify(inputs),
    });
  }

  if (opts.dryRun) {
    for (const { id, score, inputs } of writes) {
      log(`${String(score ?? "—").padStart(3)}  ${id}  ${inputs ?? ""}`);
    }
    return summary;
  }

  // One transaction: a half-scored table is never visible to /debug or the API.
  db.transaction(() => {
    for (const { id, score, inputs } of writes) {
      updateStmt.run(score, inputs, id);
    }
    summary.cleared = clearStaleStmt.run().changes;
  })();

  return summary;
}
