import { iconSvg } from "./icons.js";
import { stillApplies } from "./readable.js";

// Feynman Clarity Score & Slide Ranking Engine
//
// "If you can't explain it simply, you don't understand it well enough."
// Evaluates slides across 4 Feynman dimensions:
// 1. Brevity & Focus (0–30)
// 2. Plain Language & Low Jargon (0–30)
// 3. Visual Structure & Hierarchy (0–20)
// 4. Source Material (Bin) Alignment (0–20)

/**
 * Common technical stopwords / jargon dictionary to spot ungrounded jargon.
 */
const COMMON_JARGON = new Set([
  "asynchronous", "deterministic", "invariance", "heuristic", "orthogonal",
  "amortized", "polynomial", "monolithic", "idempotent", "isomorphic",
  "concurrency", "polymorphism", "encapsulation", "asymptotic", "dichotomy",
  "transitive", "paradigm", "arbitrage", "epistemic", "ontology"
]);

/**
 * The words in the source bin, built once per bin rather than once per slide.
 *
 * The rail scores every slide on every repaint, and a repaint happens on every
 * edit. Rebuilding this set inside that loop made the cost of drawing the
 * filmstrip the size of the bin times the number of slides, which is the shape
 * of thing that is fine until someone pastes in a lecture.
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

/**
 * Compute the Feynman Clarity Score for a single slide.
 *
 * `rated` is false when there is nothing to judge. A slide with no words on it
 * used to come back a 61 and a C - full marks for plain language, most of the
 * marks for grounding - because every dimension scored the absence of a
 * problem rather than the presence of an explanation. A grade on an empty
 * slide is not a harsh grade, it is a meaningless one, and it made the two
 * numbers on the rail that matter impossible to pick out.
 *
 * @param {object} slide
 * @param {object} deck
 * @param {Array} [findings]
 * @param {{reviewed?: boolean}} [opts] whether the critic has read this text
 * @returns {object} { rated, score, grade, tier, color, summary, dimensions, strengths, tips }
 */
