// What this slide is still missing.
//
// This used to be a grade. It rendered `D - Needs rework` and `A+ - Masterful
// Feynman clarity` over a slide somebody had written thirty seconds earlier,
// and that is the single worst-evidenced thing this tool was doing.
//
// Kluger and DeNisi's meta-analysis of 607 effect sizes found that over a
// THIRD of feedback interventions made performance worse. The moderator they
// identified is where the feedback points attention: feedback about the task
// helps, and feedback that moves attention to the self competes with the task
// for the same attention and frequently loses. A letter grade is the purest
// available form of the second kind. See docs/research.md section 2.
//
// So there is no score in here any more, and nothing is out of 100. There is
// a list of six checks, each of which is clear, open, or not yet answerable,
// and each of which can say in one sentence what it saw. "Two checks open"
// tells you what to do next. "D" tells you what you are.
//
// The checks are in the order the Feynman technique runs, not in the order
// they are cheap to compute:
//
//   1. defensible    nothing on it that the critic has contradicted
//   2. own-words     said in your words rather than the bin's
//   3. no-stand-ins  no name doing the work an explanation should do
//   4. says-how      the mechanism is actually on the slide
//   5. one-idea      one idea, at a length you could say out loud
//   6. reads-clean   it can be read at a glance
//
// Checks 2 and 4 are new, and 2 is a reversal. The old fourth dimension paid
// twenty points out of a hundred for VOCABULARY OVERLAP with the source bin,
// which meant a slide that was a straight paste of a lecture bullet scored
// full marks on the dimension meant to catch exactly that.

import { iconSvg } from "./icons.js";
import { stillApplies, longestBorrowedRun } from "./readable.js";

/**
 * Words that sound like understanding and are not.
 *
 * Not a blocklist. Every one of these is a perfectly good word once the slide
 * says what it means; the check below only fires when one appears with no
 * mechanism anywhere near it, which is the difference between using a term
 * and hiding behind one.
 */
const COMMON_JARGON = new Set([
  "asynchronous", "deterministic", "invariance", "heuristic", "orthogonal",
  "amortized", "polynomial", "monolithic", "idempotent", "isomorphic",
  "concurrency", "polymorphism", "encapsulation", "asymptotic", "dichotomy",
  "transitive", "paradigm", "arbitrage", "epistemic", "ontology",
]);

/**
 * Verbs that describe something happening to something.
 *
 * The same list the server-side critic uses, and for the same reason: an
 * explanation says what moves where, a label says what the thing is called,
 * and counting these is a crude stand-in for the difference that is blind to
 * how technical the vocabulary is. Being blind to that is the point.
 */
const MECHANISM =
  /\b(stores?|stored|holds?|keeps?|moves?|copies|copied|splits?|merges?|compares?|computes?|calculates?|counts?|scans?|walks?|points?|links?|chains?|maps?|hashes|rehash(?:es)?|doubles?|halves?|grows?|shrinks?|swaps?|reads?|writes?|appends?|inserts?|removes?|deletes?|sorts?|orders?|picks?|chooses?|waits?|blocks?|retries|retr(?:y|ies)|sends?|receives?|checks?|marks?|frees?|allocates?|evicts?|caches?|buckets?|probes?|collides?|steps?|loops?|repeats?|multiplies|divides?|adds?|subtracts?)\b/i;

/**
 * Words that join a cause to an effect.
 *
 * A slide can be full of mechanism verbs and still be a list of things that
 * happen. What turns a list into an explanation is saying which one causes
 * which, and these are the words that do it.
 */
const CAUSAL = /\b(because|so that|so it|which means|therefore|thus|hence|then|when|whenever|if|unless|until|otherwise|as a result|leads to|causes?|means that)\b/i;

/** Someone reaching for a concrete case, which is the other half of step four. */
const CONCRETE = /\b(for example|e\.?g\.?|for instance|say |suppose|imagine|like a|as if|think of)\b/i;

/**
 * The words in the source bin, built once per bin rather than once per slide.
 *
 * The rail scores every slide on every repaint, and a repaint happens on
 * every edit. Rebuilding this set inside that loop made the cost of drawing
 * the filmstrip the size of the bin times the number of slides, which is the
 * shape of thing that is fine until someone pastes in a lecture.
 */
const tokenCache = new WeakMap();
function tokensOf(sources) {
  let hit = tokenCache.get(sources);
  if (!hit) {
    hit = new Set(
      sources
        .flatMap((s) => `${s.title || ""} ${s.text || ""}`.toLowerCase().split(/\s+/))
        .map((w) => w.replace(/[^a-z0-9]/g, ""))
        .filter((w) => w.length > 3),
    );
    tokenCache.set(sources, hit);
  }
  return hit;
}

