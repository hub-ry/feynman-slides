// The two text styles, defined once.
//
// A text box is a title or it is body text. That is the whole typography
// system, and it is deliberately not a font picker: every decision you are
// offered while writing a slide is a decision you make instead of thinking
// about whether the slide is true.
//
// Plain .js so it is the SAME file for the editor, the thumbnails and the
// export. Three copies of these numbers would disagree within a week.
//
// System stacks only, no webfonts - the exported deck has to open offline.

export const FONT = {
  title: {
    family: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    size: 46,
    weight: 600,
    line: 1.15,
    letter: "-0.015em",
  },
  body: {
    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    size: 24,
    weight: 400,
    line: 1.42,
    letter: "0",
  },
};

export const ROLES = ["title", "body"];

/** CSS for one role, shared by the canvas and the export so they render identically. */
export function css(role) {
  const f = FONT[role] ?? FONT.body;
  return `font-family:${f.family};font-size:${f.size}px;font-weight:${f.weight};` +
    `line-height:${f.line};letter-spacing:${f.letter}`;
}
