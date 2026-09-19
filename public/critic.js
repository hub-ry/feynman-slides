// The critic, from the browser's side: when to ask, and the pane that shows
// what came back.
//
// Three moments now, where there were two. A PAUSE while typing is advisory -
// a half-typed bullet is not a finding - and FINISHING a text box is the firm
// pass. The third is ARRIVING at a slide: the pane is about the slide you are
// looking at, so landing on one whose critique is missing or out of date has
// to go get it. Without that, the pane answered a question about the slide you
// were on a minute ago, and answered it confidently.

import { S, api, save, emit, on, slide } from "./state.js";
import { iconSvg } from "./icons.js";
import { slideDigest, stillApplies, hasText } from "./readable.js";
import { openCriticSetupModal } from "./library.js";

const $ = (id) => document.getElementById(id);

const askReview = (slideId, firm) =>
  S.slug && slideId && api("/review", { method: "POST", body: JSON.stringify({ slideId, firm }) });

const PAUSE_MS = 2000;
let pauseTimer = null;

export function schedulePause() {
  clearTimeout(pauseTimer);
  // The slide is captured now, not in two seconds. The timer used to read the
  // current slide when it fired, so typing on one slide and stepping to the
  // next within the pause sent the wrong slide for review - and the finding
  // came back attached to a slide nobody had touched.
  const slideId = slide()?.id;
  pauseTimer = setTimeout(async () => { await save(true); askReview(slideId, false); }, PAUSE_MS);
}

export async function firmReview() {
  clearTimeout(pauseTimer);
  const recheckBtn = $("criticRecheck");
  if (recheckBtn) recheckBtn.classList.add("busy");
  const slideId = slide()?.id;
  await save(true);
  try {
    await askReview(slideId, true);
  } finally {
    setTimeout(() => recheckBtn?.classList.remove("busy"), 600);
  }
}

// --- is the critique on screen about the words on the slide? --------------

/**
 * Findings that still quote something written on the slide.
 *
 * The server prunes the same ones, but the browser has the newer copy of the
 * deck - it is the one being typed into - so it has to make the same
 * judgement rather than wait to be told. Everything that counts findings
 * reads them through here: the pane, the rail flag, the underlines and the
 * export gate agree because they ask the same question.
 */
export function liveOn(slide) {
  if (!slide) return [];
  return (S.critiques.findings[slide.id] ?? []).filter((f) => stillApplies(f, slide));
}

/** Where a slide's critique stands against what is written on it now. */
export function standing(slide) {
  if (!slide || !hasText(slide)) return "empty";
  if (S.reviewing.has(slide.id)) return "reading";
  return S.critiques.reviewed?.[slide.id]?.digest === slideDigest(slide) ? "current" : "stale";
}

// One ask per slide per version of its text, so a repaint storm cannot turn
// into a request storm.
const asked = new Map();

/**
 * Make sure the slide in front of you has been read at the words now on it.
 *
 * Not while a text box is open: that moment belongs to the pause timer, and
 * asking for a firm review of a sentence someone is halfway through writing
 * is the one thing the critic is told not to do.
 */
export async function ensureReviewed() {
  const cur = slide();
  if (!S.slug || !cur || S.editing) return;
  if (!hasText(cur)) return;

  const now = slideDigest(cur);
  if (S.critiques.reviewed?.[cur.id]?.digest === now) return;
  if (S.reviewing.has(cur.id) || asked.get(cur.id) === now) return;

  asked.set(cur.id, now);
  // Saved first, or the server reviews the copy on disk, records ITS
  // fingerprint, and we come straight back here to ask again.
  await save(true);
  await askReview(cur.id, true);
}

// --- the stream -----------------------------------------------------------

let stream = null;
export function connect() {
  disconnect();
  stream = new EventSource(`/api/deck/${S.slug}/events`);
  stream.addEventListener("reviewing", (e) => {
    S.reviewing.add(JSON.parse(e.data).slideKey);
    emit("status");
    emit("findings");
  });
  stream.addEventListener("idle", (e) => {
    S.reviewing.delete(JSON.parse(e.data).slideKey);
    emit("status");
    emit("findings");
  });
  stream.addEventListener("findings", (e) => {
    const { slideKey, findings, criticMode, criticProvider, digest } = JSON.parse(e.data);
    S.critiques.findings[slideKey] = findings;
    if (digest) {
      S.critiques.reviewed ??= {};
      S.critiques.reviewed[slideKey] = { digest };
    }
    asked.delete(slideKey);
    if (criticMode) S.criticMode = criticMode;
    if (criticProvider) S.criticProvider = criticProvider;
    emit("findings");
    emit("gate");
  });
  stream.addEventListener("error", (e) => {
    try { emit("say", JSON.parse(e.data).message); } catch { /* reconnecting */ }
  });
}
export function disconnect() { stream?.close(); stream = null; }