const CLEAR = "clear";
const OPEN = "open";
const UNKNOWN = "unknown";

const check = (id, label, state, says, next) => ({ id, label, state, says, next });

/**
 * The six checks, for one slide.
 *
 * `rated` is false when there is nothing to judge. An empty slide used to
 * come back a 61 and a C, because every dimension was scoring the absence of
 * a problem rather than the presence of an explanation. A verdict on an empty
 * slide is not a harsh verdict, it is a meaningless one.
 *
 * @param {object} slide
 * @param {object} deck
 * @param {Array} [findings] the critic's open findings for this slide
 * @param {{reviewed?: boolean}} [opts] whether the critic has read THIS text
 */
export function computeSlideScore(slide, deck = {}, findings = [], opts = {}) {
  const blank = {
    rated: false,
    checks: [],
    open: 0,
    clear: 0,
    unknown: 0,
    total: 0,
    tier: "unwritten",
    summary: "Nothing written yet",
    next: ["Write the heading and the one idea this slide teaches."],
  };
  if (!slide || !Array.isArray(slide.els)) return blank;

  const textEls = slide.els.filter((e) => e.type === "text" && e.text?.trim());
  if (!textEls.length) return blank;

  const allText = textEls.map((e) => e.text.trim()).join("\n");
  const lines = allText.split("\n").map((l) => l.trim()).filter(Boolean);
  const words = allText.split(/\s+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const content = lower.filter((w) => w.length > 3);
  const sources = deck.sources || [];

  // Only findings still quoting something written here. A finding about a
  // sentence you already took back must stop counting.
  const active = (findings || []).filter((f) => !f.dismissed && stillApplies(f, slide));
  const errors = active.filter((f) => f.severity === "error");
  const jargon = active.filter((f) => f.severity === "jargon");
  const reviewed = Boolean(opts.reviewed);

  // A slide that is mostly a heading is a section marker, not an explanation,
  // and holding it to the same six checks is how you end up with a rail full
  // of warnings about title cards.
  const headingOnly = textEls.length === 1 && words.length < 10;

  const checks = [];

  // --- 1. Nothing here is contradicted -------------------------------------
  checks.push(
    errors.length
      ? check("defensible", "Nothing contradicted", OPEN,
          `The critic disputes ${errors.length === 1 ? "a line" : `${errors.length} lines`}: "${errors[0].quote}"`,
          "Settle it or write down why the critic is wrong.")
      : reviewed
        ? check("defensible", "Nothing contradicted", CLEAR, "The critic read this version and let it stand.")
        : check("defensible", "Nothing contradicted", UNKNOWN, "The critic has not read this version yet."),
  );

  // --- 2. Your words rather than the bin's ---------------------------------
  //
  // The reversal. Overlap with the lecture is the signature of not having done
  // the restating, not evidence of grounding.
  if (!sources.length) {
    checks.push(check("own-words", "Your words, not the bin's", UNKNOWN,
      "Nothing in the bin to check against.",
      "Drop the lecture slides or your notes in the bin."));
  } else {
    const borrowed = longestBorrowedRun(lower, sources);
    if (borrowed.run > 0) {
      checks.push(check("own-words", "Your words, not the bin's", OPEN,
        `${borrowed.run} words straight out of ${borrowed.label || "the bin"}: "${borrowed.text}"`,
        "Close the bin and write the line again from memory."));
    } else {
      // Having avoided copying is only half of it. Covering nothing the bin
      // covers is its own problem, and a slide can manage both at once.
      const shared = new Set(content.filter((w) => tokensOf(sources).has(w)));
      checks.push(
        shared.size >= 2
          ? check("own-words", "Your words, not the bin's", CLEAR,
              `Covers ${shared.size} things the bin covers, in different words.`)
          : check("own-words", "Your words, not the bin's", UNKNOWN,
              "Nothing here lines up with anything in the bin.",
              "Either this is off-syllabus, or the bin is missing the part that covers it."),
      );
    }
  }

  // --- 3. No name doing an explanation's job -------------------------------
  const bareTerms = [...new Set(lower.filter((w) => COMMON_JARGON.has(w)))];
  if (jargon.length) {
    checks.push(check("no-stand-ins", "No name standing in", OPEN,
      `"${jargon[0].quote}" names a thing where the mechanism should be.`,
      "Say what moves and when, without the label."));
  } else if (bareTerms.length && !MECHANISM.test(allText)) {
    checks.push(check("no-stand-ins", "No name standing in", OPEN,
      `"${bareTerms.slice(0, 3).join('", "')}" with nothing on the slide saying what that means.`,
      "Delete the word and see whether the slide still explains anything."));
  } else if (reviewed) {
    checks.push(check("no-stand-ins", "No name standing in", CLEAR,
      "Every term here is carrying its own weight."));
  } else {
    checks.push(check("no-stand-ins", "No name standing in", UNKNOWN,
      "The critic has not read this version yet."));
  }

  // --- 4. The mechanism is on the slide ------------------------------------
  //
  // The check that was missing entirely, and the one the technique is named
  // after. Rozenblit and Keil's illusion of explanatory depth is specifically
  // an illusion about MECHANISM: people can say what a thing is for and what
  // it looks like long after they have stopped being able to say how it
  // works, and they cannot tell the difference until asked to produce the
  // steps. Everything else here checks the words. This checks whether there
  // are any steps.
  if (headingOnly) {
    checks.push(check("says-how", "Says how it works", UNKNOWN,
      "A heading on its own. Nothing to check yet."));
  } else {
    const hasMechanism = MECHANISM.test(allText);
    const hasCause = CAUSAL.test(allText);
    const hasConcrete = CONCRETE.test(allText);
    if (hasMechanism && (hasCause || hasConcrete)) {
      checks.push(check("says-how", "Says how it works", CLEAR,
        hasConcrete ? "Says what happens, and grounds it in a case."
                    : "Says what happens and what follows from it."));
    } else if (hasMechanism) {
      checks.push(check("says-how", "Says how it works", OPEN,
        "Says what happens, but not what causes what.",
        "Join two of these lines with a 'because' or a 'so that' and see if it survives."));
    } else {
      checks.push(check("says-how", "Says how it works", OPEN,
        "Nothing here says what actually happens - it names and describes.",
        "Write the next sentence as a step: what is stored, what gets compared, what happens when it runs out of room."));
    }
  }

  // --- 5. One idea, at a length you could say ------------------------------
  //
  // Mayer's coherence principle held in 23 of 23 tests at a median effect of
  // d = 0.86: people learn more deeply when the extraneous material is left
  // out. The numbers below are the usual slide-craft ones, and they are here
  // as a legibility check rather than a learning claim.
  const bodyItems = lines.length - 1;
  const longLines = lines.filter((l) => l.split(/\s+/).length > 20);
  if (headingOnly) {
    checks.push(check("one-idea", "One idea, sayable", CLEAR, "A heading. Nothing crowding it."));
  } else if (bodyItems >= 6) {
    checks.push(check("one-idea", "One idea, sayable", OPEN,
      `${bodyItems} separate points on one slide.`,
      "Keep the premise here and move the rest to a slide of its own."));
  } else if (words.length > 85) {
    checks.push(check("one-idea", "One idea, sayable", OPEN,
      `About ${words.length} words. This is a paragraph.`,
      "Cut it to the sentences you would actually say out loud."));
  } else if (longLines.length) {
    checks.push(check("one-idea", "One idea, sayable", OPEN,
      `${longLines.length} bullet${longLines.length > 1 ? "s run" : " runs"} past 20 words.`,
      "Break the long one in two at its 'and'."));
  } else {
    checks.push(check("one-idea", "One idea, sayable", CLEAR,
      `${words.length} words across ${bodyItems || 1} point${bodyItems === 1 ? "" : "s"}.`));
  }

  // --- 6. Reads cleanly ----------------------------------------------------
  const hasTitle = slide.els.some(
    (e) => e.role === "title" || (e.type === "text" && e.y <= 120 && e.h <= 120),
  );
  const spills = slide.els.some((e) => e.x < 0 || e.y < 0 || e.x + e.w > 960 || e.y + e.h > 540);
  if (spills) {
    checks.push(check("reads-clean", "Reads cleanly", OPEN,
      "Something is hanging off the edge of the slide.",
      "Nudge it back inside, or press Shift+L to re-lay the slide."));
  } else if (!hasTitle) {
    checks.push(check("reads-clean", "Reads cleanly", OPEN,
      "No heading anchoring the slide.",
      "Name the one thing this slide is about, at the top."));
  } else {
    checks.push(check("reads-clean", "Reads cleanly", CLEAR, "Heading on top, everything inside the frame."));
  }

  const open = checks.filter((c) => c.state === OPEN);
  const clear = checks.filter((c) => c.state === CLEAR).length;
  const unknown = checks.filter((c) => c.state === UNKNOWN).length;

  return {
    rated: true,
    checks,
    open: open.length,
    clear,
    unknown,
    total: checks.length,
    // For CSS only. Three states, because "one thing to fix" and "everything
    // to fix" are the same instruction and should not be six shades apart.
    tier: errors.length || jargon.length
      ? "blocking"
      : open.length
        ? "open"
        // Nothing open is not the same as nothing to find. A slide the critic
        // has not read yet has two checks it cannot answer, and showing it the
        // same green as a slide that came back clean is the exact lie the
        // review pane was rewritten to stop telling.
        : unknown
          ? "waiting"
          : "settled",
    /** Factual, and never a judgement of the person. */
    summary: open.length === 0
      ? unknown
        ? `${clear} of ${checks.length} settled, ${unknown} not checkable yet`
        : "Nothing open"
      : `${open.length} open`,
    next: open.map((c) => c.next).filter(Boolean),
  };
}

/**
 * The deck, and what to look at next.
 *
 * There is no deck average any more, for the same reason there is no slide
 * grade. What a deck can honestly say about itself is how many of its slides
 * have something open on them, which is a count of work remaining rather than
 * a mark.
 */
export function computeDeckClarity(deck, critiques = {}) {
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
    return { rated: 0, openSlides: 0, openChecks: 0, summary: "No slides", slides: [], needsWorkOrder: [], bestFirstOrder: [] };
  }

  const scoredSlides = deck.slides.map((s, idx) => ({
    index: idx,
    slideId: s.id,
    scoreResult: computeSlideScore(s, deck, critiques.findings?.[s.id] || [], {
      reviewed: critiques.reviewed?.[s.id] !== undefined,
    }),
  }));

  const rated = scoredSlides.filter((s) => s.scoreResult.rated);
  const openSlides = rated.filter((s) => s.scoreResult.open > 0).length;
  const openChecks = rated.reduce((n, s) => n + s.scoreResult.open, 0);

  // Blank slides sort last rather than worst. A deck you have started is not
  // a deck you are failing at, and "needs work" should open on a slide you
  // can actually do something about.
  const worstFirst = (a, b) =>
    b.scoreResult.rated - a.scoreResult.rated ||
    b.scoreResult.open - a.scoreResult.open ||
    (b.scoreResult.tier === "blocking") - (a.scoreResult.tier === "blocking");

  return {
    rated: rated.length,
    openSlides,
    openChecks,
    summary: !rated.length
      ? "Nothing written yet"
      : openSlides === 0
        ? "Nothing open"
        : `${openSlides} of ${rated.length} slide${rated.length === 1 ? "" : "s"} with something open`,
    slides: scoredSlides,
    needsWorkOrder: [...scoredSlides].sort(worstFirst),
    bestFirstOrder: [...scoredSlides].sort((a, b) => -worstFirst(a, b)),
  };
}

