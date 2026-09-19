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
  folder?: string;
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
        folder: deck.folder?.trim() || undefined,
        slides: deck.slides.length,
        first: deck.slides[0]?.els ?? [],
        blocking: blocking(readState(e.name)).length,
        updated: statSync(deckPath(e.name)).mtimeMs,
      };
    })
    .sort((a, b) => b.updated - a.updated);
}

const foldersPath = join(HOME, "folders.json");

export function listFolders(): string[] {
  const custom: string[] = existsSync(foldersPath)
    ? JSON.parse(readFileSync(foldersPath, "utf8"))
    : [];
  const fromDecks = list().map((c) => c.folder).filter((f): f is string => Boolean(f));
  const set = new Set([...custom, ...fromDecks]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function createFolder(name: string): void {
  const n = name.trim();
  if (!n) return;
  const current = listFolders();
  if (!current.includes(n)) {
    current.push(n);
    writeFileSync(foldersPath, JSON.stringify(current.sort((a, b) => a.localeCompare(b)), null, 2) + "\n");
  }
}

export function deleteFolder(name: string): void {
  const n = name.trim();
  for (const card of list()) {
    if (card.folder === n) setFolder(card.slug, undefined);
  }
  const custom: string[] = existsSync(foldersPath)
    ? JSON.parse(readFileSync(foldersPath, "utf8"))
    : [];
  const next = custom.filter((f) => f !== n);
  writeFileSync(foldersPath, JSON.stringify(next, null, 2) + "\n");
}

export function renameFolder(oldName: string, newName: string): void {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return;
  for (const card of list()) {
    if (card.folder === from) setFolder(card.slug, to);
  }
  const custom: string[] = existsSync(foldersPath)
    ? JSON.parse(readFileSync(foldersPath, "utf8"))
    : [];
  const next = custom.map((f) => (f === from ? to : f));
  if (!next.includes(to)) next.push(to);
  writeFileSync(foldersPath, JSON.stringify([...new Set(next)].sort((a, b) => a.localeCompare(b)), null, 2) + "\n");
}

export function create(
  title: string,
  template = "feynman",
  titleLayout?: unknown,
  folder?: string,
): string {
  let slug = slugify(title);
  // Two decks called "Hash tables" are two decks, not one: without this the
  // second one opens the first, and you lose an afternoon before you notice.
  if (existsSync(deckPath(slug))) {
    let n = 2;
    while (existsSync(deckPath(`${slug}-${n}`))) n += 1;
    slug = `${slug}-${n}`;
  }
  mkdirSync(dir(slug), { recursive: true });
  writeDeck(slug, blankDeck(title, template, titleLayout, folder));
  if (folder?.trim()) createFolder(folder.trim());
  return slug;
}

/** Assign a deck to a folder or clear it. */
export function setFolder(slug: string, folder?: string): void {
  const deck = readDeck(slug);
  deck.folder = folder?.trim() || undefined;
  writeDeck(slug, deck);
  if (folder?.trim()) createFolder(folder.trim());
}

/** Rename in place. The slug is the deck's address - changing it would break its images. */
export function rename(slug: string, title: string): void {
  const deck = readDeck(slug);
  deck.title = title;
  writeDeck(slug, deck);
}

/** Duplicate a deck, cloning its slides, sources, and images. */
export function duplicateDeck(slug: string, newTitle?: string): string {
  const original = readDeck(slug);
  const title = newTitle?.trim() || `${original.title} (Copy)`;
  let newSlug = slugify(title);
  if (existsSync(deckPath(newSlug))) {
    let n = 2;
    while (existsSync(deckPath(`${newSlug}-${n}`))) n += 1;
    newSlug = `${newSlug}-${n}`;
  }
  mkdirSync(dir(newSlug), { recursive: true });
  const copyDeck = structuredClone(original);
  copyDeck.title = title;
  writeDeck(newSlug, copyDeck);
  const origImg = imageDir(slug);
  if (existsSync(origImg)) {
    const newImg = imageDir(newSlug);
    mkdirSync(newImg, { recursive: true });
    for (const file of readdirSync(origImg)) {
      writeFileSync(join(newImg, file), readFileSync(join(origImg, file)));
    }
  }
  return newSlug;
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
