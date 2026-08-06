# racedex

A race directory for South Florida runners that answers one question: **which race should I actually sign up for?**

Every race listing today shows a date, a price, and a hype blurb. None of them tell you the things that decide the race: what the weather will actually feel like at the start line, whether the course is fast, whether the field is competitive or a stroller parade, and what the race is really about (charity 5K, turkey trot, trail race, PR attempt). racedex catalogs every race in the region with those stats — a Pokédex for races.

## Why this project

1. **Personal**: I race in Miami. Dew point at gun time is the single most decision-relevant fact about a South Florida race, and no listing shows it.
2. **Gap is validated**: FindMyMarathon proves runners want weather history + course scores, but it only covers marathons/halfs. The 5K/10K local tier — where most race volume lives — has nothing.
3. **Stack I want to build with**: PocketBase + Express + better-sqlite3 + React/Tailwind, with a production Claude integration (structured extraction/classification, not a chat wrapper).

## Data sources (validated 2026-08-03)

| Source | What we get | Access |
|---|---|---|
| RunSignup REST API | Race listings by zip+radius: per-event start times, distances, registration price tiers with date windows, HTML descriptions, addresses, full prior-year event history under a stable `race_id` | Free, unauthenticated for public races, Apache-licensed docs |
| RunSignup results endpoints | Past results (field size, winner, median finish) — **only ~25-30% of local races host results here**; feature must degrade gracefully | Same API; `get-result-sets` requires `event_id` |
| Open-Meteo archive API | Hourly historical temp / dew point / humidity for any lat/lon back to 1940 | Free, no key, 10k calls/day non-commercial, CC BY 4.0 |
| Claude API (Haiku for classification) | Tags from messy race descriptions: holiday, cause, themed, trail/road, kids, fun-run vs competitive signals | Paid, pennies at this scale |

Deferred: USATF certified course DB (drop/separation), GPX elevation, Active/RaceRoster as additional sources.

## V1 scope

**In:**

1. **Ingestion** — Express job pulls all RunSignup races within 60mi of Miami, upserts into SQLite (races, events, price periods). Zip-centroid geocoding is fine for v1.
2. **Weather normals** — for each race's date + start hour, pull the same calendar date across the last 10 years from Open-Meteo; store median temp/dew point and a dew-point-based heat score.
3. **Claude tagging** — Haiku + structured outputs: name + description → validated JSON tags.
4. **Competitiveness score** — where prior-year results exist: field size, winner time, median finish → one score. Honest "no data yet" state otherwise.
5. **Frontend** — React + Tailwind: filterable race list (month, distance, price ceiling, max heat, tags, competitiveness) + race detail card with the weather panel.
6. **PocketBase** — auth + saved races (user data in PocketBase, pipeline data in raw SQLite).

**Out of v1** (do not creep): course elevation/USATF data, second data sources, email alerts, reviews, any metro beyond South Florida.

## The demo card (north star)

> **Coconut Grove 10K** — Feb 8 · $45 (rises to $55 Jan 15) · 10 straight years
> Historically **61°F / 55°F dew point** at the 7:00am start — one of the 5 coolest race mornings in Miami's calendar.
> Median finisher 52:00, winner 33:40 (2025, 812 finishers) — competitive field.
> Tags: road · certified-vibes · PR-friendly

## Milestones

- [ ] **Weekend 1 — Pipeline**: schema + RunSignup ingestion + weather enrichment, CLI only. Done = 100+ real races in SQLite with weather normals.
- [ ] **Weekend 2 — Intelligence**: Haiku tagging + competitiveness scoring + Express read API (filtered list, race detail).
- [ ] **Weekend 3 — Product**: React UI, PocketBase auth + saved races, seed + polish for demo.

Target: demoable by early September 2026.

## Notes

- Be polite to RunSignup: cache responses, ingest on a schedule, don't hammer.
- Open-Meteo 10k calls/day is ample if weather normals are computed once per race and cached.
- Race descriptions arrive as HTML — strip before sending to Haiku.
