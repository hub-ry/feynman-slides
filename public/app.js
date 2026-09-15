// The editor half. The outline textarea is the only source of truth on this
// page; everything in the critique pane is keyed off what the server sends
// back, so a reload never invents state.

const $ = (id) => document.getElementById(id);
const ta = $("outline");

let slug = null;
let stream = null;
let state = { findings: {}, dismissed: [] };
let currentKey = null;
let reviewing = new Set();

// Two moments, per the design: a pause while typing is advisory, and leaving a
// slide is firm. PAUSE_MS is long enough that it does not fire between words.
const PAUSE_MS = 2000;
const SAVE_MS = 400;
let pauseTimer = null;
let saveTimer = null;

// --- slides, computed from the caret -------------------------------------

/** Heading offsets, mirroring src/outline.ts so the two agree on slide identity. */
function slides(text) {
  const out = [];
  const re = /^## (.*)$/gm;
  let m;
  while ((m = re.exec(text))) out.push({ index: out.length, title: m[1].trim(), start: m.index });
  out.forEach((s, i) => (s.end = out[i + 1]?.start ?? text.length));
  return out;
}
const keyOf = (s) => `${s.index}:${s.title.toLowerCase()}`;
function slideAt(text, caret) {
  const all = slides(text);
  return all.find((s) => caret >= s.start && caret < s.end) ?? all.at(-1) ?? null;
}

// --- server ---------------------------------------------------------------

const api = async (path, opts) => {
  const res = await fetch(`/api/deck/${slug}${path}`, {
    ...opts,
    headers: opts?.body ? { "content-type": "application/json" } : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
};

const save = () => api("/outline", { method: "POST", body: JSON.stringify({ text: ta.value }) });
const review = (caret, firm) =>
  api("/review", { method: "POST", body: JSON.stringify({ caret, firm }) });

function connect() {
  stream?.close();
  stream = new EventSource(`/api/deck/${slug}/events`);
  stream.addEventListener("reviewing", (e) => {
    reviewing.add(JSON.parse(e.data).slideKey);
    paint();
  });
  stream.addEventListener("idle", (e) => {
    reviewing.delete(JSON.parse(e.data).slideKey);
    paint();
  });
  stream.addEventListener("findings", (e) => {
    const { slideKey, findings, blocking } = JSON.parse(e.data);
    state.findings[slideKey] = findings;
    gate(blocking);
    paint();
  });
  stream.addEventListener("error", (e) => {
    try { $("status").textContent = JSON.parse(e.data).message; } catch { /* reconnecting */ }
  });
}

// --- the gate -------------------------------------------------------------

function gate(blocking) {
  const btn = $("export");
  btn.disabled = blocking > 0 || !slug;
  const g = $("gate");
  g.hidden = !blocking;
  g.textContent = blocking ? `${blocking} unresolved` : "";
  btn.title = blocking
    ? "Errors and jargon hold the export. Fix them, or reject them with a reason."
    : "";
}

// --- rendering ------------------------------------------------------------

function paint() {
  const text = ta.value;
  const here = slideAt(text, ta.selectionStart);
  currentKey = here ? keyOf(here) : null;
  $("where").textContent = here
    ? `slide ${here.index + 1} · ${here.title || "(untitled)"}`
    : "above the first slide";
  $("status").className = "status" + (reviewing.size ? " busy" : "");
  $("status").textContent = reviewing.size ? "reading your slide" : "";

  const live = new Map(slides(text).map((s) => [keyOf(s), s]));
  const groups = [...live.values()]
    .map((s) => ({ slide: s, findings: state.findings[keyOf(s)] ?? [] }))
    .filter((g) => g.findings.length)
    .sort((a, b) =>
      (keyOf(b.slide) === currentKey) - (keyOf(a.slide) === currentKey) ||
      a.slide.index - b.slide.index);

  const box = $("findings");
  box.replaceChildren();

  if (!groups.length) {
    const p = document.createElement("p");
    const reviewed = Object.keys(state.findings).length > 0;
    p.className = "empty" + (reviewed ? " clean" : "");
    p.textContent = reviewed
      ? "Nothing open. Write another slide."
      : "Write a slide. The critic reads it when you pause, and again when you move on.";
    box.append(p);
    return;
  }

  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "slide-group" + (keyOf(g.slide) === currentKey ? " current" : "");
    const h = document.createElement("h3");
    h.textContent = `${String(g.slide.index + 1).padStart(2, "0")} · ${g.slide.title || "(untitled)"}`;
    sec.append(h);
    for (const f of g.findings) sec.append(card(f));
    box.append(sec);
  }
}

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

  const q = document.createElement("blockquote");
  q.textContent = f.quote;
  el.append(q);

  const p = document.createElement("p");
  p.textContent = f.problem;
  el.append(p);

  if (f.fix_hint) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.append(Object.assign(document.createElement("b"), { textContent: "Go find out: " }), f.fix_hint);
    el.append(hint);
  }

  if (f.dismissed) {
    const why = document.createElement("p");
    why.className = "why";
    why.textContent = `You rejected this: ${f.dismissed.reason}`;
    el.append(why);
    return el;
  }

  // Rejection costs a sentence, on purpose. A one-click dismiss is not a
  // forcing function, and writing down why a correction is wrong is the same
  // exercise the deck is for.
  const actions = document.createElement("div");
  actions.className = "actions";
  const open = document.createElement("button");
  open.textContent = "this is wrong";
  actions.append(open);
  el.append(actions);

  open.onclick = () => {
    actions.remove();
    const form = document.createElement("form");
    form.className = "reject";
    const input = document.createElement("input");
    input.placeholder = "why is it wrong?";
    input.required = true;
    const send = Object.assign(document.createElement("button"), { textContent: "reject" });
    form.append(input, send);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      send.disabled = true;
      const { ok, data } = await api("/dismiss", {
        method: "POST",
        body: JSON.stringify({ id: f.id, reason: input.value.trim() }),
      });
      if (ok) {
        f.dismissed = { reason: input.value.trim() };
        gate(data.blocking);
        paint();
      } else send.disabled = false;
    };
    el.append(form);
    input.focus();
  };
  return el;
}

