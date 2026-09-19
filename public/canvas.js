// The slide you are looking at: drawing it, and every pointer that lands on it.
//
// Everything is authored in LOGICAL units on a 960x540 slide and the stage is
// scaled as a whole to whatever room it has. No element ever stores a screen
// pixel, so the same deck is the same deck at any window size - and every
// mouse position has to be divided back through that scale exactly once, which
// is still the only real subtlety in here.

import { S, slide, els, elById, selected, only, select, deselect, snapshot, save, emit, template } from "./state.js";
import { elCss, textHtml, boxCss } from "./render.js";
import { colorOf, W, H } from "./theme.js";
import { flagged, schedulePause, firmReview } from "./critic.js";
import * as ops from "./ops.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), canvas = $("canvas"), guides = $("guides");

/** Mouse position in slide coordinates. */
function at(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.scale, y: (e.clientY - r.top) / S.scale };
}

// --- fitting --------------------------------------------------------------

export function fit() {
  const wrap = stage.parentElement;
  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

  S.scale = Math.max(0.2, Math.min(availW / W, availH / H));
  stage.style.transform = `scale(${S.scale})`;
  // The stage is 960x540 in layout no matter how it is drawn, so its unscaled
  // height would sit under the window. Collapse the difference.
  stage.style.marginBottom = `${H * S.scale - H}px`;
  emit("selection");
}
addEventListener("resize", fit);

// --- painting -------------------------------------------------------------

const DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_AT = {
  nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50],
  se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50],
};

function handles() {
  return DIRS.map((d) => {
    const h = document.createElement("div");
    h.className = `handle ${d}`;
    h.dataset.dir = d;
    h.style.left = `calc(${HANDLE_AT[d][0]}% - ${4.5 / S.scale}px)`;
    h.style.top = `calc(${HANDLE_AT[d][1]}% - ${4.5 / S.scale}px)`;
    // Handles are chrome, not content: they keep their size on screen however
    // far the slide is scaled down, or they become unhittable on a laptop.
    h.style.width = h.style.height = `${9 / S.scale}px`;
    h.style.borderWidth = `${1.5 / S.scale}px`;
    return h;
  });
}

function node(el, t) {
  const n = document.createElement("div");
  n.className = `el ${el.type}`;
  n.dataset.id = el.id;
  n.style.cssText = elCss(el, t);

  if (el.type === "text") {
    if (el.text) {
      n.innerHTML = textHtml(el.text, colorOf(t, "accent"));
      // The critic quotes the slide verbatim, so the box that said it can
      // underline itself rather than making you hunt for the sentence.
      const flags = flagged();
      if (flags.some((q) => q.includes(el.text.trim()) || el.text.includes(q.trim()))) n.classList.add("flagged");
    } else {
      n.classList.add("blank");
      n.innerHTML = `<span class="ph">${el.hint ?? "Click to add text"}</span>`;
    }
  } else if (el.type === "image") {
    if (el.src) {
      const img = document.createElement("img");
      img.src = `/api/deck/${S.slug}/images/${encodeURIComponent(el.src)}`;
      img.alt = el.alt ?? "";
      n.append(img);
    } else {
      n.classList.add("blank");
      n.innerHTML =
        `<span class="ph"><svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>` +
        `<path d="M3.5 15l4.5-4 4 3.5 3.5-3 5 4.5"/><circle cx="9" cy="9.5" r="1.3"/></svg>Add image</span>`;
    }
  }
  return n;
}

export function paintCanvas() {
  const t = template();
  stage.style.background = colorOf(t, "paper");
  stage.style.setProperty("--accent", colorOf(t, "accent"));
  stage.style.setProperty("--muted", colorOf(t, "muted"));
  canvas.replaceChildren();
  guides.replaceChildren();
  if (!slide()) return;

  for (const el of els()) {
    const n = node(el, t);
    if (S.sel.has(el.id)) {
      n.classList.add("sel");
      n.style.setProperty("--ring", `${1.5 / S.scale}px`);
      if (S.sel.size === 1 && S.editing !== el.id) n.append(...handles());
    }
    canvas.append(n);
  }

  // A dashed box around a multi-selection: without it, four ringed elements
  // read as four things that happen to be selected rather than one thing you
  // are about to move.
  if (S.sel.size > 1) {
    const list = selected();
    const box = document.createElement("div");
    box.className = "groupbox";
    const x = Math.min(...list.map((e) => e.x)), y = Math.min(...list.map((e) => e.y));
    box.style.cssText =
      `left:${x}px;top:${y}px;width:${Math.max(...list.map((e) => e.x + e.w)) - x}px;` +
      `height:${Math.max(...list.map((e) => e.y + e.h)) - y}px;border-width:${1 / S.scale}px`;
    canvas.append(box);
  }

  if (S.editing) mountEditor(t);
  emit("selection");
}

