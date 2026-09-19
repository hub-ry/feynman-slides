// Everything you can do to a slide, as functions on the model.
//
// The pointer code, the format bar, the keyboard and the context menu all call
// these and nothing else. That is what keeps four entry points from drifting
// into four slightly different definitions of "duplicate" - and it is why
// every one of them goes through `edit`, so every one of them is undoable.

import { S, slide, els, selected, select, deselect, edit, emit, uid, template, elById } from "./state.js";
import { instantiate } from "./theme.js";
import { firmReview } from "./critic.js";
import { W, H } from "./theme.js";

// --- slides ---------------------------------------------------------------

export function go(i) {
  const next = Math.min(Math.max(i, 0), S.deck.slides.length - 1);
  if (next === S.idx) return;
  S.editing = null;
  S.idx = next;
  deselect();
  emit("deck");
}

export const step = (dir) => go(S.idx + dir);

/** A new slide, built from a layout. The layout you used last is the one you meant. */
export function newSlide(layoutId = S.lastLayout) {
  const t = template();
  const layout = t.layouts.find((l) => l.id === layoutId) ?? t.layouts[0];
  S.lastLayout = layout.id;
  edit(() => {
    S.deck.slides.splice(S.idx + 1, 0, { id: uid(), layout: layout.id, els: instantiate(layout, uid) });
    S.idx += 1;
    deselect();
  });
  // Land in the first empty slot: a layout is only faster than a blank slide
  // if it puts the caret where the words go.
  const first = els().find((e) => e.type === "text");
  if (first) startEdit(first.id);
}

export function deleteSlide(i = S.idx) {
  if (S.deck.slides.length === 1) return;
  edit(() => {
    S.deck.slides.splice(i, 1);
    S.idx = Math.max(0, Math.min(S.idx, S.deck.slides.length - 1));
    deselect();
  });
  firmReview();
}

export function duplicateSlide(i = S.idx) {
  edit(() => {
    const copy = structuredClone(S.deck.slides[i]);
    copy.id = uid();
    for (const e of copy.els) e.id = uid();
    S.deck.slides.splice(i + 1, 0, copy);
    S.idx = i + 1;
    deselect();
  });
}

/** Drag-reorder in the rail. */
export function moveSlide(from, to) {
  if (from === to || to < 0 || to >= S.deck.slides.length) return;
  edit(() => {
    const [s] = S.deck.slides.splice(from, 1);
    S.deck.slides.splice(to, 0, s);
    S.idx = to;
  });
}

/**
 * Re-lay this slide out with another layout.
 *
 * Existing text is poured into the new slots in reading order and keeps its
 * words; slots left over arrive empty, and anything that does not fit a slot
 * is left exactly where it was rather than being thrown away. Losing a
 * sentence to a layout change would be unforgivable in a tool whose whole
 * claim is that the words are the part worth protecting.
 */
export function applyLayout(layoutId) {
  const t = template();
  const layout = t.layouts.find((l) => l.id === layoutId);
  if (!layout) return;
  edit(() => {
    const s = slide();
    const fresh = instantiate(layout, uid);
    const slots = fresh.filter((e) => e.type === "text");
    const mine = s.els
      .filter((e) => e.type === "text")
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const images = s.els.filter((e) => e.type === "image" && e.src);
    const holes = fresh.filter((e) => e.type === "image");

    slots.forEach((slot, i) => { if (mine[i]) slot.text = mine[i].text; });
    holes.forEach((hole, i) => {
      if (!images[i]) return;
      hole.src = images[i].src;
      hole.alt = images[i].alt;
      hole.ratio = images[i].ratio;
    });
    const spare = [
      ...mine.slice(slots.length).map((e) => ({ ...e })),
      ...images.slice(holes.length).map((e) => ({ ...e })),
    ];
    s.layout = layout.id;
    s.els = [...fresh, ...spare];
    S.lastLayout = layout.id;
    deselect();
  });
  firmReview();
}

// --- elements -------------------------------------------------------------

export function startEdit(id) {
  const el = elById(id);
  if (!el || el.type !== "text") return;
  select(id);
  S.editing = id;
  emit("canvas");
}

export function addText(role = "body", at) {
  const n = els().filter((e) => e.type === "text").length;
  const el = {
    id: uid(), type: "text", role,
    x: at?.x ?? 80 + (n % 4) * 24,
    y: at?.y ?? 120 + (n % 6) * 40,
    w: 420, h: role === "title" ? 80 : 96,
    text: "",
  };
  edit(() => { slide().els.push(el); select(el.id); });
  startEdit(el.id);
  return el;
}

