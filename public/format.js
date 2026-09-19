// The bar that follows what you selected, and the two text commands behind it.
//
// It floats over the slide instead of living in the toolbar for the reason
// Canva's does: the thing you are formatting and the control that formats it
// should be in the same glance. A top toolbar makes you cross the window and
// come back for every bold.
//
// It is short on purpose. Everything on it is either a slot in the template's
// type scale or one of the four marks the text format has - there is no font
// picker and no colour wheel, because those live in the template, which is a
// file you edit once rather than a decision you make per box.

import { S, selected, only, emit, edit, template } from "./state.js";
import { roleNames, TOKENS, colorOf } from "./theme.js";
import { activeEditor } from "./canvas.js";
import * as ops from "./ops.js";
import { firmReview } from "./critic.js";

const bar = document.createElement("div");
bar.id = "formatbar";
bar.hidden = true;
document.body.append(bar);

// --- the marks ------------------------------------------------------------
//
// One function does both cases: with the box open for editing it wraps what
// you selected, and with the box merely selected it wraps every line - which
// is what "bold this" means when you pointed at a box rather than at words.

const MARKS = { bold: "**", italic: "*", code: "`", mark: "==" };

function wrapped(text, m) {
  return text.startsWith(m) && text.endsWith(m) && text.length > m.length * 2;
}

function toggleLine(line, m) {
  const i = line.match(/^\s*(?:[-*•]\s+|\d+[.)]\s+)?/)[0];
  const body = line.slice(i.length);
  if (!body.trim()) return line;
  return i + (wrapped(body, m) ? body.slice(m.length, -m.length) : m + body + m);
}

export function applyMark(kind) {
  const m = MARKS[kind];
  const el = only();
  const ed = activeEditor();
  if (ed) {
    const { selectionStart: a, selectionEnd: b, value } = ed;
    if (a === b) {
      // No selection: open the marks and put the caret between them, so the
      // next thing typed is bold. Same as every editor does it.
      ed.value = value.slice(0, a) + m + m + value.slice(b);
      ed.setSelectionRange(a + m.length, a + m.length);
    } else {
      const picked = value.slice(a, b);
      const next = wrapped(picked, m) ? picked.slice(m.length, -m.length) : m + picked + m;
      ed.value = value.slice(0, a) + next + value.slice(b);
      ed.setSelectionRange(a, a + next.length);
    }
    ed.dispatchEvent(new Event("input"));
    ed.focus();
    return;
  }
  if (!el || el.type !== "text") return;
  edit(() => { el.text = el.text.split("\n").map((l) => toggleLine(l, m)).join("\n"); });
  firmReview();
}

/** Bullets are a line prefix, so toggling them is a line prefix too. */
export function toggleList(ordered = false) {
  const ed = activeEditor();
  const el = only();
  const mark = (line, n) => {
    const stripped = line.replace(/^(\s*)(?:[-*•]\s+|\d+[.)]\s+)/, "$1");
    if (stripped !== line) return stripped;
    const indent = line.match(/^\s*/)[0];
    return `${indent}${ordered ? `${n}. ` : "- "}${line.slice(indent.length)}`;
  };
  if (ed) {
    const { value } = ed;
    const from = value.lastIndexOf("\n", ed.selectionStart - 1) + 1;
    const toEnd = value.indexOf("\n", ed.selectionEnd);
    const to = toEnd === -1 ? value.length : toEnd;
    const lines = value.slice(from, to).split("\n").map(mark);
    ed.value = value.slice(0, from) + lines.join("\n") + value.slice(to);
    ed.setSelectionRange(from, from + lines.join("\n").length);
    ed.dispatchEvent(new Event("input"));
    ed.focus();
    return;
  }
  if (!el || el.type !== "text") return;
  edit(() => { el.text = el.text.split("\n").map(mark).join("\n"); });
}

// --- the bar --------------------------------------------------------------

const btn = (label, title, onclick, cls = "") => {
  const b = document.createElement("button");
  b.className = cls;
  b.title = title;
  b.innerHTML = label;
  b.onmousedown = (e) => e.preventDefault(); // never steal the caret
  b.onclick = onclick;
  return b;
};
const sep = () => Object.assign(document.createElement("span"), { className: "bsep" });

