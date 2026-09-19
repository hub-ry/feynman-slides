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
let studyMode = false;
let revealed = false;

export function present(from = S.idx) {
  if (box) return;
  at = from;
  studyMode = localStorage.getItem("present-study-mode") === "true";
  revealed = false;

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
    if (studyMode && !revealed && S.deck.slides[at].els.length > 1) {
      paper.classList.add("study-concealed");
    }
    box.querySelector(".pslide")?.remove();
    box.prepend(paper);

    bar.replaceChildren();

    const count = Object.assign(document.createElement("span"), {
      className: "pbar-count",
      textContent: `${at + 1} / ${S.deck.slides.length}`,
    });

    const studyToggle = Object.assign(document.createElement("button"), {
      className: "pbar-btn" + (studyMode ? " on" : ""),
      textContent: studyMode ? "🧠 Study mode: ON (S)" : "🧠 Study mode: OFF (S)",
      title: "Active recall study mode: hides answers until revealed (S)",
      onclick: (e) => {
        e.stopPropagation();
        studyMode = !studyMode;
        revealed = false;
        localStorage.setItem("present-study-mode", String(studyMode));
        draw();
      },
    });

    bar.append(count, studyToggle);

    if (studyMode && S.deck.slides[at].els.length > 1) {
      if (!revealed) {
        const revealBtn = Object.assign(document.createElement("button"), {
          className: "pbar-action-btn",
          textContent: "Reveal answer  (Space)",
          onclick: (e) => { e.stopPropagation(); revealed = true; draw(); },
        });
        bar.append(revealBtn);
      } else {
        const trickyBtn = Object.assign(document.createElement("button"), {
          className: "pbar-grade-btn tricky",
          textContent: "Tricky  (1)",
          onclick: (e) => { e.stopPropagation(); move(1); },
        });
        const goodBtn = Object.assign(document.createElement("button"), {
          className: "pbar-grade-btn good",
          textContent: "Got it  (2 / Space)",
          onclick: (e) => { e.stopPropagation(); move(1); },
        });
        bar.append(trickyBtn, goodBtn);
      }
    }

    box.style.setProperty("--bar", colorOf(t, "muted"));
  };

  const move = (d) => {
    at = Math.max(0, Math.min(S.deck.slides.length - 1, at + d));
    revealed = false;
    draw();
  };

  const keys = (e) => {
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      studyMode = !studyMode;
      revealed = false;
      localStorage.setItem("present-study-mode", String(studyMode));
      draw();
      return;
    }
    if (studyMode && !revealed && S.deck.slides[at].els.length > 1) {
      if ([" ", "Enter", "ArrowDown", "j"].includes(e.key)) {
        e.preventDefault();
        revealed = true;
        draw();
        return;
      }
    }
    if (studyMode && revealed) {
      if (e.key === "1") { e.preventDefault(); move(1); return; }
      if (e.key === "2") { e.preventDefault(); move(1); return; }
    }
    if (["ArrowRight", " ", "PageDown", "j", "n"].includes(e.key)) { e.preventDefault(); move(1); }
    else if (["ArrowLeft", "PageUp", "k", "p"].includes(e.key)) { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { at = 0; revealed = false; draw(); }
    else if (e.key === "End") { at = S.deck.slides.length - 1; revealed = false; draw(); }
    else if (e.key === "Escape") { e.preventDefault(); stop(); }
  };

  const click = (e) => {
    if (e.target.closest("button")) return;
    if (studyMode && !revealed && S.deck.slides[at].els.length > 1) {
      revealed = true;
      draw();
      return;
    }
    move(e.clientX < innerWidth / 3 ? -1 : 1);
  };

  function stop() {
    if (!box) return;
    removeEventListener("keydown", keys, true);
    removeEventListener("resize", draw);
    box.remove();
    box = null;
    document.body.classList.remove("presenting");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
