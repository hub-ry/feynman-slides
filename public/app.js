// The canvas editor.
//
// Everything is authored in LOGICAL units on a 960x540 slide and the stage is
// scaled as a whole to whatever room it has. No element ever stores a screen
// pixel, so the same deck is the same deck at any window size - and every
// mouse position has to be divided back through that scale exactly once, which
// is the only real subtlety in here.

import { FONT, css } from "./type.js";

const W = 960, H = 540;
const $ = (id) => document.getElementById(id);
const stage = $("stage"), canvas = $("canvas"), guides = $("guides");

let slug = null;
let deck = { title: "", slides: [] };
let state = { findings: {}, dismissed: [] };
let idx = 0;              // current slide
let sel = null;           // selected element id
let editing = null;       // element id being typed into
let scale = 1;
let stream = null;
let reviewing = new Set();
const undo = [];

const slide = () => deck.slides[idx];
const elById = (id) => slide()?.els.find((e) => e.id === id) ?? null;
const uid = () => Math.random().toString(36).slice(2, 10);

// --- server ---------------------------------------------------------------

const api = (path, opts) =>
  fetch(`/api/deck/${slug}${path}`, {
    ...opts,
    headers: opts?.body && typeof opts.body === "string" ? { "content-type": "application/json" } : opts?.headers,
  }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

let saveTimer = null;
function save(now = false) {
  clearTimeout(saveTimer);
  const go = () => api("/deck", { method: "POST", body: JSON.stringify(deck) });
  if (now) return go();
  saveTimer = setTimeout(go, 400);
}

const askReview = (firm) =>
  api("/review", { method: "POST", body: JSON.stringify({ slideId: slide()?.id, firm }) });

// Two moments: a pause while typing is advisory, finishing a box is firm.
const PAUSE_MS = 2000;
let pauseTimer = null;
const schedulePause = () => {
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(async () => { await save(true); askReview(false); }, PAUSE_MS);
};
const firmReview = async () => {
  clearTimeout(pauseTimer);
  await save(true);
  askReview(true);
};

function connect() {
  stream?.close();
  stream = new EventSource(`/api/deck/${slug}/events`);
  stream.addEventListener("reviewing", (e) => { reviewing.add(JSON.parse(e.data).slideKey); paintStatus(); });
  stream.addEventListener("idle", (e) => { reviewing.delete(JSON.parse(e.data).slideKey); paintStatus(); });
  stream.addEventListener("findings", (e) => {
    const { slideKey, findings, blocking } = JSON.parse(e.data);
    state.findings[slideKey] = findings;
    gate(blocking);
    paintFindings(); paintCanvas(); paintRail();
  });
  stream.addEventListener("error", (e) => {
    try { $("status").textContent = JSON.parse(e.data).message; } catch { /* reconnecting */ }
  });
}

// --- history --------------------------------------------------------------

function snapshot() {
  undo.push(JSON.stringify(deck));
  if (undo.length > 80) undo.shift();
}
function undoOnce() {
  const prev = undo.pop();
  if (!prev) return;
  deck = JSON.parse(prev);
  idx = Math.min(idx, deck.slides.length - 1);
  sel = editing = null;
  save(); paintAll();
}

// --- fitting --------------------------------------------------------------

function fit() {
  const wrap = stage.parentElement;
  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const bin = document.querySelector(".bin").offsetHeight;
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - bin - 14;
  scale = Math.max(0.2, Math.min(availW / W, availH / H));
  stage.style.transform = `scale(${scale})`;
  // The stage is 960x540 in layout no matter how it is drawn, so its unscaled
  // height would push the bin off screen. Collapse the difference.
  stage.style.marginBottom = `${H * scale - H}px`;
}
addEventListener("resize", fit);

/** Mouse position in slide coordinates. */
function at(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}

// --- painting -------------------------------------------------------------

function styleEl(node, el) {
  node.style.left = el.x + "px";
  node.style.top = el.y + "px";
  node.style.width = el.w + "px";
  node.style.height = el.h + "px";
  if (el.type === "text") node.style.cssText += ";" + css(el.role);
}

/** Text the critic flagged, so the box on the slide shows it rather than making you hunt. */
function flaggedText() {
  const open = (state.findings[slide()?.id] ?? []).filter((f) => !f.dismissed && f.severity !== "note");
  return open.map((f) => f.quote);
}

function paintCanvas() {
  canvas.replaceChildren();
  guides.replaceChildren();
  if (!slide()) return;
  const flags = flaggedText();

  for (const el of slide().els) {
    const node = document.createElement("div");
    node.className = `el ${el.type}`;
    node.dataset.id = el.id;
    styleEl(node, el);

    if (el.type === "text") {
      node.textContent = el.text;
      if (!el.text) node.classList.add("empty");
      if (flags.some((q) => el.text && (q.includes(el.text.trim()) || el.text.includes(q.trim()))))
        node.classList.add("flagged");
      if (editing === el.id) {
        node.classList.add("editing");
        node.contentEditable = "plaintext-only";
      }
    } else {
      const img = document.createElement("img");
      img.src = `/api/deck/${slug}/images/${encodeURIComponent(el.src)}`;
      img.alt = el.alt;
      node.append(img);
    }

    if (el.id === sel) {
      node.classList.add("sel");
      if (editing !== el.id) node.append(...handles());
    }
    canvas.append(node);
  }
  if (editing) {
    const node = canvas.querySelector(`[data-id="${editing}"]`);
    if (node && document.activeElement !== node) {
      node.focus();
      const r = document.createRange();
      r.selectNodeContents(node); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  }
  paintToolbar();
}

const DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
function handles() {
  return DIRS.map((d) => {
    const h = document.createElement("div");
    h.className = `handle ${d}`;
    h.dataset.dir = d;
    const pos = {
      nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50],
      se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50],
    }[d];
    h.style.left = `calc(${pos[0]}% - 4.5px)`;
    h.style.top = `calc(${pos[1]}% - 4.5px)`;
    return h;
  });
}