const tag = (cls, text) =>
  Object.assign(document.createElement("span"), { className: `tag ${cls}`, textContent: text });

// --- editing --------------------------------------------------------------

ta.addEventListener("input", () => {
  clearTimeout(saveTimer);
  clearTimeout(pauseTimer);
  saveTimer = setTimeout(save, SAVE_MS);
  pauseTimer = setTimeout(async () => {
    await save();
    review(ta.selectionStart, false);
  }, PAUSE_MS);
  trackSlide();
});

// Leaving a slide is the firm pass. It reviews the slide you LEFT, at its own
// offset - not wherever the caret now is.
let lastSlide = null;
function trackSlide() {
  const here = slideAt(ta.value, ta.selectionStart);
  const key = here ? keyOf(here) : null;
  if (lastSlide && key !== lastSlide.key) {
    clearTimeout(pauseTimer);
    save().then(() => review(lastSlide.start, true));
  }
  lastSlide = here ? { key, start: here.start } : null;
  paint();
}
for (const ev of ["click", "keyup", "select"]) ta.addEventListener(ev, trackSlide);
ta.addEventListener("blur", () => {
  if (!lastSlide) return;
  clearTimeout(pauseTimer);
  save().then(() => review(lastSlide.start, true));
});

// --- decks ----------------------------------------------------------------

async function load(next) {
  slug = next;
  localStorage.setItem("deck", slug);
  const res = await fetch(`/api/deck/${slug}`);
  const { text, state: s, blocking } = await res.json();
  ta.value = text;
  state = s;
  lastSlide = null;
  reviewing = new Set();
  gate(blocking);
  connect();
  trackSlide();
  ta.focus();
}

async function decks(select) {
  const list = await (await fetch("/api/decks")).json();
  const picker = $("picker");
  picker.replaceChildren();
  for (const d of list) {
    picker.append(Object.assign(document.createElement("option"), { value: d.slug, textContent: d.title }));
  }
  const want = select ?? localStorage.getItem("deck");
  const pick = list.find((d) => d.slug === want)?.slug ?? list[0]?.slug;
  if (pick) { picker.value = pick; await load(pick); }
  else { ta.placeholder = "No decks yet. Make one."; gate(0); }
}

$("picker").onchange = (e) => load(e.target.value);

$("new").onclick = async () => {
  const title = prompt("What are you teaching yourself?");
  if (!title?.trim()) return;
  const res = await fetch("/api/decks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const { slug: made } = await res.json();
  await decks(made);
};

$("export").onclick = async () => {
  const { ok, data } = await api("/export", { method: "POST" });
  const s = $("status");
  s.className = "status";
  if (ok) s.textContent = `wrote ${data.path}`;
  else { s.textContent = data.error ?? "export refused"; gate(data.findings?.length ?? 1); }
};

decks();
