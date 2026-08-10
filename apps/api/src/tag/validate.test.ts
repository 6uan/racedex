import assert from "node:assert/strict";
import test from "node:test";
import { tagWithRetry } from "./validate";
import type { TagInput, TagProvider } from "./provider";

// tagWithRetry is the validation gate that sits outside every provider:
// these tests drive it with a fake provider to pin the acceptance behavior
// from issue #6 — invalid responses retried once, then flagged, never thrown.

const input: TagInput = {
  name: "Test 5K",
  city: "Miami",
  state: "FL",
  eventNames: ["5K"],
  description: null,
};

function fakeProvider(responses: unknown[]): TagProvider & { calls: number } {
  const provider = {
    name: "fake",
    model: "fake-1",
    promptVersion: 1,
    calls: 0,
    async tagRace() {
      const response = responses[provider.calls];
      provider.calls++;
      return response;
    },
  };
  return provider;
}

test("valid response tags on the first attempt", async () => {
  const provider = fakeProvider([{ tags: ["road", "holiday"] }]);
  const outcome = await tagWithRetry(provider, input);
  assert.deepEqual(outcome, {
    status: "tagged",
    tags: ["road", "holiday"],
    attempts: 1,
  });
  assert.equal(provider.calls, 1);
});

test("schema-invalid response is retried once, then accepted", async () => {
  const provider = fakeProvider([
    { tags: ["marathon-vibes"] }, // not in the vocabulary
    { tags: ["trail"] },
  ]);
  const outcome = await tagWithRetry(provider, input);
  assert.deepEqual(outcome, { status: "tagged", tags: ["trail"], attempts: 2 });
});

test("two invalid responses flag the race, no third call", async () => {
  const provider = fakeProvider([null, { tags: "road" }, { tags: ["road"] }]);
  const outcome = await tagWithRetry(provider, input);
  assert.deepEqual(outcome, { status: "invalid", attempts: 2 });
  assert.equal(provider.calls, 2);
});

test("tags are deduped and ordered by vocabulary position", async () => {
  const provider = fakeProvider([
    { tags: ["not_a_run", "road", "road", "holiday"] },
  ]);
  const outcome = await tagWithRetry(provider, input);
  assert.equal(outcome.status, "tagged");
  assert.deepEqual(
    outcome.status === "tagged" && outcome.tags,
    ["road", "holiday", "not_a_run"],
  );
});

test("empty tags array is a valid result", async () => {
  const provider = fakeProvider([{ tags: [] }]);
  const outcome = await tagWithRetry(provider, input);
  assert.deepEqual(outcome, { status: "tagged", tags: [], attempts: 1 });
});
