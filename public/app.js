// The canvas editor.
//
// Everything is authored in LOGICAL units on a 960x540 slide and the stage is
// scaled as a whole to whatever room it has. No element ever stores a screen
// pixel, so the same deck is the same deck at any window size - and every
// mouse position has to be divided back through that scale exactly once, which
// is the only real subtlety in here.

import { FONT, css } from "./type.js";
import { pdfToSources } from "./pdf-text.js";

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
  const binEl = document.querySelector(".bin");
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);

  // Twice, because the two measurements depend on each other: the bin is as
  // wide as the drawn slide, and how tall it wraps to decides how big the
  // slide can be. One extra pass settles it; more would not move.
  for (let pass = 0; pass < 2; pass++) {
    const availH = wrap.clientHeight - padY - binEl.offsetHeight - 14;
    scale = Math.max(0.2, Math.min(availW / W, availH / H));
    stage.style.transform = `scale(${scale})`;
    // The stage is 960x540 in layout no matter how it is drawn, so its
    // unscaled height would push the bin off screen. Collapse the difference.
    stage.style.marginBottom = `${H * scale - H}px`;
    // The bin is source material FOR the slide above it, so it lines up with
    // that slide rather than with the window.
    binEl.style.width = `${W * scale}px`;
  }
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
    : "Export";
  labelButtons();
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
    if (src.label) {
      const tag = document.createElement("span");
      tag.className = "tag-src";
      tag.textContent = src.label;
      tag.title = src.label;
      row.append(tag);
    }
    row.append(ta, kill);
    list.append(row);
  }
}

function removeSource(id) {
  snapshot();
  deck.sources = deck.sources.filter((s) => s.id !== id);
  save(); paintBin(); firmReview();
}

function addSource(text, label) {
  if (!text.trim()) return;
  snapshot();
  (deck.sources ??= []).push({ id: uid(), text: text.trim(), ...(label ? { label } : {}) });
  save(); paintBin(); firmReview();
}

/**
 * Many sources at once, from one upload.
 *
 * Deliberately one snapshot and one re-read for the whole file rather than per
 * page: a 40-page lecture deck must be one undo, and it must not queue forty
 * critic passes over a deck that has not changed.
 */
function addSources(entries) {
  if (!entries.length) return;
  snapshot();
  deck.sources ??= [];
  for (const e of entries) deck.sources.push({ id: uid(), text: e.text.trim(), label: e.label });
  save(); paintBin(); firmReview();
}

// Whether the bin is open is remembered: it is where your lecture material
// lives, and someone working from a PDF has it open for the whole session.
function showBin(open, focus = false) {
  $("binBody").hidden = !open;
  $("binToggle").setAttribute("aria-expanded", String(open));
  localStorage.setItem("bin", open ? "open" : "shut");
  fit();
  if (open && focus) $("binAdd").focus();
}
$("binToggle").onclick = () => showBin($("binBody").hidden, true);
showBin(localStorage.getItem("bin") === "open");

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

// --- uploading lecture slides ---------------------------------------------
//
// The thing you are studying from is almost always a PDF your professor
// handed you, so that is the case this is built around: one page in, one
// source out, labelled with where it came from.
//
// An image dropped here goes onto the SLIDE instead. Putting it in the bin
// would be theatre - the critic reads the bin as text, and nothing here does
// OCR, so it would sit there looking like source material while contributing
// nothing.

const say = (msg, busy = false) => {
  const s = $("status");
  s.className = "status" + (busy ? " busy" : "");
  s.textContent = msg;
};

async function ingest(files) {
  const list = [...files];
  const pdfs = list.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const imgs = list.filter((f) => f.type.startsWith("image/"));
  const skipped = list.length - pdfs.length - imgs.length;

  for (const f of pdfs) {
    try {
      say(`reading ${f.name}`, true);
      const { sources, pages } = await pdfToSources(f, (n, total) =>
        say(`reading ${f.name} - page ${n} of ${total}`, true),
      );
      addSources(sources);
      // A deck that yields nothing is a scan, and silence would look like a
      // bug rather than the one thing this cannot do.
      say(
        sources.length
          ? `${f.name}: added ${sources.length} of ${pages} pages`
          : `${f.name}: no text found - it looks scanned, so its pages are images`,
      );
    } catch (err) {
      say(`could not read ${f.name}: ${err.message ?? err}`);
    }
  }

  for (const f of imgs) {
    await addImageFile(f);
    say(`${f.name} added to the slide - the bin holds text the critic can read`);
  }
  if (skipped) say(`${skipped} file${skipped > 1 ? "s" : ""} skipped - PDFs and images only`);
}

$("binUpload").onclick = () => $("sourceFile").click();
$("sourceFile").onchange = async (e) => { await ingest(e.target.files); e.target.value = ""; };

