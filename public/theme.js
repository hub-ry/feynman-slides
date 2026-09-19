// A template is the whole look of a deck: its paper, its four colours, its
// type scale, and the layouts you build slides out of.
//
// This file is shared by the editor, the thumbnails, the presenter and the
// export, the same way type.js was before it - so a slide cannot look one way
// while you write it and another way when you show it.
//
// The bet the UI makes is that the way to keep an authoring surface simple is
// not to withhold customisation but to MOVE it: there is no font picker
// because the font belongs to the template, and changing it means editing a
// template, which is a thing you do deliberately and once rather than per
// text box at the moment you should be thinking about the slide.
//
// A template is data. Never code. Installing one from the community catalogue
// downloads JSON and nothing else, which is why `validate` below is strict
// about shape and silent about everything it does not recognise.

/** The four colours a template names. Everything on a slide is one of these. */
export const TOKENS = ["paper", "ink", "muted", "accent"];

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const SERIF = 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Slide geometry, in logical units. Nothing anywhere stores a screen pixel. */
export const W = 960;
export const H = 540;

const role = (over) => ({
  family: SANS, size: 24, weight: 400, line: 1.42, letter: "0",
  color: "ink", align: "left", ...over,
});

// --- the templates that ship ---------------------------------------------
//
// Three, not thirty. They exist to prove the seam is real - a dark deck and a
// light one cannot share a hardcoded white - and to give the first deck
// somewhere to start. The rest is meant to come from the catalogue.