// --- editing text ---------------------------------------------------------
//
// A textarea rather than a contenteditable box.
//
// The marks are the storage format, so while you are typing you are looking at
// `**bold**` and not at bold - which is the honest thing to show, and also the
// thing a textarea can do perfectly: real selection offsets, real undo, real
// IME, and a caret that never lands inside markup a browser inserted behind
// your back. The rendered version is what you see the moment you leave.

let editor = null;
export const activeEditor = () => editor;

function mountEditor(t) {
  const el = elById(S.editing);
  if (!el || el.type !== "text") { S.editing = null; return; }
  editor = document.createElement("textarea");
  editor.className = "editor";
  editor.spellcheck = false;
  editor.style.cssText = elCss(el, t) + `;caret-color:${colorOf(t, "ink")}`;
  editor.value = el.text;
  editor.placeholder = el.hint ?? "";
  canvas.append(editor);
  // Focus after paint, and put the caret at the end rather than wherever the
  // click happened to land in a box that was empty a moment ago.
  queueMicrotask(() => {
    editor?.focus({ preventScroll: true });
    editor?.setSelectionRange(editor.value.length, editor.value.length);
  });

  let railTimer = null;
  editor.oninput = () => {
    el.text = editor.value;
    save();
    schedulePause();
    clearTimeout(railTimer);
    railTimer = setTimeout(() => emit("rail"), 400);
  };
  editor.onblur = () => stopEditing();
  // Escape is deliberately NOT handled here. It bubbles to the one handler in
  // app.js, which closes the box on the first press and clears the selection
  // on the second. Handling it here as well ran both halves on one press.
}

export function stopEditing() {
  if (!editor) return;
  const el = elById(S.editing);
  const text = editor.value;
  editor.onblur = null;
  editor.remove();
  editor = null;
  S.editing = null;
  if (el) el.text = text;
  save();
  emit("canvas");
  emit("rail");
  firmReview();
}

// --- snapping -------------------------------------------------------------
//
// Against the slide AND against everything else on it. Aligning to another box
// by eye is the single most common thing a slide editor asks of you, and it is
// the one thing a machine can simply do.

const SNAP = 6;
const MARGIN_X = 72, MARGIN_Y = 56;

function targets(moving) {
  const skip = new Set(moving.map((e) => e.id));
  const xs = [0, W / 2, W, MARGIN_X, W - MARGIN_X];
  const ys = [0, H / 2, H, MARGIN_Y, H - MARGIN_Y];
  for (const e of els()) {
    if (skip.has(e.id)) continue;
    xs.push(e.x, e.x + e.w / 2, e.x + e.w);
    ys.push(e.y, e.y + e.h / 2, e.y + e.h);
  }
  return { xs, ys };
}

/** The smallest shift that puts one of `edges` onto one of `lines`, or nothing. */
function pull(edges, lines) {
  let best = null;
  for (const [edge, delta] of edges) {
    for (const line of lines) {
      const d = line - edge;
      if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d + delta, at: line };
    }
  }
  return best;
}

function showGuides(lines) {
  guides.replaceChildren();
  for (const l of lines) {
    const i = document.createElement("i");
    if (l.x != null) {
      i.style.cssText = `left:${l.x}px;top:0;width:${1 / S.scale}px;height:${H}px`;
    } else {
      i.style.cssText = `top:${l.y}px;left:0;height:${1 / S.scale}px;width:${W}px`;
    }
    guides.append(i);
  }
}

// --- dragging, resizing, marquee ------------------------------------------