function paintRail() {
  const rail = $("rail");
  rail.replaceChildren();
  deck.slides.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "thumb" + (i === idx ? " on" : "");
    const n = document.createElement("span");
    n.className = "n"; n.textContent = i + 1;
    const frame = document.createElement("div");
    frame.className = "frame";
    // The thumbnail is the slide at 1/6 scale - same model, same positions, so
    // it cannot drift from what the canvas shows.
    for (const el of s.els) {
      const mini = document.createElement("div");
      mini.className = `el ${el.type}`;
      mini.style.left = (el.x / W) * 100 + "%";
      mini.style.top = (el.y / H) * 100 + "%";
      mini.style.width = (el.w / W) * 100 + "%";
      mini.style.height = (el.h / H) * 100 + "%";
      if (el.type === "text") {
        // Same roles as the canvas, only smaller - so a thumbnail cannot drift
        // from the slide it is a picture of.
        const f = FONT[el.role] ?? FONT.body;
        mini.textContent = el.text;
        mini.style.cssText += ";" + css(el.role);
        mini.style.fontSize = Math.max(2, f.size / 6.2) + "px";
      } else {
        const img = document.createElement("img");
        img.src = `/api/deck/${slug}/images/${encodeURIComponent(el.src)}`;
        img.style.width = "100%"; img.style.height = "100%";
        mini.append(img);
      }
      frame.append(mini);
    }
    if ((state.findings[s.id] ?? []).some((f) => !f.dismissed && f.severity !== "note")) {
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.title = "unresolved findings";
      frame.append(flag);
    }
    frame.onclick = () => go(i);
    if (deck.slides.length > 1) {
      const x = document.createElement("button");
      x.className = "kill"; x.textContent = "\u00d7";
      x.title = "Delete this slide";
      x.onclick = (ev) => { ev.stopPropagation(); go(i).then(deleteSlide); };
      frame.append(x);
    }
    row.append(n, frame);
    rail.append(row);
  });
  const add = document.createElement("button");
  add.className = "add";
  add.textContent = "+ slide";
  add.onclick = addSlide;
  rail.append(add);
}

function paintToolbar() {
  const el = elById(sel);
  $("textTools").hidden = !(el && el.type === "text");
  $("del").hidden = !el;
  $("asTitle").classList.toggle("on", el?.role === "title");
  $("asBody").classList.toggle("on", el?.role === "body");
}

function paintStatus() {
  const s = $("status");
  s.className = "status" + (reviewing.size ? " busy" : "");
  if (reviewing.size) s.textContent = "reading your slide";
  else if (s.textContent === "reading your slide") s.textContent = "";
}

function gate(blocking) {
  $("export").disabled = blocking > 0 || !slug;
  $("gate").hidden = !blocking;
  $("gate").textContent = blocking ? `${blocking} unresolved` : "";
  $("export").title = blocking
    ? "Errors and jargon hold the export. Fix them, or reject them with a reason."
    : "";
}

