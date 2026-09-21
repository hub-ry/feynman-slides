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

/**
 * Which severities hold the export.
 *
 * One definition because three places used to answer it by hand, and two of
 * them answered it as `severity !== "note"`. That was true while there were
 * exactly three severities and became a bug the moment there were four: the
 * `probe` - a question about a slide that is FINE - would have blocked the
 * export it was asking you to think harder about.
 *
 * Errors and jargon block, deliberately. Naming a thing instead of explaining
 * it is the failure the Feynman technique exists to catch, and the one that
 * feels most like understanding while you are doing it.
 */
export const BLOCKING = new Set(["error", "jargon"]);

/** True when this finding is one of the two that stand between you and an export. */
export const blocks = (finding) => !finding?.dismissed && BLOCKING.has(finding?.severity);

/**
 * The longest run of words the slide and a source have in common.
 *
 * This is the copy-paste detector, and it is pointed the opposite way from
 * what you might expect. Overlap with your lecture notes is not evidence you
 * understood the lecture - the Feynman move is restating the idea in words
 * that are NOT the source's words, so a long verbatim run is the signature of
 * the failure rather than of grounding. The old score gave twenty points out
 * of a hundred for word overlap, which meant a slide that was a straight
 * paste scored full marks on the dimension that was supposed to catch it.
 *
 * Runs, not bags of words. Sharing "hash" and "collision" with your professor
 * is unavoidable and fine; sharing eleven consecutive words is a clipboard.
 *
 * Returns { run, text, label } for the longest match, run = 0 when there is
 * nothing worth reporting.
 */
/**
 * Every source flattened to words, with an index of where each word occurs.
 *
 * Built once per bin, not once per slide. The rail scores every slide on
 * every repaint and a repaint happens on every keystroke, so doing this
 * inside the scan meant indexing the whole bin once per slide: a forty-slide
 * deck against a sixty-page lecture spent 125ms per repaint building the same
 * index forty times. Keyed on the sources array itself, which is stable for
 * as long as the bin is unchanged.
 */
const binCache = new WeakMap();
function indexed(sources) {
  let hit = binCache.get(sources);
  if (hit) return hit;

  hit = (sources ?? []).map((source) => {
    const words = String(`${source.title || ""} ${source.text || ""}`)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const at = new Map();
    for (let j = 0; j < words.length; j++) {
      const list = at.get(words[j]);
      if (list) list.push(j);
      else at.set(words[j], [j]);
    }
    return { words, at, label: source.label || "" };
  });

  binCache.set(sources, hit);
  return hit;
}

/**
 * The longest run of words the slide and a source have in common.
 *
 * This is the copy-paste detector, and it is pointed the opposite way from
 * what you might expect. Overlap with your lecture notes is not evidence you
 * understood the lecture - the Feynman move is restating the idea in words
 * that are NOT the source's words, so a long verbatim run is the signature of
 * the failure rather than of grounding. The old score gave twenty points out
 * of a hundred for word overlap, which meant a slide that was a straight
 * paste scored full marks on the dimension that was supposed to catch it.
 *
 * Runs, not bags of words. Sharing "hash" and "collision" with your professor
 * is unavoidable and fine; sharing eleven consecutive words is a clipboard.
 *
 * Returns { run, text, label } for the longest match, run = 0 when there is
 * nothing worth reporting.
 */
export function longestBorrowedRun(slideWords, sources, floor = 7) {
  const mine = Array.isArray(slideWords)
    ? slideWords.map((w) => String(w).toLowerCase())
    : String(slideWords || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  const miss = { run: 0, text: "", label: "" };
  if (mine.length < floor) return miss;

  let best = miss;
  for (const { words: theirs, at, label } of indexed(sources)) {
    if (theirs.length < floor) continue;

    for (let i = 0; i + best.run < mine.length; i++) {
      // A run starting here cannot beat the best unless the word `best.run`
      // along also lines up, so check that end first and skip the whole
      // position when it does not. On a bin full of "the" and "of" this is
      // what stops every occurrence of a stopword starting a scan.
      const starts = at.get(mine[i]);
      if (!starts) continue;

      for (const start of starts) {
        if (best.run && theirs[start + best.run] !== mine[i + best.run]) continue;
        let n = 0;
        while (i + n < mine.length && start + n < theirs.length && mine[i + n] === theirs[start + n]) n++;
        if (n > best.run) best = { run: n, text: mine.slice(i, i + n).join(" "), label };
      }
    }
  }

  return best.run >= floor ? best : miss;
}