/** Whether the last pointer gesture was a drag, and what was selected before it. */
let dragged = false;
let wasSelected = null;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  dragged = false;
  wasSelected = S.sel.size === 1 ? [...S.sel][0] : null;
  const handle = e.target.closest(".handle");
  const hit = e.target.closest(".el");

  if (e.target.closest(".editor")) return;

  if (!hit && !handle) {
    if (S.editing) stopEditing();
    marquee(e);
    return;
  }

  const el = elById(handle ? [...S.sel][0] : hit.dataset.id);
  if (!el) return;
  const additive = e.shiftKey || e.metaKey;

  if (!handle) {
    if (S.editing && S.editing !== el.id) stopEditing();
    if (additive) {
      if (S.sel.has(el.id) && S.sel.size > 1) { S.sel.delete(el.id); emit("canvas"); return; }
      select(el.id, true);
      emit("canvas");
    } else if (!S.sel.has(el.id)) {
      select(el.id);
      emit("canvas");
    }
  }
  if (S.editing === el.id) return; // typing: let the caret do its job

  e.preventDefault();
  const start = at(e);
  const dir = handle?.dataset.dir;
  const moving = dir ? [el] : selected();
  const from = moving.map((m) => ({ el: m, x: m.x, y: m.y, w: m.w, h: m.h }));
  let moved = false;

  const onMove = (ev) => {
    const now = at(ev);
    let dx = now.x - start.x, dy = now.y - start.y;
    if (!moved && Math.hypot(dx, dy) * S.scale < 3) return;
    if (!moved) {
      snapshot();
      moved = true;
      // Captured only once this is really a drag. Capturing on every
      // pointerdown would retarget the CLICK that follows to the canvas, and
      // a click that never reaches the box you aimed at is a box you cannot
      // start typing into.
      canvas.setPointerCapture(ev.pointerId);
    }

    if (!dir) {
      const box = {
        x: Math.min(...from.map((f) => f.x)) + dx,
        y: Math.min(...from.map((f) => f.y)) + dy,
        r: Math.max(...from.map((f) => f.x + f.w)) + dx,
        b: Math.max(...from.map((f) => f.y + f.h)) + dy,
      };
      const lines = [];
      if (!ev.altKey) {
        const { xs, ys } = targets(moving);
        const px = pull([[box.x, 0], [(box.x + box.r) / 2, 0], [box.r, 0]], xs);
        const py = pull([[box.y, 0], [(box.y + box.b) / 2, 0], [box.b, 0]], ys);
        if (px) { dx += px.d; lines.push({ x: px.at }); }
        if (py) { dy += py.d; lines.push({ y: py.at }); }
      }
      showGuides(lines);
      for (const f of from) {
        f.el.x = Math.round(f.x + dx);
        f.el.y = Math.round(f.y + dy);
      }
    } else {
      const f = from[0];
      let { x, y, w, h } = f;
      const { xs, ys } = targets(moving);
      const lines = [];
      if (dir.includes("e")) {
        w = f.w + dx;
        const p = ev.altKey ? null : pull([[f.x + w, 0]], xs);
        if (p) { w += p.d; lines.push({ x: p.at }); }
      }
      if (dir.includes("w")) {
        let nx = f.x + dx;
        const p = ev.altKey ? null : pull([[nx, 0]], xs);
        if (p) { nx += p.d; lines.push({ x: p.at }); }
        w = f.w + (f.x - nx); x = nx;
      }
      if (dir.includes("s")) {
        h = f.h + dy;
        const p = ev.altKey ? null : pull([[f.y + h, 0]], ys);
        if (p) { h += p.d; lines.push({ y: p.at }); }
      }
      if (dir.includes("n")) {
        let ny = f.y + dy;
        const p = ev.altKey ? null : pull([[ny, 0]], ys);
        if (p) { ny += p.d; lines.push({ y: p.at }); }
        h = f.h + (f.y - ny); y = ny;
      }
      // A picture holds its shape on a corner: a squashed photograph is never
      // what someone dragging a corner meant.
      if (el.type === "image" && el.src && dir.length === 2) {
        const r = el.ratio || f.w / f.h;
        if (Math.abs(w - f.w) > Math.abs(h - f.h)) h = w / r; else w = h * r;
        if (dir.includes("w")) x = f.x + (f.w - w);
        if (dir.includes("n")) y = f.y + (f.h - h);
        lines.length = 0;
      }
      showGuides(lines);
      const min = el.type === "shape" ? 4 : 32;
      if (w >= min) { el.w = Math.round(w); el.x = Math.round(x); }
      if (h >= min) { el.h = Math.round(h); el.y = Math.round(y); }
    }
    for (const f of from) {
      const n = canvas.querySelector(`[data-id="${f.el.id}"]`);
      if (n) n.style.cssText = elCss(f.el, template()) + (S.sel.has(f.el.id) ? `;--ring:${1.5 / S.scale}px` : "");
    }
    emit("selection");
  };

  const onUp = (ev) => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    guides.replaceChildren();
    dragged = moved;
    if (moved) {
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      save(); emit("canvas"); emit("rail");
    }
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
});

