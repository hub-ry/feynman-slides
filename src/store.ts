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
import { type Deck, blankDeck, slideKey, slideDigest, stillApplies, migrate } from "./deck.ts";

export const HOME = process.env.FEYNMAN_SLIDES_HOME ?? join(homedir(), ".feynman-slides");
export const DECKS = join(HOME, "decks");
export const STORAGE_CAP_GB = Math.max(1, Number(process.env.FEYNMAN_STORAGE_CAP_GB || "100"));
export const STORAGE_CAP_BYTES = STORAGE_CAP_GB * 1024 * 1024 * 1024;

/** Recursively measure total byte size of a directory on disk. */
export function getDirSizeBytes(targetDir: string): number {
  if (!existsSync(targetDir)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        total += getDirSizeBytes(fullPath);
      } else if (entry.isFile()) {
        try {
          total += statSync(fullPath).size;
        } catch {}
      }
    }
  } catch {}
  return total;
}

export function getTotalStorageBytes(): number {
  return getDirSizeBytes(HOME);
}

export function assertStorageCapacity(additionalBytes = 0): void {
  const current = getTotalStorageBytes();
  if (current + additionalBytes > STORAGE_CAP_BYTES) {
    throw new Error(`storage cap of ${STORAGE_CAP_GB}GB reached. Delete older decks or images to free space.`);
  }
}

/**
 * `reviewed` is the fingerprint of the text each slide was last read at.
 *
 * Findings alone cannot tell you whether a critique is current: an empty list
 * means "clean" and "never looked" equally, and a full one goes on looking
 * authoritative long after the sentence it quotes has been rewritten. The
 * fingerprint is what separates the three, and it is what the review pane
 * shows the difference between.
 */
export type State = {
  findings: Record<string, Finding[]>;
  dismissed: Finding[];
  reviewed: Record<string, { digest: string; at: string }>;
};
const EMPTY: State = { findings: {}, dismissed: [], reviewed: {} };

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
        blocking: blocking(prune(deck, readState(e.name))).length,
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
  assertStorageCapacity();
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
  assertStorageCapacity();
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
    return {
      findings: parsed.findings ?? {},
      dismissed: parsed.dismissed ?? [],
      reviewed: parsed.reviewed ?? {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function writeState(slug: string, state: State): void {
  mkdirSync(dir(slug), { recursive: true });
  writeFileSync(statePath(slug), JSON.stringify(state, null, 2) + "\n");
}

/**
 * Drop everything that is no longer about a slide you can see.
 *
 * Two ways a finding goes stale, and both used to leave it on screen:
 *
 *   The slide was deleted. Without this its findings hold the export forever,
 *   with nothing on screen to explain what is blocking you.
 *
 *   The sentence was rewritten. A finding quotes the exact bullet it means,
 *   so once that bullet is gone the finding is about text that does not
 *   exist. Leaving it up is worse than saying nothing: it is a specific,
 *   confident claim about words the writer already took back, and it blocks
 *   an export they cannot fix, because there is nothing left to fix.
 *
 * Rewriting the line is what re-opens the question. The re-review answers it.
 */
export function prune(deck: Deck, state: State): State {
  const bySlide = new Map(deck.slides.map((s) => [slideKey(s), s]));

  for (const key of Object.keys(state.findings)) {
    const slide = bySlide.get(key);
    if (!slide) {
      delete state.findings[key];
      continue;
    }
    state.findings[key] = state.findings[key]!.filter((f) => stillApplies(f, slide));
  }

  for (const key of Object.keys(state.reviewed)) {
    if (!bySlide.has(key)) delete state.reviewed[key];
  }

  state.dismissed = state.dismissed.filter((f) => bySlide.has(f.slideKey));

  return state;
}

/** True when the critique on file was written against the words now on the slide. */
export function isCurrent(state: State, slide: Parameters<typeof slideKey>[0]): boolean {
  return state.reviewed[slideKey(slide)]?.digest === slideDigest(slide);
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
  assertStorageCapacity(bytes.length);
  mkdirSync(imageDir(slug), { recursive: true });
  writeFileSync(join(imageDir(slug), name), bytes);
  return name;
}

export function deleteDeck(slug: string): void {
  rmSync(dir(slug), { recursive: true, force: true });
}

export type CriticConfig = {
  provider: "auto" | "gemini" | "openai" | "local" | "claude" | "heuristic";
  geminiKey?: string;
  geminiModel?: string;
  openaiKey?: string;
  openaiModel?: string;
  localEndpoint?: string;
  localModel?: string;
  localToken?: string;
};

export function readCriticConfig(): CriticConfig {
  const p = join(HOME, "critic.json");
  if (!existsSync(p)) return { provider: (process.env.FEYNMAN_CRITIC as any) || "auto" };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (process.env.FEYNMAN_CRITIC) parsed.provider = process.env.FEYNMAN_CRITIC;
    return parsed;
  } catch {
    return { provider: (process.env.FEYNMAN_CRITIC as any) || "auto" };
  }
}

export function writeCriticConfig(cfg: CriticConfig): void {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(join(HOME, "critic.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
