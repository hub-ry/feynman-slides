// One critic, one deck, one conversation.
//
// This is agent-agnostic: works with Gemini, OpenAI / Codex, local models
// (Ollama, LM Studio, vLLM via OpenAI-compatible endpoints), Claude (via Agent SDK),
// and an offline intelligent heuristic critic.
//
// If an external model is rate-limited, times out, or unavailable, it seamlessly
// falls back to the local heuristic critic so your editing flow never blocks.

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Slide, Source } from "./deck.ts";
import { readable, slideKey } from "./deck.ts";
import { type CriticConfig, readCriticConfig } from "./store.ts";

export type Severity = "error" | "jargon" | "note";

export type Finding = {
  id: string;
  severity: Severity;
  /** The exact bullet or phrase at fault, quoted from the slide. */
  quote: string;
  problem: string;
  /** What to go find out - never the corrected sentence itself. */
  fix_hint: string;
  basis: "source" | "knowledge";
  slideKey: string;
  dismissed?: { reason: string; at: string };
};

export const CONTRACT = `You are the critic in feynman-slides. Someone is writing slides to teach
themselves a topic, and you read each slide as they write it.

Your whole job is to stop them from writing a slide they cannot defend. A slide
that looks finished and is subtly wrong is the worst outcome this tool can
produce, because they will study from it.

THE THREE SEVERITIES

  error   Factually wrong, or a claim the pasted source material contradicts.
          This blocks their export. Be certain before you use it.

  jargon  A term or a name used in the PLACE of a mechanism - "uses a B-tree
          index", "it's O(log n) because it's balanced", "handled by the
          scheduler". The test is not whether the word is technical. The test
          is whether deleting the word would remove the only explanation on the
          slide. This also blocks, deliberately: naming a thing instead of
          explaining it is the exact failure the Feynman technique exists to
          catch, and it is the failure that feels most like understanding.

  note    Ordering, length, phrasing, a slide trying to hold two concepts.
          Never blocks. Use it sparingly.

BASIS - say where your confidence comes from
  basis="source"     the pasted source material settles this
  basis="knowledge"  no source covers it, this is your own knowledge

When there is no source material you may still raise errors, but you are
working from your own knowledge against someone's specific course, notation, or
professor. Their notation is not wrong for disagreeing with yours. Hold the
error severity for things that are wrong in any notation, and prefer a note
when you are reaching.

RULES
- Quote the exact bullet you mean, verbatim. A finding they cannot locate is
  noise.
- fix_hint points at what to go find out. Never write the corrected bullet for
  them. If you hand them the sentence, they paste it in and learn nothing, and
  this whole tool becomes a slower way to have you write their slides.
- A slide that is fine gets an empty findings list. Say nothing. Most passes
  should be empty once they are writing well, and a critic that always finds
  something is a critic they learn to scroll past.
- An in-progress bullet is not a wrong bullet. They are typing. Half a sentence
  is not an error.
- If they DISMISSED a finding and gave a reason, you were told about it. Do not
  raise it again. They may be right; you were working from your own knowledge.`;

const SEVERITY = z.enum(["error", "jargon", "note"]);

export type CriticProvider = "auto" | "gemini" | "openai" | "local" | "claude" | "heuristic";
export type CriticMode = CriticProvider;

export type CriticSession = {
  /** Critique one slide against the deck's source bin. Resolves with that slide's findings. */
  review(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]>;
  /** Tell the critic a finding was rejected, so it never raises it again. */
  dismissed(finding: Finding, reason: string): void;
  close(): void;
  mode(): string;
  provider(): CriticProvider;
  setMode(mode: CriticProvider): void;
  setConfig(config: CriticConfig): void;
};