export function computeSlideScore(slide, deck = {}, findings = [], opts = {}) {
  const nothingToRate = {
    rated: false,
    score: 0,
    grade: "–",
    tier: "none",
    color: "#94a3b8",
    summary: "Nothing written yet",
    dimensions: { brevity: 0, language: 0, structure: 0, grounding: 0 },
    strengths: [],
    tips: ["Write a headline and the one idea this slide teaches."],
  };
  if (!slide || !Array.isArray(slide.els)) return nothingToRate;
  if (!slide.els.some((e) => e.type === "text" && e.text?.trim())) return nothingToRate;

  const textEls = slide.els.filter((e) => e.type === "text" && e.text?.trim());
  const allText = textEls.map((e) => e.text.trim()).join("\n");
  const words = allText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const strengths = [];
  const tips = [];

  // --- Dimension 1: Brevity & Focus (max 30 pts) ---
  let brevity = 0;
  if (wordCount === 0) {
    brevity = 5;
    tips.push("Empty slide. Add a clear headline and core concept.");
  } else if (wordCount < 10) {
    const isTitle = slide.els.some((e) => e.role === "title" || (e.y < 120 && e.h <= 100));
    brevity = isTitle ? 24 : 16;
    if (!isTitle) tips.push("Very sparse. Add 1–2 supporting bullet points.");
    else strengths.push("Concise slide title.");
  } else if (wordCount <= 45) {
    brevity = 30;
    strengths.push(`Punchy length (${wordCount} words): fits the Feynman rule of 1 clear mental model.`);
  } else if (wordCount <= 70) {
    brevity = 24;
    strengths.push(`Good balance (${wordCount} words).`);
    tips.push("Consider trimming 5–10 words to maximize visual retention.");
  } else if (wordCount <= 95) {
    brevity = 15;
    tips.push(`Dense slide (${wordCount} words). Split long sentences into bite-sized bullets.`);
  } else {
    brevity = 8;
    tips.push(`Text overload (${wordCount} words). Split across 2 slides or distill to key takeaways.`);
  }

  // Check individual bullet line length
  const lines = allText.split("\n").filter((l) => l.trim().length > 0);
  const longLines = lines.filter((l) => l.split(/\s+/).length > 20);
  if (longLines.length > 0) {
    brevity = Math.max(5, brevity - 3);
    tips.push("Keep bullets under 18 words so ideas can be scanned at a glance.");
  }

  // --- Dimension 2: Plain Language & Low Jargon (max 30 pts) ---
  let language = 30;
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
  const foundJargon = lowerWords.filter((w) => COMMON_JARGON.has(w));
  if (foundJargon.length > 0) {
    const unique = [...new Set(foundJargon)];
    language = Math.max(10, language - unique.length * 4);
    tips.push(`Unpack technical jargon: "${unique.slice(0, 3).join('", "')}" with simpler metaphors.`);
  }

  // Deduct for critic findings on this slide.
  //
  // Only the ones still quoting something written here, and only the real
  // severities. This used to test `f.severity === "block"` and `f.type`, and a
  // finding has neither - so nothing ever counted as blocking, every error and
  // every piece of jargon was scored as a mild note, and the grade on the
  // thumbnail went on saying "high clarity" over a slide that could not be
  // exported.
  const activeFindings = (findings || []).filter((f) => !f.dismissed && stillApplies(f, slide));
  const blockingFindings = activeFindings.filter((f) => f.severity === "error" || f.severity === "jargon");
  const notes = activeFindings.filter((f) => f.severity === "note");

  if (blockingFindings.length > 0) {
    language = Math.max(4, language - blockingFindings.length * 10);
    for (const f of blockingFindings.slice(0, 2)) {
      tips.push(f.severity === "jargon"
        ? `Critic: "${f.quote}" names a thing instead of explaining it.`
        : `Critic: "${f.quote}" is contradicted or overstated.`);
    }
    if (blockingFindings.length > 2) {
      tips.push(`${blockingFindings.length - 2} more blocking finding${blockingFindings.length - 2 > 1 ? "s" : ""} in the review pane.`);
    }
  } else if (opts.reviewed && activeFindings.length === 0 && wordCount >= 10) {
    // Only once the critic has actually read THIS text. Claiming a clean bill
    // of health for words nobody has looked at is the same lie the review pane
    // used to tell, told with a number instead.
    strengths.push("Zero critic findings: plain conversational English.");
  }

  if (notes.length > 0) {
    language = Math.max(8, language - notes.length * 3);
  }

  // --- Dimension 3: Visual Structure & Hierarchy (max 20 pts) ---
  let structure = 0;
  const hasTitle = slide.els.some((e) => e.role === "title" || (e.type === "text" && e.y <= 120 && e.h <= 120));
  if (hasTitle) {
    structure += 8;
    strengths.push("Clear title anchors the slide.");
  } else if (wordCount > 0) {
    tips.push("Add a Title or Kicker element to anchor the slide topic.");
  }

  const hasBody = slide.els.some((e) => e.role === "body" || e.type === "image" || e.type === "shape");
  if (hasBody) structure += 6;

  // Bullet formatting bonus
  const hasBullets = lines.some((l) => /^(\s*)[•\-*]\s+/.test(l));
  if (hasBullets) {
    structure += 3;
    strengths.push("Uses bulleted concept structure.");
  }

  // Boundary check (clean positioning within 960x540)
  const isOutOfBounds = slide.els.some((e) => e.x < 0 || e.y < 0 || (e.x + e.w) > 960 || (e.y + e.h) > 540);
  if (!isOutOfBounds && slide.els.length > 0) {
    structure += 3;
  } else if (isOutOfBounds) {
    tips.push("Some elements overflow past slide boundaries.");
  }

  // --- Dimension 4: Source Material (Bin) Grounding (max 20 pts) ---
  let grounding = 0;
  const sources = deck.sources || [];
  if (sources.length > 0) {
    const sourceTokens = tokensOf(sources);

    const matches = lowerWords.filter((w) => sourceTokens.has(w));
    const uniqueMatches = new Set(matches);

    if (uniqueMatches.size >= 4) {
      grounding = 20;
      strengths.push(`Strongly grounded in Source Material (${uniqueMatches.size} source concepts referenced).`);
    } else if (uniqueMatches.size >= 1) {
      grounding = 16;
      strengths.push("Connected to Source Material bin.");
    } else {
      grounding = 10;
      tips.push("Slide doesn't reference concepts from your Source Material bin.");
    }
  } else {
    // Check against deck title tokens if no sources in bin yet
    const titleTokens = (deck.title || "")
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length > 3);

    const matches = lowerWords.filter((w) => titleTokens.includes(w));
    if (matches.length > 0) {
      grounding = 18;
      strengths.push(`Directly reinforces topic "${deck.title}".`);
    } else {
      grounding = 15;
      tips.push("Add lecture slides or textbook excerpts to the Bin for source verification.");
    }
  }

  // Total calculation
  const total = Math.max(0, Math.min(100, Math.round(brevity + language + structure + grounding)));

  let grade = "D";
  let tier = "d";
  let color = "#ef4444";
  let summary = "Needs rework";

  if (total >= 90) {
    grade = "A+";
    tier = "a-plus";
    color = "#10b981";
    summary = "Masterful Feynman clarity";
  } else if (total >= 80) {
    grade = "A";
    tier = "a";
    color = "#06b6d4";
    summary = "High clarity";
  } else if (total >= 70) {
    grade = "B";
    tier = "b";
    color = "#3b82f6";
    summary = "Good clarity";
  } else if (total >= 55) {
    grade = "C";
    tier = "c";
    color = "#f59e0b";
    summary = "Needs simplification";
  }

  return {
    rated: true,
    score: total,
    grade,
    tier,
    color,
    summary,
    dimensions: {
      brevity: Math.round(brevity),
      language: Math.round(language),
      structure: Math.round(structure),
      grounding: Math.round(grounding),
    },
    strengths,
    tips,
  };
}

