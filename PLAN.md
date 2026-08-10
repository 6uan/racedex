# PLAN.md — architecture decisions

The "why" behind how racedex is built. [GOAL.md](./GOAL.md) is the product
vision; this is the engineering rationale. Work items live as GitHub issues
(milestone `v1`); one issue per PR, squash-merged.

## System shape

Two halves that deliberately don't touch:

1. **Pipeline** — CLI jobs (ingest → weather → tag → score) writing to
   `apps/api/data/racedex.db` via better-sqlite3. Run manually or on a
   schedule; no queue, no scheduler code.
2. **Product** — Express serving a read-only JSON API over the same file,
   React in front, PocketBase as a separate process owning auth + saved races.

Either half can crash, re-run, or be rewritten without taking down the other.

## Two databases, on purpose

| | `racedex.db` (ours) | `pb_data/` (PocketBase's) |
|---|---|---|
| Contains | facts about the world: races, weather, tags, scores | facts about people: users, saved races |
| Written by | pipeline jobs, via SQL we author | PocketBase, via its collection rules |
| If deleted | rebuildable from `fetch_cache` + APIs | gone — the precious data |

The browser talks to PocketBase directly (PB JS SDK, owner-only collection
rules). **Express never sees or validates an auth token** — it stays fully
public read-only. The seam is thin by design: `saved_races` stores a race
`id` string; no cross-database coupling exists, so either side is replaceable
independently.

## Rebuildability is the migration strategy

Everything except `fetch_cache` is a materialized view of `fetch_cache` +
cheap external APIs. Schema changes therefore don't need careful data
preservation: reshape the schema, drop derived tables, re-run the pipeline
(weather re-fetches from cache/API; a full Claude re-tag costs ~$1–2).

Consequences:
- Migrations are roll-forward only. No down-migrations.
- `fetch_cache` is append-only — keyed by `(url, fetched_at)` so refetches
  accumulate history — and is never dropped by a migration. It is the only
  irreplaceable table: upstream data changes (prices, delistings), and our
  snapshots are the historical record.
- Anything *external* references races by their **natural key**
  (`runsignup:12345`), never by rowid — natural keys survive full rebuilds.

## SQLite conventions

- **better-sqlite3**, raw SQL, typed row interfaces (`src/db/rows.ts`). No
  ORM at six tables. The synchronous API is a feature: SQLite is in-process,
  and sync code makes pipeline transactions trivially correct.
- **STRICT tables** — SQLite's default type *affinity* would accept a string
  in an INTEGER column; STRICT rejects it. Matches the strict-TypeScript
  posture.
- **WAL mode** — readers (Express, `sqlite3` CLI, future Datasette) never
  block the pipeline's writes.
- Dates/times are ISO-8601 TEXT (sorts correctly; SQLite has no date type);
  money is INTEGER cents; booleans are 0/1; JSON lives in TEXT columns and is
  queried with `json_*` functions. Tags are a JSON column, not a join table —
  at this scale `json_each()` filters fine, and a re-tag is a single UPDATE.
- Weather normals are keyed by **grid cell** (~2dp lat/lon) + calendar day +
  hour, not by race — nearby races share cells, which dedupes Open-Meteo
  calls and stays far under free-tier limits even at national scale.
- Bulk writes go through `db.transaction()` — batched inserts are ~100×
  faster than autocommit-per-row, and it's the one performance habit the
  pipeline needs.

## Config: one authority, mirrored defaults, env as escape hatch

The dev box's Caddyfile port registry is the single authority for ports
(racedex lane: web **3400**, api **3401**, PocketBase **3402**). Code carries
defaults that mirror it, so the box needs zero env setup; `WEB_PORT` /
`API_PORT` / `DB_PATH` override for any other environment. Distinct names
(not `PORT`) because `pnpm dev` runs both processes in one shared
environment. `.env.example` appears with the first secret
(`ANTHROPIC_API_KEY`, tagging step), loaded with Node's native env-file
support — no dotenv dependency.

## Tagging: provider interface, validation outside

`tagRace(race) → TagResult` with the tag vocabulary as one Zod schema in
`@racedex/shared`. Providers: Anthropic (`claude-haiku-4-5`, structured
outputs) and one OpenAI-compatible client that covers OpenAI, local
Ollama/vLLM on the 3090 box over the tailnet, and most other vendors.
**Validation happens outside every provider** with the same schema — that's
the equalizer that makes providers interchangeable. Provenance (provider,
model, prompt version) is recorded per race in `tag_meta`.

Operations are **CLI, not admin dashboard**: batch jobs run occasionally by
one person compose better as commands (`pnpm tag --provider local --limit
20`), and read-only observability lives in the `/debug` page until the real
UI exists.

## Competitiveness: one score, its inputs stored beside it

The score answers "is this a real race or a stroller parade?" on 0–100, from
the three facts RunSignup's results endpoints actually give us, each weighted
by how much we trust it:

| Component | Weight | Band | Why |
|---|---|---|---|
| Field size | 0.4 | log, 25 → 2500 finishers | The one input with no parsing risk. Log because 25→250 says as much as 250→2500 |
| Winner pace | 0.35 | 0.6–1.0 × a 15:00 5K, Riegel-scaled to the distance | Where a local race stops being a fun run |
| Depth | 0.25 | median finish 2.6× → 1.5× the winner | Dimensionless, so it works at any distance. Least weight: one slow winner skews the whole ratio |

Decisions worth their own line:

- **The scoring unit is the race's biggest event**, not the race — field size,
  winner and median all describe the same start line instead of blending a 5K
  with the half beside it. Editions group by parsed distance (event ids and
  names churn year to year; distances don't), and by event name where the
  distance never parsed, which keeps a race's triathlon and duathlon apart.
  Medians across years, per the median-not-mean habit.
- **Missing components renormalize, they don't score zero.** A race with no
  parsed distance is scored on field + depth over `0.65`, not punished for a
  gap in our parser.
- **Components drop out when the number behind them is a tautology.** Depth
  needs at least 10 finishers: at a field of one the median *is* the winner, a
  free 1.0× that scored four-person charity walks as the deepest fields in the
  county before the floor went in.
- **The pace component is gated on plausibility, not trusted.** Outside
  0.4–1.1 × the benchmark the row isn't a running result: above it sit
  triathlons whose "distance" is swim+bike+run summed and virtual races where
  someone logged a 3:52 5K; below it sit mis-parsed distances. Those drop the
  component instead of scoring 100 or 0. The fastest real local winner in the
  data sits at 1.04, so the gate has headroom.
- **The scale is absolute, not a curve over this metro.** Nothing in South
  Florida currently breaks 80; a genuinely elite field would. A relative scale
  would silently redefine "competitive" every time the DB grows.
- **`competitiveness_inputs` stores every number that produced the score** —
  components, raw medians, benchmark, weights, years, and a `version` to bump
  when a band moves. A bare `73` is not something a runner should have to
  trust blind, and the UI is expected to show the why.
- **The stage always recomputes.** No network, no tokens, milliseconds for the
  whole table — so there's nothing to skip, it's safe to re-run after any band
  change, and it's the only way the NULL state stays truthful when results
  change upstream. Stale scores for races whose results vanished are cleared
  in the same transaction.

Two thirds of races (116 of 182 today) publish no results at all. That NULL is
the majority case, not an edge case: it is stored as NULL rather than 0, and
`/debug` shows `—` for "nothing published" versus `n/a` for "published, but
nothing usable in it".

## Deliberately out (v1)

Course elevation/USATF data, second listing sources, email alerts, reviews,
metros beyond South Florida, an ORM, a job queue, hand-rolled auth. See
GOAL.md's scope fence.