/**
 * Drag a box on empty slide to select what it touches.
 *
 * Touches, not contains: a rubber band you have to fully enclose things with
 * is the one that makes you do it twice.
 */
function marquee(e) {
  const start = at(e);
  const keep = e.shiftKey ? new Set(S.sel) : new Set();
  const band = document.createElement("div");
  band.className = "marquee";
  canvas.append(band);
  let live = false;

  const onMove = (ev) => {
    const now = at(ev);
    const box = {
      x: Math.min(start.x, now.x), y: Math.min(start.y, now.y),
      w: Math.abs(now.x - start.x), h: Math.abs(now.y - start.y),
    };
    if (!live && Math.max(box.w, box.h) * S.scale < 4) return;
    if (!live) canvas.setPointerCapture(ev.pointerId);
    live = true;
    band.style.cssText = boxCss(box) + `;border-width:${1 / S.scale}px`;
    const hits = els().filter(
      (el) => el.x < box.x + box.w && el.x + el.w > box.x && el.y < box.y + box.h && el.y + el.h > box.y,
    );
    S.sel = new Set([...keep, ...hits.map((h) => h.id)]);
    for (const n of canvas.querySelectorAll(".el")) {
      n.classList.toggle("sel", S.sel.has(n.dataset.id));
      n.style.setProperty("--ring", `${1.5 / S.scale}px`);
    }
  };
  const onUp = (ev) => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    band.remove();
    if (live && canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    if (!live) S.sel = keep;
    emit("canvas");
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
}

canvas.addEventListener("dblclick", (e) => {
  // The second click of a double-click can land on the textarea the FIRST one
  // just opened. Without this, double-clicking an empty placeholder drops a
  // second text box on top of the one you are already typing into.
  if (e.target.closest(".editor") || S.editing) return;
  const n = e.target.closest(".el");
  if (!n) { ops.addText("body", at(e)); return; }
  const el = elById(n.dataset.id);
  if (el?.type === "text") ops.startEdit(el.id);
  if (el?.type === "image" && !el.src) emit("pick-image", el.id);
});

// Click a selected text box a second time and you are typing in it - the way
// Slides does it, and faster than reaching for a double-click. A click that
// ENDED a drag is not a second click, which is what `dragged` is for.
canvas.addEventListener("click", (e) => {
  const n = e.target.closest(".el.text");
  if (!n || S.editing || dragged) return;
  const el = elById(n.dataset.id);
  if (el && S.sel.has(el.id) && wasSelected === el.id) ops.startEdit(el.id);
});

// --- images ---------------------------------------------------------------

export async function addImageFile(file, intoId = null) {
  if (!file?.type?.startsWith("image/")) return null;
  const bytes = await file.arrayBuffer();
  const res = await fetch(`/api/deck/${S.slug}/image`, {
    method: "POST", headers: { "content-type": file.type }, body: bytes,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { emit("say", data.error ?? "could not add that image"); return null; }

  // Read the real dimensions so it lands at its own shape rather than a box we
  // guessed, and so a corner drag has a ratio to hold.
  const url = URL.createObjectURL(file);
  const probe = new Image();
  await new Promise((r) => { probe.onload = probe.onerror = r; probe.src = url; });
  const nw = probe.naturalWidth || 480, nh = probe.naturalHeight || 270;
  URL.revokeObjectURL(url);
  const alt = file.name.replace(/\.[^.]+$/, "");

  const into = intoId ? elById(intoId) : null;
  if (into && into.type === "image") {
    snapshot();
    into.src = data.src; into.alt = alt; into.ratio = nw / nh;
    save(); select(into.id); emit("canvas"); emit("rail");
    return into;
  }
  const k = Math.min(1, 520 / nw, 400 / nh);
  const w = Math.round(nw * k), h = Math.round(nh * k);
  const el = {
    id: crypto.randomUUID().slice(0, 8), type: "image",
    x: Math.round((W - w) / 2), y: Math.round((H - h) / 2),
    w, h, src: data.src, ratio: nw / nh, alt,
  };
  snapshot();
  slide().els.push(el);
  select(el.id);
  save(); emit("canvas"); emit("rail");
  return el;
}
