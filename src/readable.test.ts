// The paste detector, against a version too slow to ship.
//
// `longestBorrowedRun` is optimised twice over - the bin is indexed once and
// cached, and a candidate start is abandoned early when the word one best-run
// along does not line up. Both are the kind of change that is correct until
// it quietly is not, and the symptom would be a paste going unreported rather
// than an exception. So the fast one is checked against an obvious slow one
// on random input.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { longestBorrowedRun } from "../public/readable.js";

type Source = { id: string; label?: string; text: string; title?: string };
type Run = { run: number; text: string; label: string };

const norm = (s: string): string[] =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** Every start against every position, no index and no pruning. */
function naive(mine: string[], sources: Source[], floor = 7): Run {
  const miss: Run = { run: 0, text: "", label: "" };
  let best = miss;
  for (const src of sources) {
    const theirs = norm(`${src.title ?? ""} ${src.text ?? ""}`);
    for (let i = 0; i < mine.length; i++) {
      for (let j = 0; j < theirs.length; j++) {
        let n = 0;
        while (i + n < mine.length && j + n < theirs.length && mine[i + n] === theirs[j + n]) n++;
        if (n > best.run) best = { run: n, text: mine.slice(i, i + n).join(" "), label: src.label ?? "" };
      }
    }
  }
  return best.run >= floor ? best : miss;
}

const VOCAB =
  "the a of and hash table stores key value pairs array buckets collisions chaining probing load factor doubles rehashed linear amortised".split(
    " ",
  );
const words = (n: number) => Array.from({ length: n }, () => VOCAB[Math.floor(Math.random() * VOCAB.length)]!);

test("the fast scan finds exactly what the slow one finds", () => {
  for (let trial = 0; trial < 3000; trial += 1) {
    // Fresh arrays every trial, so the per-bin cache is genuinely exercised
    // rather than warmed once and hit for the rest of the run.
    const sources: Source[] = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, (_, i) => ({
      id: `s${i}`,
      label: `p${i}`,
      text: words(5 + Math.floor(Math.random() * 60)).join(" "),
    }));

    let mine = words(3 + Math.floor(Math.random() * 30));
    // Half the time splice in a real paste, or long runs almost never occur
    // by chance and the test only ever exercises the empty answer.
    if (Math.random() < 0.5) {
      const theirs = norm(sources[0]!.text);
      const len = Math.min(theirs.length, 4 + Math.floor(Math.random() * 16));
      const at = Math.floor(Math.random() * Math.max(1, theirs.length - len));
      mine = [...words(3), ...theirs.slice(at, at + len), ...words(3)];
    }

    const got = longestBorrowedRun(mine, sources) as Run;
    const want = naive(mine, sources);
    assert.equal(got.run, want.run, `run differs on: ${mine.join(" ")}`);
    assert.equal(got.text, want.text, `text differs on: ${mine.join(" ")}`);
  }
});

test("a pasted line is caught and names the source it came from", () => {
  const sources: Source[] = [
    { id: "s1", label: "lecture-04 p12", text: "Collisions are handled by the collision resolution strategy, most commonly separate chaining." },
  ];
  const line = norm("Collisions are handled by the collision resolution strategy, most commonly separate chaining");
  const hit = longestBorrowedRun(line, sources) as Run;
  assert.ok(hit.run >= 12, `expected a long run, got ${hit.run}`);
  assert.equal(hit.label, "lecture-04 p12");
});

test("sharing the subject's vocabulary is not a paste", () => {
  const sources: Source[] = [
    { id: "s1", label: "lecture-04 p12", text: "A hash table stores key value pairs in an array of buckets, and collisions are resolved by chaining." },
  ];
  // Every content word here is in the source. None of the ORDER is.
  const own = norm("Two keys can land in one bucket, and that bucket holds a list so both survive");
  assert.equal((longestBorrowedRun(own, sources) as Run).run, 0);
});

test("the floor holds: six shared words in a row is not a clipboard", () => {
  const sources: Source[] = [{ id: "s1", text: "one two three four five six nine ten" }];
  assert.equal((longestBorrowedRun(norm("one two three four five six"), sources) as Run).run, 0);
  assert.ok((longestBorrowedRun(norm("one two three four five six nine"), sources) as Run).run >= 7);
});

test("nothing to compare against comes back empty rather than throwing", () => {
  const miss = { run: 0, text: "", label: "" };
  assert.deepEqual(longestBorrowedRun(norm("one two three four five six seven eight"), []), miss);
  assert.deepEqual(longestBorrowedRun([], [{ id: "s", text: "one two three four five six seven" }]), miss);
  assert.deepEqual(longestBorrowedRun(["a", "b"], [{ id: "s", text: "a b" }]), miss);
});

test("the cached bin gives the same answer on the second look", () => {
  const sources: Source[] = [{ id: "x", label: "L", text: "one two three four five six seven eight nine" }];
  const line = norm("one two three four five six seven eight nine");
  const first = longestBorrowedRun(line, sources) as Run;
  const second = longestBorrowedRun(line, sources) as Run;
  assert.deepEqual(first, second);
  assert.equal(first.run, 9);
});

test("indexing a real bin once beats indexing it per slide", () => {
  // The regression this guards is not wrongness, it is the rail taking a
  // tenth of a second per keystroke once someone uploads a whole course.
  const sources: Source[] = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i}`,
    label: `lecture p${i}`,
    text: words(250).join(" "),
  }));
  const slides = Array.from({ length: 40 }, () => words(45));

  const started = performance.now();
  for (const slide of slides) longestBorrowedRun(slide, sources);
  const ms = performance.now() - started;

  assert.ok(ms < 60, `40 slides against a 60-page bin took ${ms.toFixed(0)}ms, which is a repaint you can feel`);
});
