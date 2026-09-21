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
import { startCritic, type CriticSession, type Finding, resolveProvider, testCriticConnection } from "./critic.ts";
import { type Deck, slideKey, slideDigest, hasText, uid } from "./deck.ts";
import * as store from "./store.ts";
import { type Rating, RATINGS, newMemory, grade, preview, retrievability, human } from "./recall.ts";
import { exportDeck, Blocked } from "./export.ts";
import * as templates from "./templates.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
// pdf.js is served out of node_modules rather than copied into public/ or
// pulled from a CDN: the extraction has to work with no network, because the
// rest of this tool does.
const VENDOR = join(ROOT, "node_modules", "pdfjs-dist", "build");

type Live = {
  critic: CriticSession;
  clients: Set<ServerResponse>;
  reviewing: Set<string>;
  /** Slides asked for again while a pass was running, and whether that ask was firm. */
  queued: Map<string, boolean>;
};
const live = new Map<string, Live>();

function open(slug: string, title: string): Live {
  let d = live.get(slug);
  if (!d) {
    // The critic is handed what it has already been corrected about. A dispute
    // is written down once and has to hold across restarts.
    const disputed = store.readState(slug).dismissed;
    // Who the deck is for is fixed for the life of the session. Changing it
    // closes the session (see the audience route), because every jargon call
    // the critic has made was made against the previous reader.
    const audience = store.readDeck(slug).audience;
    d = {
      critic: startCritic(title, undefined, disputed, audience),
      clients: new Set(),
      reviewing: new Set(),
      queued: new Map(),
    };
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
 * A pass already running for this slide does not cancel the new ask, it defers
 * it. A pause and a blur land milliseconds apart - you stop typing precisely
 * because you are about to click elsewhere - and dropping the second one meant
 * dropping the firm pass, so the authoritative read of a finished slide was
 * routinely thrown away in favour of the advisory read of it half-typed.
 */
async function review(slug: string, slideId: string, firm: boolean): Promise<void> {
  const deck = store.readDeck(slug);
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return;

  const key = slideKey(slide);
  const d = open(slug, deck.title);

  // Nothing written on it. Say so and clear whatever was there, rather than
  // returning quietly and leaving a critique of text the writer has deleted.
  if (!hasText(slide)) {
    const state = store.prune(deck, store.readState(slug));
    delete state.findings[key];
    delete state.reviewed[key];
    store.writeState(slug, state);
    push(slug, "findings", {
      slideKey: key,
      findings: [],
      digest: slideDigest(slide),
      blocking: store.blocking(state).length,
      criticMode: d.critic.mode(),
      criticProvider: d.critic.provider(),
    });
    return;
  }

  if (d.reviewing.has(key)) {
    d.queued.set(key, (d.queued.get(key) ?? false) || firm);
    return;
  }
  d.reviewing.add(key);
  push(slug, "reviewing", { slideKey: key });

  // The fingerprint of what we are about to send, not of whatever is on disk
  // when the answer lands. If they kept typing, the critique that comes back
  // is already about older words, and the pane has to be able to tell.
  const digest = slideDigest(slide);

  try {
    const findings = await d.critic.review(slide, deck.sources ?? [], firm);
    const state = store.prune(deck, store.readState(slug));
    // An advisory pass never clears a firm pass's findings: you paused
    // mid-sentence, which is not evidence the slide got better.
    if (firm || findings.length) {
      state.findings[key] = findings;
      state.reviewed[key] = { digest, at: new Date().toISOString() };
    }
    store.writeState(slug, state);
    push(slug, "findings", {
      slideKey: key,
      findings: state.findings[key] ?? [],
      digest: state.reviewed[key]?.digest ?? "",
      blocking: store.blocking(state).length,
      criticMode: d.critic.mode(),
      criticProvider: d.critic.provider(),
    });
  } catch (err) {
    push(slug, "error", { message: String(err) });
  } finally {
    d.reviewing.delete(key);
    push(slug, "idle", { slideKey: key });
    const again = d.queued.get(key);
    if (again !== undefined) {
      d.queued.delete(key);
      void review(slug, slideId, again);
    }
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
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    "cdn-cache-control": "no-store",
    "cloudflare-cdn-cache-control": "no-store",
    "pragma": "no-cache",
    "expires": "0",
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

  if (req.method === "GET" && p === "/api/critic/config") {
    const config = store.readCriticConfig();
    const resolved = await resolveProvider(config);
    return json(res, 200, { config, activeMode: resolved.name, activeProvider: resolved.provider });
  }

  if (req.method === "POST" && p === "/api/critic/config") {
    const newConfig = await body(req);
    store.writeCriticConfig(newConfig);
    for (const [, d] of live) {
      d.critic.setConfig(newConfig);
    }
    const resolved = await resolveProvider(newConfig);
    return json(res, 200, { ok: true, config: newConfig, activeMode: resolved.name, activeProvider: resolved.provider });
  }

  if (req.method === "POST" && p === "/api/critic/test") {
    const testConfig = await body(req);
    const result = await testCriticConnection(testConfig);
    return json(res, 200, result);
  }

  if (req.method === "GET" && p === "/api/critic/mode") {
    const config = store.readCriticConfig();
    const resolved = await resolveProvider(config);
    return json(res, 200, { mode: config.provider, activeMode: resolved.name });
  }

  if (req.method === "POST" && p === "/api/critic/mode") {
    const { mode } = await body(req);
    const config = store.readCriticConfig();
    config.provider = mode;
    store.writeCriticConfig(config);
    for (const [, d] of live) {
      d.critic.setMode(mode);
    }
    const resolved = await resolveProvider(config);
    return json(res, 200, { ok: true, mode, activeMode: resolved.name });
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
      criticProvider: d.critic.provider(),
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

  /**
   * Take back a dispute.
   *
   * The finding is looked for in both places it can be. Once the slide has
   * been read again the critic no longer reports it - that is what disputing
   * it did - so the only copy left is the one in the log, and a restore that
   * searched the open findings alone could only ever undo a dispute you had
   * made seconds ago.
   */
  if (req.method === "POST" && action === "restore") {
    const { id } = await body(req);
    const deck = store.readDeck(slug);
    const state = store.prune(deck, store.readState(slug));

    const open = Object.values(state.findings).flat().find((f) => f.id === id);
    const logged = state.dismissed.find((f) => f.id === id);
    if (!open && !logged) return json(res, 404, { error: "no such finding" });

    if (open) delete open.dismissed;
    state.dismissed = state.dismissed.filter((f) => f.id !== id);
    // The slide has to be read again for the finding to come back, so the
    // fingerprint of the last read is no longer the answer to anything.
    const key = (open ?? logged)!.slideKey;
    delete state.reviewed[key];
    store.writeState(slug, state);

    // The session remembered the quote as settled. It is open again, so the
    // critic has to be allowed to raise it - which means starting it over.
    live.get(slug)?.critic.close();
    live.delete(slug);
    return json(res, 200, { blocking: store.blocking(state).length });
  }

  /**
   * The recall schedule for this deck.
   *
   * Sent whole rather than one card at a time. A deck is thirty slides, the
   * whole schedule is a few kilobytes, and a study session that has to round
   * trip between every card is a study session with a spinner in the middle
   * of it - which is the one place this tool cannot afford one, because the
   * pause between "I think I know this" and seeing the answer is the part
   * that does the work.
   */
  if (req.method === "GET" && action === "recall") {
    const deck = store.readDeck(slug);
    const recall = store.pruneRecall(deck, store.readRecall(slug));
    store.writeRecall(slug, recall);
    const now = new Date();
    const due = store.dueSlides(deck, recall, now);
    return json(res, 200, {
      memories: recall.memories,
      due,
      lastStudied: recall.lastStudied,
      /**
       * How likely you are to still have each slide, right now.
       *
       * Sent alongside rather than computed in the browser so there is one
       * implementation of the forgetting curve rather than two that drift.
       */
      retrievability: Object.fromEntries(
        Object.entries(recall.memories).map(([k, m]) => [k, retrievability(m, now)]),
      ),
    });
  }

  /**
   * Grade one slide.
   *
   * The reply carries the next four intervals as well as the new state,
   * because the buttons in the study session are labelled with what they will
   * cost you. Telling someone that Good means eight days and Hard means two
   * is the only part of the memory model worth putting on screen.
   */
  if (req.method === "POST" && action === "recall") {
    const { slideId, rating } = await body(req);
    const r = Number(rating) as Rating;
    if (!RATINGS.includes(r)) {
      return json(res, 400, { error: "rating must be 1 (again), 2 (hard), 3 (good) or 4 (easy)" });
    }
    const deck = store.readDeck(slug);
    if (!deck.slides.some((sl) => sl.id === String(slideId))) {
      return json(res, 404, { error: "no such slide" });
    }

    const now = new Date();
    const recall = store.pruneRecall(deck, store.readRecall(slug));
    const before = recall.memories[String(slideId)] ?? newMemory(now);
    const after = grade(before, r, now);

    recall.memories[String(slideId)] = after;
    recall.lastStudied = now.toISOString();
    store.writeRecall(slug, recall);

    const next = preview(after, new Date(after.due));
    return json(res, 200, {
      memory: after,
      wait: human(new Date(after.due).getTime() - now.getTime()),
      next: Object.fromEntries(RATINGS.map((g) => [g, human(next[g])])),
      due: store.dueSlides(deck, recall, now),
    });
  }

  /**
   * What each button would cost, before any of them is pressed.
   *
   * Separate from the grade so the study session can label its buttons
   * without having pressed one.
   */
  if (req.method === "GET" && action === "schedule") {
    const deck = store.readDeck(slug);
    const recall = store.readRecall(slug);
    const now = new Date();
    const out: Record<string, Record<number, string>> = {};
    for (const sl of deck.slides) {
      const m = recall.memories[sl.id] ?? newMemory(now);
      const p = preview(m, now);
      out[sl.id] = Object.fromEntries(RATINGS.map((g) => [g, human(p[g])])) as Record<number, string>;
    }
    return json(res, 200, out);
  }

  /** One sentence naming who this deck is being explained to. See deck.ts. */
  if (req.method === "POST" && action === "audience") {
    const { audience } = await body(req);
    const deck = store.readDeck(slug);
    const text = String(audience ?? "").trim().slice(0, 240);
    if (text) deck.audience = text;
    else delete deck.audience;
    store.writeDeck(slug, deck);
    // The critic was told who it was reading for when the session opened, so
    // changing the reader has to start it over. Everything it decided about
    // jargon was decided against the old one.
    live.get(slug)?.critic.close();
    live.delete(slug);
    return json(res, 200, { ok: true, audience: deck.audience });
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
