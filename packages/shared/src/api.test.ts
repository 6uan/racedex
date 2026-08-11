import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EXCLUDED_TAGS, RaceListQuerySchema } from "./api";
import { BUCKET_SLUGS, INDEXED_BUCKETS } from "./buckets";
import { TAG_VALUES } from "./tags";

// Query params arrive as strings — every input below is what Express actually
// hands over from a real query string.

function issuesOf(query: Record<string, unknown>): { path: string; message: string }[] {
  const parsed = RaceListQuerySchema.safeParse(query);
  assert.ok(!parsed.success, "expected the query to be rejected");
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

test("an empty query hides past races and non-runs", () => {
  // The two settled defaults, and the only two. 182 races become 159.
  assert.deepEqual(RaceListQuerySchema.parse({}), {
    exclude: ["not_a_run"],
    includePast: false,
    sort: "date",
    limit: 50,
    offset: 0,
  });
});

test("virtual is not excluded by default", () => {
  // 51 of the 60 virtual-tagged races also carry `road` and have a real gun
  // time — they are in-person races that also sell a virtual entry. Excluding
  // the tag would drop the 18th Annual Levis JCC Turkey Trot, which is the
  // joint-highest-scored race in the corpus at 75.
  assert.ok(!DEFAULT_EXCLUDED_TAGS.includes("virtual"));
  assert.deepEqual([...DEFAULT_EXCLUDED_TAGS], ["not_a_run"]);
});

test("a caller can turn each default off independently", () => {
  assert.deepEqual(RaceListQuerySchema.parse({ exclude: "" }).exclude, []);
  assert.equal(RaceListQuerySchema.parse({ includePast: "true" }).includePast, true);
  // Bare `?includePast` is HTML-form idiom for true.
  assert.equal(RaceListQuerySchema.parse({ includePast: "" }).includePast, true);
  assert.equal(RaceListQuerySchema.parse({ includePast: "0" }).includePast, false);
});

test("a caller can opt in to the stricter exclusion the issue proposed", () => {
  // Rejected as a default, but nothing stops someone asking for it.
  assert.deepEqual(RaceListQuerySchema.parse({ exclude: "not_a_run,virtual" }).exclude, [
    "not_a_run",
    "virtual",
  ]);
});

test("an unknown distance is rejected with the twelve it could have been", () => {
  const [issue] = issuesOf({ distance: "5km" });
  assert.equal(issue?.path, "distance");
  for (const slug of BUCKET_SLUGS) {
    assert.ok(issue?.message.includes(slug), `${slug} missing from: ${issue?.message}`);
  }
});

test("the distance filter accepts distances that have no index page", () => {
  // The API surface is deliberately wider than the URL space (PLAN.md):
  // /south-florida/marathon 404s, ?distance=marathon lists three races.
  for (const slug of BUCKET_SLUGS) {
    assert.equal(RaceListQuerySchema.parse({ distance: slug }).distance, slug);
  }
  assert.ok(INDEXED_BUCKETS.length < BUCKET_SLUGS.length);
});

test("a bad tag in a list reports its own position", () => {
  const [issue] = issuesOf({ exclude: "road,vitual" });
  assert.equal(issue?.path, "exclude.1");
  for (const tag of TAG_VALUES) {
    assert.ok(issue?.message.includes(tag), `${tag} missing from: ${issue?.message}`);
  }
});

test("a tag list tolerates the spacing a human types", () => {
  assert.deepEqual(RaceListQuerySchema.parse({ tags: "road, trail ," }).tags, [
    "road",
    "trail",
  ]);
});

test("a misspelled param is an error, not a silently ignored filter", () => {
  // ?distence=5k quietly returning all 159 races is the worse failure.
  const [issue] = issuesOf({ distence: "5k" });
  assert.equal(issue?.path, "");
  assert.match(issue?.message ?? "", /distence/);
});

test("numeric filters are rejected outside their real range", () => {
  assert.equal(issuesOf({ maxHeat: "6" })[0]?.path, "maxHeat");
  assert.equal(issuesOf({ maxHeat: "0" })[0]?.path, "maxHeat");
  assert.equal(issuesOf({ minCompetitiveness: "101" })[0]?.path, "minCompetitiveness");
  assert.equal(issuesOf({ maxPriceCents: "-1" })[0]?.path, "maxPriceCents");
  assert.equal(issuesOf({ limit: "500" })[0]?.path, "limit");
  // Nothing in the corpus scores above 75, but 100 is the scale's top.
  assert.equal(RaceListQuerySchema.parse({ minCompetitiveness: "100" }).minCompetitiveness, 100);
});

test("a month must be a real year-month", () => {
  assert.equal(RaceListQuerySchema.parse({ month: "2026-11" }).month, "2026-11");
  for (const bad of ["2026-13", "2026-00", "11", "2026-1", "nov"]) {
    assert.match(issuesOf({ month: bad })[0]?.message ?? "", /YYYY-MM/, bad);
  }
});

test("money crosses the wire in cents", () => {
  // Named for its unit: maxPrice=5000 reading as $50 is exactly the ambiguity
  // that puts a $50 filter on a $5,000 race.
  assert.equal(RaceListQuerySchema.parse({ maxPriceCents: "3500" }).maxPriceCents, 3500);
  assert.equal(issuesOf({ maxPriceCents: "35.50" })[0]?.path, "maxPriceCents");
});