/** The quotes the critic flagged, so the box on the slide can underline itself. */
export function flagged() {
  return liveOn(slide())
    .filter((f) => !f.dismissed && f.severity !== "note")
    .map((f) => f.quote);
}

/** How many unresolved findings a slide is carrying, for the rail's flag. */
export const openOn = (slide) =>
  liveOn(slide).filter((f) => !f.dismissed && f.severity !== "note").length;

/**
 * What stands between this deck and an export, counted here rather than taken
 * from the server, so the gate, the pane and the rail cannot disagree while
 * there are edits the server has not seen yet.
 */
export const blockingNow = () =>
  S.deck.slides.reduce((n, s) => n + openOn(s), 0);

// --- the pane -------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let filterMode = "current"; // "current" | "all"
let headerBound = false;

function bindHeaderEvents(goTo) {
  if (headerBound) return;
  headerBound = true;

  on("critic-configured", () => {
    updateEngineUI();
    firmReview();
  });

  const engineBtn = $("criticEngineBtn");
  if (engineBtn) {
    engineBtn.onclick = (e) => {
      e.stopPropagation();
      openCriticSetupModal();
    };
  }

  const recheckBtn = $("criticRecheck");
  if (recheckBtn) {
    recheckBtn.onclick = (e) => {
      e.stopPropagation();
      firmReview();
    };
  }

  const tabCur = $("criticFilterCurrent");
  const tabAll = $("criticFilterAll");
  if (tabCur) {
    tabCur.onclick = () => {
      filterMode = "current";
      paintFindings(goTo);
    };
  }
  if (tabAll) {
    tabAll.onclick = () => {
      filterMode = "all";
      paintFindings(goTo);
    };
  }
}

/**
 * The pill names the engine that actually ran.
 */
function updateEngineUI() {
  const provider = S.criticProvider ?? "heuristic";
  const isHeuristic = provider === "heuristic";
  const dot = $("criticEngineDot");
  const label = $("criticEngineLabel");
  const btn = $("criticEngineBtn");
  const NAMES = { heuristic: "Local", claude: "Claude", gemini: "Gemini", openai: "OpenAI", local: "Local model" };
  if (dot) dot.className = `engine-dot ${isHeuristic ? "heuristic" : "claude"}`;
  if (label) label.textContent = NAMES[provider] ?? "Local";
  if (btn) {
    btn.title = `AI Reviewer: ${S.criticMode ?? NAMES[provider] ?? "Local"} - click to configure`;
  }
}

