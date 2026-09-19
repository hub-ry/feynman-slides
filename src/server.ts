// A local server, no framework. Two runtime dependencies, both things that
// could not reasonably have been written by hand: the Agent SDK, and pdf.js
// for reading the lecture PDFs you drop in the bin.
//
// The browser cannot talk to the Agent SDK, so the critic session lives here
// and findings come back over SSE. One session per open deck, started lazily,
// because starting one costs a subprocess.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { startCritic, type CriticSession, type Finding } from "./critic.ts";
import { type Deck, slideKey, uid } from "./deck.ts";
import * as store from "./store.ts";
import { exportDeck, Blocked } from "./export.ts";
import * as templates from "./templates.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
// pdf.js is served out of node_modules rather than copied into public/ or
// pulled from a CDN: the extraction has to work with no network, because the
// rest of this tool does.
const VENDOR = join(ROOT, "node_modules", "pdfjs-dist", "build");

type Live = { critic: CriticSession; clients: Set<ServerResponse>; reviewing: Set<string> };
const live = new Map<string, Live>();

function open(slug: string, title: string): Live {
  let d = live.get(slug);
  if (!d) {
    d = { critic: startCritic(title), clients: new Set(), reviewing: new Set() };
    live.set(slug, d);
  }
  return d;
}

function push(slug: string, event: string, data: unknown): void {
  const d = live.get(slug);
  if (!d) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of d.clients) c.write(frame);
}

/**
 * Review one slide and broadcast what came back.
 *
 * `firm` is the difference between the two moments the critic fires: a pause
 * while typing in a text box (advisory - a half-typed bullet is not a finding)
 * and finishing with that box (this is as done as it is getting).
 *
 * Deduplicated per slide because a pause and a blur land milliseconds apart -
 * you stop typing precisely because you are about to click elsewhere.
 */
async function review(slug: string, slideId: string, firm: boolean): Promise<void> {
  const deck = store.readDeck(slug);
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return;
  if (!slide.els.some((e) => e.type === "text" && e.text.trim())) return;

  const key = slideKey(slide);
  const d = open(slug, deck.title);
  if (d.reviewing.has(key)) return;
  d.reviewing.add(key);
  push(slug, "reviewing", { slideKey: key });

  try {
    const findings = await d.critic.review(slide, deck.sources ?? [], firm);
    const state = store.prune(deck, store.readState(slug));
    // An advisory pass never clears a firm pass's findings: you paused
    // mid-sentence, which is not evidence the slide got better.
    if (firm || findings.length) state.findings[key] = findings;
    store.writeState(slug, state);
    push(slug, "findings", {
      slideKey: key,
      findings: state.findings[key] ?? [],
      blocking: store.blocking(state).length,
      criticMode: d.critic.mode(),
    });
  } catch (err) {
    push(slug, "error", { message: String(err) });
  } finally {
    d.reviewing.delete(key);
    push(slug, "idle", { slideKey: key });
  }
}

// --- plumbing -------------------------------------------------------------

