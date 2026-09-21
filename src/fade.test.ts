// The fade only ever makes the critic quieter, so every test here is really
// asking the same question: can it be made quiet by something that is not
// evidence of learning?
//
//   node --experimental-strip-types --test src/fade.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { SETTLED_REPS, settled, faded } from "./fade.ts";
import { AGAIN, HARD, GOOD, EASY, type Memory } from "./recall.ts";
import type { Finding, Severity } from "./critic.ts";

const DIGEST = "abc123";

function memory(over: Partial<Memory> = {}): Memory {
  return {
    state: "review",
    step: null,
    stability: 12,
    difficulty: 5,
    due: new Date(Date.now() + 86_400_000).toISOString(),
    last: new Date().toISOString(),
    reps: SETTLED_REPS,
    lapses: 0,
    lastRating: GOOD,
    ...over,
  };
}

test("a slide nobody has studied is never settled", () => {
  assert.equal(settled(undefined, DIGEST, undefined), false);
  assert.equal(settled(memory(), DIGEST, undefined), false);
});

test("rewriting the slide takes its quiet away", () => {
  assert.equal(settled(memory(), DIGEST, DIGEST), true);
  assert.equal(settled(memory(), "rewritten", DIGEST), false);
});

test("a slide still on the learning ladder is not settled", () => {
  assert.equal(settled(memory({ state: "learning", step: 1 }), DIGEST, DIGEST), false);
  assert.equal(settled(memory({ state: "relearning", step: 0 }), DIGEST, DIGEST), false);
});

test("one or two reviews is not a record", () => {
  for (let reps = 0; reps < SETTLED_REPS; reps++) {
    assert.equal(settled(memory({ reps }), DIGEST, DIGEST), false, `reps=${reps}`);
  }
  assert.equal(settled(memory({ reps: SETTLED_REPS }), DIGEST, DIGEST), true);
});

test("only a good recall counts - struggling through it does not", () => {
  assert.equal(settled(memory({ lastRating: AGAIN }), DIGEST, DIGEST), false);
  assert.equal(settled(memory({ lastRating: HARD }), DIGEST, DIGEST), false);
  assert.equal(settled(memory({ lastRating: GOOD }), DIGEST, DIGEST), true);
  assert.equal(settled(memory({ lastRating: EASY }), DIGEST, DIGEST), true);
  assert.equal(settled(memory({ lastRating: undefined }), DIGEST, DIGEST), false);
});

const finding = (severity: Severity): Finding => ({
  id: severity,
  severity,
  quote: "q",
  problem: "p",
  fix_hint: "h",
  basis: "knowledge",
  slideKey: "s1",
});

test("fading never silences anything that blocks the export", () => {
  const all = [finding("error"), finding("jargon"), finding("note"), finding("probe")];
  const kept = faded(all).map((f) => f.severity);

  assert.ok(kept.includes("error"), "error must survive - a confidently recalled wrong slide is the failure mode");
  assert.ok(kept.includes("jargon"), "jargon must survive - self-graded recall is no defence against a chunk label");
  assert.ok(kept.includes("probe"), "probe must survive - going deeper is what a settled slide is for");
  assert.ok(!kept.includes("note"), "note is the one that fades");
});
