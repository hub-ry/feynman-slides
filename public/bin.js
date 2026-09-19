// The source bin: one per deck, not one per slide.
//
// Source material does not divide neatly by slide. One passage covers three of
// them, and the definition you pasted while writing slide 2 is exactly what
// the critic needs on slide 9 - so everything in here is checked against every
// slide, and shown on none of them.

import { S, save, emit, edit, uid } from "./state.js";
import { firmReview } from "./critic.js";
import { pdfToSources } from "./pdf-text.js";

const $ = (id) => document.getElementById(id);
const say = (msg, busy = false) => emit("say", msg, busy);

export function paintBin() {
  S.deck.sources ??= [];
  const n = S.deck.sources.length;
  const count = $("binCount");
  count.textContent = n ? String(n) : "empty";
  count.classList.toggle("some", n > 0);

  const list = $("binList");
  list.replaceChildren();
  for (const src of S.deck.sources) {
    const row = document.createElement("div");
    row.className = "source";
    if (src.label) {
      const tag = Object.assign(document.createElement("span"), { className: "tag-src", textContent: src.label });
      tag.title = src.label;
      row.append(tag);
    }
    const ta = document.createElement("textarea");
    ta.value = src.text;
    ta.spellcheck = false;
    ta.rows = Math.min(6, src.text.split("\n").length + 1);
    ta.oninput = () => { src.text = ta.value; save(); };
    // Editing a source changes what every slide is checked against, so the
    // re-read waits until you are done rather than firing on each keystroke.
    ta.onblur = () => { if (!src.text.trim()) removeSource(src.id); else firmReview(); };
    const kill = Object.assign(document.createElement("button"), { className: "kill", textContent: "×" });
    kill.title = "Remove";
    kill.onclick = () => removeSource(src.id);
    row.append(ta, kill);
    list.append(row);
  }
}

function removeSource(id) {
  edit(() => { S.deck.sources = S.deck.sources.filter((s) => s.id !== id); });
  emit("bin");
  firmReview();
}

function addSource(text, label) {
  if (!text.trim()) return;
  edit(() => { (S.deck.sources ??= []).push({ id: uid(), text: text.trim(), ...(label ? { label } : {}) }); });
  emit("bin");
  firmReview();
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
  edit(() => {
    S.deck.sources ??= [];
    for (const e of entries) S.deck.sources.push({ id: uid(), text: e.text.trim(), label: e.label });
  });
  emit("bin");
  firmReview();
}

// Whether the bin is open is remembered: it is where your lecture material
// lives, and someone working from a PDF has it open for the whole session.
export function showBin(open, focus = false) {
  $("binBody").hidden = !open;
  $("binToggle").setAttribute("aria-expanded", String(open));
  localStorage.setItem("bin", open ? "open" : "shut");
  emit("fit");
  if (open && focus) $("binAdd").focus();
}
export const binOpen = () => !$("binBody").hidden;

/**
 * What a dropped file becomes.
 *
 * A PDF is source material, one entry per page, labelled with where it came
 * from. An IMAGE goes on the slide instead: nothing here does OCR, so a
 * picture in the bin would sit there looking like source material while
 * contributing nothing.
 */
export async function ingest(files, onImage) {
  const list = [...files];
  const pdfs = list.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const imgs = list.filter((f) => f.type.startsWith("image/"));
  const skipped = list.length - pdfs.length - imgs.length;

  for (const f of pdfs) {
    try {
      say(`reading ${f.name}`, true);
      const { sources, pages } = await pdfToSources(f, (n, total) =>
        say(`reading ${f.name} - page ${n} of ${total}`, true));
      addSources(sources);
      // A deck that yields nothing is a scan, and silence would look like a
      // bug rather than the one thing this cannot do.
      say(sources.length
        ? `${f.name}: added ${sources.length} of ${pages} pages`
        : `${f.name}: no text found - it looks scanned, so its pages are images`);
    } catch (err) {
      say(`could not read ${f.name}: ${err.message ?? err}`);
    }
  }
  for (const f of imgs) {
    await onImage(f);
    say(`${f.name} added to the slide - the bin holds text the critic can read`);
  }
  if (skipped) say(`${skipped} file${skipped > 1 ? "s" : ""} skipped - PDFs and images only`);
}

export function wireBin(onImage) {
  $("binToggle").onclick = () => showBin(!binOpen(), true);
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
  $("binUpload").onclick = () => $("sourceFile").click();
  $("sourceFile").onchange = async (e) => { await ingest(e.target.files, onImage); e.target.value = ""; };

  // The whole panel is the target, not just the button - you are dragging a
  // file at a box, and the button is the smallest part of the box.
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
  drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("over"); });
  drop.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.classList.remove("over");
    await ingest(e.dataTransfer.files, onImage);
  });
  // Dropping a file anywhere else would otherwise navigate away from the
  // editor and lose whatever was not yet saved.
  for (const type of ["dragover", "drop"]) {
    addEventListener(type, (e) => { if (hasFiles(e) && !drop.contains(e.target)) e.preventDefault(); });
  }
}
