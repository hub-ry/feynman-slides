// The FSRS port, checked against the algorithm it claims to be.
//
// `recall.fixture.json` was produced by transcribing the formulas out of
// open-spaced-repetition/py-fsrs `fsrs/scheduler.py` and running them in
// Python. If one of these fails, the port has drifted from FSRS-6 - not the
// other way round. Regenerating the fixture to make a test pass is the one
// thing you must not do here.
//
//   node --experimental-strip-types --test src/recall.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AGAIN,
  HARD,
  GOOD,
  EASY,
  DECAY,
  FACTOR,
  DESIRED_RETENTION,
  type Memory,
  type Rating,
  newMemory,
  grade,
  preview,
  isDue,
  human,
  retrievability,
  initialStability,
  initialDifficulty,
  intervalDays,
  nextDifficulty,
  shortTermStability,
  forgetStability,
  recallStability,
} from "./recall.ts";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "recall.fixture.json"), "utf8"),
) as Record<string, any>;

/** Floats crossing a JSON file and two exp() chains. Tighter than this is noise. */
const near = (a: number, b: number, what: string) =>
  assert.ok(
    Math.abs(a - b) < 1e-9,
    `${what}: got ${a}, reference says ${b} (off by ${Math.abs(a - b)})`,
  );

test("the two derived constants match the reference", () => {
  near(FACTOR, fixture.factor, "FACTOR");
  near(DECAY, fixture.decay, "DECAY");
});

test("initial stability is w[grade - 1]", () => {
  for (const g of [1, 2, 3, 4] as Rating[]) {
    near(initialStability(g), fixture.initialStability[String(g)], `S0(${g})`);
  }
});

test("initial difficulty matches, including the clamp at Easy", () => {
  for (const g of [1, 2, 3, 4] as Rating[]) {
    near(initialDifficulty(g), fixture.initialDifficulty[String(g)], `D0(${g})`);
  }
  // Easy comes out below 1 before clamping, so this is the clamp being exercised
  // rather than an arithmetic coincidence.
  assert.equal(initialDifficulty(EASY), 1.0);
  assert.ok(initialDifficulty(EASY, false) < 1.0);
});

test("intervals match", () => {
  for (const [s, days] of Object.entries(fixture.interval)) {
    assert.equal(intervalDays(Number(s)), days, `I(${s})`);
  }
});

test("the forgetting curve matches, and hits 0.9 at t = S", () => {
  for (const [key, r] of Object.entries(fixture.retrievability)) {
    const [t, s] = key.split("|").map(Number);
    const m: Memory = {
      state: "review",
      step: null,
      stability: s!,
      difficulty: 5,
      due: "",
      last: new Date(0).toISOString(),
      reps: 1,
      lapses: 0,
    };
    near(retrievability(m, new Date(t! * 86_400_000)), r as number, `R(${key})`);
  }

  // The property FACTOR exists to guarantee.
  const m: Memory = {
    state: "review",
    step: null,
    stability: 12,
    difficulty: 5,
    due: "",
    last: new Date(0).toISOString(),
    reps: 1,
    lapses: 0,
  };
  near(retrievability(m, new Date(12 * 86_400_000)), 0.9, "R at t = S");
});

test("difficulty update matches at the boundaries and in the middle", () => {
  for (const [key, want] of Object.entries(fixture.nextDifficulty)) {
    const [d, g] = key.split("|").map(Number);
    near(nextDifficulty(d!, g as Rating), want as number, `D'(${key})`);
  }
});

test("same-day stability matches, and never drops at Good or above", () => {
  for (const [key, want] of Object.entries(fixture.shortTerm)) {
    const [s, g] = key.split("|").map(Number);
    near(shortTermStability(s!, g as Rating), want as number, `S_short(${key})`);
  }
  for (const g of [HARD, GOOD, EASY] as Rating[]) {
    assert.ok(shortTermStability(4.2, g) >= 4.2, `same-day ${g} lost stability`);
  }
});

test("post-lapse and post-recall stability match", () => {
  for (const [key, want] of Object.entries(fixture.forget)) {
    const [d, s, r] = key.split("|").map(Number);
    near(forgetStability(d!, s!, r!), want as number, `S_forget(${key})`);
  }
  for (const [key, want] of Object.entries(fixture.recall)) {
    const [d, s, r, g] = key.split("|").map(Number);
    near(recallStability(d!, s!, r!, g as Rating), want as number, `S_recall(${key})`);
  }
});

// --- Behaviour, rather than arithmetic -------------------------------------

test("a new slide is due immediately and has no memory yet", () => {
  const m = newMemory(new Date("2026-01-01T00:00:00Z"));
  assert.equal(m.stability, null);
  assert.equal(m.difficulty, null);
  assert.ok(isDue(m, new Date("2026-01-01T00:00:00Z")));
  assert.equal(retrievability(m), 0, "never reviewed is not 'certain to recall'");
});

