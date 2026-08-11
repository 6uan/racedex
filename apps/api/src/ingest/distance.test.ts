import test from "node:test";
import assert from "node:assert/strict";
import { parseDistanceMeters } from "./distance";

test("distances parse from event text; ambiguous ones stay null", () => {
  const cases: [string, number | null][] = [
    ["5K Run", 5000],
    ["5k", 5000],
    ["3.5K", 3500],
    ["10 km", 10000],
    ["50K Ultra", 50000],
    ["Half Marathon", 21097],
    ["Half-Marathon", 21097],
    ["13.1 miles", 21097],
    ["Marathon", 42195],
    ["26.2", 42195],
    ["3.1", 5000],
    ["6.2", 10000],
    ["10 Mile", 16093],
    ["100-Miler", 160934],
    ["1 mile", 1609],
    ["400m", 400],
    ["800 meters", 800],
    ["Magic Mile", 1609],
    ["Miler's Club 5K", 5000], // pattern order beats text order
    ["KIDS DASH 10 & UNDER", null],
    ["Fun Run", null],
    ["1M Fun Run", null], // "1M" is mile-vs-meters ambiguous — never guess
    ["Race #2", null],
    ["Sprint Triathlon", null],
  ];
  for (const [text, expected] of cases) {
    assert.equal(parseDistanceMeters(text), expected, text);
  }
});

test("first candidate with a match wins", () => {
  assert.equal(parseDistanceMeters(null, "5K Run"), 5000);
  assert.equal(parseDistanceMeters("400m", "5K Run"), 400);
  assert.equal(parseDistanceMeters("", undefined), null);
});