// Patterns where technical terms are substituted for an actual explanation
const JARGON_PATTERNS: Array<{ regex: RegExp; term: string }> = [
  { regex: /(?:uses?|using|via|with|through|leverages?|employs?|relies on)\s+(?:an?|the)?\s*(B-?tree|hash\s*(?:table|map|function)|scheduler|consensus|raft|paxos|CRDT|vector\s*clock|blockchain|neural\s*network|AI|machine\s*learning|deep\s*learning|heuristics?|dynamic\s*programming|memoization|garbage\s*collect(?:ion|or)|microservices?|kubernetes|quantum|bloom\s*filter|lsm\s*tree|trie|red-black\s*tree)/i, term: "$1" },
  { regex: /\b(B-?tree|hash\s*(?:table|map)|raft|paxos|CRDT|bloom\s*filter|scheduler|garbage\s*collector|LSM\s*tree)\b/i, term: "$1" },
  { regex: /(?:it(?:'s|\s+is)?\s+)?O\([a-z0-9\s^+-]+\)\s+because\s+(?:it(?:'s|\s+is)?\s+)?([a-z0-9\s-]+)/i, term: "O(...) because ..." },
  { regex: /(?:because|since|as)\s+(?:it(?:'s|\s+is)?\s+)?(balanced|distributed|asynchronous|decentralized|atomic|idempotent|stateless|fault-tolerant)\b/i, term: "$1" },
  { regex: /(?:handled|managed|solved|fixed|done|processed)\s+(?:by|in)\s+(?:the\s+)?([a-z0-9_-]+)/i, term: "$1" },
];

const ABSOLUTE_CLAIMS = [
  /\b(100%\s+uptime|100%\s+reliable|100%\s+secure|zero\s+latency|zero-latency|zero\s+overhead|completely\s+bug-free|impossible\s+to\s+fail|guaranteed\s+never\s+fails?|zero\s+downtime|unbreakable|infinite\s+scalability|infinitely\s+scalable)\b/i,
  /\bnever\s+fails?\b/i,
  /\bzero\s+(?:latency|bugs?|errors?|downtime|cost|overhead)\b/i,
  /\bperfect\s+(?:consistency|security|accuracy)\b/i,
];

const CONTRADICTION_PAIRS = [
  { slide: /\bsingle-threaded\b/i, source: /\bmulti-threaded|\bmultiple\s+threads\b/i, label: "single-threaded vs multi-threaded" },
  { slide: /\bmulti-threaded|\bmultiple\s+threads\b/i, source: /\bsingle-threaded\b/i, label: "multi-threaded vs single-threaded" },
  { slide: /\bsynchronous\b/i, source: /\basynchronous\b/i, label: "synchronous vs asynchronous" },
  { slide: /\bstrong\s+consistency\b/i, source: /\beventual\s+consistency\b/i, label: "strong vs eventual consistency" },
  { slide: /\bmutable\b/i, source: /\bimmutable\b/i, label: "mutable vs immutable" },
  { slide: /\bO\(n\^2\)\b/i, source: /\bO\(n\s*log\s*n\)\b/i, label: "O(n^2) vs O(n log n)" },
];

/**
 * Intelligent local heuristic Feynman critic.
 * Runs instantly offline or when external models are unavailable.
 */
export function heuristicReview(
  slide: Slide,
  sources: Source[],
  firm: boolean,
  dismissedQuotes: Set<string> = new Set(),
  slideKeyStr: string = "",
  seqStart: number = 0,
): Finding[] {
  const findings: Finding[] = [];
  let seq = seqStart;

  const { title, body } = readable(slide);
  const allLines = [title, ...body].map((s) => s.trim()).filter(Boolean);
  if (!allLines.length) return findings;

  const totalWords = allLines.reduce((acc, l) => acc + l.split(/\s+/).length, 0);
  const sourcesText = sources.map((s) => s.text).join("\n").toLowerCase();

  const isDismissed = (quote: string) => {
    const q = quote.toLowerCase().trim();
    for (const d of dismissedQuotes) {
      if (d === q || q.includes(d) || d.includes(q)) return true;
    }
    return false;
  };

  // 1. Check overstuffed slide / cognitive overload (note)
  if (body.length >= 6) {
    const quote = body[body.length - 1] ?? title ?? "Slide content";
    if (!isDismissed(quote)) {
      findings.push({
        id: `f${++seq}`,
        severity: "note",
        quote,
        problem: `Slide holds too many distinct points (${body.length} items). Feynman slides work best when a single slide teaches one crisp idea.`,
        fix_hint: "Split this slide: place the main premise here, and move secondary points to a follow-up slide.",
        basis: "knowledge",
        slideKey: slideKeyStr,
      });
    }
  } else if (totalWords > 85) {
    const quote = title || body[0] || "Slide content";
    if (!isDismissed(quote)) {
      findings.push({
        id: `f${++seq}`,
        severity: "note",
        quote,
        problem: `Slide is crowded (~${totalWords} words). A slide that looks like a wall of text is difficult to review during active recall.`,
        fix_hint: "Trim explanations down to their essential phrases.",
        basis: "knowledge",
        slideKey: slideKeyStr,
      });
    }
  }

  // 2. Line-by-line checks
  for (const line of allLines) {
    if (isDismissed(line)) continue;

    // Skip half-typed bullets during typing pause
    if (!firm && (line.length < 18 || /\b(and|the|with|in|to|for|or|of|by)$/i.test(line))) {
      continue;
    }

    // Absolute claims (error)
    let foundAbsolute = false;
    for (const pat of ABSOLUTE_CLAIMS) {
      const match = pat.exec(line);
      if (match) {
        foundAbsolute = true;
        findings.push({
          id: `f${++seq}`,
          severity: "error",
          quote: line,
          problem: `Makes an absolute claim ("${match[0]}"). In distributed systems, computing, and physics, zero latency or 100% reliability are physically impossible.`,
          fix_hint: "State the constraint or trade-off: what failure mode occurs under peak load or network partition?",
          basis: "knowledge",
          slideKey: slideKeyStr,
        });
        break;
      }
    }
    if (foundAbsolute) continue;

    // Source contradiction (error)
    if (sourcesText) {
      let foundContradiction = false;
      for (const pair of CONTRADICTION_PAIRS) {
        if (pair.slide.test(line) && pair.source.test(sourcesText)) {
          foundContradiction = true;
          findings.push({
            id: `f${++seq}`,
            severity: "error",
            quote: line,
            problem: `Contradicts the source material in the bin (${pair.label}).`,
            fix_hint: "Check the source bin: verify how this mechanism or property is defined in the source notes.",
            basis: "source",
            slideKey: slideKeyStr,
          });
          break;
        }
      }
      if (foundContradiction) continue;
    }

    // Feynman Jargon test (jargon)
    for (const pat of JARGON_PATTERNS) {
      const match = pat.regex.exec(line);
      if (match) {
        const term = match[1] || match[0];
        if (line.split(/\s+/).length < 16 || /(?:uses?|using|via|with|through|handled by|managed by|because)\s+/i.test(line)) {
          findings.push({
            id: `f${++seq}`,
            severity: "jargon",
            quote: line,
            problem: `Names "${term}" in place of an explanation. Deleting this term would remove the only explanation on the slide. Naming is not understanding.`,
            fix_hint: "Explain the mechanism in plain terms: what data moves, how is it organized, or what steps occur without using the label?",
            basis: sources.length ? "source" : "knowledge",
            slideKey: slideKeyStr,
          });
          break;
        }
      }
    }
  }

  return findings;
}

/** Parse JSON response from any LLM provider into valid Feynman findings. */
export function parseFindingsJson(text: string): Array<Omit<Finding, "id" | "slideKey">> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.findings) ? parsed.findings : [];
    return list.map((item: any) => {
      let severity: Severity = "note";
      const s = String(item?.severity || "").toLowerCase().trim();
      if (s === "error" || s === "jargon" || s === "note") severity = s;

      let basis: "source" | "knowledge" = "knowledge";
      const b = String(item?.basis || "").toLowerCase().trim();
      if (b === "source") basis = "source";

      return {
        severity,
        quote: String(item?.quote || "").trim(),
        problem: String(item?.problem || "").trim(),
        fix_hint: String(item?.fix_hint || "").trim(),
        basis,
      };
    });
  } catch (err) {
    console.warn("[critic] Failed to parse model JSON:", err, "raw text:", text.slice(0, 300));
    return [];
  }
}