function paintAll() { fit(); paintCanvas(); paintRail(); paintBin(); paintFindings(); }

// --- source bin -----------------------------------------------------------
//
// One bin for the deck, not a box per slide. Source material does not divide
// neatly by slide: one passage covers three of them, and the definition you
// pasted while writing slide 2 is exactly what the critic needs on slide 9.

function paintBin() {
  deck.sources ??= [];
  const n = deck.sources.length;
  const count = $("binCount");
  count.textContent = n ? `${n}` : "empty";
  count.classList.toggle("some", n > 0);

  const list = $("binList");
  list.replaceChildren();
  for (const src of deck.sources) {
    const row = document.createElement("div");
    row.className = "source";
    const ta = document.createElement("textarea");
    ta.value = src.text;
    ta.spellcheck = false;
    ta.rows = Math.min(6, src.text.split("\n").length + 1);
    ta.oninput = () => { src.text = ta.value; save(); };
    // Editing a source changes what every slide is checked against, so the
    // re-read waits until you are done rather than firing on each keystroke.
    ta.onblur = () => { if (!src.text.trim()) removeSource(src.id); else firmReview(); };
    const kill = document.createElement("button");
    kill.className = "kill"; kill.textContent = "\u00d7"; kill.title = "Remove";
    kill.onclick = () => removeSource(src.id);
    row.append(ta, kill);
    list.append(row);
  }
}

function removeSource(id) {
  snapshot();
  deck.sources = deck.sources.filter((s) => s.id !== id);
  save(); paintBin(); firmReview();
}

function addSource(text) {
  if (!text.trim()) return;
  snapshot();
  (deck.sources ??= []).push({ id: uid(), text: text.trim() });
  save(); paintBin(); firmReview();
}

$("binToggle").onclick = () => {
  const open = $("binBody").hidden;
  $("binBody").hidden = !open;
  $("binToggle").setAttribute("aria-expanded", String(open));
  fit();
  if (open) $("binAdd").focus();
};

$("binAdd").onkeydown = (e) => {
  // Enter adds, shift+enter is a newline - the bin is a list of things, and
  // most things pasted into it are one thing.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    addSource($("binAdd").value);
    $("binAdd").value = "";
  }
};
$("binAdd").onblur = () => { addSource($("binAdd").value); $("binAdd").value = ""; };

// --- findings pane --------------------------------------------------------

function paintFindings() {
  const box = $("findings");
  box.replaceChildren();
  const groups = deck.slides
    .map((s, i) => ({ i, id: s.id, findings: state.findings[s.id] ?? [] }))
    .filter((g) => g.findings.length)
    .sort((a, b) => (b.i === idx) - (a.i === idx) || a.i - b.i);

  if (!groups.length) {
    const p = document.createElement("p");
    const any = Object.keys(state.findings).length > 0;
    p.className = "empty" + (any ? " clean" : "");
    p.textContent = any
      ? "Nothing open. Write another slide."
      : "Write a slide. The critic reads it when you pause, and again when you finish a text box.";
    box.append(p);
    return;
  }
  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "slide-group" + (g.i === idx ? " current" : "");
    const h = document.createElement("h3");
    h.textContent = `slide ${g.i + 1}`;
    h.style.cursor = "pointer";
    h.onclick = () => go(g.i);
    sec.append(h);
    for (const f of g.findings) sec.append(card(f));
    box.append(sec);
  }
}

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
    b.className = "blocks"; b.textContent = "holds export";
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
        gate(data.blocking);
        paintFindings(); paintCanvas(); paintRail();
      } else send.disabled = false;
    };
    el.append(form);
    input.focus();
  };
  return el;
}

// --- slides ---------------------------------------------------------------

async function go(i) {
  if (i === idx) return;
  if (editing) await stopEditing();
  idx = i; sel = null;
  paintAll();
}

function addSlide() {
  snapshot();
  deck.slides.splice(idx + 1, 0, { id: uid(), els: [] });
  idx += 1; sel = null;
  save(); paintAll();
}

function deleteSlide() {
  if (deck.slides.length === 1) return;
  snapshot();
  deck.slides.splice(idx, 1);
  idx = Math.max(0, idx - 1);
  sel = null;
  save(); paintAll();
}

// --- elements -------------------------------------------------------------

function addText() {
  snapshot();
  const n = slide().els.filter((e) => e.type === "text").length;
  const el = {
    id: uid(), type: "text",
    x: 80 + (n % 4) * 24, y: 120 + (n % 6) * 40,
    w: 420, h: 90, text: "", role: "body",
  };
  slide().els.push(el);
  sel = el.id; editing = el.id;
  save(); paintCanvas(); paintRail();
}

