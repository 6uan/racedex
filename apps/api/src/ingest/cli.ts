import { parseArgs } from "node:util";
import { runIngest } from "./ingest";

// pnpm --filter api ingest [-- --zip 33131 --radius 60 --max-age-hours 24 --limit 5]
//
// Defaults cover the v1 target (60mi around Miami). --max-age-hours 0 forces
// a full refetch; --limit N processes only the first N races (dev runs).

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it so flags after it parse.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    zip: { type: "string", default: "33131" },
    radius: { type: "string", default: "60" },
    "max-age-hours": { type: "string", default: "24" },
    limit: { type: "string" },
  },
});

const zip = values.zip;
const radiusMiles = Number(values.radius);
const maxAgeHours = Number(values["max-age-hours"]);
const limit = values.limit === undefined ? undefined : Number(values.limit);

if (
  !/^\d{5}$/.test(zip) ||
  !Number.isFinite(radiusMiles) ||
  radiusMiles <= 0 ||
  !Number.isFinite(maxAgeHours) ||
  maxAgeHours < 0 ||
  (limit !== undefined && (!Number.isInteger(limit) || limit <= 0))
) {
  console.error(
    "usage: ingest [--zip 33131] [--radius 60] [--max-age-hours 24] [--limit N]",
  );
  process.exit(1);
}

const startedAt = Date.now();
const summary = await runIngest({ zip, radiusMiles, maxAgeHours, limit });

console.log(`
ingest finished in ${Math.round((Date.now() - startedAt) / 1000)}s
  races          ${summary.races}
  events         ${summary.events}
  price periods  ${summary.pricePeriods}
  race results   ${summary.raceResults}
  zips geocoded  ${summary.zipsGeocoded} (${summary.zipsUnresolved} unresolved)
  network        ${summary.networkFetches} fetches (${summary.failedFetches} failed)
  cache hits     ${summary.cacheHits}`);
