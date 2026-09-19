// The export is one self-contained HTML file: positioned slides, images
// inlined as data URIs, no server, no accounts, opens offline. Arrow keys and
// click advance it, so it presents as well as it reads.
//
// It draws through public/render.js and public/theme.js - the same two
// functions the editor draws with - so the file you hand in is the file you
// were looking at. Nothing in here knows what a bullet looks like.
//
// The gate lives here, in the export path, rather than in a disabled button.
// dum-intern learned this the expensive way: asked not to build before
// approval, it skipped the gate, wrote two files, and reported that nothing
// was built. A gate you ask for is a suggestion.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { Deck, El } from "./deck.ts";
import { W, H } from "./deck.ts";
import { elCss, elHtml, esc } from "../public/render.js";
import { colorOf } from "../public/theme.js";
import type { Finding } from "./critic.ts";
import type { State } from "./store.ts";
import { blocking, imageDir } from "./store.ts";
import { get as getTemplate, type Template } from "./templates.ts";

export class Blocked extends Error {
  // Longhand: Node strips types rather than compiling them, so a constructor
  // parameter property is a syntax error at load even when tsc is happy.
  findings: Finding[];
  constructor(findings: Finding[]) {
    super(`${findings.length} unresolved finding${findings.length === 1 ? "" : "s"}`);
    this.findings = findings;
  }
}

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
};

/** Images become data URIs so the file stays one file. */
function dataUri(slug: string, name: string): string {
  const p = join(imageDir(slug), name);
  if (!existsSync(p)) return "";
  const mime = MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${readFileSync(p).toString("base64")}`;
}

function element(slug: string, el: El, t: Template): string {
  const style = elCss(el, t);
  if (el.type === "image") {
    const src = el.src ? dataUri(slug, el.src) : "";
    // A layout's empty image slot is a hole you did not fill. It is a prompt
    // in the editor and nothing at all here.
    return src ? `<img class="el" style="${style}" src="${src}" alt="${esc(el.alt)}">` : "";
  }
  if (el.type === "shape") return `<div class="el shape" style="${style}"></div>`;
  return `<div class="el text" style="${style}">${elHtml(el, t)}</div>`;
}

const css = (t: Template) => `
:root { --paper:${colorOf(t, "paper")}; --ink:${colorOf(t, "ink")}; --muted:${colorOf(t, "muted")}; --accent:${colorOf(t, "accent")}; }
* { box-sizing:border-box; margin:0; }
body { background:#0d0f12; color:var(--ink);
  font:16px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;
  min-height:100vh; display:grid; place-items:center; overflow:hidden; }
#stage { position:relative; width:${W}px; height:${H}px; transform-origin:center; }
.slide { position:absolute; inset:0; background:var(--paper); overflow:hidden;
  box-shadow:0 18px 60px rgba(0,0,0,.55); border-radius:2px; display:none; }
.slide.on { display:block; }
.el { position:absolute; }
.text { white-space:pre-wrap; overflow-wrap:anywhere; }
.text code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.88em;
  background:color-mix(in srgb, var(--muted) 22%, transparent); padding:.05em .3em; border-radius:3px; }
img.el { object-fit:contain; }
#bar { position:fixed; bottom:1.1rem; left:50%; transform:translateX(-50%);
  color:#8b929b; font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.1em;
  user-select:none; }
@media print {
  body { background:#fff; display:block; overflow:visible; }
  #stage { transform:none !important; width:${W}px; height:${H}px; }
  .slide { display:block !important; position:relative; page-break-after:always; box-shadow:none; }
  #bar { display:none; }
}
`;

const JS = `
const slides=[...document.querySelectorAll('.slide')];
let i=0;
const bar=document.getElementById('bar');
const show=n=>{i=Math.max(0,Math.min(slides.length-1,n));
  slides.forEach((s,k)=>s.classList.toggle('on',k===i));
  bar.textContent=(i+1)+' / '+slides.length;};
// The deck is authored at a fixed size and scaled to whatever it is opened in,
// so the same file looks right on a laptop and a projector.
const fit=()=>{const s=Math.min(innerWidth/${W},innerHeight/${H})*0.92;
  document.getElementById('stage').style.transform='scale('+s+')';};
addEventListener('resize',fit);
addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(i+1);
  if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);
  if(e.key==='Home')show(0); if(e.key==='End')show(slides.length-1);});
addEventListener('click',e=>show(i+(e.clientX<innerWidth/3?-1:1)));
fit();show(0);
`;

export function html(slug: string, deck: Deck, t: Template = getTemplate(deck.template ?? "feynman")): string {
  const slides = deck.slides
    .map((s) => `<section class="slide">${s.els.map((e) => element(slug, e, t)).join("")}</section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.title)}</title>
<style>${css(t)}</style></head>
<body><div id="stage">
${slides}
</div><div id="bar"></div>
<script>${JS}</script></body></html>`;
}

/** Writes the deck next to its slides. Throws `Blocked` rather than writing one you cannot defend. */
export function exportDeck(slug: string, dir: string, deck: Deck, state: State): string {
  const open = blocking(state);
  if (open.length) throw new Blocked(open);
  const out = join(dir, "deck.html");
  writeFileSync(out, html(slug, deck));
  return out;
}