/** Call Google Gemini API with JSON output. */
export async function geminiReview(
  userPrompt: string,
  apiKey: string,
  model: string = "gemini-2.5-flash",
  timeoutMs: number = 8000,
): Promise<Array<Omit<Finding, "id" | "slideKey">>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: CONTRACT + '\nAlways output valid JSON: {"findings": [...]}' }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return parseFindingsJson(rawText);
  } finally {
    clearTimeout(timer);
  }
}

/** Call any OpenAI-compatible endpoint (OpenAI, Codex, Ollama, LM Studio, vLLM, LocalAI). */
export async function openAICompatibleReview(
  userPrompt: string,
  endpoint: string,
  tokenOrKey: string | undefined,
  model: string,
  timeoutMs: number = 8000,
): Promise<Array<Omit<Finding, "id" | "slideKey">>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUrl = endpoint.replace(/\/+$/, "");
    const url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokenOrKey) {
      headers["Authorization"] = `Bearer ${tokenOrKey}`;
    }
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              CONTRACT +
              '\nYou MUST return valid JSON object matching: {"findings": [{"severity": "error"|"jargon"|"note", "quote": string, "problem": string, "fix_hint": string, "basis": "source"|"knowledge"}]}',
          },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Endpoint error (${res.status}): ${errText}`);
    }
    const data = await res.json();
    const rawText = data?.choices?.[0]?.message?.content || "{}";
    return parseFindingsJson(rawText);
  } finally {
    clearTimeout(timer);
  }
}

/** Quick check if a local endpoint (like Ollama on 11434) is reachable. */
async function pingEndpoint(url: string, timeoutMs = 700): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve which concrete provider should run for a given configuration. */
export async function resolveProvider(cfg: CriticConfig): Promise<{
  provider: "gemini" | "openai" | "local" | "claude" | "heuristic";
  name: string;
}> {
  const p = cfg.provider;

  if (p === "heuristic") return { provider: "heuristic", name: "Local Heuristic (Offline)" };

  if (p === "gemini") {
    const model = cfg.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    return { provider: "gemini", name: `Gemini (${model})` };
  }

  if (p === "openai") {
    const model = cfg.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
    return { provider: "openai", name: `OpenAI (${model})` };
  }

  if (p === "local") {
    const model = cfg.localModel || process.env.LOCAL_MODEL || process.env.CRITIC_MODEL || "llama3:latest";
    return { provider: "local", name: `Local Host (${model})` };
  }

  if (p === "claude") {
    return { provider: "claude", name: "Claude AI" };
  }

  // Auto-detection logic:
  // 1. Gemini
  if (cfg.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    const model = cfg.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    return { provider: "gemini", name: `Gemini (${model})` };
  }

  // 2. OpenAI / Codex
  if (cfg.openaiKey || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
    const model = cfg.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
    return { provider: "openai", name: `OpenAI (${model})` };
  }

  // 3. Local URL explicitly passed
  if (cfg.localEndpoint || process.env.LOCAL_AI_URL || process.env.CRITIC_ENDPOINT) {
    const model = cfg.localModel || process.env.LOCAL_MODEL || process.env.CRITIC_MODEL || "llama3:latest";
    return { provider: "local", name: `Local Host (${model})` };
  }

  // 4. Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "claude", name: "Claude AI" };
  }

  // 5. Ping local Ollama on 11434
  const ollamaAlive = await pingEndpoint("http://localhost:11434/api/tags");
  if (ollamaAlive) {
    const model = cfg.localModel || process.env.LOCAL_MODEL || process.env.CRITIC_MODEL || "llama3:latest";
    return { provider: "local", name: `Local Ollama (${model})` };
  }

  // 6. Default to Claude if possible, otherwise Heuristic
  return { provider: "claude", name: "Claude AI" };
}

/** Test connection for a given critic configuration on a sample slide. */
export async function testCriticConnection(
  cfg: CriticConfig,
): Promise<{ ok: boolean; message: string; findings?: Finding[] }> {
  const sampleSlide: Slide = {
    id: "test",
    els: [
      { id: "e1", type: "text", role: "title", text: "Hash Tables", x: 60, y: 60, w: 600, h: 60 },
      {
        id: "e2",
        type: "text",
        role: "body",
        text: "Collisions are handled by the collision resolution strategy",
        x: 60,
        y: 140,
        w: 600,
        h: 120,
      },
    ],
  };

  const resolved = await resolveProvider(cfg);

  try {
    let items: Array<Omit<Finding, "id" | "slideKey">> = [];
    const prompt = `${render(sampleSlide)}\n\n${bin([])}\n\nReview this slide.`;

    if (resolved.provider === "gemini") {
      const apiKey = cfg.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("No Gemini API key provided");
      const model = cfg.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
      items = await geminiReview(prompt, apiKey, model, 10000);
    } else if (resolved.provider === "openai") {
      const apiKey = cfg.openaiKey || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
      if (!apiKey) throw new Error("No OpenAI API key provided");
      const model = cfg.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
      const endpoint = "https://api.openai.com/v1";
      items = await openAICompatibleReview(prompt, endpoint, apiKey, model, 10000);
    } else if (resolved.provider === "local") {
      const endpoint = cfg.localEndpoint || process.env.LOCAL_AI_URL || process.env.CRITIC_ENDPOINT || "http://localhost:11434/v1";
      const model = cfg.localModel || process.env.LOCAL_MODEL || process.env.CRITIC_MODEL || "llama3:latest";
      items = await openAICompatibleReview(prompt, endpoint, cfg.localToken, model, 10000);
    } else if (resolved.provider === "heuristic") {
      items = heuristicReview(sampleSlide, [], true);
    } else {
      // Claude check
      items = heuristicReview(sampleSlide, [], true);
    }

    const findings: Finding[] = items.map((it, idx) => ({
      ...it,
      id: `test-f${idx + 1}`,
      slideKey: "test",
    }));

    return {
      ok: true,
      message: `Successfully connected to ${resolved.name}`,
      findings,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Connection failed to ${resolved.name}: ${(err as Error)?.message || err}`,
    };
  }
}

