// The filmstrip. Every slide, drawn the way the slide is drawn.
//
// A thumbnail is the real renderer at a smaller scale - the same element
// styles, the same markdown, scaled by a transform - rather than a second
// drawing of the same model. The first version approximated font sizes here
// and the rail slowly stopped agreeing with the canvas, which is exactly the
// bug you cannot see until you are looking for a slide you cannot find.

import { S, emit, template } from "./state.js";
import { miniature } from "./preview.js";
import { W } from "./theme.js";
import { openOn } from "./critic.js";
import * as ops from "./ops.js";
import { computeSlideScore, computeDeckClarity, openScorePopover } from "./score.js";

const rail = document.getElementById("rail");

let dragFrom = null;
let railMenu = null;

function closeRailMenu() {
  if (railMenu) {
    railMenu.remove();
    railMenu = null;
  }
}

document.addEventListener("click", closeRailMenu);
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest("#rail")) closeRailMenu();
});

function openRailContextMenu(e, index) {
  e.preventDefault();
  e.stopPropagation();
  closeRailMenu();

  const menu = document.createElement("div");
  menu.className = "rail-context-menu";
  const x = Math.min(e.clientX, window.innerWidth - 190);
  const y = Math.min(e.clientY, window.innerHeight - 220);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items = [
    {
      label: "Duplicate slide",
      shortcut: "⌘D",
      action: () => ops.duplicateSlide(index),
    },
    {
      label: "Add slide below",
      shortcut: "N",
      action: () => ops.insertSlideAt(index + 1),
    },
    ...(index > 0 ? [{
      label: "Move up",
      shortcut: "↑",
      action: () => ops.moveSlide(index, index - 1),
    }] : []),
    ...(index < S.deck.slides.length - 1 ? [{
      label: "Move down",
      shortcut: "↓",
      action: () => ops.moveSlide(index, index + 1),
    }] : []),
    ...(S.deck.slides.length > 1 ? [{
      label: "Delete slide",
      shortcut: "⌫",
      danger: true,
      action: () => ops.deleteSlide(index),
    }] : []),
  ];

  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "rail-menu-item" + (item.danger ? " danger" : "");
    btn.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ""}`;
    btn.onclick = () => {
      closeRailMenu();
      item.action();
    };
    menu.append(btn);
  }

  document.body.append(menu);
  railMenu = menu;
}

function makeInserter(afterIndex) {
  const slot = document.createElement("div");
  slot.className = "rail-insert-slot";
  const btn = document.createElement("button");
  btn.className = "rail-insert-btn";
  btn.title = "Insert slide here";
  btn.textContent = "+";
  btn.onclick = (e) => {
    e.stopPropagation();
    ops.insertSlideAt(afterIndex);
  };
  slot.append(btn);
  return slot;
}

let showScores = localStorage.getItem("show_clarity_scores") !== "false";
let rankMode = false;

export function paintRail() {
  const t = template();
  rail.replaceChildren();
  closeRailMenu();

  if (!S.deck || !Array.isArray(S.deck.slides) || S.deck.slides.length === 0) return;

  const deckClarity = computeDeckClarity(S.deck, S.critiques);

  // --- Rail Header with Deck Clarity & Controls ---
  const header = document.createElement("div");
  header.className = "rail-header";

  const clarityBtn = document.createElement("button");
  clarityBtn.type = "button";
  clarityBtn.className = "rail-deck-score";
  clarityBtn.title = `Deck Feynman Clarity: ${deckClarity.averageScore}/100 (${deckClarity.summary}). Click for current slide breakdown.`;
  clarityBtn.innerHTML = `
    <span class="score-dot" style="background:${deckClarity.color}"></span>
    <span class="score-lbl">Clarity</span>
    <strong class="score-num" style="color:${deckClarity.color}">${deckClarity.averageScore}</strong>
    <span class="score-grd">${deckClarity.grade}</span>
  `;
  clarityBtn.onclick = () => {
    const curSlide = S.deck.slides[S.idx];
    if (curSlide) {
      const curScore = computeSlideScore(curSlide, S.deck, S.critiques.findings[curSlide.id] || []);
      openScorePopover(S.idx, curScore, () => ops.go(S.idx));
    }
  };

  const controls = document.createElement("div");
  controls.className = "rail-controls";

  const rankBtn = document.createElement("button");
  rankBtn.type = "button";
  rankBtn.className = "rail-icon-btn" + (rankMode ? " active" : "");
  rankBtn.title = rankMode ? "Sorted: Weakest clarity first (click to reset order)" : "Sort slides by clarity (weakest first)";
  rankBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M9 18h6"/></svg>`;
  rankBtn.onclick = () => {
    rankMode = !rankMode;
    paintRail();
  };

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "rail-icon-btn" + (showScores ? " active" : "");
  toggleBtn.title = showScores ? "Hide clarity badges on slides" : "Show clarity badges on slides";
  toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  toggleBtn.onclick = () => {
    showScores = !showScores;
    localStorage.setItem("show_clarity_scores", showScores ? "true" : "false");
    paintRail();
  };

  controls.append(rankBtn, toggleBtn);
  header.append(clarityBtn, controls);
  rail.append(header);

  if (rankMode) {
    const rankNotice = document.createElement("div");
    rankNotice.className = "rail-rank-notice";
    rankNotice.innerHTML = `<span>Ranked: Weakest First</span><button class="rank-reset-btn" type="button">Reset</button>`;
    rankNotice.querySelector(".rank-reset-btn").onclick = () => {
      rankMode = false;
      paintRail();
    };
    rail.append(rankNotice);
  }

  const slideEntries = rankMode
    ? deckClarity.needsWorkOrder.map((item, rankIdx) => ({
        s: S.deck.slides[item.index],
        i: item.index,
        rankIdx,
        scoreResult: item.scoreResult,
      }))
    : S.deck.slides.map((s, i) => ({
        s,
        i,
        rankIdx: null,
        scoreResult: computeSlideScore(s, S.deck, S.critiques.findings[s.id] || []),
      }));

  slideEntries.forEach(({ s, i, rankIdx, scoreResult }, listIdx) => {
    const row = document.createElement("div");
    row.className = "thumb" + (i === S.idx ? " on" : "") + (rankMode ? " ranked-item" : "");
    row.draggable = !rankMode;
    row.dataset.i = i;

    const numBadge = document.createElement("span");
    numBadge.className = "n";
    numBadge.textContent = rankMode ? `#${rankIdx + 1}` : i + 1;
    if (rankMode) numBadge.title = `Slide ${i + 1} (Rank #${rankIdx + 1})`;
    row.append(numBadge);

    const frame = document.createElement("div");
    frame.className = "frame";
    frame.append(miniature(s.els, t, { srcFor: (e) => `/api/deck/${S.slug}/images/${encodeURIComponent(e.src)}` }));

    if (openOn(s.id)) {
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.title = "unresolved findings";
      frame.append(flag);
    }

    if (showScores) {
      const scoreBadge = document.createElement("button");
      scoreBadge.type = "button";
      scoreBadge.className = `score-badge tier-${scoreResult.tier}`;
      scoreBadge.title = `Feynman Clarity: ${scoreResult.score}/100 (${scoreResult.summary}). Click for breakdown.`;
      scoreBadge.textContent = scoreResult.score;
      scoreBadge.onclick = (e) => {
        e.stopPropagation();
        openScorePopover(i, scoreResult, () => ops.go(i));
      };
      frame.append(scoreBadge);
    }

    frame.onclick = () => ops.go(i);
    row.append(frame);

    row.oncontextmenu = (e) => openRailContextMenu(e, i);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";

    const more = document.createElement("button");
    more.className = "more";
    more.title = "Slide actions";
    more.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>`;
    more.onclick = (e) => {
      e.stopPropagation();
      openRailContextMenu(e, i);
    };
    actions.append(more);

    if (S.deck.slides.length > 1) {
      const kill = document.createElement("button");
      kill.className = "kill";
      kill.textContent = "×";
      kill.title = "Delete this slide";
      kill.onclick = (e) => { e.stopPropagation(); ops.deleteSlide(i); };
      actions.append(kill);
    }
    row.append(actions);

    if (!rankMode) {
      row.ondragstart = (e) => {
        dragFrom = i;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      };
      row.ondragend = () => { dragFrom = null; paintRail(); };
      row.ondragover = (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const box = row.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        for (const other of rail.children) other.classList.remove("drop-before", "drop-after");
        row.classList.add(after ? "drop-after" : "drop-before");
      };
      row.ondrop = (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const box = row.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        let to = i + (after ? 1 : 0);
        if (to > dragFrom) to -= 1;
        ops.moveSlide(dragFrom, to);
        dragFrom = null;
      };
    }

    rail.append(row);

    // Between-slide inserter (only in normal sequential order)
    if (!rankMode && i < S.deck.slides.length - 1) {
      rail.append(makeInserter(i + 1));
    }
  });

  if (!rankMode) {
    const add = document.createElement("button");
    add.className = "add";
    add.textContent = "+  slide";
    add.title = "New slide  (N)";
    add.onclick = () => ops.newSlide();
    rail.append(add);
  }

  scaleRail();
}

/**
 * How far down a thumbnail is scaled, measured rather than assumed.
 *
 * The rail can be any width - it is a percentage of the window - so the only
 * honest source for this number is the box the thumbnail actually got.
 */
export function scaleRail() {
  const frame = rail.querySelector(".frame");
  if (!frame) return;
  rail.style.setProperty("--k", frame.clientWidth / W);
}
addEventListener("resize", scaleRail);
