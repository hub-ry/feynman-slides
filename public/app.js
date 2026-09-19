// Wiring: the two views, the keyboard, and who repaints when.
//
// Nothing in here draws a slide. The modules own their own surfaces and this
// file is the only place that knows they exist - which is why the keyboard
// table below can be the single description of what the app can do, and the
// help sheet and every tooltip can be generated from it.

import { S, on, emit, api, save, undo, clearHistory, slide, els, elById,
         select, deselect, edit, template, loadTemplates } from "./state.js";
import * as ops from "./ops.js";
import { fit, paintCanvas, stopEditing, addImageFile, currentPointer, armTool, getArmedTool, disarmTool } from "./canvas.js";
import { paintRail, scaleRail } from "./rail.js";
import { paintFormat, applyMark, toggleList } from "./format.js";
import { paintFindings, connect, disconnect } from "./critic.js";
import { paintBin, wireBin, showBin, binOpen } from "./bin.js";
import { openLayouts, openTemplates, openNewDeck, openMoveDialog } from "./library.js";
import { present } from "./present.js";
import { miniature } from "./preview.js";
import { pick } from "./theme.js";

const $ = (id) => document.getElementById(id);

// --- painting -------------------------------------------------------------

function paintAll() {
  fit();
  paintCanvas();
  paintRail();
  paintBin();
  paintFindings(ops.go);
  paintToolbar();
  paintGate();
}

function paintToolbar() {
  const t = template();
  $("tplName").textContent = t.name;
  $("layoutName").textContent =
    t.layouts.find((l) => l.id === slide()?.layout)?.name ?? "Layout";
  $("slideNow").textContent = S.deck.slides.length ? `${S.idx + 1} / ${S.deck.slides.length}` : "";
}

function paintGate() {
  const blocking = S.blocking;
  $("export").disabled = blocking > 0 || !S.slug;
  $("gate").hidden = !blocking;
  $("gate").textContent = blocking ? `${blocking} unresolved` : "";
  $("export").title = blocking
    ? "Errors and jargon hold the export. Fix them, or reject them with a reason."
    : "Export";
  labelButtons();
}

function say(msg, busy = false) {
  const s = $("status");
  s.className = "status" + (busy ? " busy" : "");
  s.textContent = msg;
}

function paintStatus() {
  const s = $("status");
  s.className = "status" + (S.reviewing.size ? " busy" : "");
  if (S.reviewing.size) s.textContent = "reading your slide";
  else if (s.textContent === "reading your slide") s.textContent = "";
}

on("deck", paintAll);
on("template", paintAll);
on("canvas", () => { paintCanvas(); paintToolbar(); });
on("rail", paintRail);
on("selection", paintFormat);
on("findings", () => paintFindings(ops.go));
on("gate", paintGate);
on("status", paintStatus);
on("bin", paintBin);
on("fit", fit);
on("say", say);
on("templates", paintToolbar);

// --- images ---------------------------------------------------------------

let imageInto = null;
on("pick-image", (id) => { imageInto = id; $("file").click(); });
$("file").onchange = async (e) => {
  await addImageFile(e.target.files[0], imageInto);
  imageInto = null;
  e.target.value = "";
};
const insertImage = () => { imageInto = null; $("file").click(); };

wireBin((file) => addImageFile(file, null));

addEventListener("paste", async (e) => {
  if (S.editing || ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName)) return;
  const file = [...(e.clipboardData?.files ?? [])][0];
  if (file) { e.preventDefault(); await addImageFile(file); return; }
  // Elements you copied inside the app. Pasted as new elements, nudged over so
  // the copy is visibly a copy.
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (clip.length && text === clipText) {
    e.preventDefault();
    edit(() => {
      const copies = clip.map((el) => ({ ...structuredClone(el), id: Math.random().toString(36).slice(2, 10), x: el.x + 20, y: el.y + 20 }));
      slide().els.push(...copies);
      select(copies.map((c) => c.id));
    });
  } else if (text.trim() && slide()) {
    e.preventDefault();
    const el = ops.addText();
    el.text = text.trim();
    save();
    emit("canvas");
  }
});

