// A slide, drawn small.
//
// The rail, the layout gallery and the template market all need one, and they
// all need it to be the SAME small slide - a layout you picked out of a
// gallery has to land looking like the picture you picked. So there is one
// function, and it draws with the same styles the canvas does, scaled by a
// transform rather than re-decided at a smaller size.

import { elCss, elHtml } from "./render.js";
import { colorOf, W, H } from "./theme.js";

export function miniature(els, t, { width, hints = false, srcFor } = {}) {
  const paper = document.createElement("div");
  paper.className = "paper";
  paper.style.background = colorOf(t, "paper");
  if (width) {
    paper.style.width = `${width}px`;
    paper.style.height = `${Math.round((width * H) / W)}px`;
  }
  const inner = document.createElement("div");
  inner.className = "scaled";
  if (width) inner.style.transform = `scale(${width / W})`;
  for (const el of els) {
    const n = document.createElement("div");
    n.className = `el ${el.type}`;
    n.style.cssText = elCss(el, t);
    if (el.type === "text" && !el.text && hints) {
      n.innerHTML = `<span style="opacity:.42">${el.hint ?? ""}</span>`;
    } else if (el.type === "image" && !el.src) {
      n.className += " hole";
      n.style.cssText += `;border:2px dashed ${colorOf(t, "muted")}55;border-radius:4px`;
    } else {
      n.innerHTML = elHtml(el, t, srcFor);
    }
    inner.append(n);
  }
  paper.append(inner);
  return paper;
}