// The whole panel is the target, not just the button - you are dragging a file
// at a box, and the button is the smallest part of the box.
const drop = $("binDrop");
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
for (const type of ["dragenter", "dragover"]) {
  drop.addEventListener(type, (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    drop.classList.add("over");
  });
}
// dragleave fires when crossing onto a CHILD of the drop zone, so the
// highlight has to survive a pointer that is still inside it.
drop.addEventListener("dragleave", (e) => {
  if (!drop.contains(e.relatedTarget)) drop.classList.remove("over");
});
drop.addEventListener("drop", async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  drop.classList.remove("over");
  await ingest(e.dataTransfer.files);
});
// Dropping a file anywhere else would otherwise navigate away from the editor
// and lose whatever was not yet saved.
for (const type of ["dragover", "drop"]) {
  addEventListener(type, (e) => { if (hasFiles(e) && !drop.contains(e.target)) e.preventDefault(); });
}

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
//
// The toolbar is the discoverable copy of this table, not the other way round.
// Everything worth doing to a slide has a key, because the cost of reaching
// for the mouse is paid in attention you were spending on whether the slide is
// true.
//
// Single letters act, unmodified, and that is safe here for one reason: you
// are never typing unless you asked to be. A text box takes keystrokes only
// after Enter or a double-click, and every handler below bails while `typing`.
//
// KEYS is the only description of the keyboard. Dispatch reads it, the button
// tooltips read it, and the help sheet is generated from it - so a shortcut
// cannot come loose from the label that advertises it.

const KEYS = [
  { group: "Slides", key: "n", label: "New slide", btn: "addSlide", run: () => addSlide() },
  // j and k mean nothing else, so they navigate whatever is selected. The
  // arrows are the ones that have to yield: they belong to the selection when
  // there is one, and to the deck when there is not.
  { group: "Slides", key: "j", label: "Next slide", show: "J  /  \u2193", run: () => step(1) },
  { group: "Slides", key: "k", label: "Previous slide", show: "K  /  \u2191", run: () => step(-1) },
  { group: "Slides", key: "Backspace", mod: true, label: "Delete this slide", run: () => deleteSlide() },

  { group: "On the slide", key: "t", label: "New text box", btn: "addText", run: () => addText() },
  { group: "On the slide", key: "i", label: "Insert image", btn: "addImage", run: () => $("file").click() },
  { group: "On the slide", key: "Tab", label: "Select next element", show: "Tab", run: (e) => cycleSel(e.shiftKey ? -1 : 1) },
  { group: "On the slide", key: "Enter", label: "Edit the selection", when: () => elById(sel)?.type === "text",
    run: () => { editing = sel; paintCanvas(); } },
  { group: "On the slide", key: "Escape", label: "Back to the slide, then deselect",
    run: () => { if (editing) stopEditing(); else { sel = null; paintCanvas(); } } },
  { group: "On the slide", key: "d", mod: true, label: "Duplicate", when: () => sel, run: () => duplicateEl() },
  { group: "On the slide", key: "Backspace", alias: "Delete", label: "Delete the selection",
    when: () => sel, btn: "del", run: () => deleteEl() },
  { group: "On the slide", keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    label: "Nudge the selection, shift for ten", show: "\u2190 \u2191 \u2193 \u2192",
    run: (e) => (sel ? nudge(e) : step(e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1)) },

  { group: "Text", key: "1", label: "Make it a Title", btn: "asTitle",
    when: () => elById(sel)?.type === "text", run: () => setRole("title") },
  { group: "Text", key: "2", label: "Make it Normal", btn: "asBody",
    when: () => elById(sel)?.type === "text", run: () => setRole("body") },

  { group: "Source material", key: "s", label: "Open or close the bin", btn: "binToggle",
    run: () => showBin($("binBody").hidden, true) },
  { group: "Source material", key: "u", label: "Upload lecture slides", btn: "binUpload",
    run: () => { showBin(true); $("sourceFile").click(); } },

  { group: "The deck", key: "e", label: "Export", btn: "export", run: () => doExport() },
  { group: "The deck", key: "z", mod: true, label: "Undo", show: "\u2318Z", run: () => undoOnce() },
  { group: "The deck", key: "\\", label: "Theme: system, light, dark", btn: "theme", run: () => cycleTheme() },
  { group: "The deck", key: "?", label: "This list", run: () => toggleHelp() },
];

/** How a binding is written on a button or in the help sheet. */
function keyLabel(k) {
  if (k.show) return k.show;
  const name = { Backspace: "Bksp", Enter: "Enter", Escape: "Esc", Tab: "Tab" }[k.key] ?? k.key.toUpperCase();
  return (k.mod ? "\u2318" : "") + name;
}

const matches = (k, e) => {
  const want = k.keys ?? [k.key, k.alias].filter(Boolean);
  if (!want.some((w) => e.key === w || e.key.toLowerCase() === w.toLowerCase())) return false;
  // A modifier that the binding did not ask for belongs to the browser.
  return Boolean(k.mod) === Boolean(e.metaKey || e.ctrlKey);
};

