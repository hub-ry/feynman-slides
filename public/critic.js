// The critic, from the browser's side: when to ask, and the pane that shows
// what came back.
//
// Two moments, unchanged from the first version because they are the whole
// idea: a PAUSE while typing is advisory - a half-typed bullet is not a
// finding - and FINISHING a text box is the firm pass.

import { S, api, save, emit, slide } from "./state.js";
import { iconSvg } from "./icons.js";

const $ = (id) => document.getElementById(id);

const askReview = (firm) =>
  S.slug && api("/review", { method: "POST", body: JSON.stringify({ slideId: slide()?.id, firm }) });

const PAUSE_MS = 2000;
let pauseTimer = null;

export function schedulePause() {
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(async () => { await save(true); askReview(false); }, PAUSE_MS);
}

export async function firmReview() {
  clearTimeout(pauseTimer);
  const recheckBtn = $("criticRecheck");
  if (recheckBtn) recheckBtn.classList.add("busy");
  await save(true);
  try {
    await askReview(true);
  } finally {
    setTimeout(() => recheckBtn?.classList.remove("busy"), 600);
  }
}

// --- the stream -----------------------------------------------------------

let stream = null;
export function connect() {
  disconnect();
  stream = new EventSource(`/api/deck/${S.slug}/events`);
  stream.addEventListener("reviewing", (e) => {
    S.reviewing.add(JSON.parse(e.data).slideKey);
    emit("status");
  });
  stream.addEventListener("idle", (e) => {
    S.reviewing.delete(JSON.parse(e.data).slideKey);
    emit("status");
  });
  stream.addEventListener("findings", (e) => {
    const { slideKey, findings, blocking, criticMode } = JSON.parse(e.data);
    S.critiques.findings[slideKey] = findings;
    S.blocking = blocking;
    if (criticMode) S.criticMode = criticMode;
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
  return (S.critiques.findings[slide()?.id] ?? [])
    .filter((f) => !f.dismissed && f.severity !== "note")
    .map((f) => f.quote);
}

export const openOn = (slideId) =>
  (S.critiques.findings[slideId] ?? []).filter((f) => !f.dismissed && f.severity !== "note").length;

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

  const engineBtn = $("criticEngineBtn");
  if (engineBtn) {
    engineBtn.onclick = async (e) => {
      e.stopPropagation();
      const isHeuristic = (S.criticMode ?? "heuristic") === "heuristic";
      const next = isHeuristic ? "claude" : "heuristic";
      S.criticMode = next;
      updateEngineUI();
      await fetch("/api/critic/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next, slug: S.slug }),
      }).catch(() => {});
      firmReview();
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

function updateEngineUI() {
  const isHeuristic = (S.criticMode ?? "heuristic") === "heuristic";
  const dot = $("criticEngineDot");
  const label = $("criticEngineLabel");
  const btn = $("criticEngineBtn");
  if (dot) {
    dot.className = `engine-dot ${isHeuristic ? "heuristic" : "claude"}`;
  }
  if (label) {
    label.textContent = isHeuristic ? "Local" : "Claude";
  }
  if (btn) {
    btn.title = isHeuristic
      ? "Engine: Local Heuristic (Click to switch to Claude)"
      : "Engine: Claude AI (Click to switch to Local)";
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
    blk.innerHTML = `${iconSvg("lock-simple", 11)} <span>Blocks</span>`;
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
        <span class="dis-icon">${iconSvg("check", 11)}</span>
        <span class="dis-text" title="${escapeHtml(f.dismissed.reason)}">Disputed: <em>${escapeHtml(f.dismissed.reason)}</em></span>
      </div>
    `;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "dis-restore-btn";
    restore.textContent = "Restore";
    restore.title = "Re-enable this finding";
    restore.onclick = () => {
      delete f.dismissed;
      const allActive = Object.values(S.critiques.findings || {}).flat().filter((x) => !x.dismissed && x.severity !== "note");
      S.blocking = allActive.length;
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
  disputeBtn.innerHTML = `${iconSvg("pencil-simple", 11)} <span>Dispute finding...</span>`;
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
      const { ok, data } = await api("/dismiss", {
        method: "POST",
        body: JSON.stringify({ id: f.id, reason: val }),
      });
      if (ok) {
        f.dismissed = { reason: val };
        S.blocking = data.blocking;
        emit("findings"); emit("gate"); emit("canvas"); emit("rail");
      } else {
        submitBtn.disabled = false;
      }
    };
  };

  return el;
}

export function paintFindings(goTo) {
  bindHeaderEvents(goTo);
  updateEngineUI();

  const curSlide = slide();
  const curSlideId = curSlide?.id;
  const curFindings = curSlideId ? (S.critiques.findings[curSlideId] ?? []) : [];
  const curActive = curFindings.filter((f) => !f.dismissed);

  const allEntries = Object.entries(S.critiques.findings ?? {});
  const allFindings = allEntries.flatMap(([, list]) => list);
  const allActive = allFindings.filter((f) => !f.dismissed);
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

  if (filterMode === "current") {
    if (curFindings.length > 0) {
      const list = document.createElement("div");
      list.className = "findings-slide-list";
      for (const f of curFindings) {
        list.append(card(f, S.idx, goTo));
      }
      box.append(list);
    } else {
      const empty = document.createElement("div");
      empty.className = "critique-empty clean";
      empty.innerHTML = `
        <div class="empty-icon">${iconSvg("shield-check", 22)}</div>
        <div class="empty-title">This slide is clean</div>
        <p class="empty-desc">No factual conflicts or unexplained jargon detected on slide ${S.idx + 1}.</p>
      `;
      if (allActive.length > 0) {
        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.className = "empty-switch-btn";
        switchBtn.textContent = `View ${allActive.length} issue${allActive.length > 1 ? "s" : ""} on other slides`;
        switchBtn.onclick = () => {
          filterMode = "all";
          paintFindings(goTo);
        };
        empty.append(switchBtn);
      }
      box.append(empty);
    }
    return;
  }

  // filterMode === "all"
  const groups = S.deck.slides
    .map((s, i) => ({ i, id: s.id, findings: S.critiques.findings[s.id] ?? [] }))
    .filter((g) => g.findings.length)
    .sort((a, b) => (b.i === S.idx) - (a.i === S.idx) || a.i - b.i);

  if (!groups.length) {
    const empty = document.createElement("div");
    const hasAnyChecked = Object.keys(S.critiques.findings ?? {}).length > 0;
    empty.className = "critique-empty" + (hasAnyChecked ? " clean" : "");
    empty.innerHTML = `
      <div class="empty-icon">${iconSvg(hasAnyChecked ? "check-circle" : "pencil-simple", 22)}</div>
      <div class="empty-title">${hasAnyChecked ? "All slides clear" : "Editorial review"}</div>
      <p class="empty-desc">${
        hasAnyChecked
          ? "Every claim satisfies Feynman clarity rules. Ready to export."
          : "Claims are verified against source material and ungrounded jargon is flagged as you write."
      }</p>
    `;
    box.append(empty);
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

    for (const f of g.findings) {
      sec.append(card(f, g.i, goTo));
    }
    box.append(sec);
  }
}
