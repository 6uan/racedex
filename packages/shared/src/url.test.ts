import test from "node:test";
import assert from "node:assert/strict";
import { METRO_SLUG, parseRaceUrl, raceSlug, raceUrl } from "./url";
import { BUCKET_SLUGS } from "./buckets";

// Every name below is a real row from the first South Florida ingest.

test("duplicate race names get distinct URLs with no tie-breaking suffix", () => {
  // Three live editions of one recurring race, same name, same city.
  const editions = [
    { id: "runsignup:207981", name: "Sunrise Marathon 5K/10K/13.1 MIAMI" },
    { id: "runsignup:210567", name: "Sunrise Marathon 5K/10K/13.1 MIAMI" },
    { id: "runsignup:211556", name: "Sunrise Marathon 5K/10K/13.1 MIAMI" },
  ];
  const urls = editions.map(raceUrl);

  assert.deepEqual(urls, [
    "/south-florida/sunrise-marathon-5k-10k-13-1-miami-207981",
    "/south-florida/sunrise-marathon-5k-10k-13-1-miami-210567",
    "/south-florida/sunrise-marathon-5k-10k-13-1-miami-211556",
  ]);
});

test("a race's URL does not depend on what else has been ingested", () => {
  // The property a conditional "-2" suffix cannot offer: ingesting a fourth
  // edition tomorrow must not move the first one.
  const first = { id: "runsignup:207981", name: "Sunrise Marathon 5K/10K/13.1 MIAMI" };
  const alone = raceUrl(first);

  const laterCorpus = [
    first,
    { id: "runsignup:210567", name: "Sunrise Marathon 5K/10K/13.1 MIAMI" },
    { id: "runsignup:999999", name: "Sunrise Marathon 5K/10K/13.1 MIAMI" },
  ];
  assert.equal(raceUrl(laterCorpus[0]!), alone);
});

test("a renamed race keeps resolving, then canonicalizes", () => {
  // The common case is not a duplicate name — it is RunSignup renaming a race
  // between ingests. The old link must resolve, not 404.
  const renamed = { id: "runsignup:207981", name: "Sunrise Half Marathon Miami" };

  assert.equal(
    parseRaceUrl("sunrise-marathon-5k-10k-13-1-miami-207981"),
    "runsignup:207981",
  );
  assert.equal(parseRaceUrl("totally-different-name-207981"), "runsignup:207981");
  // ...and the API 301s to whatever the name is now.
  assert.equal(raceUrl(renamed), "/south-florida/sunrise-half-marathon-miami-207981");
});

test("messy race names slug cleanly", () => {
  const cases: [string, string][] = [
    // U+2019 apostrophe: no separator left behind.
    ["Alfredo’s Birthday 5K Run / Walk", "alfredos-birthday-5k-run-walk"],
    ["AVDA's 27th Annual Race for Hope", "avdas-27th-annual-race-for-hope"],
    // "&" carries meaning, so it becomes a word rather than vanishing.
    ["Gobbler 5K & 10K at Hollywood, FL (47)", "gobbler-5k-and-10k-at-hollywood-fl-47"],
    // "•" and "#" fold to separators; this one also truncates.
    [
      "Virtual Fitness Group #VFGSTRONG Veteran Fitness • Mental Health • Accountability",
      "virtual-fitness-group-vfgstrong-veteran-fitness",
    ],
    // The doubled spaces RunSignup leaves in names collapse to one separator.
    [
      "Move for Hope  1K • 5K • 10K • Half Marathon Virtual Races",
      "move-for-hope-1k-5k-10k-half-marathon-virtual",
    ],
    ["The 5.4 Funky Run", "the-5-4-funky-run"],
    ["2nd Annual Rock the Climb", "2nd-annual-rock-the-climb"],
  ];
  for (const [name, expected] of cases) {
    assert.equal(raceSlug(name), expected, name);
  }
});

test("long names truncate on a word boundary", () => {
  // 86 chars, the longest in the corpus.
  const slug = raceSlug(
    "Rosenhaus Sports Representation Presents the Kennedy Kids Foundation 4th Annual 5K/8K!",
  );
  assert.equal(slug, "rosenhaus-sports-representation-presents-the");
  assert.ok(slug.length <= 50);
  assert.ok(!slug.endsWith("-"));
});

test("a name with nothing sluggable still yields a URL", () => {
  assert.equal(raceSlug("!!! ••• ???"), "race");
  assert.equal(
    raceUrl({ id: "runsignup:12345", name: "•••" }),
    "/south-florida/race-12345",
  );
});

test("no race name can collide with a distance bucket route", () => {
  // Bucket slugs and (post-v1) series slugs share `/<metro>/<segment>`, so
  // they are reserved words. Detail URLs are safe by construction — they
  // always end in "-<digits>" — but this guards the reservation.
  for (const slug of BUCKET_SLUGS) {
    assert.equal(parseRaceUrl(slug), null, slug);
  }
  assert.equal(parseRaceUrl(`/${METRO_SLUG}/5k`.split("/").pop()!), null);
});

test("parseRaceUrl rejects anything that is not a detail segment", () => {
  for (const segment of ["", "-", "turkey-trot", "5k", "half-marathon", "12345"]) {
    assert.equal(parseRaceUrl(segment), null, JSON.stringify(segment));
  }
});

test("a race name ending in digits does not shadow the trailing ID", () => {
  assert.equal(
    parseRaceUrl("gobbler-5k-and-10k-at-hollywood-fl-47-173193"),
    "runsignup:173193",
  );
});

test("every canonical URL round-trips back to its natural key", () => {
  const races = [
    { id: "runsignup:204577", name: "Move for Hope  1K • 5K • 10K • Half Marathon Virtual Races" },
    { id: "runsignup:212466", name: "NWANA Nordic Walking SPORT" },
    { id: "runsignup:21878", name: "KEYS100 Ultramarathon" },
    { id: "runsignup:113138", name: "The 5.4 Funky Run" },
  ];
  for (const race of races) {
    const segment = raceUrl(race).split("/").pop()!;
    assert.equal(parseRaceUrl(segment), race.id, race.name);
  }
});