async function raw(req: IncomingMessage, cap = 12 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > cap) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function body(req: IncomingMessage): Promise<any> {
  const text = (await raw(req)).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const json = (res: ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mjs": "text/javascript; charset=utf-8", ".map": "application/json",
};

function sendFile(res: ServerResponse, path: string, root: string, isHead = false): void {
  // Resolved and then checked, not just checked: `normalize` is what turns
  // `../../etc/passwd` into something a prefix test can actually see.
  const full = normalize(path);
  if (!full.startsWith(root) || !existsSync(full)) {
    res.writeHead(404).end("not found");
    return;
  }
  const bytes = readFileSync(full);
  res.writeHead(200, {
    "content-type": TYPES[extname(full).toLowerCase()] ?? "application/octet-stream",
    "content-length": bytes.length,
  });
  if (isHead) {
    res.end();
  } else {
    res.end(bytes);
  }
}

// --- routes ---------------------------------------------------------------

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = decodeURIComponent(url.pathname);
  const isGet = req.method === "GET";
  const isHead = req.method === "HEAD";

  if ((isGet || isHead) && (p === "/" || p === "/index.html"))
    return sendFile(res, join(PUBLIC, "index.html"), PUBLIC, isHead);
  if ((isGet || isHead) && p.startsWith("/templates/"))
    return sendFile(res, join(templates.SHIPPED, p.slice("/templates/".length)), templates.SHIPPED, isHead);
  if ((isGet || isHead) && p.startsWith("/vendor/"))
    return sendFile(res, join(VENDOR, p.slice("/vendor/".length)), VENDOR, isHead);
  if ((isGet || isHead) && !p.startsWith("/api/"))
    return sendFile(res, join(PUBLIC, p.slice(1)), PUBLIC, isHead);

  if (req.method === "GET" && p === "/api/storage") {
    const usedBytes = store.getTotalStorageBytes();
    return json(res, 200, {
      usedBytes,
      capBytes: store.STORAGE_CAP_BYTES,
      capGb: store.STORAGE_CAP_GB,
      usedMb: Math.round((usedBytes / (1024 * 1024)) * 100) / 100,
      freeBytes: Math.max(0, store.STORAGE_CAP_BYTES - usedBytes),
    });
  }

  if (req.method === "GET" && p === "/api/decks") return json(res, 200, store.list());
  if (req.method === "POST" && p === "/api/decks") {
    const { title, template, folder } = await body(req);
    if (!title?.trim()) return json(res, 400, { error: "a deck needs a title" });
    const t = templates.get(String(template ?? "feynman"));
    const first = t.layouts.find((l: { id: string }) => l.id === "title") ?? t.layouts[0];
    return json(res, 200, {
      slug: store.create(
        title.trim(),
        t.id,
        first,
        folder ? String(folder).trim() : undefined,
      ),
    });
  }

  // --- folders ------------------------------------------------------------

  if (req.method === "GET" && p === "/api/folders")
    return json(res, 200, { folders: store.listFolders() });

  if (req.method === "POST" && p === "/api/folders") {
    const { name } = await body(req);
    if (!name?.trim()) return json(res, 400, { error: "folder needs a name" });
    store.createFolder(String(name).trim());
    return json(res, 200, { ok: true, folders: store.listFolders() });
  }

  if (req.method === "POST" && p === "/api/folders/delete") {
    const { name } = await body(req);
    if (!name?.trim()) return json(res, 400, { error: "folder name required" });
    store.deleteFolder(String(name).trim());
    return json(res, 200, { ok: true, folders: store.listFolders() });
  }

  if (req.method === "POST" && p === "/api/folders/rename") {
    const { from, to } = await body(req);
    if (!from?.trim() || !to?.trim()) return json(res, 400, { error: "names required" });
    store.renameFolder(String(from).trim(), String(to).trim());
    return json(res, 200, { ok: true, folders: store.listFolders() });
  }

  // --- templates ----------------------------------------------------------
  //
  // A folder you own and a catalogue that is a file. Installing writes one
  // validated JSON file and runs nothing.

  if (req.method === "GET" && p === "/api/templates")
    return json(res, 200, { installed: templates.all(), dir: templates.DIR });

  if (req.method === "GET" && p === "/api/templates/catalog") {
    const tag = url.searchParams.get("tag") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const cat = await templates.catalog({ tag, q });
    const have = new Set(templates.all().map((t) => t.id));
    return json(res, 200, {
      ...cat,
      entries: cat.entries.map((e) => ({ ...e, installed: have.has(e.id) })),
    });
  }

  if (req.method === "POST" && p === "/api/templates/community/publish") {
    const payload = await body(req);
    try {
      const templateInput = payload.template ?? (payload.id && !payload.palette ? payload.id : payload);
      if (!templateInput) return json(res, 400, { error: "no template or template id provided" });
      const { entry, template } = templates.publishToCommunity(templateInput, {
        tags: payload.tags,
        category: payload.category,
        author: payload.author,
        description: payload.description,
        version: payload.version,
      });
      return json(res, 200, { ok: true, entry, template });
    } catch (err) {
      return json(res, 400, { error: String((err as Error).message ?? err) });
    }
  }

  if (req.method === "GET" && p.startsWith("/api/templates/raw/")) {
    const one = templates.raw(p.slice("/api/templates/raw/".length));
    return one ? json(res, 200, one) : json(res, 404, { error: "no such template" });
  }

  if (req.method === "POST" && p === "/api/templates/install") {
    const { url } = await body(req);
    if (!url) return json(res, 400, { error: "install what?" });
    try {
      return json(res, 200, { template: await templates.install(String(url)) });
    } catch (err) {
      return json(res, 400, { error: String((err as Error).message ?? err) });
    }
  }

  if (req.method === "POST" && p === "/api/templates/save") {
    try {
      return json(res, 200, { template: templates.write((await body(req)) as Record<string, unknown>) });
    } catch (err) {
      return json(res, 400, { error: String((err as Error).message ?? err) });
    }
  }

  if (req.method === "POST" && p === "/api/templates/from-deck") {
    const { slug, id, name } = await body(req);
    if (!slug || !id || !name) return json(res, 400, { error: "needs a deck, an id and a name" });
    try {
      const made = templates.fromDeck(store.readDeck(String(slug)), String(id), String(name));
      return json(res, 200, { template: templates.write(made) });
    } catch (err) {
      return json(res, 400, { error: String((err as Error).message ?? err) });
    }
  }

  if (req.method === "POST" && p === "/api/templates/remove") {
    const { id } = await body(req);
    try {
      templates.remove(String(id));
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: String((err as Error).message ?? err) });
    }
  }

  if (req.method === "GET" && p === "/api/critic/mode") {
    return json(res, 200, { mode: process.env.FEYNMAN_CRITIC || "auto" });
  }

  if (req.method === "POST" && p === "/api/critic/mode") {
    const { mode, slug } = await body(req);
    if (mode === "auto" || mode === "claude" || mode === "heuristic") {
      process.env.FEYNMAN_CRITIC = mode;
      if (slug && live.has(slug)) {
        live.get(slug)?.critic.setMode(mode);
      }
      return json(res, 200, { ok: true, mode });
    }
    return json(res, 400, { error: "invalid critic mode" });
  }

  const m = /^\/api\/deck\/([a-z0-9-]+)(?:\/([a-z]+))?(?:\/(.+))?$/.exec(p);
  if (!m) return void res.writeHead(404).end("not found");
  const slug = m[1]!;
  const action = m[2];
  const rest = m[3];

  if (req.method === "GET" && action === "images" && rest)
    return sendFile(res, join(store.imageDir(slug), basename(rest)), store.imageDir(slug));

  if (req.method === "GET" && !action) {
    const deck = store.readDeck(slug);
    const state = store.prune(deck, store.readState(slug));
    const d = open(slug, deck.title);
    return json(res, 200, {
      deck,
      state,
      blocking: store.blocking(state).length,
      criticMode: d.critic.mode(),
    });
  }

  if (req.method === "GET" && action === "events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const d = open(slug, store.readDeck(slug).title);
    d.clients.add(res);
    req.on("close", () => d.clients.delete(res));
    return;
  }

  if (req.method === "POST" && action === "deck") {
    const deck = (await body(req)) as Deck;
    if (!deck?.slides) return json(res, 400, { error: "not a deck" });
    store.writeDeck(slug, deck);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && action === "duplicate") {
    const { title } = await body(req);
    const newSlug = store.duplicateDeck(slug, title ? String(title).trim() : undefined);
    return json(res, 200, { ok: true, slug: newSlug });
  }

  if (req.method === "POST" && action === "rename") {
    const { title } = await body(req);
    if (!title?.trim()) return json(res, 400, { error: "a deck needs a title" });
    store.rename(slug, title.trim());
    live.get(slug)?.critic.close();
    live.delete(slug);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && action === "delete") {
    live.get(slug)?.critic.close();
    live.delete(slug);
    store.deleteDeck(slug);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && action === "folder") {
    const { folder } = await body(req);
    store.setFolder(slug, folder ? String(folder).trim() : undefined);
    return json(res, 200, { ok: true, folder: store.readDeck(slug).folder });
  }

  if (req.method === "POST" && action === "review") {
    const { slideId, firm } = await body(req);
    // Deliberately not awaited: a review takes seconds and the editor must
    // never wait on it. Results arrive over SSE.
    void review(slug, String(slideId), Boolean(firm));
    return json(res, 202, { ok: true });
  }

  if (req.method === "POST" && action === "image") {
    const type = String(req.headers["content-type"] ?? "");
    const ext = Object.entries(TYPES).find(([, v]) => v === type)?.[0];
    if (!ext) return json(res, 415, { error: `unsupported image type: ${type || "none"}` });
    const bytes = await raw(req);
    const name = `${uid()}${ext}`;
    store.saveImage(slug, name, bytes);
    return json(res, 200, { src: name });
  }

  if (req.method === "POST" && action === "dismiss") {
    const { id, reason } = await body(req);
    if (!reason?.trim()) {
      // The whole point of the hatch. A dismissal you can make with one click
      // is not a forcing function, and writing down why a correction is wrong
      // is itself the practice this tool is for.
      return json(res, 400, { error: "say why it is wrong" });
    }
    const state = store.readState(slug);
    let hit: Finding | undefined;
    for (const list of Object.values(state.findings)) {
      const f = list.find((f) => f.id === id);
      if (f) hit = f;
    }
    if (!hit) return json(res, 404, { error: "no such finding" });
    hit.dismissed = { reason: reason.trim(), at: new Date().toISOString() };
    state.dismissed.push(hit);
    store.writeState(slug, state);
    live.get(slug)?.critic.dismissed(hit, reason.trim());
    return json(res, 200, { blocking: store.blocking(state).length });
  }

  if (req.method === "GET" && action === "export") {
    const deck = store.readDeck(slug);
    const state = store.prune(deck, store.readState(slug));
    const isDownload = url.searchParams.get("download") === "1";
    let filePath = join(store.dir(slug), "deck.html");
    if (!existsSync(filePath)) {
      try {
        filePath = exportDeck(slug, store.dir(slug), deck, state);
      } catch (err) {
        if (err instanceof Blocked) return json(res, 409, { error: err.message, findings: err.findings });
        throw err;
      }
    }
    const htmlBytes = readFileSync(filePath);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      ...(isDownload ? { "content-disposition": `attachment; filename="${slug}.html"` } : {}),
    });
    return void res.end(htmlBytes);
  }

  if (req.method === "POST" && action === "export") {
    const deck = store.readDeck(slug);
    const state = store.prune(deck, store.readState(slug));
    store.writeState(slug, state);
    try {
      return json(res, 200, { path: exportDeck(slug, store.dir(slug), deck, state) });
    } catch (err) {
      if (err instanceof Blocked) return json(res, 409, { error: err.message, findings: err.findings });
      throw err;
    }
  }

  res.writeHead(404).end("not found");
}

export class PortTaken extends Error {
  port: number;
  constructor(port: number) {
    super(`127.0.0.1:${port} is already in use`);
    this.port = port;
  }
}

export function serve(port: number): Promise<number> {
  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: String(err) });
    });
  });
  return new Promise((resolve, reject) => {
    // Without this the "already running" case is an unhandled 'error' event:
    // twenty lines of node internals for the most ordinary thing that can
    // happen, which is starting it twice.
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "EADDRINUSE" ? new PortTaken(port) : err);
    });
    server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}
