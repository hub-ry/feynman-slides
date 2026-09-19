// Decks on disk: one JSON file, one sidecar of findings, and an images folder.
//
//   ~/.feynman-slides/decks/<slug>/
//     deck.json        the slides - source of truth
//     critiques.json   open findings and your rejections - disposable
//     images/          what you pasted in, by name
//     deck.html        the export
//
// The sidecar is deliberately separate from the deck: losing your critiques
// must never be able to cost you your slides.

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, rmSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Finding } from "./critic.ts";
import { type Deck, blankDeck, slideKey, migrate } from "./deck.ts";

export const HOME = process.env.FEYNMAN_SLIDES_HOME ?? join(homedir(), ".feynman-slides");
export const DECKS = join(HOME, "decks");

export type State = { findings: Record<string, Finding[]>; dismissed: Finding[] };
const EMPTY: State = { findings: {}, dismissed: [] };

export function slugify(title: string): string {
  return (
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "deck"
  );
}

export const dir = (slug: string) => join(DECKS, slug);
const deckPath = (slug: string) => join(dir(slug), "deck.json");
const statePath = (slug: string) => join(dir(slug), "critiques.json");
export const imageDir = (slug: string) => join(dir(slug), "images");

export type Card = {
  slug: string;
  title: string;
  template: string;
  slides: number;
  blocking: number;
  updated: number;
  /** The first slide's elements, so the home page can show the deck rather than its initial. */
  first: unknown[];
};

/**
 * Every deck, newest first.
 *
 * The counts are read here rather than on the home page, because a deck you
 * cannot export is the one fact worth seeing before you open it.
 */
export function list(): Card[] {
  if (!existsSync(DECKS)) return [];
  return readdirSync(DECKS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(deckPath(e.name)))
    .map((e) => {
      const deck = readDeck(e.name);
      return {
        slug: e.name,
        title: deck.title,
        template: deck.template ?? "feynman",
        slides: deck.slides.length,
        first: deck.slides[0]?.els ?? [],
        blocking: blocking(readState(e.name)).length,
        updated: statSync(deckPath(e.name)).mtimeMs,
      };
    })
    .sort((a, b) => b.updated - a.updated);
}

export function create(title: string, template = "feynman", titleLayout?: unknown): string {
  let slug = slugify(title);
  // Two decks called "Hash tables" are two decks, not one: without this the
  // second one opens the first, and you lose an afternoon before you notice.
  if (existsSync(deckPath(slug))) {
    let n = 2;
    while (existsSync(deckPath(`${slug}-${n}`))) n += 1;
    slug = `${slug}-${n}`;
  }
  mkdirSync(dir(slug), { recursive: true });
  writeDeck(slug, blankDeck(title, template, titleLayout));
  return slug;
}

/** Rename in place. The slug is the deck's address - changing it would break its images. */
export function rename(slug: string, title: string): void {
  const deck = readDeck(slug);
  deck.title = title;
  writeDeck(slug, deck);
}

export function readDeck(slug: string): Deck {
  const p = deckPath(slug);
  if (!existsSync(p)) return blankDeck(slug);
  return migrate(JSON.parse(readFileSync(p, "utf8")) as Deck);
}

export function writeDeck(slug: string, deck: Deck): void {
  mkdirSync(dir(slug), { recursive: true });
  // Written to a temp file and renamed, because the editor saves on every
  // drag: a crash mid-write must not be able to leave you with half a deck.
  const tmp = deckPath(slug) + ".tmp";
  writeFileSync(tmp, JSON.stringify(deck, null, 2) + "\n");
  renameSync(tmp, deckPath(slug));
}

export function readState(slug: string): State {
  const p = statePath(slug);
  if (!existsSync(p)) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return { findings: parsed.findings ?? {}, dismissed: parsed.dismissed ?? [] };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function writeState(slug: string, state: State): void {
  mkdirSync(dir(slug), { recursive: true });
  writeFileSync(statePath(slug), JSON.stringify(state, null, 2) + "\n");
}

/**
 * Drop findings for slides that no longer exist.
 *
 * Without this, deleting a slide leaves its findings holding the export
 * forever, with nothing on screen to explain what is blocking you.
 */
export function prune(deck: Deck, state: State): State {
  const live = new Set(deck.slides.map(slideKey));
  for (const key of Object.keys(state.findings)) {
    if (!live.has(key)) delete state.findings[key];
  }
  return state;
}

/**
 * What stands between you and an export.
 *
 * Errors AND jargon both block, deliberately. Naming a thing instead of
 * explaining it is the failure the Feynman technique exists to catch, and the
 * one that feels most like understanding while you are doing it.
 */
export function blocking(state: State): Finding[] {
  return Object.values(state.findings)
    .flat()
    .filter((f) => !f.dismissed && (f.severity === "error" || f.severity === "jargon"));
}

export function saveImage(slug: string, name: string, bytes: Buffer): string {
  mkdirSync(imageDir(slug), { recursive: true });
  writeFileSync(join(imageDir(slug), name), bytes);
  return name;
}

export function deleteDeck(slug: string): void {
  rmSync(dir(slug), { recursive: true, force: true });
}