export const BUILTIN = [
  {
    id: "feynman",
    name: "Feynman",
    author: "feynman-slides",
    version: "1.0.0",
    description: "A serif heading over plain sans. The default, and the one to copy.",
    palette: { paper: "#ffffff", ink: "#16181d", muted: "#6b7280", accent: "#1a73e8" },
    roles: {
      title: role({ family: SERIF, size: 46, weight: 600, line: 1.15, letter: "-0.015em" }),
      body: role({}),
      caption: role({ size: 15, color: "muted", line: 1.45 }),
    },
    layouts: [
      { id: "title", name: "Title", els: [
        { type: "text", role: "title", x: 96, y: 186, w: 768, h: 120, hint: "Title" },
        { type: "text", role: "body", x: 96, y: 312, w: 768, h: 48, hint: "Subtitle" },
      ] },
      { id: "title-body", name: "Title and body", els: [
        { type: "text", role: "title", x: 72, y: 56, w: 816, h: 84, hint: "Title" },
        { type: "text", role: "body", x: 72, y: 168, w: 816, h: 300, hint: "Body" },
      ] },
      { id: "section", name: "Section", els: [
        { type: "shape", shape: "line", fill: "accent", x: 72, y: 250, w: 96, h: 4 },
        { type: "text", role: "title", x: 72, y: 274, w: 700, h: 84, hint: "Section" },
      ] },
      { id: "two", name: "Two columns", els: [
        { type: "text", role: "title", x: 72, y: 56, w: 816, h: 84, hint: "Title" },
        { type: "text", role: "body", x: 72, y: 168, w: 384, h: 300, hint: "Left" },
        { type: "text", role: "body", x: 504, y: 168, w: 384, h: 300, hint: "Right" },
      ] },
      { id: "figure", name: "Figure", els: [
        { type: "text", role: "title", x: 72, y: 48, w: 816, h: 60, hint: "Title" },
        { type: "image", x: 72, y: 124, w: 816, h: 300 },
        { type: "text", role: "caption", x: 72, y: 436, w: 816, h: 44, hint: "What this shows" },
      ] },
      { id: "quote", name: "Quote", els: [
        { type: "text", role: "title", x: 120, y: 176, w: 720, h: 160, hint: "The claim" },
        { type: "text", role: "caption", x: 120, y: 356, w: 720, h: 40, hint: "Where it came from" },
      ] },
      { id: "blank", name: "Blank", els: [] },
    ],
  },
  {
    id: "chalk",
    name: "Chalk",
    author: "feynman-slides",
    version: "1.0.0",
    description: "Dark paper. For a room with the lights off.",
    palette: { paper: "#15171c", ink: "#f2f4f7", muted: "#98a2b3", accent: "#7dd3fc" },
    roles: {
      title: role({ size: 44, weight: 650, letter: "-0.02em", line: 1.12 }),
      body: role({ size: 23, line: 1.45 }),
      caption: role({ family: MONO, size: 14, color: "muted" }),
    },
    layouts: [
      { id: "title", name: "Title", els: [
        { type: "text", role: "title", x: 96, y: 198, w: 768, h: 108, hint: "Title" },
        { type: "text", role: "caption", x: 96, y: 318, w: 768, h: 40, hint: "Subtitle" },
      ] },
      { id: "title-body", name: "Title and body", els: [
        { type: "text", role: "title", x: 72, y: 60, w: 816, h: 76, hint: "Title" },
        { type: "shape", shape: "line", fill: "accent", x: 72, y: 146, w: 72, h: 3 },
        { type: "text", role: "body", x: 72, y: 180, w: 816, h: 288, hint: "Body" },
      ] },
      { id: "section", name: "Section", els: [
        { type: "text", role: "title", x: 72, y: 240, w: 700, h: 84, hint: "Section" },
      ] },
      { id: "two", name: "Two columns", els: [
        { type: "text", role: "title", x: 72, y: 60, w: 816, h: 76, hint: "Title" },
        { type: "text", role: "body", x: 72, y: 172, w: 384, h: 296, hint: "Left" },
        { type: "text", role: "body", x: 504, y: 172, w: 384, h: 296, hint: "Right" },
      ] },
      { id: "figure", name: "Figure", els: [
        { type: "text", role: "title", x: 72, y: 48, w: 816, h: 60, hint: "Title" },
        { type: "image", x: 72, y: 124, w: 816, h: 300 },
        { type: "text", role: "caption", x: 72, y: 436, w: 816, h: 44, hint: "What this shows" },
      ] },
      { id: "blank", name: "Blank", els: [] },
    ],
  },
  {
    id: "grid",
    name: "Grid",
    author: "feynman-slides",
    version: "1.0.0",
    description: "Swiss and tight. Accent rules instead of decoration.",
    palette: { paper: "#fbfbf9", ink: "#101014", muted: "#71717a", accent: "#e11d48" },
    roles: {
      title: role({ size: 40, weight: 700, letter: "-0.025em", line: 1.1 }),
      body: role({ size: 22, line: 1.5 }),
      caption: role({ size: 13, color: "muted", weight: 500, letter: ".06em" }),
    },
    layouts: [
      { id: "title", name: "Title", els: [
        { type: "text", role: "caption", x: 72, y: 168, w: 480, h: 28, hint: "Course" },
        { type: "text", role: "title", x: 72, y: 202, w: 720, h: 116, hint: "Title" },
        { type: "shape", shape: "line", fill: "accent", x: 72, y: 332, w: 160, h: 5 },
      ] },
      { id: "title-body", name: "Title and body", els: [
        { type: "shape", shape: "line", fill: "accent", x: 72, y: 60, w: 48, h: 5 },
        { type: "text", role: "title", x: 72, y: 80, w: 816, h: 72, hint: "Title" },
        { type: "text", role: "body", x: 72, y: 180, w: 816, h: 288, hint: "Body" },
      ] },
      { id: "section", name: "Section", els: [
        { type: "shape", shape: "rect", fill: "accent", x: 0, y: 0, w: 24, h: 540 },
        { type: "text", role: "title", x: 96, y: 236, w: 700, h: 84, hint: "Section" },
      ] },
      { id: "two", name: "Two columns", els: [
        { type: "text", role: "title", x: 72, y: 64, w: 816, h: 72, hint: "Title" },
        { type: "text", role: "caption", x: 72, y: 160, w: 384, h: 26, hint: "One" },
        { type: "text", role: "body", x: 72, y: 192, w: 384, h: 276, hint: "Left" },
        { type: "text", role: "caption", x: 504, y: 160, w: 384, h: 26, hint: "Two" },
        { type: "text", role: "body", x: 504, y: 192, w: 384, h: 276, hint: "Right" },
      ] },
      { id: "figure", name: "Figure", els: [
        { type: "text", role: "title", x: 72, y: 48, w: 816, h: 60, hint: "Title" },
        { type: "image", x: 72, y: 124, w: 816, h: 300 },
        { type: "text", role: "caption", x: 72, y: 436, w: 816, h: 44, hint: "What this shows" },
      ] },
      { id: "blank", name: "Blank", els: [] },
    ],
  },
];

export const DEFAULT_ID = "feynman";

