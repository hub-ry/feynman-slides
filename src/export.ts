// Rendering is the easy half, so it stays the easy half: one self-contained
// HTML file, no accounts, no OAuth, no build step, opens offline.
//
// The gate lives in the export path itself rather than in a prompt or a
// disabled button. dum-intern learned this the expensive way - asked not to
// build before approval, it skipped the gate, wrote two files, and reported
// that nothing was built. A gate you ask for is a suggestion.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Outline } from "./outline.ts";
import type { Finding } from "./critic.ts";
import type { State } from "./store.ts";
import { blocking } from "./store.ts";

export class Blocked extends Error {
  // Written out longhand: Node strips types rather than compiling them, so a
  // constructor parameter property is a syntax error at load, not at build.
  findings: Finding[];
  constructor(findings: Finding[]) {
    super(`${findings.length} unresolved finding${findings.length === 1 ? "" : "s"}`);
    this.findings = findings;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root { --ink:#16181d; --dim:#6b7280; --bg:#faf9f7; --rule:#e3e0da; --accent:#2f6f4f; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#e8e6e1; --dim:#9aa0a8; --bg:#15171a; --rule:#2c3036; --accent:#7fc8a0; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font: 16px/1.6 ui-serif, Georgia, "Times New Roman", serif; }
.deck { max-width: 60rem; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
h1.deck-title { font-size: clamp(2rem, 6vw, 3.4rem); line-height:1.1; margin:0 0 3.5rem;
  letter-spacing:-0.02em; }
section { border-top: 1px solid var(--rule); padding: 2.75rem 0; page-break-after: always; }
section h2 { font-size: clamp(1.4rem, 3.4vw, 2rem); line-height:1.2; margin:0 0 1.25rem;
  letter-spacing:-0.01em; }
ul { margin:0; padding-left: 1.2em; }
li { margin: 0.55rem 0; max-width: 46rem; }
.source { margin-top:1.75rem; padding-left:1rem; border-left:2px solid var(--accent);
  color:var(--dim); font-size:0.92rem; white-space:pre-wrap; max-width:46rem; }
.n { color:var(--dim); font: 0.75rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing:0.12em; display:block; margin-bottom:0.65rem; }
@media print { body { background:#fff; } section { border-top:none; } }
`;

export function html(outline: Outline): string {
  const slides = outline.slides
    .map((s, i) => {
      const bullets = s.bullets.length
        ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
        : "";
      const source = s.source ? `<div class="source">${esc(s.source)}</div>` : "";
      return `<section><span class="n">${String(i + 1).padStart(2, "0")}</span><h2>${esc(s.title)}</h2>${bullets}${source}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(outline.title)}</title>
<style>${CSS}</style></head>
<body><main class="deck"><h1 class="deck-title">${esc(outline.title)}</h1>
${slides}
</main></body></html>`;
}

/** Writes the deck next to its outline. Throws `Blocked` rather than writing a deck you cannot defend. */
export function exportDeck(dir: string, outline: Outline, state: State): string {
  const open = blocking(state);
  if (open.length) throw new Blocked(open);
  const out = join(dir, "deck.html");
  writeFileSync(out, html(outline));
  return out;
}
