// The deck you have open, and everyone who needs to know when it changes.
//
// One mutable object rather than a store with actions, because every edit here
// is "change this element and redraw": a reducer would be a layer of ceremony
// over `el.x = 40`. What the ceremony WOULD have bought - nobody redrawing
// stale data - is bought instead by the rule that anything which mutates
// `deck` ends by emitting, and the painters are the only readers.

import { normalize, BUILTIN, pick } from "./theme.js";

export const S = {
  slug: null,
  deck: { title: "", slides: [], sources: [], template: "feynman" },
  /**
   * `reviewed` is the fingerprint of the text each slide was last read at, so
   * the pane can tell "clean" from "not looked at yet" from "looked at words
   * you have since rewritten" - three states an empty findings list cannot.
   */
  critiques: { findings: {}, dismissed: [], reviewed: {} },
  templates: [normalize({ ...BUILTIN[0], builtin: true })],
  idx: 0,
  /** Element ids. A Set because "selected" is a property of an element, not an ordering. */
  sel: new Set(),
  editing: null,
  scale: 1,
  reviewing: new Set(),
  /** The layout the last slide was made from, so N can repeat it. */
  lastLayout: "title-body",
};

const subs = new Map();
export const on = (evt, fn) => subs.set(evt, [...(subs.get(evt) ?? []), fn]);
export const emit = (evt, ...args) => { for (const fn of subs.get(evt) ?? []) fn(...args); };

export const slide = () => S.deck.slides[S.idx] ?? null;
export const els = () => slide()?.els ?? [];
export const elById = (id) => els().find((e) => e.id === id) ?? null;
export const selected = () => els().filter((e) => S.sel.has(e.id));
export const only = () => (S.sel.size === 1 ? elById([...S.sel][0]) : null);
export const uid = () => Math.random().toString(36).slice(2, 10);
export const template = () => pick(S.templates, S.deck.template);

export const select = (ids, additive = false) => {
  if (!additive) S.sel.clear();
  for (const id of [ids].flat()) S.sel.add(id);
  emit("selection");
};
export const deselect = () => { S.sel.clear(); emit("selection"); };

// --- the server -----------------------------------------------------------

export const api = (path, opts) =>
  fetch(`/api/deck/${S.slug}${path}`, {
    ...opts,
    headers:
      opts?.body && typeof opts.body === "string" ? { "content-type": "application/json" } : opts?.headers,
  }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

export const post = (path, data) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

let saveTimer = null;
export function save(now = false) {
  clearTimeout(saveTimer);
  const go = () => api("/deck", { method: "POST", body: JSON.stringify(S.deck) });
  if (now) return go();
  saveTimer = setTimeout(go, 400);
  return Promise.resolve();
}

// --- undo -----------------------------------------------------------------
//
// Whole-deck snapshots. A deck is a few kilobytes of JSON and the alternative
// is an inverse operation per command, which is a bug farm for a tool whose
// point is elsewhere.

const past = [];
export function snapshot() {
  past.push(JSON.stringify({ deck: S.deck, idx: S.idx }));
  if (past.length > 120) past.shift();
}
export function undo() {
  const prev = past.pop();
  if (!prev) return false;
  const was = JSON.parse(prev);
  S.deck = was.deck;
  S.idx = Math.min(was.idx, S.deck.slides.length - 1);
  S.sel.clear();
  S.editing = null;
  save();
  emit("deck");
  return true;
}
export const clearHistory = () => (past.length = 0);

/** Every edit funnels through here: snapshot, change, save, redraw. */
export function edit(fn) {
  snapshot();
  const r = fn();
  save();
  emit("deck");
  return r;
}

/** The installed templates, refreshed whenever the folder might have changed. */
export async function loadTemplates() {
  try {
    const r = await (await fetch("/api/templates")).json();
    if (r.installed?.length) S.templates = r.installed;
    S.templatesDir = r.dir;
  } catch { /* the built-in is already in S.templates */ }
  emit("templates");
}
