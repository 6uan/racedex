import { parseArgs } from "node:util";
import { runScore } from "./score";

// pnpm --filter @racedex/api score [-- --limit 5 --dry-run]
//
// The no-flag run is the normal one: rescore every race from race_results.
// There is no --recompute flag because there is nothing to skip — the stage is
// pure arithmetic over local rows, so a full pass costs milliseconds.
// --dry-run prints the score and its inputs per race without writing.

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it so flags after it parse.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const limit = values.limit === undefined ? undefined : Number(values.limit);

if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error("usage: score [--limit N] [--dry-run]");
  process.exit(1);
}

const startedAt = Date.now();
const summary = runScore({ limit, dryRun: values["dry-run"] });

// The band histogram is how a band change gets sanity-checked: a tweak that
// pushes every race into 80-100 is visible here without opening /debug.
const BANDS = ["0-19", "20-39", "40-59", "60-79", "80-100"];
const histogram = summary.bands
  .map((n, i) => `${BANDS[i]}: ${n}`)
  .join("  ");

console.log(`
score finished in ${Math.round((Date.now() - startedAt) / 1000)}s${
  values["dry-run"] ? " (dry run — nothing written)" : ""
}
  candidates   ${summary.candidates} races with results
  scored       ${summary.scored}
  unscorable   ${summary.unscorable} (results present, no usable numbers)
  no data      ${summary.noResults}/${summary.racesTotal} races have no results at all
  cleared      ${summary.cleared} stale scores removed
  distribution ${histogram}`);
