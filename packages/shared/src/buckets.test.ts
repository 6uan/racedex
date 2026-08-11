import test from "node:test";
import assert from "node:assert/strict";
import {
  BUCKET_SLUGS,
  DISTANCE_BUCKETS,
  INDEXED_BUCKETS,
  distanceBucket,
  isBucketSlug,
} from "./buckets";

// Every number below is a real distance_m from the first South Florida ingest.

test("road distances land in their bucket", () => {
  const cases: [number, string][] = [
    [1000, "1k"],
    [1609, "mile"],
    [5000, "5k"],
    [10000, "10k"],
    [42195, "marathon"],
    [50000, "50k"], // KEYS100 "50 Kilometer Individual Ultra"
    [80467, "50-mile"],
    [160934, "100-mile"],
  ];
  for (const [meters, slug] of cases) {
    assert.equal(distanceBucket(meters), slug, String(meters));
  }
});

test("8K and 5 Mile share one bucket", () => {
  // "KENNEDY KIDS 8K RUN" and Dunn's Run "5 Mile Run" are the same slot.
  assert.equal(distanceBucket(8000), "8k");
  assert.equal(distanceBucket(8047), "8k");
});

test("every spelling of a half marathon lands in one bucket", () => {
  // The parser emits 21000 for "1/2 Marathon", 21097 for "Half Marathon",
  // and the corpus holds one stray 21098.
  for (const meters of [21000, 21097, 21098]) {
    assert.equal(distanceBucket(meters), "half-marathon", String(meters));
  }
});

test("multisport and step-challenge distances are not running buckets", () => {
  // The reason every band is closed on both ends. Each of these sits close
  // enough to a real road distance that a tolerant band would swallow it.
  const cases: [number, string][] = [
    [1500, "open-water metric mile, 109m under a mile"],
    [3000, "Move for Hope Step/Ride 3K/day"],
    [4345, "The 2.7 'Not quite as Funky Run'"],
    [8690, "The 5.4 Funky Run"],
    [25347, "Sprint Triathlon, swim+bike+run summed"],
    [26554, "Sprint Duathlon"],
    [40000, "Step/Ride 40K/week"],
    [41360, "Olympic Aquabike, 835m under a marathon"],
    [51338, "Olympic Triathlon, 338m over a 50K"],
    [51499, "Olympic Duathlon"],
    [70000, "Step/Ride 70K/day"],
    [90000, "Step/Ride 90K/day"],
    [292579, "Frankenfit '181.8 miles' virtual challenge"],
  ];
  for (const [meters, why] of cases) {
    assert.equal(distanceBucket(meters), null, `${meters} — ${why}`);
  }
});

test("kids dashes are not running buckets", () => {
  for (const meters of [200, 400, 402, 483, 500, 805]) {
    assert.equal(distanceBucket(meters), null, String(meters));
  }
});

test("an unparsed distance has no bucket", () => {
  // 63 events in the first ingest, plus stair climbs and curling.
  assert.equal(distanceBucket(null), null);
  assert.equal(distanceBucket(undefined), null);
});

test("bands do not overlap", () => {
  const sorted = [...DISTANCE_BUCKETS].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    assert.ok(prev.max < next.min, `${prev.slug} overlaps ${next.slug}`);
  }
});

test("every indexed bucket is a real bucket", () => {
  for (const slug of INDEXED_BUCKETS) {
    assert.ok(isBucketSlug(slug), slug);
  }
  assert.ok(INDEXED_BUCKETS.length < BUCKET_SLUGS.length);
});