async function addImageFile(file) {
  if (!file?.type?.startsWith("image/")) return;
  const bytes = await file.arrayBuffer();
  const { ok, data } = await api("/image", {
    method: "POST", headers: { "content-type": file.type }, body: bytes,
  });
  if (!ok) { $("status").textContent = data.error ?? "could not add that image"; return; }

  // Read the real dimensions so it lands at its own shape rather than a box we
  // guessed, and so corner-resize has a ratio to hold.
  const url = URL.createObjectURL(file);
  const probe = new Image();
  await new Promise((res) => { probe.onload = probe.onerror = res; probe.src = url; });
  const nw = probe.naturalWidth || 480, nh = probe.naturalHeight || 270;
  URL.revokeObjectURL(url);

  const k = Math.min(1, 460 / nw, 380 / nh);
  const w = Math.round(nw * k), h = Math.round(nh * k);
  snapshot();
  const el = {
    id: uid(), type: "image",
    x: Math.round((W - w) / 2), y: Math.round((H - h) / 2),
    w, h, src: data.src, ratio: nw / nh, alt: file.name.replace(/\.[^.]+$/, ""),
  };
  slide().els.push(el);
  sel = el.id; editing = null;
  save(); paintCanvas(); paintRail();
}

function deleteEl() {
  const el = elById(sel);
  if (!el) return;
  snapshot();
  slide().els = slide().els.filter((e) => e.id !== sel);
  sel = editing = null;
  save(); paintCanvas(); paintRail();
  firmReview();
}

async function stopEditing() {
  const el = elById(editing);
  const node = canvas.querySelector(`[data-id="${editing}"]`);
  if (el && node) el.text = node.innerText.replace(/\n$/, "");
  editing = null;
  paintCanvas(); paintRail();
  await firmReview();
}

// --- dragging and resizing ------------------------------------------------

const SNAP = 5;
function showGuides(lines) {
  guides.replaceChildren();
  for (const l of lines) {
    const i = document.createElement("i");
    if (l.x != null) { i.style.left = l.x + "px"; i.style.top = 0; i.style.width = "1px"; i.style.height = H + "px"; }
    else { i.style.top = l.y + "px"; i.style.left = 0; i.style.height = "1px"; i.style.width = W + "px"; }
    guides.append(i);
  }
}

/** Pull an edge onto the slide's centre or margins when it is close. */
function snapMove(el, x, y) {
  const lines = [];
  const xs = [[x, 0], [x + el.w / 2, el.w / 2], [x + el.w, el.w]];
  for (const [edge, off] of xs) {
    for (const target of [0, W / 2, W]) {
      if (Math.abs(edge - target) <= SNAP) { x = target - off; lines.push({ x: target }); }
    }
  }
  const ys = [[y, 0], [y + el.h / 2, el.h / 2], [y + el.h, el.h]];
  for (const [edge, off] of ys) {
    for (const target of [0, H / 2, H]) {
      if (Math.abs(edge - target) <= SNAP) { y = target - off; lines.push({ y: target }); }
    }
  }
  showGuides(lines);
  return { x, y };
}

canvas.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".handle");
  const node = e.target.closest(".el");

  if (!node && !handle) {                       // empty canvas: deselect
    if (editing) stopEditing(); else { sel = null; paintCanvas(); }
    return;
  }
  const el = elById(handle ? sel : node.dataset.id);
  if (!el) return;

  if (!handle && el.id !== sel) { if (editing) stopEditing(); sel = el.id; paintCanvas(); }
  if (editing === el.id) return;                // typing: let the caret do its job

  e.preventDefault();
  const start = at(e);
  const from = { x: el.x, y: el.y, w: el.w, h: el.h };
  const dir = handle?.dataset.dir;
  let moved = false;
  canvas.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const now = at(ev);
    const dx = now.x - start.x, dy = now.y - start.y;
    if (!moved && Math.hypot(dx, dy) < 2) return;
    if (!moved) { snapshot(); moved = true; }

    if (!dir) {
      const p = snapMove(el, from.x + dx, from.y + dy);
      el.x = Math.round(p.x); el.y = Math.round(p.y);
    } else {
      let { x, y, w, h } = from;
      if (dir.includes("e")) w = from.w + dx;
      if (dir.includes("s")) h = from.h + dy;
      if (dir.includes("w")) { w = from.w - dx; x = from.x + dx; }
      if (dir.includes("n")) { h = from.h - dy; y = from.y + dy; }
      // Images hold their shape on a corner: a squashed photograph is never
      // what someone dragging a corner meant.
      if (el.type === "image" && dir.length === 2) {
        const r = el.ratio || from.w / from.h;
        if (Math.abs(w - from.w) > Math.abs(h - from.h)) h = w / r; else w = h * r;
        if (dir.includes("w")) x = from.x + (from.w - w);
        if (dir.includes("n")) y = from.y + (from.h - h);
      }
      const min = el.type === "text" ? 40 : 24;
      if (w >= min) { el.w = Math.round(w); el.x = Math.round(x); }
      if (h >= min) { el.h = Math.round(h); el.y = Math.round(y); }
    }
    styleEl(canvas.querySelector(`[data-id="${el.id}"]`), el);
  };

  const onUp = () => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    guides.replaceChildren();
    if (moved) { save(); paintRail(); }
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
});