addEventListener("keydown", (e) => {
  const typing = editing || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

  // Escape has to work mid-sentence, because it is what you reach for when the
  // sentence went wrong - and it is the way back to the slide from any field.
  // Without this, `s` opens the bin, focus lands in the textarea, and every
  // other key is swallowed as typing with no keyboard way out.
  if (e.key === "Escape") {
    if (editing) { e.preventDefault(); stopEditing(); return; }
    const a = document.activeElement;
    if (a && ["INPUT", "TEXTAREA"].includes(a.tagName)) { e.preventDefault(); a.blur(); return; }
  }
  if (typing) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !editing) return;
    return;
  }
  if (help.open && e.key !== "?" && e.key !== "Escape") return;

  for (const k of KEYS) {
    if (!matches(k, e)) continue;
    if (k.when && !k.when()) continue;
    e.preventDefault();
    k.run(e);
    return;
  }
});

/** Move by one slide, stopping at either end rather than wrapping. */
const step = (dir) => go(Math.min(Math.max(idx + dir, 0), deck.slides.length - 1));

function nudge(e) {
  const el = elById(sel);
  if (!el) return;
  const by = e.shiftKey ? 10 : 1;
  snapshot();
  if (e.key === "ArrowUp") el.y -= by;
  if (e.key === "ArrowDown") el.y += by;
  if (e.key === "ArrowLeft") el.x -= by;
  if (e.key === "ArrowRight") el.x += by;
  save(); paintCanvas(); paintRail();
}

/** Tab through the elements on this slide, so the mouse is never the only way in. */
function cycleSel(dir) {
  const els = slide()?.els ?? [];
  if (!els.length) return;
  const at = els.findIndex((el) => el.id === sel);
  sel = els[(at + dir + els.length) % els.length].id;
  paintCanvas();
}

function duplicateEl() {
  const el = elById(sel);
  if (!el) return;
  snapshot();
  const copy = { ...el, id: uid(), x: el.x + 16, y: el.y + 16 };
  slide().els.push(copy);
  sel = copy.id;
  save(); paintCanvas(); paintRail();
}

// --- the help sheet -------------------------------------------------------
//
// Keyboard-first only works if the keys are findable, and a README is not
// findable while your hands are on the keyboard.

const help = document.createElement("dialog");
help.id = "help";
addEventListener("keydown", (e) => {
  if (help.open && e.key === "Escape") { e.preventDefault(); help.close(); }
});

function buildHelp() {
  help.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = "Keys";
  help.append(h);
  for (const group of [...new Set(KEYS.map((k) => k.group))]) {
    const sec = document.createElement("section");
    const t = document.createElement("h3");
    t.textContent = group;
    sec.append(t);
    for (const k of KEYS.filter((x) => x.group === group)) {
      const row = document.createElement("div");
      row.className = "row";
      const kbd = document.createElement("kbd");
      kbd.textContent = keyLabel(k);
      const label = document.createElement("span");
      label.textContent = k.label;
      row.append(kbd, label);
      sec.append(row);
    }
    help.append(sec);
  }
  const foot = document.createElement("p");
  foot.className = "foot";
  foot.textContent = "Esc closes this.";
  help.append(foot);
  document.body.append(help);
}

const toggleHelp = () => (help.open ? help.close() : help.showModal());

// Every button that has a key says so, from the same table - a tooltip is
// where you look when you already suspect there is a faster way.
function labelButtons() {
  for (const k of KEYS) {
    const b = k.btn && $(k.btn);
    if (!b) continue;
    const base = (b.title || k.label).replace(/\s*\([^)]*\)$/, "");
    b.title = `${base}  (${keyLabel(k)})`;
  }
}

buildHelp();
labelButtons();

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
// --- theme ----------------------------------------------------------------
//
// Three states, not two: following the system is a real choice and the one
// most people want, so the toggle cycles through it rather than forcing a
// side the first time you touch it.

const THEMES = ["system", "light", "dark"];
const ICON = {
  system: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 20h8"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
};

function paintTheme(mode) {
  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const b = $("theme");
  b.innerHTML = ICON[mode];
  b.title = `Theme: ${mode}`;
  b.setAttribute("aria-label", `Theme: ${mode}. Click to change.`);
  labelButtons();
}

let theme = localStorage.getItem("theme") ?? "system";
if (!THEMES.includes(theme)) theme = "system";
paintTheme(theme);
function cycleTheme() {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  localStorage.setItem("theme", theme);
  paintTheme(theme);
}
$("theme").onclick = cycleTheme;

$("addSlide").onclick = addSlide;
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
async function doExport() {
  if ($("export").disabled) return;
  const { ok, data } = await api("/export", { method: "POST" });
  const s = $("status");
  s.className = "status";
  if (ok) s.textContent = `wrote ${data.path}`;
  else { s.textContent = data.error ?? "export refused"; gate(data.findings?.length ?? 1); }
}
$("export").onclick = doExport;

decks();
