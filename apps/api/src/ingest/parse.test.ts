import test from "node:test";
import assert from "node:assert/strict";
import {
  durationToSeconds,
  moneyToCents,
  stripHtml,
  usDateTimeParts,
  usDateTimeToIso,
  usDateToIso,
} from "./parse";

test("usDateToIso converts M/D/YYYY and rejects every other format", () => {
  assert.equal(usDateToIso("10/17/2026"), "2026-10-17");
  assert.equal(usDateToIso("7/4/2026"), "2026-07-04");
  assert.equal(usDateToIso("Oct 17, 2026"), null);
  assert.equal(usDateToIso(null), null);
});

test("date-time parsing needs both halves and zero-pads the hour", () => {
  assert.deepEqual(usDateTimeParts("10/17/2026 07:30"), {
    date: "2026-10-17",
    time: "07:30",
  });
  assert.deepEqual(usDateTimeParts("7/4/2026 7:30"), {
    date: "2026-07-04",
    time: "07:30",
  });
  assert.equal(usDateTimeParts("10/17/2026"), null);
  assert.equal(usDateTimeToIso("7/27/2026 10:00"), "2026-07-27T10:00");
  assert.equal(usDateTimeToIso(null), null);
});

test("moneyToCents reads commas and bare dollars, nulls non-numeric", () => {
  assert.equal(moneyToCents("$15.00"), 1500);
  assert.equal(moneyToCents("$1,250.50"), 125050);
  assert.equal(moneyToCents("$0.00"), 0);
  assert.equal(moneyToCents("15"), 1500);
  assert.equal(moneyToCents("Free"), null);
  assert.equal(moneyToCents(null), null);
});

test("durationToSeconds rounds fractions and reads mm:ss or h:mm:ss", () => {
  assert.equal(durationToSeconds("18:30.02"), 1110);
  assert.equal(durationToSeconds("18:40.9"), 1121);
  assert.equal(durationToSeconds("1:02:33"), 3753);
  assert.equal(durationToSeconds("58:12"), 3492);
  assert.equal(durationToSeconds("DNF"), null);
  assert.equal(durationToSeconds(""), null);
  assert.equal(durationToSeconds(null), null);
});

test("stripHtml decodes entities, breaks blocks into lines, nulls empties", () => {
  assert.equal(stripHtml("<p>Hi &amp; bye</p>"), "Hi & bye");
  assert.equal(stripHtml("<p>a</p><p>b</p>"), "a\nb");
  assert.equal(stripHtml("Kids&#39; Dash&nbsp;5K"), "Kids' Dash 5K");
  assert.equal(stripHtml("<div><ul><li>one</li><li>two</li></ul></div>"), "one\ntwo");
  assert.equal(stripHtml("<div>  </div>"), null);
  assert.equal(stripHtml(null), null);
});
