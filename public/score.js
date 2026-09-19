import { iconSvg } from "./icons.js";

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
 * Compute the Feynman Clarity Score for a single slide.
 *
 * @param {object} slide
 * @param {object} deck
 * @param {Array} [findings]
 * @returns {object} { score, grade, tier, color, summary, dimensions, strengths, tips }
 */
export function computeSlideScore(slide, deck = {}, findings = []) {
  if (!slide || !Array.isArray(slide.els)) {
    return {
      score: 0,
      grade: "D",
      tier: "d",
      color: "#ef4444",
      summary: "Empty slide",
      dimensions: { brevity: 0, language: 0, structure: 0, grounding: 0 },
      strengths: [],
      tips: ["Add text elements or a title to begin."],
    };
  }

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

  // Deduct for critic findings on this slide
  const activeFindings = (findings || []).filter((f) => !f.dismissed);
  const blockingFindings = activeFindings.filter((f) => f.severity === "block" || f.type === "jargon" || f.type === "error");
  const notes = activeFindings.filter((f) => f.severity !== "block" && f.type !== "jargon" && f.type !== "error");

  if (blockingFindings.length > 0) {
    language = Math.max(4, language - blockingFindings.length * 10);
    tips.push(`${blockingFindings.length} blocking finding${blockingFindings.length > 1 ? "s" : ""} flagged by critic.`);
  } else if (activeFindings.length === 0 && wordCount >= 10) {
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
    // Extract tokens from source titles and text
    const sourceTokens = new Set(
      sources
        .flatMap((s) => `${s.title || ""} ${s.text || ""}`.toLowerCase().split(/\s+/))
        .map((w) => w.replace(/[^a-z0-9]/g, ""))
        .filter((w) => w.length > 3)
    );

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

  const scoredSlides = deck.slides.map((s, idx) => {
    const findings = critiques.findings?.[s.id] || [];
    const result = computeSlideScore(s, deck, findings);
    return {
      index: idx,
      slideId: s.id,
      scoreResult: result,
    };
  });

  const sum = scoredSlides.reduce((acc, curr) => acc + curr.scoreResult.score, 0);
  const avg = Math.round(sum / scoredSlides.length);

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
    slides: scoredSlides,
    // Sorted by score ascending (lowest score / needs attention first)
    needsWorkOrder: [...scoredSlides].sort((a, b) => a.scoreResult.score - b.scoreResult.score),
    // Sorted by score descending (best first)
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

  pop.innerHTML = `
    <div class="score-pop-header">
      <div class="score-pop-grade" style="background: ${scoreResult.color}22; color: ${scoreResult.color}; border: 1px solid ${scoreResult.color}55">
        ${scoreResult.grade}
      </div>
      <div class="score-pop-title">
        <h4>Slide ${slideIndex + 1} Clarity: ${scoreResult.score}/100</h4>
        <p>${scoreResult.summary}</p>
      </div>
      <button class="score-pop-close" aria-label="Close">&times;</button>
    </div>

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

  pop.querySelector(".score-pop-close").onclick = () => pop.remove();

  // Close on Escape or click outside
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

  document.body.append(pop);
  return pop;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