/**
 * Compute the aggregate deck-level score and ranked slide list.
 *
 * @param {object} deck
 * @param {object} critiques
 * @returns {object} { averageScore, grade, color, summary, rankedSlides }
 */
export function computeDeckClarity(deck, critiques = {}) {
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
    return { averageScore: 0, grade: "D", color: "#ef4444", summary: "No slides", rankedSlides: [] };
  }

  const scoredSlides = deck.slides.map((s, idx) => ({
    index: idx,
    slideId: s.id,
    scoreResult: computeSlideScore(s, deck, critiques.findings?.[s.id] || [], {
      reviewed: critiques.reviewed?.[s.id] !== undefined,
    }),
  }));

  // Blank slides are left out of the average rather than counted as bad ones.
  // A deck you have started is not a deck you are failing at.
  const rated = scoredSlides.filter((s) => s.scoreResult.rated);
  const sum = rated.reduce((acc, curr) => acc + curr.scoreResult.score, 0);
  const avg = rated.length ? Math.round(sum / rated.length) : 0;

  let grade = "D";
  let color = "#ef4444";
  let summary = "Needs improvement";

  if (avg >= 90) {
    grade = "A+";
    color = "#10b981";
    summary = "Exceptional Feynman clarity";
  } else if (avg >= 80) {
    grade = "A";
    color = "#06b6d4";
    summary = "Strong explanatory clarity";
  } else if (avg >= 70) {
    grade = "B";
    color = "#3b82f6";
    summary = "Clear and structured";
  } else if (avg >= 55) {
    grade = "C";
    color = "#f59e0b";
    summary = "Needs simplification";
  }

  return {
    averageScore: avg,
    grade,
    color,
    summary,
    rated: rated.length,
    slides: scoredSlides,
    // Weakest first, with the unrated ones at the end: "needs work" should
    // open on a slide you can actually do something about.
    needsWorkOrder: [...scoredSlides].sort(
      (a, b) => a.scoreResult.rated - b.scoreResult.rated || a.scoreResult.score - b.scoreResult.score,
    ),
    bestFirstOrder: [...scoredSlides].sort((a, b) => b.scoreResult.score - a.scoreResult.score),
  };
}