export function addShape(shape = "rect") {
  const size = shape === "line" ? { w: 240, h: 4 } : { w: 220, h: 160 };
  const el = {
    id: uid(), type: "shape", shape, fill: "accent",
    x: Math.round((W - size.w) / 2), y: Math.round((H - size.h) / 2), ...size,
  };
  edit(() => { slide().els.push(el); select(el.id); });
  return el;
}

/** An empty image slot, for the times you know where the picture goes before you have it. */
export function addImageSlot() {
  const el = { id: uid(), type: "image", x: 270, y: 120, w: 420, h: 300, src: "", alt: "" };
  edit(() => { slide().els.push(el); select(el.id); });
  return el;
}

export function duplicate() {
  const picked = selected();
  if (!picked.length) return;
  edit(() => {
    const copies = picked.map((el) => ({ ...structuredClone(el), id: uid(), x: el.x + 16, y: el.y + 16 }));
    slide().els.push(...copies);
    select(copies.map((c) => c.id));
  });
}

export function remove() {
  if (!S.sel.size) return;
  edit(() => {
    slide().els = els().filter((e) => !S.sel.has(e.id));
    deselect();
  });
  firmReview();
}

export function nudge(dx, dy) {
  if (!S.sel.size) return;
  edit(() => {
    for (const el of selected()) { el.x += dx; el.y += dy; }
  });
}

/** Z-order is array order, so "bring forward" is a swap with the next one along. */
export function arrange(how) {
  const picked = selected();
  if (!picked.length) return;
  edit(() => {
    const s = slide();
    const keep = s.els.filter((e) => !S.sel.has(e.id));
    const move = s.els.filter((e) => S.sel.has(e.id));
    if (how === "front") s.els = [...keep, ...move];
    else if (how === "back") s.els = [...move, ...keep];
    else {
      // One step, respecting the order the selection already had.
      const idxs = move.map((e) => s.els.indexOf(e)).sort((a, b) => (how === "forward" ? b - a : a - b));
      for (const i of idxs) {
        const j = how === "forward" ? i + 1 : i - 1;
        if (j < 0 || j >= s.els.length || S.sel.has(s.els[j].id)) continue;
        [s.els[i], s.els[j]] = [s.els[j], s.els[i]];
      }
    }
  });
}

const bounds = (list) => ({
  x: Math.min(...list.map((e) => e.x)),
  y: Math.min(...list.map((e) => e.y)),
  r: Math.max(...list.map((e) => e.x + e.w)),
  b: Math.max(...list.map((e) => e.y + e.h)),
});

/**
 * Align the selection.
 *
 * One element aligns to the SLIDE, several align to each other. That is what
 * you mean in both cases, and needing a mode switch to say so would be the
 * kind of small friction this editor is meant not to have.
 */
export function align(how) {
  const picked = selected();
  if (!picked.length) return;
  const box = picked.length === 1 ? { x: 0, y: 0, r: W, b: H } : bounds(picked);
  edit(() => {
    for (const el of picked) {
      if (how === "left") el.x = box.x;
      if (how === "center") el.x = Math.round(box.x + (box.r - box.x - el.w) / 2);
      if (how === "right") el.x = box.r - el.w;
      if (how === "top") el.y = box.y;
      if (how === "middle") el.y = Math.round(box.y + (box.b - box.y - el.h) / 2);
      if (how === "bottom") el.y = box.b - el.h;
    }
  });
}

/** Equal gaps between three or more, which is the only count at which it means anything. */
export function distribute(axis) {
  const picked = selected();
  if (picked.length < 3) return;
  edit(() => {
    const key = axis === "h" ? "x" : "y";
    const size = axis === "h" ? "w" : "h";
    const sorted = [...picked].sort((a, b) => a[key] - b[key]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last[key] + last[size] - first[key];
    const used = sorted.reduce((n, e) => n + e[size], 0);
    const gap = (span - used) / (sorted.length - 1);
    let at = first[key];
    for (const el of sorted) {
      el[key] = Math.round(at);
      at += el[size] + gap;
    }
  });
}

// --- text -----------------------------------------------------------------

export const setRole = (role) =>
  edit(() => { for (const el of selected()) if (el.type === "text") el.role = role; });

export const setAlign = (how) =>
  edit(() => {
    for (const el of selected()) {
      if (el.type !== "text") continue;
      if (how) el.align = how;
      else delete el.align;
    }
  });

export const setFill = (token) =>
  edit(() => { for (const el of selected()) if (el.type === "shape") el.fill = token; });

// --- the deck's template --------------------------------------------------

export function setTemplate(id) {
  edit(() => { S.deck.template = id; });
  emit("template");
}