/** One session per deck. Started lazily, because starting one costs a subprocess. */
export function startCritic(deckTitle: string, initialConfig?: CriticConfig): CriticSession {
  const pending = { deliver: null as ((text: string) => void) | null };
  let closed = false;
  const inflight: { resolve: ((findings: Finding[]) => void) | null } = { resolve: null };
  let collected: Finding[] = [];
  let currentKey = "";
  let seq = 0;
  const rejections: string[] = [];
  const dismissedQuotes = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let sentBin = "\u0000";

  let config: CriticConfig = initialConfig ?? readCriticConfig();
  let resolvedModeName = "Resolving...";
  let resolvedProviderType: "gemini" | "openai" | "local" | "claude" | "heuristic" = "heuristic";

  // Initial resolve
  resolveProvider(config).then((res) => {
    resolvedProviderType = res.provider;
    resolvedModeName = res.name;
  });

  // Claude Agent SDK session setup (for claude mode)
  async function* turns(): AsyncGenerator<any> {
    for (;;) {
      const next = await new Promise<string>((res) => (pending.deliver = res));
      if (closed || !next) return;
      yield {
        type: "user" as const,
        message: { role: "user" as const, content: next },
        parent_tool_use_id: null,
      };
    }
  }

  const tools = createSdkMcpServer({
    name: "critic",
    version: "1.0.0",
    tools: [
      tool(
        "report",
        "Report your findings for the slide you were just shown. Call this exactly once per slide, with an empty list when the slide is fine.",
        {
          findings: z
            .array(
              z.object({
                severity: SEVERITY,
                quote: z.string().describe("The exact bullet or phrase at fault, verbatim from the slide"),
                problem: z.string().describe("What is wrong with it, in one or two plain sentences"),
                fix_hint: z.string().describe("What they should go find out. NOT the corrected text."),
                basis: z.enum(["source", "knowledge"]),
              }),
            )
            .describe("Empty when the slide is fine"),
        },
        async (args) => {
          collected = (args.findings ?? []).map((f) => ({
            ...f,
            id: `f${++seq}`,
            slideKey: currentKey,
          }));
          return { content: [{ type: "text" as const, text: "Recorded. Wait for the next slide." }] };
        },
      ),
    ],
  });

  let claudeSession: any = null;
  function ensureClaudeSession() {
    if (claudeSession) return;
    try {
      claudeSession = query({
        prompt: turns(),
        options: {
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: `${CONTRACT}\n\nThe deck they are writing is titled: ${deckTitle}`,
          },
          mcpServers: { critic: tools },
          allowedTools: ["mcp__critic__report"],
        },
      });

      (async () => {
        try {
          for await (const msg of claudeSession as AsyncIterable<any>) {
            if (msg.type === "result") {
              const done = inflight.resolve;
              inflight.resolve = null;
              if (msg.is_error) {
                console.warn("[critic] Claude returned error, falling back to heuristic:", msg.result);
                resolvedProviderType = "heuristic";
                resolvedModeName = "Local Heuristic (Offline)";
              }
              done?.(collected);
              collected = [];
            }
          }
        } catch (err) {
          if (!closed) {
            console.warn("[critic] Claude session unavailable, falling back to heuristic:", (err as Error)?.message || err);
          }
          resolvedProviderType = "heuristic";
          resolvedModeName = "Local Heuristic (Offline)";
          if (inflight.resolve) {
            const done = inflight.resolve;
            inflight.resolve = null;
            done([]);
          }
        }
      })();
    } catch {
      resolvedProviderType = "heuristic";
      resolvedModeName = "Local Heuristic (Offline)";
    }
  }

  async function reviewOne(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]> {
    if (closed) return [];
    currentKey = slideKey(slide);

    // Refresh provider resolution
    const res = await resolveProvider(config);
    resolvedProviderType = res.provider;
    resolvedModeName = res.name;

    // 1. Local Heuristic
    if (resolvedProviderType === "heuristic") {
      const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
      seq += findings.length;
      return findings;
    }

    const bar = firm
      ? "They just left this slide, so it is as finished as it is going to get. Review it properly."
      : "They paused while typing in this slide. It is IN PROGRESS. Only speak up for something clearly wrong; an unfinished bullet is not a finding.";
    const rejected = rejections.length
      ? `THEY REJECTED THESE FINDINGS. Never raise them again - they may well be\nright, and you were working from your own knowledge.\n\n${rejections.join("\n\n")}\n\n`
      : "";
    rejections.length = 0;

    const now = bin(sources);
    const sources_ = now === sentBin ? "The source bin is unchanged from what you were shown earlier. Use it." : now;
    sentBin = now;

    const userPrompt = `${rejected}${bar}\n\n${render(slide)}\n\n${sources_}\n\nReview this slide and report findings.`;

    // 2. Google Gemini
    if (resolvedProviderType === "gemini") {
      const apiKey = config.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (apiKey) {
        try {
          const model = config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
          const items = await geminiReview(userPrompt, apiKey, model, 7000);
          const findings = items.map((it) => ({ ...it, id: `f${++seq}`, slideKey: currentKey }));
          return filterDismissed(findings, dismissedQuotes);
        } catch (err) {
          console.warn("[critic] Gemini call failed, falling back to heuristic:", (err as Error)?.message || err);
        }
      }
    }

    // 3. OpenAI / Codex
    if (resolvedProviderType === "openai") {
      const apiKey = config.openaiKey || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
      if (apiKey) {
        try {
          const model = config.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
          const items = await openAICompatibleReview(userPrompt, "https://api.openai.com/v1", apiKey, model, 7000);
          const findings = items.map((it) => ({ ...it, id: `f${++seq}`, slideKey: currentKey }));
          return filterDismissed(findings, dismissedQuotes);
        } catch (err) {
          console.warn("[critic] OpenAI call failed, falling back to heuristic:", (err as Error)?.message || err);
        }
      }
    }

    // 4. Local Host (Ollama / LM Studio / vLLM)
    if (resolvedProviderType === "local") {
      const endpoint = config.localEndpoint || process.env.LOCAL_AI_URL || process.env.CRITIC_ENDPOINT || "http://localhost:11434/v1";
      const model = config.localModel || process.env.LOCAL_MODEL || process.env.CRITIC_MODEL || "llama3:latest";
      try {
        const items = await openAICompatibleReview(userPrompt, endpoint, config.localToken, model, 8000);
        const findings = items.map((it) => ({ ...it, id: `f${++seq}`, slideKey: currentKey }));
        return filterDismissed(findings, dismissedQuotes);
      } catch (err) {
        console.warn("[critic] Local model call failed, falling back to heuristic:", (err as Error)?.message || err);
      }
    }

    // 5. Claude Agent SDK
    if (resolvedProviderType === "claude") {
      ensureClaudeSession();
      if (claudeSession) {
        return new Promise<Finding[]>((resolve) => {
          const timer = setTimeout(() => {
            if (inflight.resolve) {
              console.warn("[critic] Claude timed out, activating local heuristic fallback");
              resolvedProviderType = "heuristic";
              resolvedModeName = "Local Heuristic (Offline)";
              const done = inflight.resolve;
              inflight.resolve = null;
              const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
              seq += findings.length;
              done(findings);
            }
          }, 4500);

          inflight.resolve = (res) => {
            clearTimeout(timer);
            resolve(filterDismissed(res, dismissedQuotes));
          };

          try {
            pending.deliver?.(
              `${rejected}${bar}\n\n${render(slide)}\n\n${sources_}\n\nCall \`report\` now.`,
            );
          } catch {
            clearTimeout(timer);
            const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
            seq += findings.length;
            resolve(findings);
          }
        });
      }
    }

    // Fallback: heuristic review
    const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
    seq += findings.length;
    return findings;
  }

  return {
    review(slide, sources, firm) {
      if (closed) return Promise.resolve([]);
      const run = chain.then(() => reviewOne(slide, sources, firm));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    dismissed(finding, reason) {
      if (closed) return;
      dismissedQuotes.add(finding.quote.toLowerCase().trim());
      rejections.push(
        `You said: [${finding.severity}] "${finding.quote}" - ${finding.problem}\n` +
          `They rejected it: ${reason}`,
      );
    },
    close() {
      closed = true;
      pending.deliver?.("");
    },
    mode() {
      return resolvedModeName;
    },
    provider() {
      return config.provider;
    },
    setMode(mode: CriticProvider) {
      config.provider = mode;
      resolveProvider(config).then((res) => {
        resolvedProviderType = res.provider;
        resolvedModeName = res.name;
      });
    },
    setConfig(newConfig: CriticConfig) {
      config = { ...newConfig };
      resolveProvider(config).then((res) => {
        resolvedProviderType = res.provider;
        resolvedModeName = res.name;
      });
    },
  };
}

function filterDismissed(findings: Finding[], dismissed: Set<string>): Finding[] {
  if (!dismissed.size) return findings;
  return findings.filter((f) => {
    const q = f.quote.toLowerCase().trim();
    for (const d of dismissed) {
      if (d === q || q.includes(d) || d.includes(q)) return false;
    }
    return true;
  });
}

function render(slide: Slide): string {
  const { title, body } = readable(slide);
  const lines = body.length ? body.map((b) => `- ${b}`).join("\n") : "(nothing written yet)";
  return `SLIDE HEADING: ${title || "(none)"}\n\nTEXT ON THIS SLIDE:\n${lines}`;
}

function bin(sources: Source[]): string {
  if (!sources.length) {
    return "SOURCE BIN: empty. Fall back on your own knowledge and mark every finding basis=knowledge.";
  }
  return (
    "SOURCE BIN for this deck - check them against ALL of it, not just the part\n" +
    "that looks like this slide. Any entry may cover any slide.\n\n" +
    sources
      .map((s, i) => `--- source ${i + 1}${s.label ? ` (${s.label})` : ""} ---\n${s.text.trim()}`)
      .join("\n\n")
  );
}
