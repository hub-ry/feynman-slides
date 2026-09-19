// A deck is JSON now, not markdown.
//
// Markdown was the source of truth while a slide was a title and some bullets.
// A text box at (140, 88) that is 300 wide has no markdown spelling, so the
// model is positions and the file is JSON.
//
// Everything is in LOGICAL units on a 960x540 canvas. Nothing stores a screen
// pixel: the editor scales the whole canvas to whatever space it has, and the
// export scales it to the window, so a deck written on a laptop and opened on
// a monitor is the same deck.

export const W = 960;
export const H = 540;

export type Role = "title" | "body";

export type TextEl = {
  id: string;
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Title or body. Everything about how it looks comes from this - see public/type.js. */
  role: Role;
};

export type ImageEl = {
  id: string;
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /** File name under the deck's images/ directory. */
  src: string;
  /** Kept so resize can hold the shape and so a corner drag has something to snap back to. */
  ratio: number;
  alt: string;
};

export type El = TextEl | ImageEl;

export type Slide = {
  id: string;
  els: El[];
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
  return { id: uid(), els: [] };
}

export function blankDeck(title: string): Deck {
  const s = blankSlide();
  s.els.push(text(70, 190, 820, 150, title, "title"));
  return { title, slides: [s], sources: [] };
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
 * Bring a deck forward from when text boxes carried their own size and weight.
 *
 * Decks written before the two roles existed have `size` and `bold` instead.
 * Big or bold meant title; everything else was body.
 */
export function migrate(deck: Deck): Deck {
  deck.sources ??= [];
  for (const s of deck.slides) {
    // Notes used to hang off each slide. Everything anyone wrote in one is
    // source material, so it moves to the bin rather than being dropped.
    const old = s as Slide & { notes?: string };
    if (old.notes?.trim()) deck.sources.push({ id: uid(), text: old.notes.trim() });
    delete old.notes;
    for (const el of s.els) {
      if (el.type !== "text") continue;
      const old = el as TextEl & { size?: number; bold?: boolean; align?: string };
      if (!old.role) old.role = (old.size ?? 24) >= 36 || old.bold ? "title" : "body";
      delete old.size;
      delete old.bold;
      delete old.align;
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
 * The topmost text box is offered as the title, which is what a heading is on
 * a slide even though nothing here marks it as one.
 */
export function readable(slide: Slide): { title: string; body: string[] } {
  const texts = slide.els
    .filter((e): e is TextEl => e.type === "text" && e.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const [head, ...rest] = texts;
  const images = slide.els.filter((e): e is ImageEl => e.type === "image");
  const body = rest.flatMap((t) => t.text.split("\n").map((l) => l.trim()).filter(Boolean));
  for (const img of images) {
    if (img.alt.trim()) body.push(`[image: ${img.alt.trim()}]`);
  }
  return { title: head?.text.split("\n")[0]?.trim() ?? "", body };
}

/** Stable identity for a slide. Its own id, so renaming a heading does not orphan its findings. */
export const slideKey = (slide: Slide): string => slide.id;