/**
 * Create a score popover modal element for a slide.
 */
export function openScorePopover(slideIndex, scoreResult, onNavigate) {
  // Close any existing popover
  const existing = document.getElementById("score-popover");
  if (existing) existing.remove();

  const pop = document.createElement("div");
  pop.id = "score-popover";
  pop.className = "score-popover";

  const header = `
    <div class="score-pop-header">
      <div class="score-pop-grade" style="background: ${scoreResult.color}22; color: ${scoreResult.color}; border: 1px solid ${scoreResult.color}55">
        ${scoreResult.grade}
      </div>
      <div class="score-pop-title">
        <h4>${scoreResult.rated ? `Slide ${slideIndex + 1} Clarity: ${scoreResult.score}/100` : `Slide ${slideIndex + 1}`}</h4>
        <p>${scoreResult.summary}</p>
      </div>
      <button class="score-pop-close" aria-label="Close">&times;</button>
    </div>`;

  // Four bars at zero is not a breakdown of anything. An unwritten slide gets
  // the one sentence that is actually true about it.
  if (!scoreResult.rated) {
    pop.innerHTML = `${header}
      <div class="score-feedback">
        <div class="feedback-section tips">
          <h6>Start here</h6>
          <ul>${scoreResult.tips.map((t) => `<li>${iconSvg("pencil-simple", 13)} <span>${escapeHtml(t)}</span></li>`).join("")}</ul>
        </div>
      </div>`;
    wirePopover(pop);
    document.body.append(pop);
    return pop;
  }

  pop.innerHTML = `${header}

    <div class="score-bars">
      <div class="score-bar-row">
        <span>Brevity & Focus</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(scoreResult.dimensions.brevity / 30) * 100}%; background: ${scoreResult.color}"></div></div>
        <span class="bar-num">${scoreResult.dimensions.brevity}/30</span>
      </div>
      <div class="score-bar-row">
        <span>Plain English</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(scoreResult.dimensions.language / 30) * 100}%; background: ${scoreResult.color}"></div></div>
        <span class="bar-num">${scoreResult.dimensions.language}/30</span>
      </div>
      <div class="score-bar-row">
        <span>Structure & Layout</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(scoreResult.dimensions.structure / 20) * 100}%; background: ${scoreResult.color}"></div></div>
        <span class="bar-num">${scoreResult.dimensions.structure}/20</span>
      </div>
      <div class="score-bar-row">
        <span>Bin Grounding</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(scoreResult.dimensions.grounding / 20) * 100}%; background: ${scoreResult.color}"></div></div>
        <span class="bar-num">${scoreResult.dimensions.grounding}/20</span>
      </div>
    </div>

    <div class="score-feedback">
      ${scoreResult.strengths.length > 0 ? `
        <div class="feedback-section positive">
          <h6>Strengths</h6>
          <ul>${scoreResult.strengths.map((s) => `<li>${iconSvg("check-circle", 13)} <span>${escapeHtml(s)}</span></li>`).join("")}</ul>
        </div>
      ` : ""}
      ${scoreResult.tips.length > 0 ? `
        <div class="feedback-section tips">
          <h6>Improvement Tips</h6>
          <ul>${scoreResult.tips.map((t) => `<li>${iconSvg("warning-circle", 13)} <span>${escapeHtml(t)}</span></li>`).join("")}</ul>
        </div>
      ` : ""}
    </div>
  `;

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