/** The template a deck asks for, or the default when it names one you removed. */
export function pick(list, id) {
  return list.find((t) => t.id === id) ?? list.find((t) => t.id === DEFAULT_ID) ?? BUILTIN[0];
}

/**
 * Fill in everything a template left out.
 *
 * A community template written by hand will be missing things, and the failure
 * it must never have is a blank slide: an unknown role falls back to body, and
 * a missing colour falls back to the default template's.
 */
export function normalize(t) {
  const base = BUILTIN[0];
  const palette = { ...base.palette, ...(t?.palette ?? {}) };
  const roles = {};
  for (const [k, v] of Object.entries({ ...base.roles, ...(t?.roles ?? {}) })) roles[k] = role(v);
  if (!roles.body) roles.body = role({});
  const layouts = (t?.layouts?.length ? t.layouts : base.layouts).map((l) => ({
    id: String(l.id ?? "layout"),
    name: String(l.name ?? l.id ?? "Layout"),
    els: (l.els ?? []).map((e) => ({ ...e })),
  }));
  return {
    id: String(t?.id ?? DEFAULT_ID),
    name: String(t?.name ?? t?.id ?? "Untitled"),
    author: String(t?.author ?? ""),
    version: String(t?.version ?? "0.0.0"),
    description: String(t?.description ?? ""),
    palette, roles, layouts,
    builtin: Boolean(t?.builtin),
  };
}

/**
 * Is this JSON a template at all?
 *
 * Checked on install rather than on use, because the useful place to refuse
 * something is the moment it arrives from somewhere else - and because a
 * template that fails here never reaches the disk.
 */
export function validate(t) {
  if (!t || typeof t !== "object") return "not an object";
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(String(t.id ?? ""))) return "id must be lowercase letters, digits and dashes";
  if (!String(t.name ?? "").trim()) return "needs a name";
  if (t.palette && typeof t.palette !== "object") return "palette must be an object";
  for (const [k, v] of Object.entries(t.palette ?? {})) {
    if (!TOKENS.includes(k)) return `unknown colour "${k}" - only ${TOKENS.join(", ")}`;
    if (!/^#[0-9a-f]{3,8}$/i.test(String(v))) return `"${k}" must be a hex colour`;
  }
  if (t.roles && typeof t.roles !== "object") return "roles must be an object";
  for (const [k, v] of Object.entries(t.roles ?? {})) {
    if (!v || typeof v !== "object") return `role "${k}" must be an object`;
    if (v.color && !TOKENS.includes(v.color)) return `role "${k}" names an unknown colour`;
  }
  if (t.layouts && !Array.isArray(t.layouts)) return "layouts must be a list";
  for (const l of t.layouts ?? []) {
    if (!Array.isArray(l?.els)) return `layout "${l?.id ?? "?"}" has no els`;
    for (const e of l.els) {
      if (!["text", "image", "shape"].includes(e?.type)) return `layout "${l.id}" has an unknown element`;
      for (const n of ["x", "y", "w", "h"]) {
        if (typeof e[n] !== "number") return `layout "${l.id}": every element needs ${n}`;
      }
    }
  }
  return null;
}

/** A colour token resolved against the template. Anything unknown is ink. */
export const colorOf = (t, token) => t.palette[token] ?? t.palette.ink;

/** The CSS for one role - the same string in the editor, the rail and the export. */
export function roleCss(t, name) {
  const f = t.roles[name] ?? t.roles.body;
  return (
    `font-family:${f.family};font-size:${f.size}px;font-weight:${f.weight};` +
    `line-height:${f.line};letter-spacing:${f.letter};color:${colorOf(t, f.color)};` +
    `text-align:${f.align}`
  );
}

/** The role names a template offers, body first because it is the common one. */
export function roleNames(t) {
  const names = Object.keys(t.roles);
  return names.includes("title") ? ["title", ...names.filter((n) => n !== "title")] : names;
}

/**
 * A layout turned into real elements on a real slide.
 *
 * The placeholders arrive EMPTY, carrying only their hint. A layout that
 * arrived pre-filled with "Lorem ipsum" would mean every slide starts as
 * something to delete, and half of them would ship with a word you did not
 * write still on them.
 */
export function instantiate(layout, uid) {
  return (layout?.els ?? []).map((proto) => {
    const el = { ...proto, id: uid() };
    if (el.type === "text") el.text = "";
    if (el.type === "image") { el.src ??= ""; el.alt ??= ""; }
    return el;
  });
}