// Copy inside the app is a real clipboard write, so pasting into a text editor
// still gives you the words - and pasting back in here gives you the elements.
let clip = [];
let clipText = "";
addEventListener("copy", (e) => {
  if (S.editing || ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName)) return;
  const picked = els().filter((el) => S.sel.has(el.id));
  if (!picked.length) return;
  clip = structuredClone(picked);
  clipText = picked.map((el) => (el.type === "text" ? el.text : `[${el.type}]`)).join("\n");
  e.clipboardData.setData("text/plain", clipText);
  e.preventDefault();
});
addEventListener("cut", (e) => {
  if (S.editing) return;
  dispatchEvent(new ClipboardEvent("copy", { clipboardData: e.clipboardData }));
  if (clip.length) { e.preventDefault(); ops.remove(); }
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
// after Enter or a double-click, and the dispatcher bails while `typing`.

const roleKeyed = (n) => () => {
  const names = Object.keys(template().roles);
  if (names[n]) ops.setRole(names[n]);
};

const KEYS = [
  { group: "Slides", key: "n", label: "New slide, same layout", btn: "addSlide", run: () => ops.newSlide() },
  { group: "Slides", key: "l", label: "Pick a layout", btn: "layoutBtn", run: () => openLayouts() },
  { group: "Slides", key: "l", shift: true, label: "Re-lay this slide", run: () => openLayouts({ apply: true }) },
  { group: "Slides", key: "j", label: "Next slide", show: "J  /  ↓", run: () => ops.step(1) },
  { group: "Slides", key: "k", label: "Previous slide", show: "K  /  ↑", run: () => ops.step(-1) },
  { group: "Slides", key: "d", mod: true, shift: true, label: "Duplicate this slide", run: () => ops.duplicateSlide() },
  { group: "Slides", key: "Backspace", mod: true, label: "Delete this slide", run: () => ops.deleteSlide() },

  {
    group: "On the slide", key: "t", label: "New text box", btn: "addText",
    run: () => {
      const pt = currentPointer();
      if (pt) {
        disarmTool();
        ops.addText("body", pt);
      } else {
        armTool(getArmedTool() === "text" ? null : "text");
      }
    },
  },
  { group: "On the slide", key: "i", label: "Insert image", btn: "addImage", run: insertImage },
  { group: "On the slide", key: "r", label: "New shape", btn: "addShape", run: () => ops.addShape("rect") },
  { group: "On the slide", key: "Tab", label: "Select next element", show: "Tab", run: (e) => cycleSel(e.shiftKey ? -1 : 1) },
  { group: "On the slide", key: "a", mod: true, label: "Select everything", run: () => select(els().map((e) => e.id)) },
  { group: "On the slide", key: "Enter", label: "Edit the selection",
    when: () => S.sel.size === 1 && elById([...S.sel][0])?.type === "text",
    run: () => ops.startEdit([...S.sel][0]) },
  { group: "On the slide", key: "Escape", label: "Back to the slide, then deselect",
    run: () => { if (S.editing) stopEditing(); else deselect(); } },
  { group: "On the slide", key: "d", mod: true, label: "Duplicate", when: () => S.sel.size, run: () => ops.duplicate() },
  { group: "On the slide", key: "Backspace", alias: "Delete", label: "Delete the selection",
    when: () => S.sel.size, run: () => ops.remove() },
  { group: "On the slide", keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    label: "Nudge the selection, shift for ten", show: "← ↑ ↓ →",
    run: (e) => (S.sel.size ? nudge(e) : ops.step(e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1)) },
  { group: "On the slide", key: "]", label: "Bring forward", when: () => S.sel.size, run: () => ops.arrange("forward") },
  { group: "On the slide", key: "[", label: "Send backward", when: () => S.sel.size, run: () => ops.arrange("backward") },

  { group: "Text", key: "1", label: "First style", run: roleKeyed(0) },
  { group: "Text", key: "2", label: "Second style", run: roleKeyed(1) },
  { group: "Text", key: "3", label: "Third style", run: roleKeyed(2) },
  { group: "Text", key: "b", mod: true, label: "Bold", typing: true, run: () => applyMark("bold") },
  { group: "Text", key: "i", mod: true, label: "Italic", typing: true, run: () => applyMark("italic") },
  { group: "Text", key: "e", mod: true, label: "Code", typing: true, run: () => applyMark("code") },
  { group: "Text", key: "h", mod: true, label: "Highlight", typing: true, run: () => applyMark("mark") },
  { group: "Text", key: "8", mod: true, shift: true, label: "Bullets", typing: true, run: () => toggleList(false) },

  { group: "Source material", key: "s", label: "Open or close the bin", btn: "binToggle",
    run: () => showBin(!binOpen(), true) },
  { group: "Source material", key: "u", label: "Upload lecture slides", btn: "binUpload",
    run: () => { showBin(true); $("sourceFile").click(); } },
  { group: "Source material", key: "c", label: "Show or hide the critic", btn: "criticBtn", run: toggleCritic },

  { group: "The deck", key: "m", label: "Templates", btn: "tplBtn", run: () => openTemplates() },
  { group: "The deck", key: "p", label: "Present", btn: "present", run: () => present(S.idx) },
  { group: "The deck", key: "e", label: "Export", btn: "export", run: () => doExport() },
  { group: "The deck", key: "h", label: "All decks", btn: "toHome", run: () => go("#/") },
  { group: "The deck", key: "z", mod: true, label: "Undo", show: "⌘Z", run: () => undo() },
  { group: "The deck", key: "\\", label: "Theme: system, light, dark", btn: "theme", run: () => cycleTheme() },
  { group: "The deck", key: "?", label: "This list", run: () => toggleHelp() },
];

/** How a binding is written on a button or in the help sheet. */
function keyLabel(k) {
  if (k.show) return k.show;
  const name = { Backspace: "Bksp", Enter: "Enter", Escape: "Esc", Tab: "Tab", " ": "Space" }[k.key]
    ?? k.key.toUpperCase();
  return (k.mod ? "⌘" : "") + (k.shift ? "⇧" : "") + name;
}

const matches = (k, e) => {
  const want = k.keys ?? [k.key, k.alias].filter(Boolean);
  if (!want.some((w) => e.key === w || e.key.toLowerCase() === w.toLowerCase())) return false;
  // A modifier the binding did not ask for belongs to the browser.
  if (Boolean(k.mod) !== Boolean(e.metaKey || e.ctrlKey)) return false;
  if (k.shift !== undefined && Boolean(k.shift) !== e.shiftKey) return false;
  return true;
};

addEventListener("keydown", (e) => {
  // The editor's single-letter keys belong to a slide. On the home page there
  // is no slide, and N would otherwise add one to the deck you last had open.
  if (document.body.dataset.view === "home") return;
  if (document.getElementById("presenter")) return;
  const inField = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  const typing = Boolean(S.editing) || inField;

  // Escape has to work mid-sentence, because it is what you reach for when the
  // sentence went wrong - and it is the way back to the slide from any field.
  if (e.key === "Escape") {
    if (getArmedTool()) { e.preventDefault(); disarmTool(); return; }
    if (S.editing) { e.preventDefault(); stopEditing(); return; }
    if (inField) { e.preventDefault(); document.activeElement.blur(); return; }
  }
  if (document.querySelector("dialog[open]") && e.key !== "?") return;
  if (help.open && e.key !== "?" && e.key !== "Escape") return;

  for (const k of KEYS) {
    if (!matches(k, e)) continue;
    // A binding marked `typing` is one that means something INSIDE a text box:
    // bold is the obvious one. Everything else yields to the caret.
    if (typing && !k.typing) continue;
    if (typing && k.typing && !S.editing) continue;
    if (k.when && !k.when()) continue;
    e.preventDefault();
    k.run(e);
    return;
  }
});

function nudge(e) {
  const by = e.shiftKey ? 10 : 1;
  ops.nudge(
    (e.key === "ArrowRight" ? by : 0) - (e.key === "ArrowLeft" ? by : 0),
    (e.key === "ArrowDown" ? by : 0) - (e.key === "ArrowUp" ? by : 0),
  );
}

/** Tab through the elements on this slide, so the mouse is never the only way in. */
function cycleSel(dir) {
  const list = els();
  if (!list.length) return;
  const at = list.findIndex((el) => S.sel.has(el.id));
  select(list[(at + dir + list.length) % list.length].id);
  emit("canvas");
}

// --- the help sheet -------------------------------------------------------

const help = document.createElement("dialog");
help.id = "help";
addEventListener("keydown", (e) => { if (help.open && e.key === "Escape") { e.preventDefault(); help.close(); } });

function buildHelp() {
  help.replaceChildren();
  help.append(Object.assign(document.createElement("h2"), { textContent: "Keys" }));
  for (const group of [...new Set(KEYS.map((k) => k.group))]) {
    const sec = document.createElement("section");
    sec.append(Object.assign(document.createElement("h3"), { textContent: group }));
    for (const k of KEYS.filter((x) => x.group === group)) {
      const row = document.createElement("div");
      row.className = "row";
      row.append(
        Object.assign(document.createElement("kbd"), { textContent: keyLabel(k) }),
        Object.assign(document.createElement("span"), { textContent: k.label }),
      );
      sec.append(row);
    }
    help.append(sec);
  }
  help.append(Object.assign(document.createElement("p"), {
    className: "foot",
    textContent: "Marks: **bold**, *italic*, `code`, ==highlight==, and a line starting with - is a bullet.",
  }));
  document.body.append(help);
}
const toggleHelp = () => (help.open ? help.close() : help.showModal());

// Every button that has a key says so, from the same table - a tooltip is
// where you look when you already suspect there is a faster way.
function labelButtons() {
  for (const k of KEYS) {
    const b = k.btn && $(k.btn);
    if (!b) continue;
    const base = (b.dataset.label ?? b.title ?? k.label).replace(/\s*\([^)]*\)$/, "");
    b.dataset.label = base;
    b.title = `${base}  (${keyLabel(k)})`;
  }
}

// --- theme ----------------------------------------------------------------
//
// Three states, not two: following the system is a real choice and the one
// most people want, so the toggle cycles through it rather than forcing a side
// the first time you touch it. The SLIDE is not themed - its colours come from
// the template, and a deck that changed colour with the app chrome would be a
// deck you could not trust on a projector.

const THEMES = ["system", "light", "dark"];
const ICON = {
  system: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 20h8"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
};

function paintTheme(mode) {
  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  for (const b of [$("theme"), $("homeTheme")]) {
    b.innerHTML = ICON[mode];
    b.dataset.label = `Theme: ${mode}`;
    b.title = `Theme: ${mode}`;
    b.setAttribute("aria-label", `Theme: ${mode}. Click to change.`);
  }
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

// --- the critic panel -----------------------------------------------------

function toggleCritic(force) {
  const shut = force ?? !document.body.classList.contains("no-critic");
  document.body.classList.toggle("no-critic", shut);
  localStorage.setItem("critic", shut ? "shut" : "open");
  $("criticBtn").classList.toggle("on", !shut);
  fit();
}
toggleCritic(localStorage.getItem("critic") === "shut");

// --- buttons --------------------------------------------------------------

$("addSlide").onclick = () => { disarmTool(); ops.newSlide(); };
$("layoutBtn").onclick = () => { disarmTool(); openLayouts(); };
$("relayBtn").onclick = () => { disarmTool(); openLayouts({ apply: true }); };
$("addText").onclick = () => {
  if (getArmedTool() === "text") disarmTool();
  else armTool("text");
};
$("addImage").onclick = () => { disarmTool(); insertImage(); };
$("addShape").onclick = () => { disarmTool(); ops.addShape("rect"); };
addEventListener("pointerdown", (e) => {
  if (getArmedTool() && !$("canvas")?.contains(e.target) && !$("addText")?.contains(e.target)) {
    disarmTool();
  }
});
$("tplBtn").onclick = () => openTemplates();
$("criticBtn").onclick = () => toggleCritic();
$("theme").onclick = cycleTheme;
$("homeTheme").onclick = cycleTheme;
$("present").onclick = () => present(S.idx);
$("helpBtn").onclick = toggleHelp;
$("new").onclick = openNewDeck;
$("homeNew").onclick = () => openNewDeck({ folder: currentFolder });
$("homeNewFolder").onclick = async () => {
  const name = prompt("New folder name (e.g. CS 251):");
  if (!name?.trim()) return;
  await fetch("/api/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  currentFolder = name.trim();
  await router();
};
$("toHome").onclick = () => go("#/");
document.addEventListener("present-ended", () => paintAll());

// The deck's own menu: the three things you do to a deck rather than to a
// slide, kept off the toolbar because you do them once each.
$("deckMenu").onclick = (e) => {
  const menu = $("deckMenuList");
  menu.hidden = !menu.hidden;
  e.stopPropagation();
};
addEventListener("click", () => { $("deckMenuList").hidden = true; });
$("renameDeck").onclick = async () => {
  const title = prompt("Rename this deck", S.deck.title);
  if (!title?.trim()) return;
  const { ok } = await api("/rename", { method: "POST", body: JSON.stringify({ title }) });
  if (!ok) return;
  S.deck.title = title.trim();
  $("deckTitle").textContent = S.deck.title;
  connect();
};
$("moveDeckFolder").onclick = () => {
  openMoveDialog(S.slug, S.deck.title, S.deck.folder, (next) => {
    S.deck.folder = next ?? undefined;
    emit("say", next ? `moved to ${next}` : "removed from folder");
  });
};
$("deleteDeck").onclick = async () => {
  if (!confirm(`Delete "${S.deck.title}" and everything in it?`)) return;
  await api("/delete", { method: "POST" });
  go("#/");
};
$("saveAsTemplate").onclick = () => openTemplates("make");

async function doExport() {
  if ($("export").disabled) return;
  const { ok, data } = await api("/export", { method: "POST" });
  if (ok) say(`wrote ${data.path}`);
  else { say(data.error ?? "export refused"); S.blocking = data.findings?.length ?? 1; paintGate(); }
}
$("export").onclick = doExport;

// --- decks ----------------------------------------------------------------
//
// Two views, one page: the home page listing your decks, and the editor. The
// hash is the only routing there is - `#/` is home, `#/deck/<slug>` is a deck -
// so back and reload land you where you were.

const go = (hash) => { location.hash = hash; };

async function load(next) {
  if (S.slug === next) return;
  S.slug = next;
  localStorage.setItem("deck", next);
  const r = await (await fetch(`/api/deck/${next}`)).json();
  S.deck = r.deck;
  S.deck.sources ??= [];
  S.critiques = r.state;
  S.blocking = r.blocking;
  S.idx = 0;
  S.editing = null;
  deselect();
  S.reviewing = new Set();
  clearHistory();
  S.lastLayout = S.deck.slides[0]?.layout ?? "title-body";
  $("deckTitle").textContent = S.deck.title;
  document.title = `${S.deck.title} - feynman-slides`;
  connect();
  paintAll();
}

let currentFolder = null;

const getFolders = () =>
  fetch("/api/folders")
    .then((r) => r.json())
    .then((d) => d.folders ?? [])
    .catch(() => []);

function makeFolderDropTarget(target, folderName) {
  target.addEventListener("dragover", (e) => {
    const types = [...(e.dataTransfer?.types ?? [])];
    if (types.includes("application/x-deck") || types.includes("text/plain")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      target.classList.add("drop-target");
    }
  });
  target.addEventListener("dragleave", (e) => {
    if (!target.contains(e.relatedTarget)) target.classList.remove("drop-target");
  });
  target.addEventListener("drop", async (e) => {
    e.preventDefault();
    target.classList.remove("drop-target");
    const slug = e.dataTransfer.getData("application/x-deck") || e.dataTransfer.getData("text/plain");
    if (!slug) return;
    await fetch(`/api/deck/${slug}/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder: folderName }),
    });
    await router();
  });
}

function createDeckCard(d) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = `#/deck/${d.slug}`;
  card.draggable = true;
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-deck", d.slug);
    e.dataTransfer.setData("text/plain", d.slug);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  });

  const menuBtn = document.createElement("button");
  menuBtn.className = "card-menu-btn";
  menuBtn.title = "Move to folder";
  menuBtn.setAttribute("aria-label", `Move ${d.title}`);
  menuBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>`;
  menuBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMoveDialog(d.slug, d.title, d.folder, () => router());
  };
  card.append(menuBtn);

  card.oncontextmenu = (e) => {
    e.preventDefault();
    openMoveDialog(d.slug, d.title, d.folder, () => router());
  };

  const shot = document.createElement("div");
  shot.className = "shot";
  const t = pick(S.templates, d.template);
  shot.append(miniature(d.first ?? [], t, {
    width: 260,
    srcFor: (e) => `/api/deck/${d.slug}/images/${encodeURIComponent(e.src)}`,
  }));
  card.append(shot);

  const titleDiv = Object.assign(document.createElement("div"), { className: "card-title" });
  if (d.folder && !currentFolder) {
    const tag = Object.assign(document.createElement("span"), {
      className: "card-folder",
      textContent: `📁 ${d.folder}`,
      title: `Folder: ${d.folder}. Click to filter.`,
    });
    tag.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentFolder = d.folder;
      router();
    };
    titleDiv.append(tag);
  }
  titleDiv.append(document.createTextNode(d.title));
  card.append(titleDiv);

  card.append(Object.assign(document.createElement("div"), {
    className: "card-meta",
    textContent: `${d.slides} slide${d.slides === 1 ? "" : "s"} · ${t.name} · ${when(d.updated)}`,
  }));
  if (d.blocking) {
    card.append(Object.assign(document.createElement("span"), {
      className: "card-gate",
      textContent: `${d.blocking} to deal with`,
    }));
  }
  return card;
}

/** A card per deck: organized by folder with drag-and-drop support. */
function paintHome(list, folders) {
  const titleEl = $("homeTitle");
  const crumbEl = $("folderBreadcrumb");
  if (currentFolder) {
    titleEl.textContent = currentFolder;
    crumbEl.hidden = false;
    crumbEl.replaceChildren();
    const backBtn = Object.assign(document.createElement("button"), {
      className: "ghost small",
      textContent: "← All decks",
    });
    backBtn.onclick = () => { currentFolder = null; router(); };
    crumbEl.append(backBtn);
  } else {
    titleEl.textContent = "Your decks";
    crumbEl.hidden = true;
  }

  const folderBar = $("homeFolders");
  if (!folders.length) {
    folderBar.hidden = true;
  } else {
    folderBar.hidden = false;
    folderBar.replaceChildren();

    const allChip = Object.assign(document.createElement("button"), {
      className: "folder-chip" + (!currentFolder ? " on" : ""),
      title: "View all decks (or drop here to remove from folder)",
    });
    allChip.innerHTML = `All decks <span class="count">${list.length}</span>`;
    allChip.onclick = () => { currentFolder = null; router(); };
    makeFolderDropTarget(allChip, null);
    folderBar.append(allChip);

    for (const f of folders) {
      const count = list.filter((d) => d.folder === f).length;
      const chip = Object.assign(document.createElement("button"), {
        className: "folder-chip" + (currentFolder === f ? " on" : ""),
        title: `Folder: ${f} (drop a deck here to file it)`,
      });
      const fLabel = document.createElement("span");
      fLabel.textContent = `📁 ${f}`;
      const fCount = Object.assign(document.createElement("span"), {
        className: "count",
        textContent: String(count),
      });
      chip.append(fLabel, fCount);
      chip.onclick = () => { currentFolder = f; router(); };
      makeFolderDropTarget(chip, f);

      const delBtn = Object.assign(document.createElement("span"), {
        className: "kill-folder",
        innerHTML: "&times;",
        title: `Delete folder "${f}"`,
      });
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete folder "${f}"? Decks will be moved to unfiled.`)) return;
        await fetch("/api/folders/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: f }),
        });
        if (currentFolder === f) currentFolder = null;
        await router();
      };
      chip.append(delBtn);
      folderBar.append(chip);
    }
  }

  const grid = $("homeGrid");
  grid.replaceChildren();

  if (currentFolder) {
    const visible = list.filter((d) => d.folder === currentFolder);
    $("homeEmpty").hidden = visible.length > 0;
    if (visible.length === 0) {
      $("homeEmpty").textContent = `No decks in "${currentFolder}" yet. Drag decks onto this folder chip or click "New deck".`;
    }
    for (const d of visible) grid.append(createDeckCard(d));
    makeFolderDropTarget(grid, currentFolder);
  } else if (folders.length > 0) {
    $("homeEmpty").hidden = list.length > 0;
    if (list.length === 0) {
      $("homeEmpty").textContent = "No decks yet. A deck is one topic you are teaching yourself.";
    }

    for (const f of folders) {
      const inFolder = list.filter((d) => d.folder === f);
      if (!inFolder.length) continue;
      const section = document.createElement("div");
      section.className = "folder-section-drop";
      const head = document.createElement("div");
      head.className = "folder-section-head";
      head.innerHTML = `<span class="folder-section-title">📁 ${f}</span><span class="folder-section-count">${inFolder.length} deck${inFolder.length === 1 ? "" : "s"}</span>`;
      const subgrid = document.createElement("div");
      subgrid.className = "grid";
      for (const d of inFolder) subgrid.append(createDeckCard(d));
      section.append(head, subgrid);
      makeFolderDropTarget(section, f);
      grid.append(section);
    }

    const unfiled = list.filter((d) => !d.folder);
    if (unfiled.length || folders.some((f) => list.some((d) => d.folder === f))) {
      const section = document.createElement("div");
      section.className = "folder-section-drop";
      const head = document.createElement("div");
      head.className = "folder-section-head";
      head.innerHTML = `<span class="folder-section-title">Decks</span><span class="folder-section-count">${unfiled.length} deck${unfiled.length === 1 ? "" : "s"}</span>`;
      const subgrid = document.createElement("div");
      subgrid.className = "grid";
      for (const d of unfiled) subgrid.append(createDeckCard(d));
      section.append(head, subgrid);
      makeFolderDropTarget(section, null);
      grid.append(section);
    }
  } else {
    $("homeEmpty").hidden = list.length > 0;
    $("homeEmpty").textContent = "No decks yet. A deck is one topic you are teaching yourself.";
    for (const d of list) grid.append(createDeckCard(d));
  }
}

/** Coarse on purpose: the useful question is how stale a deck is, not when. */
function when(ms) {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(ms).toLocaleDateString();
}

const decks = () => fetch("/api/decks").then((r) => r.json());

async function router() {
  const m = /^#\/deck\/([a-z0-9-]+)$/.exec(location.hash);
  const [list, folders] = await Promise.all([decks(), getFolders()]);
  await loadTemplates();

  if (m && list.some((d) => d.slug === m[1])) {
    document.body.dataset.view = "editor";
    await load(m[1]);
    scaleRail();
    return;
  }
  document.body.dataset.view = "home";
  disconnect();
  S.slug = null;
  document.title = "feynman-slides";
  paintHome(list, folders);
}
addEventListener("hashchange", router);

buildHelp();
labelButtons();

// First load with no route: back to the deck you were last in, because that is
// where you left off. Home is what you get when there is nothing to go back to.
if (!location.hash) {
  const last = localStorage.getItem("deck");
  location.replace(last ? `#/deck/${last}` : "#/");
}
router();
