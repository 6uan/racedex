import { parseArgs } from "node:util";
import { runWeather } from "./weather";

// pnpm --filter api weather [-- --limit 5 --recompute]
//
// The no-flag run is the normal one: find every (cell, day) a race starts in
// and fetch only what's missing. --limit N computes only the first N cell-days
// (dev runs); --recompute rebuilds cells that already have rows — after a
// heat-band change it replays from fetch_cache without touching the network.

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it so flags after it parse.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    limit: { type: "string" },
    recompute: { type: "boolean", default: false },
  },
});

const limit = values.limit === undefined ? undefined : Number(values.limit);

if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error("usage: weather [--limit N] [--recompute]");
  process.exit(1);
}

const startedAt = Date.now();
const summary = await runWeather({ limit, recompute: values.recompute });

console.log(`
weather finished in ${Math.round((Date.now() - startedAt) / 1000)}s
  cell-days      ${summary.computed} computed, ${summary.skipped} already present, ${summary.cellDays} total
  rows written   ${summary.rowsWritten}
  races covered  ${summary.racesCovered}/${summary.racesTotal}
  network        ${summary.networkFetches} fetches (${summary.failedFetches} failed)
  cache hits     ${summary.cacheHits}`);
