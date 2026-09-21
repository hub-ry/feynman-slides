// What the app offers once you have cleared the queue.
//
// The schedule's whole claim is that "you are caught up" means something, so
// the study-ahead list has two jobs: never to contain a slide that is due
// (that one belongs in the queue), and to put the weakest memory first.
//
//   node --experimental-strip-types --test src/ahead.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { type Deck, type Slide, text } from "./deck.ts";
import { type Memory, newMemory, grade, GOOD } from "./recall.ts";
import { aheadSlides, dueSlides, type Recall } from "./store.ts";

const DAY = 86_400_000;

/** A slide with a heading and a body, which is what makes it a card. */
function card(id: string): Slide {
  return { id, els: [text(0, 0, 100, 40, `head ${id}`, "title"), text(0, 50, 100, 80, `body ${id}`)] };
}

function deckOf(...ids: string[]): Deck {
  return { title: "t", slides: ids.map(card) } as Deck;
}

/** A memory that was graded `Good` `reps` times, the last one `agoDays` ago. */
function studied(reps: number, agoDays: number, now: Date): Memory {
  let m = newMemory(new Date(now.getTime() - (reps + agoDays) * DAY));
  for (let i = reps; i > 0; i--) {
    m = grade(m, GOOD, new Date(now.getTime() - (i + agoDays) * DAY));
  }
  return m;
}

const recallOf = (memories: Record<string, Memory>): Recall => ({ memories });

test("a slide that has never been studied is due, so it is never 'ahead'", () => {
  const now = new Date();
  const deck = deckOf("a", "b");
  const recall = recallOf({});

  assert.deepEqual(dueSlides(deck, recall, now), ["a", "b"]);
  assert.deepEqual(aheadSlides(deck, recall, now), []);
});

test("due and ahead never contain the same slide", () => {
  const now = new Date();
  const deck = deckOf("a", "b", "c");
  const recall = recallOf({
    a: studied(2, 0, now),
    b: studied(2, 400, now),
    c: studied(1, 0, now),
  });

  const due = new Set(dueSlides(deck, recall, now));
  const ahead = aheadSlides(deck, recall, now);

  assert.ok(ahead.length > 0, "expected something to be scheduled ahead");
  for (const id of ahead) assert.ok(!due.has(id), `${id} is in both lists`);
});

test("ahead is ordered weakest memory first", () => {
  const now = new Date();
  const deck = deckOf("fresh", "fading");
  // Same review count; one of them was last seen much longer ago, so its
  // retrievability has decayed further without yet crossing the due line.
  const recall = recallOf({
    fresh: studied(3, 0, now),
    fading: studied(3, 2, now),
  });

  const ahead = aheadSlides(deck, recall, now);
  assert.deepEqual(ahead, ["fading", "fresh"]);
});

test("a slide with only a heading is not a card, in either list", () => {
  const now = new Date();
  const headingOnly: Slide = { id: "bare", els: [text(0, 0, 100, 40, "just a title", "title")] };
  const deck = { title: "t", slides: [card("real"), headingOnly] } as Deck;
  const recall = recallOf({
    real: studied(2, 0, now),
    bare: studied(2, 0, now),
  });

  assert.ok(!dueSlides(deck, recall, now).includes("bare"));
  assert.ok(!aheadSlides(deck, recall, now).includes("bare"));
});
