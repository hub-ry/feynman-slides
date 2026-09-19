// The filmstrip. Every slide, drawn the way the slide is drawn.
//
// A thumbnail is the real renderer at a smaller scale - the same element
// styles, the same markdown, scaled by a transform - rather than a second
// drawing of the same model. The first version approximated font sizes here
// and the rail slowly stopped agreeing with the canvas, which is exactly the
// bug you cannot see until you are looking for a slide you cannot find.

import { S, emit, template } from "./state.js";
import { miniature } from "./preview.js";
import { W } from "./theme.js";
import { openOn } from "./critic.js";
import * as ops from "./ops.js";

const rail = document.getElementById("rail");

let dragFrom = null;
let railMenu = null;

function closeRailMenu() {
  if (railMenu) {
    railMenu.remove();
    railMenu = null;
  }
}

document.addEventListener("click", closeRailMenu);
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest("#rail")) closeRailMenu();
});

function openRailContextMenu(e, index) {
  e.preventDefault();
  e.stopPropagation();
  closeRailMenu();

  const menu = document.createElement("div");
  menu.className = "rail-context-menu";
  const x = Math.min(e.clientX, window.innerWidth - 190);
  const y = Math.min(e.clientY, window.innerHeight - 220);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items = [
    {
      label: "Duplicate slide",
      shortcut: "⌘D",
      action: () => ops.duplicateSlide(index),
    },
    {
      label: "Add slide below",
      shortcut: "N",
      action: () => ops.insertSlideAt(index + 1),
    },
    ...(index > 0 ? [{
      label: "Move up",
      shortcut: "↑",
      action: () => ops.moveSlide(index, index - 1),
    }] : []),
    ...(index < S.deck.slides.length - 1 ? [{
      label: "Move down",
      shortcut: "↓",
      action: () => ops.moveSlide(index, index + 1),
    }] : []),
    ...(S.deck.slides.length > 1 ? [{
      label: "Delete slide",
      shortcut: "⌫",
      danger: true,
      action: () => ops.deleteSlide(index),
    }] : []),
  ];

  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "rail-menu-item" + (item.danger ? " danger" : "");
    btn.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ""}`;
    btn.onclick = () => {
      closeRailMenu();
      item.action();
    };
    menu.append(btn);
  }

  document.body.append(menu);
  railMenu = menu;
}

function makeInserter(afterIndex) {
  const slot = document.createElement("div");
  slot.className = "rail-insert-slot";
  const btn = document.createElement("button");
  btn.className = "rail-insert-btn";
  btn.title = "Insert slide here";
  btn.textContent = "+";
  btn.onclick = (e) => {
    e.stopPropagation();
    ops.insertSlideAt(afterIndex);
  };
  slot.append(btn);
  return slot;
}

export function paintRail() {
  const t = template();
  rail.replaceChildren();
  closeRailMenu();

  S.deck.slides.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "thumb" + (i === S.idx ? " on" : "");
    row.draggable = true;
    row.dataset.i = i;

    row.append(Object.assign(document.createElement("span"), { className: "n", textContent: i + 1 }));

    const frame = document.createElement("div");
    frame.className = "frame";
    frame.append(miniature(s.els, t, { srcFor: (e) => `/api/deck/${S.slug}/images/${encodeURIComponent(e.src)}` }));
    if (openOn(s.id)) {
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.title = "unresolved findings";
      frame.append(flag);
    }
    frame.onclick = () => ops.go(i);
    row.append(frame);

    row.oncontextmenu = (e) => openRailContextMenu(e, i);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";

    const more = document.createElement("button");
    more.className = "more";
    more.title = "Slide actions";
    more.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>`;
    more.onclick = (e) => {
      e.stopPropagation();
      openRailContextMenu(e, i);
    };
    actions.append(more);

    if (S.deck.slides.length > 1) {
      const kill = document.createElement("button");
      kill.className = "kill";
      kill.textContent = "×";
      kill.title = "Delete this slide";
      kill.onclick = (e) => { e.stopPropagation(); ops.deleteSlide(i); };
      actions.append(kill);
    }
    row.append(actions);

    row.ondragstart = (e) => {
      dragFrom = i;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    };
    row.ondragend = () => { dragFrom = null; paintRail(); };
    row.ondragover = (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      const box = row.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      for (const other of rail.children) other.classList.remove("drop-before", "drop-after");
      row.classList.add(after ? "drop-after" : "drop-before");
    };
    row.ondrop = (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      const box = row.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      let to = i + (after ? 1 : 0);
      if (to > dragFrom) to -= 1;
      ops.moveSlide(dragFrom, to);
      dragFrom = null;
    };

    rail.append(row);

    // Subtle between-slide inserter
    if (i < S.deck.slides.length - 1) {
      rail.append(makeInserter(i + 1));
    }
  });

  const add = document.createElement("button");
  add.className = "add";
  add.textContent = "+  slide";
  add.title = "New slide  (N)";
  add.onclick = () => ops.newSlide();
  rail.append(add);
  scaleRail();
}

/**
 * How far down a thumbnail is scaled, measured rather than assumed.
 *
 * The rail can be any width - it is a percentage of the window - so the only
 * honest source for this number is the box the thumbnail actually got.
 */
export function scaleRail() {
  const frame = rail.querySelector(".frame");
  if (!frame) return;
  rail.style.setProperty("--k", frame.clientWidth / W);
}
addEventListener("resize", scaleRail);
