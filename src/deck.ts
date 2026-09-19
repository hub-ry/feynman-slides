// A deck is JSON, and everything in it is in LOGICAL units on a 960x540
// canvas. Nothing stores a screen pixel: the editor scales the whole canvas to
// whatever space it has and the export scales it to the window, so a deck
// written on a laptop and shown on a projector is the same deck.
//
// How it LOOKS is not in here. That is the template - see public/theme.js -
// and a deck names one. Two decks with the same slides and different templates
// are the same file with one word changed, which is the point.

import { plain } from "../public/render.js";
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
 * What the critic reads.
 *
 * Reading order, not array order: elements are sorted top-to-bottom then
 * left-to-right, because array order is creation order and someone who adds a
 * heading last should not have their slide read to the critic upside down.
 *
 * The marks come off first. `**a hash table**` and `a hash table` are the same
 * claim, and a critic quoting asterisks back at you is quoting something you
 * cannot find on the slide.
 */
export function readable(slide: Slide): { title: string; body: string[] } {
  const texts = slide.els
    .filter((e): e is TextEl => e.type === "text" && plain(e.text).trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const [head, ...rest] = texts;
  const images = slide.els.filter((e): e is ImageEl => e.type === "image" && Boolean(e.src));
  const body = rest.flatMap((t) =>
    plain(t.text).split("\n").map((l) => l.trim()).filter(Boolean),
  );
  for (const img of images) {
    if (img.alt.trim()) body.push(`[image: ${img.alt.trim()}]`);
  }
  return { title: plain(head?.text ?? "").split("\n")[0]?.trim() ?? "", body };
}

/** Stable identity for a slide. Its own id, so renaming a heading does not orphan its findings. */
export const slideKey = (slide: Slide): string => slide.id;
