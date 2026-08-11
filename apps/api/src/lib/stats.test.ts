import test from "node:test";
import assert from "node:assert/strict";
import { median } from "./stats";

test("median averages the middle pair on even input, null on empty", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([61.5, 60.5]), 61);
});
