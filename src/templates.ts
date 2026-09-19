// Templates on disk, and where new ones come from.
//
// The model is Obsidian's, deliberately: a folder you own, one file per thing,
// and a catalogue that is itself just a file somewhere. There is no account,
// nothing phones home, and a template you wrote is a file you can email to
// someone. Drop a .json in the folder and it is installed; delete it and it is
// gone.
//
//   ~/.feynman-slides/templates/<id>.json
//
// A template is DATA. There is no place in the format for code, `validate`
// refuses anything that is not the shape it expects, and installing one writes
// exactly one JSON file - so "install a template from the internet" carries
// the risk of a stylesheet, not the risk of a plugin.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN, normalize, validate } from "../public/theme.js";
import { HOME } from "./store.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The catalogue that ships with the tool, and the templates it points at. */
export const SHIPPED = join(ROOT, "templates");
export const DIR = join(HOME, "templates");

export type Template = ReturnType<typeof normalize>;

/**
 * Where the community catalogue is read from.
 *
 * Unset by default, and then the bundled file is the catalogue. A default
 * pointing at a URL would mean every visit to the market waits on a network
 * round trip to decide it is offline, for a list that has four entries in it.
 */
export const REGISTRY = process.env.FEYNMAN_TEMPLATE_REGISTRY ?? "";

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Everything installed: what ships, then what you have added. */
export function all(): Template[] {
  const out = BUILTIN.map((t) => normalize({ ...t, builtin: true }));
  if (!existsSync(DIR)) return out;
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith(".json")) continue;
    const raw = readJson(join(DIR, f));
    if (!raw || validate(raw)) continue;
    const t = normalize(raw);
    // A file you wrote shadows a built-in with the same id, so a built-in is
    // something you can override rather than something in your way.
    const at = out.findIndex((x) => x.id === t.id);
    if (at >= 0) out[at] = t;
    else out.push(t);
  }
  return out;
}

export const get = (id: string): Template =>
  all().find((t) => t.id === id) ?? normalize(BUILTIN[0]);

export type CatalogEntry = {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  palette: Record<string, string>;
  url: string;
  installed?: boolean;
};

/**
 * The community catalogue.
 *
 * `source` is reported so the market can say which list you are looking at.
 * Silently falling back to the bundled four while a fetch failed would be the
 * kind of lie that takes an afternoon to notice.
 */
export async function catalog(): Promise<{ source: string; entries: CatalogEntry[]; error?: string }> {
  const bundled = () => {
    const raw = readJson(join(SHIPPED, "registry.json")) as { templates?: CatalogEntry[] } | null;
    return raw?.templates ?? [];
  };
  if (!REGISTRY) return { source: "bundled", entries: bundled() };
  try {
    const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`registry returned ${res.status}`);
    const raw = (await res.json()) as { templates?: CatalogEntry[] };
    return { source: new URL(REGISTRY).host, entries: raw.templates ?? [] };
  } catch (err) {
    return { source: "bundled", entries: bundled(), error: String((err as Error).message ?? err) };
  }
}

/** A catalogue url, which is either a file that shipped or something to fetch. */
async function fetchTemplate(url: string): Promise<unknown> {
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`could not fetch it: ${res.status}`);
    return await res.json();
  }
  const local = join(SHIPPED, url.replace(/^\/?templates\/?/, ""));
  if (!local.startsWith(SHIPPED)) throw new Error("that is not a template path");
  const raw = readJson(local);
  if (!raw) throw new Error("no template at that path");
  return raw;
}

export async function install(url: string): Promise<Template> {
  const raw = (await fetchTemplate(url)) as Record<string, unknown>;
  const bad = validate(raw);
  if (bad) throw new Error(`that file is not a template: ${bad}`);
  return write(raw);
}

/** Write a validated template into the folder you own. */
export function write(raw: Record<string, unknown>): Template {
  const bad = validate(raw);
  if (bad) throw new Error(bad);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${raw.id}.json`), JSON.stringify(raw, null, 2) + "\n");
  return normalize(raw);
}

/** Read one back as it is on disk, for the editor - not normalized, not filled in. */
export function raw(id: string): Record<string, unknown> | null {
  const mine = join(DIR, `${id}.json`);
  if (existsSync(mine)) return readJson(mine) as Record<string, unknown>;
  const shipped = BUILTIN.find((t) => t.id === id);
  return shipped ? (structuredClone(shipped) as Record<string, unknown>) : null;
}

/**
 * Remove one you installed.
 *
 * A built-in cannot be removed, only shadowed - so removing a template you had
 * overridden puts the original back rather than leaving a deck with nothing to
 * draw itself with.
 */
export function remove(id: string): void {
  const p = join(DIR, `${id}.json`);
  if (!existsSync(p)) throw new Error("that one did not come from your templates folder");
  rmSync(p);
}

/**
 * A template made out of a deck you have already built.
 *
 * This is the intended way to get a template: arrange one deck until it looks
 * the way you want, then keep the arrangement. Every slide becomes a layout,
 * named after whatever its heading says, with the words taken out - the words
 * were the deck, the positions were the template.
 */
export function fromDeck(
  deck: { title: string; template?: string; slides: { els: Record<string, unknown>[] }[] },
  id: string,
  name: string,
): Record<string, unknown> {
  const base = get(deck.template ?? "feynman");
  const seen = new Set<string>();
  const layouts = deck.slides
    .map((s, i) => {
      const head = s.els.find((e) => e.type === "text" && String(e.text ?? "").trim());
      const label = String(head?.text ?? "").split("\n")[0]!.trim().slice(0, 28) || `Layout ${i + 1}`;
      let lid = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `layout-${i + 1}`;
      while (seen.has(lid)) lid += "-2";
      seen.add(lid);
      return {
        id: lid,
        name: label,
        els: s.els.map((e) => {
          const { id: _id, text, src, alt, ...rest } = e as Record<string, unknown>;
          // The hint is what the slot said when you built it, which is a
          // better name for the slot than anything this could invent.
          const hint = e.type === "text" ? String(text ?? "").split("\n")[0]!.trim().slice(0, 32) : undefined;
          return e.type === "text" ? { ...rest, ...(hint ? { hint } : {}) } : { ...rest };
        }),
      };
    })
    .filter((l) => l.els.length);
  return {
    id, name,
    author: "you",
    version: "1.0.0",
    description: `From the deck "${deck.title}".`,
    palette: base.palette,
    roles: base.roles,
    layouts: layouts.length ? layouts : base.layouts,
  };
}
