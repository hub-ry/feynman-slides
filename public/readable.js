// What the critic reads, and a fingerprint of it.
//
// One definition, imported by both sides. The server decides what to put in
// front of the critic; the browser decides whether the critique on screen is
// still about the words on the slide. Two copies of this rule would drift,
// and the symptom is the worst one this tool has: a finding quoting a
// sentence you deleted, sitting next to a slide, holding your export.
//
// Reading order, not array order: elements are sorted top-to-bottom then
// left-to-right, because array order is creation order and someone who adds a
// heading last should not have their slide read to the critic upside down.
//
// The marks come off first. `**a hash table**` and `a hash table` are the same
// claim, and a critic quoting asterisks back at you is quoting something you
// cannot find on the slide.

import { plain } from "./render.js";

/** The slide as the critic sees it: a heading and the lines under it. */
export function readable(slide) {
  const texts = (slide?.els ?? [])
    .filter((e) => e.type === "text" && plain(e.text).trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const [head, ...rest] = texts;

  const lines = (el) =>
    plain(el.text)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  // The heading box is one line of heading and, if someone kept typing into
  // it, more body. The earlier version kept only the first line, so anything
  // below it was invisible to the critic - text on the slide that could never
  // be flagged because it was never shown.
  const [title = "", ...spill] = head ? lines(head) : [];
  const body = [...spill, ...rest.flatMap(lines)];

  for (const img of (slide?.els ?? []).filter((e) => e.type === "image" && e.src)) {
    if (img.alt?.trim()) body.push(`[image: ${img.alt.trim()}]`);
  }

  return { title, body };
}

/** Everything on the slide as one string, whitespace-flattened and lowercased. */
export function slideText(slide) {
  const { title, body } = readable(slide);
  return [title, ...body].join("\n").replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when there is anything for the critic to read. */
export const hasText = (slide) => slideText(slide).length > 0;

/**
 * A fingerprint of what the critic read.
 *
 * djb2 rather than a real hash: nothing here is a security boundary, the
 * inputs are a few hundred bytes, and the browser needs the identical answer
 * without reaching for crypto.subtle and turning every comparison async.
 */
export function digest(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36) + ":" + str.length.toString(36);
}

/** The fingerprint of a slide's text. Same words, same digest, on either side. */
export const slideDigest = (slide) => digest(slideText(slide));

/**
 * Is this finding still about something on the slide?
 *
 * A finding quotes the exact bullet it means. Once that bullet is gone the
 * finding is an artefact of text that no longer exists, and it must stop
 * counting - against the export, in the rail, and in the pane. Rewriting the
 * line is what re-opens the question, and the re-review answers it.
 */
export function stillApplies(finding, slide) {
  const q = String(finding?.quote ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!q) return true; // nothing to check it against; the critic owes us a quote
  return slideText(slide).includes(q);
}
