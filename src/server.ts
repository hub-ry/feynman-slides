// A local server, no framework. The only runtime dependency is the Agent SDK,
// which is the one thing here that could not have been written by hand.
//
// The browser cannot talk to the Agent SDK, so the critic session lives here
// and findings come back over SSE. One session per open deck, started lazily,
// because starting one costs a subprocess.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, slideAt, slideKey } from "./outline.ts";
import { startCritic, type CriticSession, type Finding } from "./critic.ts";
import * as store from "./store.ts";
import { exportDeck, Blocked } from "./export.ts";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

type Deck = { critic: CriticSession; clients: Set<ServerResponse>; reviewing: Set<string> };
const decks = new Map<string, Deck>();

function open(slug: string, title: string): Deck {
  let d = decks.get(slug);
  if (!d) {
    d = { critic: startCritic(title), clients: new Set(), reviewing: new Set() };
    decks.set(slug, d);
  }
  return d;
}

function push(slug: string, event: string, data: unknown): void {
  const d = decks.get(slug);
  if (!d) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of d.clients) c.write(frame);
}

/**
 * Review one slide and broadcast what came back.
 *
 * `firm` is the difference between the two moments the critic fires: a pause
 * while typing (advisory, an unfinished bullet is not a finding) and leaving
 * the slide for another (this is as done as it is getting).
 *
 * Reviews are deduplicated per slide because a pause and a blur can land at
 * almost the same instant - you stop typing precisely because you are about to
 * click elsewhere - and two sessions reviewing one slide would race to write
 * the same key.
 */
async function review(slug: string, caret: number, firm: boolean): Promise<void> {
  const text = store.readOutline(slug);
  const outline = parse(text);
  const slide = slideAt(outline, caret);
  if (!slide || (!slide.bullets.length && !slide.source)) return;

  const key = slideKey(slide);
  const d = open(slug, outline.title);
  if (d.reviewing.has(key)) return;
  d.reviewing.add(key);
  push(slug, "reviewing", { slideKey: key });

  try {
    const findings = await d.critic.review(slide, firm);
    const state = store.prune(slug, store.readState(slug));
    // An advisory pass never clears a firm pass's findings: you paused
    // mid-sentence, which is not evidence the slide got better.
    if (firm || findings.length) state.findings[key] = findings;
    store.writeState(slug, state);
    push(slug, "findings", { slideKey: key, findings: state.findings[key] ?? [], blocking: store.blocking(state).length });
  } catch (err) {
    push(slug, "error", { message: String(err) });
  } finally {
    d.reviewing.delete(key);
    push(slug, "idle", { slideKey: key });
  }
}

// --- routes ---------------------------------------------------------------

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const json = (res: ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function serveStatic(res: ServerResponse, name: string): void {
  // Resolved and then checked, not just checked: `normalize` is what turns
  // `../../etc/passwd` into something a prefix test can actually see.
  const path = normalize(join(PUBLIC, name));
  if (!path.startsWith(PUBLIC) || !existsSync(path)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  const m = /^\/api\/deck\/([a-z0-9-]+)(\/[a-z]+)?$/.exec(p);

  if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveStatic(res, "index.html");
  if (req.method === "GET" && !p.startsWith("/api/")) return serveStatic(res, p.slice(1));

  if (req.method === "GET" && p === "/api/decks") return json(res, 200, store.list());
  if (req.method === "POST" && p === "/api/decks") {
    const { title } = await body(req);
    if (!title?.trim()) return json(res, 400, { error: "a deck needs a title" });
    return json(res, 200, { slug: store.create(title.trim()) });
  }

  if (!m) return void res.writeHead(404).end("not found");
  const slug = m[1]!;
  const action = m[2];

  if (req.method === "GET" && !action) {
    const text = store.readOutline(slug);
    const state = store.prune(slug, store.readState(slug));
    return json(res, 200, { text, outline: parse(text), state, blocking: store.blocking(state).length });
  }

  if (req.method === "GET" && action === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const d = open(slug, parse(store.readOutline(slug)).title);
    d.clients.add(res);
    req.on("close", () => d.clients.delete(res));
    return;
  }

  if (req.method === "POST" && action === "/outline") {
    const { text } = await body(req);
    if (typeof text !== "string") return json(res, 400, { error: "text required" });
    store.writeOutline(slug, text);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && action === "/review") {
    const { caret, firm } = await body(req);
    // Deliberately not awaited: the review takes seconds and the editor must
    // not wait on it. Results arrive over SSE.
    void review(slug, Number(caret) || 0, Boolean(firm));
    return json(res, 202, { ok: true });
  }

  if (req.method === "POST" && action === "/dismiss") {
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
    decks.get(slug)?.critic.dismissed(hit, reason.trim());
    return json(res, 200, { blocking: store.blocking(state).length });
  }

  if (req.method === "POST" && action === "/export") {
    const text = store.readOutline(slug);
    const state = store.prune(slug, store.readState(slug));
    store.writeState(slug, state);
    try {
      const out = exportDeck(join(store.DECKS, slug), parse(text), state);
      return json(res, 200, { path: out });
    } catch (err) {
      if (err instanceof Blocked) return json(res, 409, { error: err.message, findings: err.findings });
      throw err;
    }
  }

  res.writeHead(404).end("not found");
}

export function serve(port: number): Promise<number> {
  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: String(err) });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}
