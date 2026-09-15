// The outline is a plain markdown file, and it is the source of truth.
//
//     # Deck title
//
//     ## Slide title
//     - a bullet
//     - another bullet
//
//     > source material this slide is drawn from
//
// Slides are `##` headings, bullets are the body, a blockquote is the source
// material the critic checks you against. Nothing here is a database: you can
// open the file in any editor, and the tool reads whatever it finds.

export type Slide = {
  index: number;
  title: string;
  bullets: string[];
  /** Blockquoted source material, if you pasted any. Turns the critic strict. */
  source: string;
  /** Character offsets in the raw text, so the editor can tell which slide the caret is in. */
  start: number;
  end: number;
};

export type Outline = {
  title: string;
  slides: Slide[];
};

export const TEMPLATE = `# {title}

## What question does this slide answer?
- Replace this with the idea in your own words
- One slide per concept. If it needs two, split it

> Paste your lecture slide or textbook passage here. With source material the
> critic checks you against it. Without it, the critic falls back on what it
> knows and says so.
`;

export function parse(text: string): Outline {
  const lines = text.split("\n");
  let title = "Untitled deck";
  const slides: Slide[] = [];
  let current: Slide | null = null;
  let source: string[] = [];
  let offset = 0;

  const flush = (end: number) => {
    if (!current) return;
    current.source = source.join("\n").trim();
    current.end = end;
    slides.push(current);
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const lineStart = offset;
    offset += raw.length + 1; // +1 for the newline we split on

    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      flush(lineStart);
      source = [];
      current = {
        index: slides.length,
        title: line.slice(3).trim(),
        bullets: [],
        source: "",
        start: lineStart,
        end: text.length,
      };
    } else if (!current) {
      continue;
    } else if (/^\s*[-*]\s+/.test(line)) {
      current.bullets.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (line.startsWith(">")) {
      source.push(line.replace(/^>\s?/, ""));
    } else if (line.trim()) {
      source.push(line.trim());
    }
  }
  flush(text.length);
  return { title, slides };
}

/** Which slide the caret sits in, or null when it is above the first `##`. */
export function slideAt(outline: Outline, caret: number): Slide | null {
  for (const s of outline.slides) {
    if (caret >= s.start && caret < s.end) return s;
  }
  return outline.slides.at(-1) ?? null;
}

/**
 * What the critic is shown for one slide.
 *
 * Slide-local on purpose: deck-wide context would catch "you used this term
 * before you defined it", but it costs tokens on every keystroke pause and it
 * is not the failure this tool exists for.
 */
export function render(slide: Slide): string {
  const bullets = slide.bullets.length
    ? slide.bullets.map((b) => `- ${b}`).join("\n")
    : "(no bullets yet)";
  const source = slide.source
    ? `SOURCE MATERIAL THEY PASTED (check them against THIS):\n${slide.source}`
    : "SOURCE MATERIAL: none given. Fall back on your own knowledge and mark every finding basis=knowledge.";
  return `SLIDE TITLE: ${slide.title}\n\nBULLETS:\n${bullets}\n\n${source}`;
}

/** Stable-enough identity for a slide across edits, used to key findings. */
export function slideKey(slide: Slide): string {
  return `${slide.index}:${slide.title.trim().toLowerCase()}`;
}