const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h14"/></svg>',
  center: '<svg viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M5 17h14"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 12h10M6 17h14"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 7h11M9 12h11M9 17h11"/><circle cx="5" cy="7" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="5" cy="17" r="1.1"/></svg>',
  front: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="11" height="11" rx="1.5"/><path d="M9 20h11V9"/></svg>',
  back: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M15 4H4v11"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5.5 7.5h13M9.5 7.5V5.5h5v2M7 7.5l.8 11.5h8.4L17 7.5"/></svg>',
  alignL: '<svg viewBox="0 0 24 24"><path d="M4 4v16"/><rect x="7" y="6" width="11" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/></svg>',
  alignC: '<svg viewBox="0 0 24 24"><path d="M12 4v16"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>',
  alignR: '<svg viewBox="0 0 24 24"><path d="M20 4v16"/><rect x="6" y="6" width="11" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/></svg>',
  alignT: '<svg viewBox="0 0 24 24"><path d="M4 4h16"/><rect x="6" y="7" width="4" height="11" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/></svg>',
  alignM: '<svg viewBox="0 0 24 24"><path d="M4 12h16"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>',
  alignB: '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><rect x="6" y="6" width="4" height="11" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/></svg>',
  distH: '<svg viewBox="0 0 24 24"><path d="M4 4v16M20 4v16"/><rect x="10" y="7" width="4" height="10" rx="1"/></svg>',
  distV: '<svg viewBox="0 0 24 24"><path d="M4 4h16M4 20h16"/><rect x="7" y="10" width="10" height="4" rx="1"/></svg>',
};

function build() {
  const picked = selected();
  bar.replaceChildren();
  // The bar belongs to the slide. On the home page there is no slide, and a
  // bar left over from the deck you just closed is a control pointing at
  // nothing.
  if (!picked.length || document.body.dataset.view !== "editor") { bar.hidden = true; return; }
  const t = template();
  const one = picked.length === 1 ? picked[0] : null;

  if (one?.type === "text") {
    for (const name of roleNames(t)) {
      const b = btn(name[0].toUpperCase() + name.slice(1), `${name} (${roleNames(t).indexOf(name) + 1})`,
        () => ops.setRole(name), "role" + (one.role === name ? " on" : ""));
      b.style.cssText = `font-family:${t.roles[name]?.family};font-weight:${Math.min(600, t.roles[name]?.weight ?? 400)}`;
      bar.append(b);
    }
    bar.append(sep());
    bar.append(
      btn("<b>B</b>", "Bold  (⌘B)", () => applyMark("bold")),
      btn("<i>I</i>", "Italic  (⌘I)", () => applyMark("italic")),
      btn("<code>‹›</code>", "Code  (⌘E)", () => applyMark("code")),
      btn('<span class="hl">H</span>', "Highlight  (⌘H)", () => applyMark("mark")),
      btn(ICON.list, "Bullets  (⇧⌘8)", () => toggleList(false)),
    );
    bar.append(sep());
    for (const how of ["left", "center", "right"]) {
      bar.append(btn(ICON[how], `Align ${how}`, () => ops.setAlign(how),
        (one.align ?? t.roles[one.role]?.align ?? "left") === how ? "on" : ""));
    }
  }

  if (one?.type === "shape") {
    for (const token of TOKENS) {
      const b = btn("", `Fill: ${token}`, () => ops.setFill(token), "swatch" + (one.fill === token ? " on" : ""));
      b.style.background = colorOf(t, token);
      bar.append(b);
    }
    bar.append(sep());
    for (const shape of ["rect", "ellipse", "line"]) {
      bar.append(btn(
        shape === "ellipse" ? '<span class="sh el"></span>' : shape === "line" ? '<span class="sh ln"></span>' : '<span class="sh rc"></span>',
        shape, () => edit(() => { one.shape = shape; }), one.shape === shape ? "on" : "",
      ));
    }
  }

  if (one?.type === "image") {
    const alt = document.createElement("input");
    alt.className = "alt";
    alt.placeholder = "describe this image";
    alt.value = one.alt ?? "";
    alt.title = "The critic reads this, so a diagram you describe is a diagram it can check";
    alt.oninput = () => { one.alt = alt.value; };
    alt.onchange = () => { edit(() => {}); firmReview(); };
    bar.append(alt);
    bar.append(btn("Replace", "Choose another file", () => emit("pick-image", one.id), "wide"));
    bar.append(sep());
  }

  if (picked.length > 1) {
    for (const [how, icon] of [["left", "alignL"], ["center", "alignC"], ["right", "alignR"],
                               ["top", "alignT"], ["middle", "alignM"], ["bottom", "alignB"]]) {
      bar.append(btn(ICON[icon], `Align ${how}`, () => ops.align(how)));
    }
    if (picked.length > 2) {
      bar.append(sep());
      bar.append(
        btn(ICON.distH, "Space evenly across", () => ops.distribute("h")),
        btn(ICON.distV, "Space evenly down", () => ops.distribute("v")),
      );
    }
    bar.append(sep());
  }

  bar.append(
    btn(ICON.front, "Bring forward  (])", () => ops.arrange("forward")),
    btn(ICON.back, "Send backward  ([)", () => ops.arrange("backward")),
    btn(ICON.trash, "Delete  (⌫)", () => ops.remove(), "danger"),
  );
  bar.hidden = false;
}