test("failing a new slide brings it back in a minute, not a day", () => {
  const at = new Date("2026-01-01T09:00:00Z");
  const after = grade(newMemory(at), AGAIN, at);
  assert.equal(after.state, "learning");
  assert.equal(new Date(after.due).getTime() - at.getTime(), 60_000);
});

test("Good twice graduates a slide to day-scale intervals", () => {
  let at = new Date("2026-01-01T09:00:00Z");
  let m = grade(newMemory(at), GOOD, at);
  assert.equal(m.state, "learning", "one Good is still learning");

  at = new Date(at.getTime() + 10 * 60_000);
  m = grade(m, GOOD, at);
  assert.equal(m.state, "review");
  assert.equal(m.step, null);
  assert.ok(new Date(m.due).getTime() - at.getTime() >= 86_400_000, "graduated into days");
});

test("Easy graduates straight away and lands further out than Good", () => {
  const at = new Date("2026-01-01T09:00:00Z");
  const easy = grade(newMemory(at), EASY, at);
  assert.equal(easy.state, "review");

  let good = grade(newMemory(at), GOOD, at);
  good = grade(good, GOOD, new Date(at.getTime() + 10 * 60_000));
  assert.ok(
    new Date(easy.due).getTime() > new Date(good.due).getTime(),
    "Easy should buy more time than two Goods",
  );
});

test("blanking on a mature slide costs a lapse and drops it into relearning", () => {
  const start = new Date("2026-01-01T09:00:00Z");
  let m = grade(newMemory(start), EASY, start);
  const wasStability = m.stability!;

  const later = new Date(new Date(m.due).getTime());
  m = grade(m, AGAIN, later);

  assert.equal(m.state, "relearning");
  assert.equal(m.lapses, 1);
  assert.ok(m.stability! < wasStability, "a lapse must not raise stability");
  assert.ok(m.stability! > 0, "and must not wipe it either - you knew it once");
  assert.equal(new Date(m.due).getTime() - later.getTime(), 10 * 60_000);
});

test("the intervals the four buttons offer are strictly increasing", () => {
  const start = new Date("2026-01-01T09:00:00Z");
  let m = grade(newMemory(start), GOOD, start);
  m = grade(m, GOOD, new Date(start.getTime() + 10 * 60_000));

  const at = new Date(m.due);
  const p = preview(m, at);
  assert.ok(p[AGAIN] < p[HARD], "Again must come back sooner than Hard");
  assert.ok(p[HARD] < p[GOOD], "Hard must come back sooner than Good");
  assert.ok(p[GOOD] < p[EASY], "Good must come back sooner than Easy");
});

test("a slide recalled when it was nearly forgotten gains more than one recalled early", () => {
  // Bjork's desirable difficulty, as the model states it: the stability gain
  // scales with (1 - retrievability). If this inverts, the whole point of
  // spacing has gone.
  const start = new Date("2026-01-01T09:00:00Z");
  let base = grade(newMemory(start), GOOD, start);
  base = grade(base, GOOD, new Date(start.getTime() + 10 * 60_000));

  const due = new Date(base.due).getTime();
  const early = grade(base, GOOD, new Date(due - 5 * 86_400_000));
  const late = grade(base, GOOD, new Date(due + 20 * 86_400_000));

  assert.ok(
    late.stability! > early.stability!,
    `late recall (${late.stability}) should beat early recall (${early.stability})`,
  );
});

test("repeated Good over months pushes the interval out, not in", () => {
  let at = new Date("2026-01-01T09:00:00Z");
  let m = grade(newMemory(at), GOOD, at);
  at = new Date(at.getTime() + 10 * 60_000);
  m = grade(m, GOOD, at);

  let last = 0;
  for (let i = 0; i < 8; i += 1) {
    at = new Date(m.due);
    const span = at.getTime() - new Date(m.last!).getTime();
    assert.ok(span > last, `review ${i}: interval shrank (${span} <= ${last})`);
    last = span;
    m = grade(m, GOOD, at);
  }
  assert.ok(m.stability! > 30, "eight clean recalls should be worth more than a month");
});

test("desired retention is the default FSRS asks for", () => {
  assert.equal(DESIRED_RETENTION, 0.9);
});

test("human() reads like a person wrote it", () => {
  assert.equal(human(0), "now");
  assert.equal(human(60_000), "1 min");
  assert.equal(human(90 * 60_000), "2 hr");
  assert.equal(human(3 * 86_400_000), "3 d");
  assert.equal(human(90 * 86_400_000), "3 mo");
  assert.equal(human(500 * 86_400_000), "1.4 yr");
});