canvas.addEventListener("dblclick", (e) => {
  const node = e.target.closest(".el.text");
  if (!node) return;
  sel = node.dataset.id; editing = sel;
  paintCanvas();
});

canvas.addEventListener("input", (e) => {
  const node = e.target.closest(".el.text");
  if (!node || editing !== node.dataset.id) return;
  const el = elById(editing);
  if (!el) return;
  el.text = node.innerText.replace(/\n$/, "");
  node.classList.toggle("empty", !el.text);
  save(); schedulePause();
});

canvas.addEventListener("focusout", (e) => {
  if (e.target.closest(".el.text") && editing) stopEditing();
});

// --- keyboard -------------------------------------------------------------

addEventListener("keydown", (e) => {
  const typing = editing || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    if (typing) return;
    e.preventDefault(); undoOnce(); return;
  }
  if (e.key === "Escape" && editing) { e.preventDefault(); stopEditing(); return; }
  if (typing) return;

  if (e.key === "t" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addText(); return; }
  if ((e.key === "Backspace" || e.key === "Delete") && sel) { e.preventDefault(); deleteEl(); return; }
  if (e.key === "Enter" && sel && elById(sel)?.type === "text") {
    e.preventDefault(); editing = sel; paintCanvas(); return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    const el = elById(sel);
    if (!el) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    snapshot();
    if (e.key === "ArrowUp") el.y -= step;
    if (e.key === "ArrowDown") el.y += step;
    if (e.key === "ArrowLeft") el.x -= step;
    if (e.key === "ArrowRight") el.x += step;
    save(); paintCanvas(); paintRail();
  }
});

addEventListener("paste", async (e) => {
  if (editing || ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName)) return;
  const file = [...(e.clipboardData?.files ?? [])][0];
  if (file) { e.preventDefault(); await addImageFile(file); }
});

// --- text tools -----------------------------------------------------------

function mutate(fn) {
  const el = elById(sel);
  if (!el || el.type !== "text") return;
  snapshot(); fn(el); save(); paintCanvas(); paintRail();
}
const setRole = (role) => mutate((el) => (el.role = role));
$("asTitle").onclick = () => setRole("title");
$("asBody").onclick = () => setRole("body");
$("del").onclick = deleteEl;
$("addText").onclick = addText;
$("addImage").onclick = () => $("file").click();
$("file").onchange = async (e) => { await addImageFile(e.target.files[0]); e.target.value = ""; };

// --- decks ----------------------------------------------------------------

async function load(next) {
  slug = next;
  localStorage.setItem("deck", slug);
  const r = await (await fetch(`/api/deck/${slug}`)).json();
  deck = r.deck; deck.sources ??= []; state = r.state;
  idx = 0; sel = editing = null; reviewing = new Set(); undo.length = 0;
  gate(r.blocking);
  connect();
  paintAll();
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
  else gate(0);
}

$("picker").onchange = (e) => load(e.target.value);
$("new").onclick = async () => {
  const title = prompt("What are you teaching yourself?");
  if (!title?.trim()) return;
  const r = await fetch("/api/decks", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  await decks((await r.json()).slug);
};
$("export").onclick = async () => {
  const { ok, data } = await api("/export", { method: "POST" });
  const s = $("status");
  s.className = "status";
  if (ok) s.textContent = `wrote ${data.path}`;
  else { s.textContent = data.error ?? "export refused"; gate(data.findings?.length ?? 1); }
};

decks();