/** Above the selection, flipped below when there is no room - and never off-screen. */
function place() {
  if (bar.hidden) return;
  const nodes = [...document.querySelectorAll("#canvas .el.sel")];
  if (!nodes.length) { bar.hidden = true; return; }
  const boxes = nodes.map((n) => n.getBoundingClientRect());
  const left = Math.min(...boxes.map((b) => b.left));
  const right = Math.max(...boxes.map((b) => b.right));
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  const w = bar.offsetWidth, h = bar.offsetHeight;
  const stage = document.getElementById("stage").getBoundingClientRect();

  let y = top - h - 10;
  if (y < stage.top - h - 4) y = bottom + 10;
  y = Math.max(8, Math.min(y, innerHeight - h - 8));
  let x = (left + right) / 2 - w / 2;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function paintFormat() {
  build();
  place();
}

// --- right-click ----------------------------------------------------------

const menu = document.createElement("div");
menu.id = "ctxmenu";
menu.hidden = true;
document.body.append(menu);

const closeMenu = () => { menu.hidden = true; };
addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) closeMenu(); }, true);
addEventListener("blur", closeMenu);

document.getElementById("canvas").addEventListener("contextmenu", (e) => {
  const n = e.target.closest(".el");
  e.preventDefault();
  if (n && !S.sel.has(n.dataset.id)) { S.sel = new Set([n.dataset.id]); emit("canvas"); }
  if (!n) { S.sel.clear(); emit("canvas"); }
  const rows = S.sel.size
    ? [
        ["Duplicate", "⌘D", () => ops.duplicate()],
        ["Bring to front", "", () => ops.arrange("front")],
        ["Send to back", "", () => ops.arrange("back")],
        ["-"],
        ["Delete", "⌫", () => ops.remove()],
      ]
    : [
        ["Paste", "⌘V", () => emit("paste-here")],
        ["-"],
        ["New text box", "T", () => ops.addText()],
        ["Duplicate slide", "", () => ops.duplicateSlide()],
      ];
  menu.replaceChildren();
  for (const [label, key, run] of rows) {
    if (label === "-") { menu.append(Object.assign(document.createElement("hr"))); continue; }
    const b = document.createElement("button");
    b.append(Object.assign(document.createElement("span"), { textContent: label }));
    if (key) b.append(Object.assign(document.createElement("kbd"), { textContent: key }));
    b.onclick = () => { closeMenu(); run(); };
    menu.append(b);
  }
  menu.hidden = false;
  menu.style.transform = `translate(${Math.min(e.clientX, innerWidth - menu.offsetWidth - 8)}px, ${Math.min(e.clientY, innerHeight - menu.offsetHeight - 8)}px)`;
});
