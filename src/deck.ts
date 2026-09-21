// A deck is JSON, and everything in it is in LOGICAL units on a 960x540
// canvas. Nothing stores a screen pixel: the editor scales the whole canvas to
// whatever space it has and the export scales it to the window, so a deck
// written on a laptop and shown on a projector is the same deck.
//
// How it LOOKS is not in here. That is the template - see public/theme.js -
// and a deck names one. Two decks with the same slides and different templates
// are the same file with one word changed, which is the point.

import { instantiate } from "../public/theme.js";

export const W = 960;
export const H = 540;

/** A role names a slot in the template's type scale. The template decides the rest. */
export type Role = string;

export type TextEl = {
  id: string;
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Plain text with markdown marks: `**bold**`, `*italic*`, `` `code` ``, `==mark==`, `- ` lists. */
  text: string;
  role: Role;
  /** Overrides the role's alignment, for the one line that needs centring. */
  align?: "left" | "center" | "right";
  /** What the layout called this slot - shown while the box is empty. */
  hint?: string;
};

export type ImageEl = {
  id: string;
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /** File under the deck's images/ directory. Empty means the layout left a hole for one. */
  src: string;
  /** Kept so a corner drag can hold the shape. */
  ratio?: number;
  alt: string;
};

/** Rules, blocks and dots. Filled with a template COLOUR, never a hex - see theme.js. */
export type ShapeEl = {
  id: string;
  type: "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  shape: "rect" | "ellipse" | "line";
  fill: string;
};

export type El = TextEl | ImageEl | ShapeEl;

export type Slide = {
  id: string;
  els: El[];
  /** Which layout it was built from, so "new slide" can repeat what you just did. */
  layout?: string;
};

/** One thing you dropped in the bin: a lecture slide, a passage, a definition. */
export type Source = {
  id: string;
  text: string;
  /**
   * Where it came from - "lecture-04.pdf p12" for an upload, absent when you
   * typed it. Shown to the critic so a finding can say which slide of your
   * professor's deck contradicts you, rather than just that something does.
   */
  label?: string;
};

export type Deck = {
  title: string;
  slides: Slide[];
  /**
   * Who you are explaining this to.
   *
   * One sentence, and it is not decoration. Kobayashi's meta-analysis of
   * learning-by-teaching found that teaching after studying WITHOUT the
   * expectation of teaching did not differ from not teaching at all; with the
   * expectation in place the benefit was g = 0.48. The reader is the
   * condition, not the audience.
   *
   * It is also what makes the critic's central judgement answerable. "Does
   * this term stand in for a mechanism" has no answer in the abstract -
   * "quorum" explains plenty to a distributed systems PhD and nothing to you
   * in six weeks - so without a named reader the critic was inventing one per
   * slide, which is why its jargon calls read as arbitrary.
   *
   * See docs/research.md section 4.
   */
  audience?: string;
  /** The installed template this deck is drawn with. */
  template?: string;
  /** An optional folder or class this deck belongs to. */
  folder?: string;
  /**
   * The source bin, for the whole deck rather than per slide.
   *
   * Source material does not divide neatly by slide - one passage covers three
   * slides, and a definition you pasted on slide 2 is exactly what the critic
   * needs on slide 9. It is checked against every slide.
   */
  sources: Source[];
};

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export function blankSlide(): Slide {
  return { id: uid(), els: [], layout: "blank" };
}

/** The first slide is the title layout with the deck's name already in it. */
export function blankDeck(
  title: string,
  template = "feynman",
  titleLayout?: unknown,
  folder?: string,
): Deck {
  const s = blankSlide();
  s.layout = "title";
  if (titleLayout) {
    s.els = (instantiate as (l: unknown, u: () => string) => El[])(titleLayout, uid);
    const head = s.els.find((e): e is TextEl => e.type === "text" && e.role === "title");
    if (head) head.text = title;
  } else {
    s.els = [text(96, 186, 768, 120, title, "title")];
  }
  return {
    title,
    template,
    ...(folder ? { folder } : {}),
    slides: [s],
    sources: [],
  };
}

export function text(
  x: number,
  y: number,
  w: number,
  h: number,
  body = "",
  role: Role = "body",
): TextEl {
  return { id: uid(), type: "text", x, y, w, h, text: body, role };
}

/**
 * Bring a deck forward from before templates existed.
 *
 * Decks written when a text box carried its own size and weight have `size`
 * and `bold` instead of a role: big or bold meant title, everything else was
 * body. Decks written after that but before templates have no `template`, and
 * the default is exactly what they were drawn with, so they do not move.
 */
export function migrate(deck: Deck): Deck {
  deck.sources ??= [];
  deck.template ??= "feynman";
  // Decks written before there was a reader do not get one invented for them.
  // An audience you did not choose is not an expectation, and a placeholder
  // here would quietly turn the editor's prompt off for every existing deck.
  if (typeof deck.audience === "string" && !deck.audience.trim()) delete deck.audience;
  for (const s of deck.slides) {
    // Notes used to hang off each slide. Everything anyone wrote in one is
    // source material, so it moves to the bin rather than being dropped.
    const old = s as Slide & { notes?: string };
    if (old.notes?.trim()) deck.sources.push({ id: uid(), text: old.notes.trim() });
    delete old.notes;
    for (const el of s.els) {
      if (el.type !== "text") continue;
      const was = el as TextEl & { size?: number; bold?: boolean };
      if (!was.role) was.role = (was.size ?? 24) >= 36 || was.bold ? "title" : "body";
      delete was.size;
      delete was.bold;
    }
  }
  return deck;
}

/**
 * What the critic reads, and the fingerprint of it.
 *
 * Defined once in `public/readable.js` and re-exported here, because the
 * browser needs the same answer: it is what tells the review pane whether the
 * critique it is showing is still about the words on the slide.
 */
export { readable, slideText, slideDigest, hasText, stillApplies, BLOCKING, blocks } from "../public/readable.js";

/** Stable identity for a slide. Its own id, so renaming a heading does not orphan its findings. */
export const slideKey = (slide: Slide): string => slide.id;