const ICONS = {
  [CLEAR]: "check-circle",
  [OPEN]: "warning-circle",
  [UNKNOWN]: "question",
};

/** The checklist for one slide, as a popover. */
export function openScorePopover(slideIndex, scoreResult, onNavigate) {
  document.getElementById("score-popover")?.remove();

  const pop = document.createElement("div");
  pop.id = "score-popover";
  pop.className = "score-popover";

  const header = `
    <div class="score-pop-header">
      <div class="score-pop-title">
        <h4>Slide ${slideIndex + 1}</h4>
        <p>${escapeHtml(scoreResult.summary)}</p>
      </div>
      <button class="score-pop-close" aria-label="Close">&times;</button>
    </div>`;

  if (!scoreResult.rated) {
    pop.innerHTML = `${header}
      <div class="score-feedback">
        <ul class="score-checks">
          <li class="chk unknown">${iconSvg("pencil-simple", 14)}
            <span><strong>Start here</strong><em>Write the heading and the one idea this slide teaches.</em></span>
          </li>
        </ul>
      </div>`;
    wirePopover(pop);
    document.body.append(pop);
    return pop;
  }

  pop.innerHTML = `${header}
    <ul class="score-checks">
      ${scoreResult.checks
        .map(
          (c) => `<li class="chk ${c.state}">${iconSvg(ICONS[c.state], 14)}
            <span>
              <strong>${escapeHtml(c.label)}</strong>
              <em>${escapeHtml(c.says)}</em>
              ${c.next ? `<b>${escapeHtml(c.next)}</b>` : ""}
            </span>
          </li>`,
        )
        .join("")}
    </ul>`;

  wirePopover(pop);
  document.body.append(pop);
  return pop;
}

/** Close on the button, on Escape, and on a click anywhere else. */
function wirePopover(pop) {
  pop.querySelector(".score-pop-close").onclick = () => pop.remove();

  const onKey = (e) => {
    if (e.key === "Escape") {
      pop.remove();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  setTimeout(() => {
    const onClickOutside = (e) => {
      if (!pop.contains(e.target) && !e.target.closest(".score-badge")) {
        pop.remove();
        document.removeEventListener("pointerdown", onClickOutside);
      }
    };
    document.addEventListener("pointerdown", onClickOutside);
  }, 10);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