function card(f, slideIndex, goTo) {
  const el = document.createElement("article");
  el.className = `finding sev-${f.severity}` + (f.dismissed ? " dismissed" : "");

  const meta = document.createElement("div");
  meta.className = "finding-meta";

  const left = document.createElement("div");
  left.className = "finding-meta-left";

  const sevBadge = document.createElement("span");
  sevBadge.className = `sev-badge ${f.severity}`;
  const dot = document.createElement("span");
  dot.className = "sev-pip";
  sevBadge.append(dot);
  const sevText = f.severity === "error" ? "Conflict" : f.severity === "jargon" ? "Jargon" : "Note";
  sevBadge.append(document.createTextNode(sevText));
  left.append(sevBadge);

  const basisBadge = document.createElement("span");
  basisBadge.className = "basis-badge";
  basisBadge.title = f.basis === "source" ? "Flagged against source bin" : "Evaluated from general knowledge";
  basisBadge.textContent = f.basis === "source" ? "Source" : "Knowledge";
  left.append(basisBadge);

  meta.append(left);

  const right = document.createElement("div");
  right.className = "finding-meta-right";

  if (!f.dismissed && f.severity !== "note") {
    const blk = document.createElement("span");
    blk.className = "block-badge";
    blk.title = "Blocks export until resolved or disputed";
    blk.innerHTML = `${iconSvg("lock-simple", 12)} <span>Blocks</span>`;
    right.append(blk);
  }

  if (slideIndex !== undefined && slideIndex !== S.idx) {
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "finding-slide-link";
    jump.textContent = `Slide ${slideIndex + 1}`;
    jump.title = `Jump to slide ${slideIndex + 1}`;
    jump.onclick = (e) => {
      e.stopPropagation();
      goTo(slideIndex);
    };
    right.append(jump);
  }

  meta.append(right);
  el.append(meta);

  if (f.quote) {
    const qBox = document.createElement("div");
    qBox.className = "finding-quote";
    const code = document.createElement("code");
    code.textContent = `"${f.quote}"`;
    qBox.append(code);
    el.append(qBox);
  }

  const prob = document.createElement("p");
  prob.className = "finding-problem";
  prob.textContent = f.problem;
  el.append(prob);

  if (f.fix_hint) {
    const hint = document.createElement("div");
    hint.className = "finding-hint";
    hint.innerHTML = `<span class="hint-prefix">Investigate:</span> <span class="hint-text">${escapeHtml(f.fix_hint)}</span>`;
    el.append(hint);
  }

  if (f.dismissed) {
    const dis = document.createElement("div");
    dis.className = "finding-dismissed-banner";
    dis.innerHTML = `
      <div class="dis-content">
        <span class="dis-icon">${iconSvg("check", 12)}</span>
        <span class="dis-text" title="${escapeHtml(f.dismissed.reason)}">Disputed: <em>${escapeHtml(f.dismissed.reason)}</em></span>
      </div>
    `;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "dis-restore-btn";
    restore.textContent = "Restore";
    restore.title = "Re-enable this finding";
    // Re-opening a finding is a server-side fact. Doing it only in the browser
    // meant the dispute was still on disk: the finding came back on reload,
    // and the critic still believed it had been told to drop the subject.
    restore.onclick = async () => {
      restore.disabled = true;
      const { ok } = await api("/restore", { method: "POST", body: JSON.stringify({ id: f.id }) });
      if (!ok) { restore.disabled = false; return; }
      delete f.dismissed;
      emit("findings"); emit("gate"); emit("canvas"); emit("rail");
    };
    dis.append(restore);
    el.append(dis);
    return el;
  }

  const actions = document.createElement("div");
  actions.className = "finding-actions";
  const disputeBtn = document.createElement("button");
  disputeBtn.type = "button";
  disputeBtn.className = "dispute-trigger";
  disputeBtn.innerHTML = `${iconSvg("pencil-simple", 13)} <span>Dispute finding...</span>`;
  actions.append(disputeBtn);
  el.append(actions);

  disputeBtn.onclick = () => {
    actions.remove();
    const form = document.createElement("form");
    form.className = "dispute-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "dispute-input";
    input.placeholder = "Why is this claim sound? (Enter to confirm)";
    input.autocomplete = "off";

    const btnRow = document.createElement("div");
    btnRow.className = "dispute-btn-row";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "dispute-cancel-btn";
    cancelBtn.textContent = "Cancel";

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "dispute-submit-btn";
    submitBtn.textContent = "Confirm";

    btnRow.append(cancelBtn, submitBtn);
    form.append(input, btnRow);
    el.append(form);
    input.focus();

    cancelBtn.onclick = () => {
      form.remove();
      el.append(actions);
    };

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      submitBtn.disabled = true;
      const { ok } = await api("/dismiss", {
        method: "POST",
        body: JSON.stringify({ id: f.id, reason: val }),
      });
      if (ok) {
        f.dismissed = { reason: val };
        emit("findings"); emit("gate"); emit("canvas"); emit("rail");
      } else {
        submitBtn.disabled = false;
      }
    };
  };

  return el;
}

/** A one-line banner above a critique that is being re-checked. */
function recheckBanner(state, index) {
  const el = document.createElement("div");
  el.className = "critique-recheck" + (state === "reading" ? " reading" : "");
  el.innerHTML = `
    <span class="recheck-pip"></span>
    <span>${state === "reading" ? `Reading slide ${index + 1}` : `Slide ${index + 1} changed since this was written`}</span>
  `;
  return el;
}

function emptyState({ icon, title, desc, clean = false, working = false }) {
  const el = document.createElement("div");
  el.className = "critique-empty" + (clean ? " clean" : "") + (working ? " working" : "");
  el.innerHTML = `
    <div class="empty-icon">${iconSvg(icon, 22)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <p class="empty-desc">${escapeHtml(desc)}</p>
  `;
  return el;
}

