// Public URL shape. Shared because both halves mint URLs: the API returns
// canonical paths and 301 targets, the web app builds links. See PLAN.md.
//
// The slug is a PURE FUNCTION OF ONE RACE — its own name plus its natural key,
// no corpus knowledge, no persisted state, no counters, no insertion order.
// Rebuildability means a stored slug column would be destroyed by a routine
// migration, and a conditional "-2" collision suffix would let a race ingested
// later change an existing race's URL.

export const METRO_SLUG = "south-florida";

// Measured over the first ingest: median slug 34 chars, p90 47, longest 85.
// Cutting at 50 introduces zero new name-slug collisions; cutting at 40
// introduces two. 50 is the shortest cut that costs no readability.
const MAX_SLUG_LENGTH = 50;

// Combining marks left behind by NFKD. Written as an explicit range rather
// than \p{Diacritic} so the regex compiles without a unicode-aware target.
const COMBINING_MARKS = /[̀-ͯ]/g;

// Dropped without leaving a separator, so "Alfredo’s" slugs to "alfredos"
// rather than "alfredo-s". U+2019 is what RunSignup actually sends.
const APOSTROPHES = /['‘’ʼ]/g;

// Bare trailing digits mean runsignup BY DEFINITION of this route. RunSignup
// earned every inbound link, so it keeps the clean URLs; a second source gets
// a code in this map and a prefixed form ("-ac12345"), and bare-digit URLs
// stay grandfathered. Nothing already published ever has to move.
//
// Two numeric sources can't collide here even when both hold id 12345: this
// map is what disambiguates, and races.id ('<source>:<source_race_id>') keeps
// them distinct rows in the DB.
const SOURCE_BY_CODE: Record<string, string | undefined> = {
  "": "runsignup",
};

// Anchored at the end, so a race name that itself ends in digits is harmless:
// "Gobbler ... FL (47)" + id 173193 slugs to "...-fl-47-173193" and the ID
// still wins. When series URLs land (post-v1), match known series slugs FIRST
// and fall through to here — a series slug ending in digits would otherwise
// look like a detail URL.
const DETAIL_SUFFIX = /-([a-z]{0,6})(\d+)$/;

/**
 * Race name → URL-safe slug. Total: always returns a non-empty string.
 */
export function raceSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(APOSTROPHES, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    // Folds everything else — "•", "#", "/", ",", "!", en/em dashes, and the
    // double spaces RunSignup leaves in names — into single separators.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return truncateOnWord(base) || "race";
}

function truncateOnWord(slug: string): string {
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1);
  const lastDash = cut.lastIndexOf("-");
  const kept = lastDash > 0 ? cut.slice(0, lastDash) : slug.slice(0, MAX_SLUG_LENGTH);
  return kept.replace(/-+$/, "");
}

/**
 * The canonical path for a race. Anything else that resolves to the same race
 * should 301 here — covers both a duplicate name and a RunSignup rename.
 */
export function raceUrl(race: { id: string; name: string }): string {
  return `/${METRO_SLUG}/${raceSegment(race)}`;
}

/**
 * Just the identifying segment — what parseRaceUrl reads back. Split out
 * because the read API mints its own canonical path (`/api/races/<segment>`)
 * off the same rule, and string-splitting a web path to get there would let
 * the two drift.
 */
export function raceSegment(race: { id: string; name: string }): string {
  const [source, sourceRaceId] = splitNaturalKey(race.id);
  const code = codeForSource(source);
  return `${raceSlug(race.name)}-${code}${sourceRaceId}`;
}

/**
 * The last path segment of a detail URL → a race's natural key, or null if the
 * segment isn't a detail URL at all. The name portion is deliberately ignored:
 * "/south-florida/anything-at-all-12345" resolves, then canonicalizes.
 */
export function parseRaceUrl(segment: string): string | null {
  const match = segment.match(DETAIL_SUFFIX);
  if (!match) return null;
  const source = SOURCE_BY_CODE[match[1] ?? ""];
  return source ? `${source}:${match[2]}` : null;
}

function splitNaturalKey(id: string): [string, string] {
  const colon = id.indexOf(":");
  if (colon === -1) return ["runsignup", id];
  return [id.slice(0, colon), id.slice(colon + 1)];
}

function codeForSource(source: string): string {
  for (const [code, name] of Object.entries(SOURCE_BY_CODE)) {
    if (name === source) return code;
  }
  throw new Error(`no URL code registered for source '${source}'`);
}
