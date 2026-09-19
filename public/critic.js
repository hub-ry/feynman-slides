// The critic, from the browser's side: when to ask, and the pane that shows
// what came back.
//
// Two moments, unchanged from the first version because they are the whole
// idea: a PAUSE while typing is advisory - a half-typed bullet is not a
// finding - and FINISHING a text box is the firm pass.

import { S, api, save, emit, slide } from "./state.js";

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
  await save(true);
  askReview(true);
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

const tag = (cls, text) =>
  Object.assign(document.createElement("span"), { className: `tag ${cls}`, textContent: text });

function card(f) {
  const el = document.createElement("article");
  el.className = `finding ${f.severity}` + (f.dismissed ? " dismissed" : "");
  const tags = document.createElement("div");
  tags.className = "tags";
  tags.append(tag(f.severity, f.severity), tag("basis", f.basis));
  if (!f.dismissed && f.severity !== "note") {
    const b = document.createElement("span");
    b.className = "blocks";
    b.textContent = "holds export";
    tags.append(b);
  }
  el.append(tags);
  el.append(Object.assign(document.createElement("blockquote"), { textContent: f.quote }));
  el.append(Object.assign(document.createElement("p"), { textContent: f.problem }));
  if (f.fix_hint) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.append(Object.assign(document.createElement("b"), { textContent: "Go find out: " }), f.fix_hint);
    el.append(hint);
  }
  if (f.dismissed) {
    el.append(
      Object.assign(document.createElement("p"), {
        className: "why",
        textContent: `You rejected this: ${f.dismissed.reason}`,
      }),
    );
    return el;
  }
  // Rejection costs a sentence, on purpose. A one-click dismiss is not a
  // forcing function, and writing down why a correction is wrong is the same
  // exercise the deck is for.
  const actions = document.createElement("div");
  actions.className = "actions";
  const open = Object.assign(document.createElement("button"), { textContent: "this is wrong" });
  actions.append(open);
  el.append(actions);
  open.onclick = () => {
    actions.remove();
    const form = document.createElement("form");
    form.className = "reject";
    const input = Object.assign(document.createElement("input"), { placeholder: "why is it wrong?" });
    const send = Object.assign(document.createElement("button"), { textContent: "reject" });
    form.append(input, send);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!input.value.trim()) return;
      send.disabled = true;
      const { ok, data } = await api("/dismiss", {
        method: "POST",
        body: JSON.stringify({ id: f.id, reason: input.value.trim() }),
      });
      if (ok) {
        f.dismissed = { reason: input.value.trim() };
        S.blocking = data.blocking;
        emit("findings"); emit("gate"); emit("canvas"); emit("rail");
      } else send.disabled = false;
    };
    el.append(form);
    input.focus();
  };
  return el;
}

export function paintFindings(goTo) {
  const box = $("findings");
  box.replaceChildren();

  const modeBar = document.createElement("div");
  modeBar.className = "critic-mode-bar";
  const isHeuristic = (S.criticMode ?? "heuristic") === "heuristic";
  modeBar.innerHTML = `
    <span class="critic-mode-pill ${isHeuristic ? "heuristic" : "claude"}">
      <span class="dot"></span>
      ${isHeuristic ? "Local Critic (Active)" : "Claude AI"}
    </span>
    <button class="critic-mode-toggle" title="Switch critic mode">
      ${isHeuristic ? "Try Claude" : "Use Local"}
    </button>
  `;
  const toggleBtn = modeBar.querySelector(".critic-mode-toggle");
  if (toggleBtn) {
    toggleBtn.onclick = async (e) => {
      e.stopPropagation();
      const next = isHeuristic ? "claude" : "heuristic";
      S.criticMode = next;
      await fetch("/api/critic/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next, slug: S.slug }),
      });
      firmReview();
    };
  }
  box.append(modeBar);

  const groups = S.deck.slides
    .map((s, i) => ({ i, id: s.id, findings: S.critiques.findings[s.id] ?? [] }))
    .filter((g) => g.findings.length)
    .sort((a, b) => (b.i === S.idx) - (a.i === S.idx) || a.i - b.i);

  const count = groups.reduce((n, g) => n + g.findings.filter((f) => !f.dismissed).length, 0);
  $("criticCount").textContent = count || "";
  $("criticCount").hidden = !count;

  if (!groups.length) {
    const p = document.createElement("p");
    const any = Object.keys(S.critiques.findings).length > 0;
    p.className = "empty" + (any ? " clean" : "");
    p.textContent = any
      ? "Nothing open. Write another slide."
      : "Write a slide. The critic reads it when you pause, and again when you finish a text box.";
    box.append(p);
    return;
  }
  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "slide-group" + (g.i === S.idx ? " current" : "");
    const h = Object.assign(document.createElement("h3"), { textContent: `slide ${g.i + 1}` });
    h.onclick = () => goTo(g.i);
    sec.append(h);
    for (const f of g.findings) sec.append(card(f));
    box.append(sec);
  }
}