export function paintFindings(goTo) {
  bindHeaderEvents(goTo);
  updateEngineUI();

  const curSlide = slide();
  const state = standing(curSlide);
  const curFindings = liveOn(curSlide);
  const curActive = curFindings.filter((f) => !f.dismissed);

  const allLive = S.deck.slides.flatMap((s) => liveOn(s));
  const allActive = allLive.filter((f) => !f.dismissed);
  const blockingCount = allActive.filter((f) => f.severity !== "note").length;

  // Titlebar badge
  const titleBadge = $("criticCount");
  if (titleBadge) {
    const showCount = blockingCount || allActive.length;
    titleBadge.textContent = showCount || "";
    titleBadge.hidden = !showCount;
  }

  // Header status pill
  const statusPill = $("critiqueStatusPill");
  if (statusPill) {
    statusPill.hidden = false;
    if (blockingCount > 0) {
      statusPill.className = "critique-status-pill blocking";
      statusPill.textContent = `${blockingCount} blocking`;
    } else if (allActive.length > 0) {
      statusPill.className = "critique-status-pill note";
      statusPill.textContent = `${allActive.length} note${allActive.length > 1 ? "s" : ""}`;
    } else {
      statusPill.className = "critique-status-pill clean";
      statusPill.textContent = "All clear";
    }
  }

  // Filter button counts
  const curCountEl = $("criticCurrentCount");
  const allCountEl = $("criticAllCount");
  if (curCountEl) curCountEl.textContent = String(curActive.length);
  if (allCountEl) allCountEl.textContent = String(allActive.length);

  const tabCur = $("criticFilterCurrent");
  const tabAll = $("criticFilterAll");
  if (tabCur) tabCur.classList.toggle("on", filterMode === "current");
  if (tabAll) tabAll.classList.toggle("on", filterMode === "all");

  const box = $("findings");
  if (!box) return;
  box.replaceChildren();

  if (S.criticProvider === "heuristic") {
    const banner = document.createElement("div");
    banner.className = "critic-offline-banner";
    banner.innerHTML = `
      <span class="offline-icon">${iconSvg("sparkle", 14)}</span>
      <span class="offline-text">Running offline rules. Connect Gemini, Claude, or Ollama for deep checks.</span>
      <button type="button" class="offline-btn">Set up AI &rarr;</button>
    `;
    banner.querySelector(".offline-btn").onclick = () => openCriticSetupModal();
    box.append(banner);
  }

  if (filterMode === "current") {
    // Four answers, and the pane has to give the right one. An empty findings
    // list used to mean "clean", "never looked" and "looked, at words you have
    // since replaced" all at once, which is how slide 1's verdict ended up
    // standing in for slide 2's.
    if (state === "empty") {
      box.append(emptyState({
        icon: "pencil-simple",
        title: `Slide ${S.idx + 1} is blank`,
        desc: "Write something and the critic reads it as you go.",
      }));
    } else if (curFindings.length) {
      const list = document.createElement("div");
      list.className = "findings-slide-list";
      if (state !== "current") list.append(recheckBanner(state, S.idx));
      for (const f of curFindings) list.append(card(f, S.idx, goTo));
      box.append(list);
    } else if (state === "current") {
      const empty = emptyState({
        icon: "shield-check",
        title: "This slide is clean",
        desc: `No factual conflicts or unexplained jargon on slide ${S.idx + 1}.`,
        clean: true,
      });
      if (S.criticProvider === "heuristic") {
        const setupAiBtn = document.createElement("button");
        setupAiBtn.type = "button";
        setupAiBtn.className = "empty-ai-btn";
        setupAiBtn.textContent = "Configure AI Reviewer (Gemini, Claude, Ollama) \u2192";
        setupAiBtn.onclick = () => openCriticSetupModal();
        empty.append(setupAiBtn);
      }
      if (allActive.length > 0) {
        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.className = "empty-switch-btn";
        switchBtn.textContent = `View ${allActive.length} issue${allActive.length > 1 ? "s" : ""} on other slides`;
        switchBtn.onclick = () => { filterMode = "all"; paintFindings(goTo); };
        empty.append(switchBtn);
      }
      box.append(empty);
    } else {
      box.append(emptyState({
        icon: "eye",
        title: `Reading slide ${S.idx + 1}`,
        desc: "Checking what is written here against your source bin.",
        working: true,
      }));
    }
    ensureReviewed();
    return;
  }

  // filterMode === "all"
  const groups = S.deck.slides
    .map((s, i) => ({ i, id: s.id, findings: liveOn(s) }))
    .filter((g) => g.findings.length)
    .sort((a, b) => (b.i === S.idx) - (a.i === S.idx) || a.i - b.i);

  if (!groups.length) {
    const hasAnyChecked = Object.keys(S.critiques.reviewed ?? {}).length > 0;
    box.append(emptyState({
      icon: hasAnyChecked ? "check-circle" : "pencil-simple",
      title: hasAnyChecked ? "All slides clear" : "Editorial review",
      desc: hasAnyChecked
        ? "Every claim satisfies Feynman clarity rules. Ready to export."
        : "Claims are verified against source material and ungrounded jargon is flagged as you write.",
      clean: hasAnyChecked,
    }));
    ensureReviewed();
    return;
  }

  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "slide-group" + (g.i === S.idx ? " current" : "");

    const h = document.createElement("div");
    h.className = "slide-group-head";
    h.innerHTML = `
      <span class="slide-group-title">Slide ${g.i + 1}</span>
      ${g.i === S.idx ? '<span class="slide-group-now">Current</span>' : ""}
    `;
    h.onclick = () => goTo(g.i);
    sec.append(h);

    const st = standing(S.deck.slides[g.i]);
    if (st !== "current" && st !== "empty") sec.append(recheckBanner(st, g.i));

    for (const f of g.findings) sec.append(card(f, g.i, goTo));
    box.append(sec);
  }

  ensureReviewed();
}
