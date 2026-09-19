// How a slide is drawn, in one place.
//
// The editor, the rail thumbnails, the presenter and the exported file all
// call these two functions. That is the whole reason the module exists: the
// first version of this tool drew a slide in three places and they disagreed
// about line height within a week, which you only discover on a projector.
//
// Text is stored as plain text with markdown marks in it - `**like this**` -
// rather than as HTML or as a tree of styled runs. Three reasons, in order of
// how much they matter:
//
//   1. deck.json stays something you can read and diff.
//   2. The critic reads the slide as text, so it needs no un-marking pass
//      beyond stripping the marks - it never sees a DOM.
//   3. You can type it. Somebody who knows markdown never has to find the
//      bold button, which is the difference between writing a slide fast and
//      operating a slide editor.

import { roleCss, colorOf } from "./theme.js";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Longest marks first, so `**bold**` is never read as two italics.
const INLINE = /(\*\*[^*\n]+\*\*|==[^=\n]+==|`[^`\n]+`|\*[^*\n]+\*)/g;

/** One line of text, with its inline marks turned into spans. */
function inline(text, accent) {
  return text
    .split(INLINE)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return `<b>${esc(part.slice(2, -2))}</b>`;
      if (part.startsWith("==") && part.endsWith("==") && part.length > 4)
        return `<mark style="background:${accent}22;color:inherit;padding:0 .12em;border-radius:2px">${esc(part.slice(2, -2))}</mark>`;
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
        return `<code>${esc(part.slice(1, -1))}</code>`;
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
        return `<i>${esc(part.slice(1, -1))}</i>`;
      return esc(part);
    })
    .join("");
}

const BULLET = /^(\s*)([-*•])\s+(.*)$/;
const NUMBER = /^(\s*)(\d+)[.)]\s+(.*)$/;

/**
 * A text box's contents as HTML.
 *
 * Bullets are a flex row rather than a `<ul>`, because a list item's marker
 * cannot be positioned reliably at an arbitrary font size across the four
 * places this is drawn, and a slide's bullet is a hanging indent and nothing
 * more.
 */
export function textHtml(text, accent = "#1a73e8") {
  const lines = String(text ?? "").split("\n");
  return lines
    .map((raw) => {
      const b = BULLET.exec(raw);
      const n = !b && NUMBER.exec(raw);
      const hit = b || n;
      if (hit) {
        const depth = Math.min(2, Math.floor(hit[1].length / 2));
        const mark = b ? "•" : `${n[2]}.`;
        return (
          `<div class="li" style="display:flex;gap:.5em;margin-left:${depth * 1.4}em">` +
          `<span class="bullet" style="flex:0 0 auto;opacity:.75">${mark}</span>` +
          `<span style="flex:1 1 auto;min-width:0">${inline(hit[3], accent) || "&nbsp;"}</span></div>`
        );
      }
      return `<div>${inline(raw, accent) || "&nbsp;"}</div>`;
    })
    .join("");
}

/** Strip the marks, for anything that wants the words and not the styling. */
export const plain = (text) =>
  String(text ?? "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/==([^=\n]+)==/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^(\s*)[-*•]\s+/gm, "$1")
    .replace(/^(\s*)(\d+)[.)]\s+/gm, "$1");

/** Where an element sits. Logical units - the stage as a whole is what scales. */
export const boxCss = (el) =>
  `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px`;

/**
 * The full style for one element, template applied.
 *
 * `el.align` is the one typographic knob that is per-element rather than per
 * role, because centring one line under a figure is a property of that line
 * and not of every caption in the deck.
 */
export function elCss(el, t) {
  const box = boxCss(el);
  if (el.type === "text") {
    return `${box};${roleCss(t, el.role)}` + (el.align ? `;text-align:${el.align}` : "");
  }
  if (el.type === "shape") {
    const fill = el.fill === "none" ? "transparent" : colorOf(t, el.fill ?? "accent");
    const round = el.shape === "ellipse" ? "50%" : el.shape === "line" ? "999px" : "0";
    return `${box};background:${fill};border-radius:${round}`;
  }
  return box;
}

/** The inner HTML of one element, for the places that draw from strings. */
export function elHtml(el, t, srcFor) {
  if (el.type === "text") return textHtml(el.text, colorOf(t, "accent"));
  if (el.type === "shape") return "";
  const src = srcFor ? srcFor(el) : "";
  return src ? `<img src="${esc(src)}" alt="${esc(el.alt ?? "")}">` : "";
}
