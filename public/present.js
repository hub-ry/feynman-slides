// Presenting, without exporting first.
//
// The export is still the artefact you hand in; this is for the ten times
// before that when you want to see the deck at full size and read it back to
// yourself. It draws with the same renderer, so it is not a preview of the
// deck - it is the deck.

import { S, template } from "./state.js";
import { miniature } from "./preview.js";
import { W, H, colorOf } from "./theme.js";

let box = null;
let at = 0;

export function present(from = S.idx) {
  if (box) return;
  at = from;
  box = document.createElement("div");
  box.id = "presenter";
  box.tabIndex = -1;
  const bar = document.createElement("div");
  bar.className = "pbar";
  box.append(bar);
  document.body.append(box);
  document.body.classList.add("presenting");

  const draw = () => {
    const t = template();
    const width = Math.min(innerWidth * 0.94, ((innerHeight * 0.94) * W) / H);
    const paper = miniature(S.deck.slides[at].els, t, {
      width,
      srcFor: (e) => `/api/deck/${S.slug}/images/${encodeURIComponent(e.src)}`,
    });
    paper.classList.add("pslide");
    box.querySelector(".pslide")?.remove();
    box.prepend(paper);
    bar.textContent = `${at + 1} / ${S.deck.slides.length}`;
    box.style.setProperty("--bar", colorOf(t, "muted"));
  };

  const move = (d) => { at = Math.max(0, Math.min(S.deck.slides.length - 1, at + d)); draw(); };
  const keys = (e) => {
    if (["ArrowRight", " ", "PageDown", "j", "n"].includes(e.key)) { e.preventDefault(); move(1); }
    else if (["ArrowLeft", "PageUp", "k", "p"].includes(e.key)) { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { at = 0; draw(); }
    else if (e.key === "End") { at = S.deck.slides.length - 1; draw(); }
    else if (e.key === "Escape") { e.preventDefault(); stop(); }
  };
  const click = (e) => move(e.clientX < innerWidth / 3 ? -1 : 1);

  function stop() {
    if (!box) return;
    removeEventListener("keydown", keys, true);
    removeEventListener("resize", draw);
    box.remove();
    box = null;
    document.body.classList.remove("presenting");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Land back on the slide you stopped on, which is the one you were talking
    // about when you decided it was wrong.
    S.idx = at;
    document.dispatchEvent(new CustomEvent("present-ended"));
  }

  addEventListener("keydown", keys, true);
  addEventListener("resize", draw);
  box.addEventListener("click", click);
  // Escape leaves fullscreen on its own, and an overlay still sitting there
  // afterwards looks like the app has hung.
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && box) stop(); });
  box.requestFullscreen?.().catch(() => {});
  draw();
  box.focus();
}
