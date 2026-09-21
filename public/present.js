// Presenting, without exporting first.
//
// The export is still the artefact you hand in; this is for the ten times
// before that when you want to see the deck at full size and read it back to
// yourself. It draws with the same renderer, so it is not a preview of the
// deck - it is the deck.
//
// This used to carry a study mode of its own: the body blurred, Space to
// reveal, 1 or 2 to say how it went. Two things were wrong with it. Revealing
// a blur is RECOGNITION - you are judging an answer in front of you, not
// producing one - and recognition is exactly the thing that feels like
// knowing and is not. And both grade buttons called move(1), so nothing was
// ever recorded; the app asked how it went and then threw the answer away.
//
// S still means study. It now hands off to the recall session, which asks you
// to say it before it shows you anything and keeps the schedule. See
// public/recall.js and docs/research.md section 5.

import { S, template } from "./state.js";
import { miniature } from "./preview.js";
import { W, H, colorOf } from "./theme.js";
import { iconSvg } from "./icons.js";
import { openRecall } from "./recall.js";

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

    bar.replaceChildren();

    const count = Object.assign(document.createElement("span"), {
      className: "pbar-count",
      textContent: `${at + 1} / ${S.deck.slides.length}`,
    });

    const studyBtn = document.createElement("button");
    studyBtn.className = "pbar-btn";
    studyBtn.innerHTML = `${iconSvg("brain", 14)} <span>Recall (S)</span>`;
    studyBtn.title = "Close the presenter and recall the slides that are due (S)";
    studyBtn.onclick = (e) => { e.stopPropagation(); toRecall(); };

    bar.append(count, studyBtn);

    box.style.setProperty("--bar", colorOf(t, "muted"));
  };

  const move = (d) => {
    at = Math.max(0, Math.min(S.deck.slides.length - 1, at + d));
    draw();
  };

  /**
   * Hand off to the recall session.
   *
   * The presenter closes first rather than layering one fullscreen overlay
   * over another: they both own Escape, and a stack of two would take two
   * presses to leave with nothing on screen saying so.
   */
  const toRecall = () => {
    const slug = S.slug;
    const deck = S.deck;
    const t = template();
    stop();
    // After the current event, not during it. The editor's global key handler
    // skips everything while `#presenter` exists, and stop() removes that
    // element synchronously - so handing off inside the keydown let the same
    // S carry on down to the editor and toggle the source bin behind the
    // session that was opening.
    setTimeout(() => openRecall(slug, deck, t, () => {}), 0);
  };

  const keys = (e) => {
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      e.stopPropagation();
      toRecall();
      return;
    }
    if (["ArrowRight", " ", "PageDown", "j", "n"].includes(e.key)) { e.preventDefault(); move(1); }
    else if (["ArrowLeft", "PageUp", "k", "p"].includes(e.key)) { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { at = 0; draw(); }
    else if (e.key === "End") { at = S.deck.slides.length - 1; draw(); }
    else if (e.key === "Escape") { e.preventDefault(); stop(); }
  };

  const click = (e) => {
    if (e.target.closest("button")) return;
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
