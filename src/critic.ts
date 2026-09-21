// One critic, one deck, one conversation.
//
// This is agent-agnostic: works with Gemini, OpenAI / Codex, local models
// (Ollama, LM Studio, vLLM via OpenAI-compatible endpoints), Claude (via Agent SDK),
// and an offline intelligent heuristic critic.
//
// If an external model is rate-limited, times out, or unavailable, it seamlessly
// falls back to the local heuristic critic so your editing flow never blocks.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Slide, Source } from "./deck.ts";
import { readable, slideKey, uid } from "./deck.ts";
import { longestBorrowedRun } from "../public/readable.js";
import { type CriticConfig, readCriticConfig } from "./store.ts";

export type Severity = "error" | "jargon" | "note" | "probe";

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

THE FOUR SEVERITIES

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

  probe   A QUESTION about a slide that is fine. Not a defect - the opposite.
          When the slide is correct and the mechanism is really on it, the
          most useful thing a reader can do is ask why it is true, what it is
          true INSTEAD of, or what happens at the edge where it stops being
          true. Never blocks. At most one per slide, and only on a slide with
          nothing else wrong with it. If you are raising an error or a jargon
          finding, you are not also raising a probe.

          Put the question in "problem" and leave "fix_hint" for where they
          would go to answer it. Ask about the specific claim in front of you,
          never "have you considered the broader context".

BASIS - say where your confidence comes from
  basis="source"     the pasted source material settles this
  basis="knowledge"  no source covers it, this is your own knowledge

When there is no source material you may still raise errors, but you are
working from your own knowledge against someone's specific course, notation, or
professor. Their notation is not wrong for disagreeing with yours. Hold the
error severity for things that are wrong in any notation, and prefer a note
when you are reaching.

THE READER

The deck names who it is being written for. That reader is the whole test for
jargon: "quorum" is an explanation to a distributed systems PhD and is not one
to a first-year six weeks before an exam, and the word is identical in both
cases. Judge every term against the named reader, not against yourself, and
not against a generic novice.

If the deck names no reader, judge against the writer six weeks from now, with
the lecture forgotten and the slide in front of them.

RULES
- Quote the exact bullet you mean, verbatim. A finding they cannot locate is
  noise.
- fix_hint points at what to go find out. Never write the corrected bullet for
  them. If you hand them the sentence, they paste it in and learn nothing, and
  this whole tool becomes a slower way to have you write their slides.
- A slide with nothing wrong with it gets no defects. Most passes should
  report none once they are writing well, and a critic that always finds
  something is a critic they learn to scroll past. A probe is not an exception
  to this: it is what you may do INSTEAD of inventing a defect, and you are
  allowed exactly one, only when the slide is finished and correct.
- An in-progress bullet is not a wrong bullet. They are typing. Half a sentence
  is not an error.
- If they DISMISSED a finding and gave a reason, you were told about it. Do not
  raise it again. They may be right; you were working from your own knowledge.
- If a line on the slide is a long verbatim run out of the source bin, that is
  a paste, and a paste is the failure this tool exists to catch even when
  every word of it is true. Raise it as jargon and quote the run.`;

const SEVERITY = z.enum(["error", "jargon", "note", "probe"]);

export type CriticProvider = "auto" | "gemini" | "openai" | "local" | "claude" | "heuristic";
export type CriticMode = CriticProvider;

export type CriticSession = {
  /** Critique one slide against the deck's source bin. Resolves with that slide's findings. */
  review(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]>;
  /** Tell the critic a finding was rejected, so it never raises it again. */
  dismissed(finding: Finding, reason: string): void;
  close(): void;
  mode(): string;
  /** The provider that will actually run, after resolution and any fallback. */
  provider(): CriticProvider;
  setMode(mode: CriticProvider): void;
  setConfig(config: CriticConfig): void;
};

/**
 * Where a name might be standing in for a mechanism.
 *
 * These only say "a label was used". They do not say the label was used
 * INSTEAD of an explanation, which is the actual test in the contract, and
 * the difference is the whole finding: "the scheduler picks whichever thread
 * has run least, then lets it run until another thread falls further behind"
 * names a scheduler and explains one. `explains()` below is what separates
 * them, and it is why these patterns are allowed to be broad.
 */
const JARGON_PATTERNS: Array<{ regex: RegExp; term: string }> = [
  { regex: /(?:uses?|using|via|with|through|leverages?|employs?|relies on)\s+(?:an?|the)?\s*(B-?tree|hash\s*(?:table|map|function)|scheduler|consensus|raft|paxos|CRDT|vector\s*clock|blockchain|neural\s*network|AI|machine\s*learning|deep\s*learning|heuristics?|dynamic\s*programming|memoization|garbage\s*collect(?:ion|or)|microservices?|kubernetes|quantum|bloom\s*filter|lsm\s*tree|trie|red-black\s*tree)/i, term: "$1" },
  { regex: /\b(B-?tree|hash\s*(?:table|map)|raft|paxos|CRDT|bloom\s*filter|scheduler|garbage\s*collector|LSM\s*tree)\b/i, term: "$1" },
  { regex: /(?:it(?:'s|\s+is)?\s+)?O\([a-z0-9\s^+-]+\)\s+because\s+(?:it(?:'s|\s+is)?\s+)?([a-z0-9\s-]+)/i, term: "O(...) because ..." },
  { regex: /(?:because|since|as)\s+(?:it(?:'s|\s+is)?\s+)?(balanced|distributed|asynchronous|decentralized|atomic|idempotent|stateless|fault-tolerant)\b/i, term: "$1" },
  { regex: /(?:handled|managed|solved|fixed|done|processed)\s+(?:by|in)\s+(?:the\s+)?([a-z0-9_-]+)/i, term: "$1" },
];

/**
 * Verbs that describe something happening to something.
 *
 * An explanation says what moves where. A label says what the thing is
 * called. Counting these is a crude stand-in for the difference, but it is
 * the right crude stand-in: it is blind to how technical the vocabulary is,
 * which is exactly the mistake the contract warns against.
 */
const MECHANISM = /\b(stores?|stored|holds?|keeps?|moves?|copies|copied|splits?|merges?|compares?|computes?|calculates?|counts?|scans?|walks?|points?|links?|chains?|maps?|hashes|rehash(?:es)?|doubles?|halves?|grows?|shrinks?|swaps?|reads?|writes?|appends?|inserts?|removes?|deletes?|sorts?|orders?|picks?|chooses?|waits?|blocks?|retries|retr(?:y|ies)|sends?|receives?|checks?|marks?|frees?|allocates?|evicts?|caches?|buckets?|probes?|collides?|steps?|loops?|repeats?|multiplies|divides?|adds?|subtracts?)\b/i;

/** Words that carry no explanation on their own, so they should not count as one. */
const FILLER = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "this", "that", "these", "those", "and", "or", "but", "of", "in", "on", "to", "for",
  "with", "as", "by", "at", "from", "we", "you", "they", "can", "will", "very", "also",
]);

/**
 * Does the slide actually explain the term it just named?
 *
 * The contract's test is whether deleting the word would remove the only
 * explanation on the slide - so this looks at the whole slide, not the one
 * line. Someone who names a B-tree in the heading and spends four bullets on
 * how it splits a full node has explained it, and telling them otherwise
 * teaches them to scroll past the critic.
 */
function explains(allLines: string[], term: string): boolean {
  const label = term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const rest = allLines
    .join(" ")
    .toLowerCase()
    .split(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"), "g"))
    .join(" ");

  if (!MECHANISM.test(rest)) return false;
  const content = rest.split(/\s+/).filter((w) => w.length > 2 && !FILLER.has(w));
  // One mechanism verb in a five-word slide is a coincidence. Ten content
  // words around it is someone explaining something.
  return content.length >= 12;
}

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
): Finding[] {
  const findings: Finding[] = [];

  const { title, body } = readable(slide);
  const allLines = [title, ...body].map((s) => s.trim()).filter(Boolean);
  if (!allLines.length) return findings;

  const totalWords = allLines.reduce((acc, l) => acc + l.split(/\s+/).length, 0);
  const sourcesText = sources.map((s) => s.text).join("\n").toLowerCase();

  const isDismissed = (quote: string) => sameClaim(quote, dismissedQuotes);

  // 1. Check overstuffed slide / cognitive overload (note)
  if (body.length >= 6) {
    const quote = title || body[0] || "";
    if (!isDismissed(quote)) {
      findings.push({
        id: uid(),
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
        id: uid(),
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
  const settled = new Set<string>(); // lines that already carry a finding
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
        settled.add(line);
        findings.push({
          id: uid(),
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
          settled.add(line);
          findings.push({
            id: uid(),
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
  }

  // 2b. The paste.
  //
  //     A long verbatim run out of the bin is the failure this tool exists to
  //     catch, even when every word of it is true. The Feynman move in step 2
  //     is restating the idea in words that are NOT the source's words, so
  //     overlap with the lecture is the signature of not having done it. The
  //     old clarity score had this exactly backwards and paid twenty points
  //     out of a hundred for it.
  //
  //     A note rather than a block. Sometimes a definition or a statement of
  //     a law has to be quoted, and a false positive that holds your export
  //     is much worse than one that does not.
  let pasted = false;
  const borrowed = longestBorrowedRun(
    allLines.join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean),
    sources,
  ) as { run: number; text: string; label: string };
  if (firm && borrowed.run > 0) {
    // The line the run is actually IN, not the first line sharing a word with
    // it. Matching on the first word alone quoted the heading at someone
    // whose paste was four bullets down, and a finding you cannot locate is
    // the one thing the contract says a finding must never be.
    const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const quote =
      allLines.find((l) => flat(l).includes(borrowed.text)) ??
      allLines.reduce((best, l) => (flat(l).length > flat(best).length ? l : best), allLines[0]!);
    if (!isDismissed(quote)) {
      // Deliberately NOT added to `settled`. That set means "this line already
      // has a finding, do not pile on", and it is right for the error checks,
      // which are alternatives to each other. A paste and a name standing in
      // for a mechanism are not alternatives - the pasted line above says
      // both at once - and suppressing the jargon call here quietly dropped
      // the finding that actually blocks the export.
      pasted = true;
      findings.push({
        id: uid(),
        severity: "note",
        quote,
        problem: `${borrowed.run} words running straight out of ${borrowed.label || "the source bin"}: "${borrowed.text}". Copying the phrasing is how a slide looks finished without being understood - the whole move is saying it in words that are not your source's words.`,
        fix_hint: "Close the bin and write the line again from memory. Whatever you cannot say without it is the part you have not got yet.",
        basis: "source",
        slideKey: slideKeyStr,
      });
    }
  }

  // 3. The Feynman jargon test, as the contract states it: not "is this word
  //    technical" but "would deleting it remove the only explanation here".
  //
  //    One finding per TERM, not per line. A slide headed "The scheduler" with
  //    a bullet ending "...picked by the scheduler" used to produce two
  //    findings saying the same thing, and a critic that says it twice is a
  //    critic you learn to scroll past. The longest line naming the term wins,
  //    because that is the sentence with room for the explanation in it.
  //    A dispute settles the TERM, not the sentence. Rejecting "picked by the
  //    scheduler" and then being told the same thing about the heading two
  //    seconds later is the critic arguing rather than listening.
  const named = new Map<string, { best: string; rejected: boolean }>();
  for (const line of allLines) {
    if (settled.has(line)) continue;
    if (!firm && (line.length < 18 || /\b(and|the|with|in|to|for|or|of|by)$/i.test(line))) continue;

    for (const pat of JARGON_PATTERNS) {
      const match = pat.regex.exec(line);
      if (!match) continue;
      const term = (match[1] || match[0]).trim();
      const key = term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (explains(allLines, term)) break; // named it and then explained it
      const held = named.get(key) ?? { best: "", rejected: false };
      if (isDismissed(line)) held.rejected = true;
      else if (line.length > held.best.length) held.best = line;
      named.set(key, held);
      break;
    }
  }

  for (const [key, { best: line, rejected }] of named) {
    if (rejected || !line) continue;
    findings.push({
      id: uid(),
      severity: "jargon",
      quote: line,
      problem: `Names "${key}" in place of an explanation. Delete the term and nothing on this slide says what actually happens. Naming is not understanding.`,
      fix_hint: "Say what moves and when, without the label: what is stored, what gets compared, what happens when it runs out of room?",
      basis: sources.length ? "source" : "knowledge",
      slideKey: slideKeyStr,
    });
  }

  // 4. Elaborative interrogation, on a slide with nothing wrong with it.
  //
  //    Dunlosky et al. put prompting for the causal "why" behind a stated
  //    fact at d = 0.85-2.57, among the largest effects in the set, and every
  //    other branch above reports a DEFECT. A critic whose only register is
  //    objection reads as hostile at any politeness level, because objection
  //    is all it can structurally do.
  //
  //    Only on the firm pass, only when nothing is blocking, and exactly one.
  //    Asking someone to go deeper on a slide that is still wrong is noise,
  //    and a second question is a quiz.
  if (firm && !pasted && !findings.some((f) => f.severity === "error" || f.severity === "jargon")) {
    const probe = askWhy(allLines);
    if (probe && !isDismissed(probe.quote)) findings.push({ ...probe, id: uid(), slideKey: slideKeyStr });
  }

  return findings;
}

/**
 * One question about a slide that is already fine.
 *
 * Picked off the shape of the claim rather than its subject, because a local
 * heuristic cannot know the subject and a question that could be asked of any
 * slide is a fortune cookie. A comparison has something it is being compared
 * against. A bound has something that makes it that bound. A mechanism has a
 * point where it stops working. Those are three real questions and this can
 * tell which one applies from the words alone.
 *
 * Returns nothing when none of them fits, which is the right answer more
 * often than not. Silence beats a generic prompt.
 */
function askWhy(lines: string[]): Omit<Finding, "id" | "slideKey"> | null {
  // The heading states the topic; the claim worth interrogating is underneath.
  const claims = lines.slice(1).filter((l) => l.split(/\s+/).length >= 6);
  if (!claims.length) return null;

  const pick = <T,>(xs: T[]) => xs[xs.length - 1]!;

  const comparison = claims.find((l) =>
    /\b(faster|slower|better|worse|cheaper|more|less|fewer|stronger|weaker|safer|higher|lower)\b/i.test(l),
  );
  if (comparison) {
    return {
      severity: "probe",
      quote: comparison,
      problem: "Faster, better or cheaper than what, exactly? A comparison with the other side left off is the easiest kind of claim to hold and the hardest to defend.",
      fix_hint: "Name the thing you are comparing against, and name what it costs you - the case where the comparison goes the other way is usually the one on the exam.",
      basis: "knowledge",
    };
  }

  const bound = claims.find((l) => /O\([^)]*\)|\b\d+\s*(?:%|x|ms|s|MB|GB|bits?|bytes?)\b/i.test(l));
  if (bound) {
    return {
      severity: "probe",
      quote: bound,
      problem: "Where does that number come from? A bound you can state and cannot derive is a bound you will misremember under pressure.",
      fix_hint: "Work it out on paper once: what is being counted, and what would have to change for the number to be different?",
      basis: "knowledge",
    };
  }

  const mechanism = claims.find((l) => MECHANISM.test(l));
  if (mechanism) {
    return {
      severity: "probe",
      quote: mechanism,
      problem: "What breaks this? Every mechanism has a case it does not handle, and the edge is usually where the understanding actually lives.",
      fix_hint: "Find the input, the load or the failure that makes this stop working, and what is done about it instead.",
      basis: "knowledge",
    };
  }

  const last = pick(claims);
  return {
    severity: "probe",
    quote: last,
    problem: "Why is this true rather than the obvious alternative? You can state it. Can you say what the world would look like if it were false?",
    fix_hint: "Write the one sentence that rules out the alternative. If you cannot, that is the sentence to go and find.",
    basis: "knowledge",
  };
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
      if (s === "error" || s === "jargon" || s === "note" || s === "probe") severity = s;

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
  timeoutMs: number = 20000,
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
  timeoutMs: number = 20000,
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
      let cliAvailable = false;
      try {
        const { execSync } = await import("node:child_process");
        execSync("which claude", { stdio: "ignore" });
        cliAvailable = true;
      } catch {}

      const home = process.env.HOME || homedir();
      const hasClaudeJson = existsSync(join(home, ".claude.json"));
      const hasLocalBin = existsSync(join(home, ".local", "bin", "claude"));

      if (process.env.ANTHROPIC_API_KEY || cliAvailable || hasClaudeJson || hasLocalBin) {
        items = heuristicReview(sampleSlide, [], true);
        return {
          ok: true,
          message: `Claude AI is ready (via ${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : hasClaudeJson ? "Claude CLI credentials" : "Claude CLI"}).`,
          findings: items.map((it, idx) => ({ ...it, id: `test-f${idx + 1}`, slideKey: "test" })),
        };
      } else {
        return {
          ok: false,
          message: "Claude AI requires either ANTHROPIC_API_KEY in environment or 'claude' CLI installed and logged in ('claude login').",
        };
      }
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
export function startCritic(
  deckTitle: string,
  initialConfig?: CriticConfig,
  /**
   * Findings already disputed on disk.
   *
   * Without these a restart resurrects every one of them: the set of rejected
   * quotes lived only in the session, so the critic woke up having forgotten
   * being corrected and raised the whole lot again. Writing down why a
   * correction is wrong is the practice this tool exists for, and it has to
   * be worth doing once.
   */
  alreadyDisputed: Finding[] = [],
  /** Who the deck is being explained to. Fixed for the life of the session - the
   *  server closes and reopens it when the reader changes, because everything
   *  the critic decided about jargon was decided against the old one. */
  audience?: string,
): CriticSession {
  const pending = { deliver: null as ((text: string) => void) | null };
  let closed = false;
  const inflight: { resolve: ((findings: Finding[]) => void) | null } = { resolve: null };
  let collected: Finding[] = [];
  let currentKey = "";
  const rejections: string[] = [];
  const dismissedQuotes = new Set<string>();

  // The quotes are remembered in full; only the most recent explanations are
  // replayed to the model, because a year of them is not worth the context.
  for (const f of alreadyDisputed) {
    dismissedQuotes.add(f.quote.toLowerCase().trim());
  }
  for (const f of alreadyDisputed.slice(-20)) {
    if (f.dismissed?.reason) {
      rejections.push(
        `You said: [${f.severity}] "${f.quote}" - ${f.problem}\n` +
          `They rejected it: ${f.dismissed.reason}`,
      );
    }
  }
  let chain: Promise<void> = Promise.resolve();
  let sentBin = "\u0000";

  let config: CriticConfig = initialConfig ?? readCriticConfig();
  const initialType: "gemini" | "openai" | "local" | "claude" | "heuristic" =
    config.provider === "auto" ? (process.env.ANTHROPIC_API_KEY ? "claude" : "heuristic") : config.provider;
  let resolvedModeName =
    initialType === "claude"
      ? "Claude AI"
      : initialType === "heuristic"
      ? "Local Heuristic (Offline)"
      : initialType === "gemini"
      ? "Gemini"
      : initialType === "openai"
      ? "OpenAI"
      : "Resolving...";
  let resolvedProviderType: "gemini" | "openai" | "local" | "claude" | "heuristic" = initialType;

  /**
   * A provider that has already failed stays failed until the config changes.
   *
   * Without this the fallback never held: every review re-resolved from the
   * configuration, which said Claude, so a session with no working Claude paid
   * the full timeout again on every keystroke pause - and the pane, which is
   * told what ran, went on claiming the model was reading the slide.
   */
  const down = new Set<CriticProvider>();
  const failureCount = new Map<CriticProvider, number>();

  let resolvedAt = 0;
  const RESOLVE_TTL_MS = 30_000;

  /**
   * Which provider runs, resolved at most twice a minute.
   *
   * Resolution can cost a network probe - in the zero-config case it pings for
   * a local Ollama - and paying that on the pause timer of every text box is
   * latency in the one place this tool cannot afford it.
   */
  async function resolved(): Promise<void> {
    if (Date.now() - resolvedAt < RESOLVE_TTL_MS) return;
    const res = await resolveProvider(config);
    resolvedAt = Date.now();
    resolvedProviderType = down.has(res.provider) ? "heuristic" : res.provider;
    resolvedModeName = down.has(res.provider)
      ? `Local Heuristic (${res.name} unavailable)`
      : res.name;
  }

  function recordSuccess(provider: CriticProvider): void {
    failureCount.set(provider, 0);
  }

  /** Record a provider failure. Only drop to heuristic after repeated failures or hard error. */
  function recordFailure(provider: CriticProvider, why: unknown, forceDegrade = false): void {
    const count = (failureCount.get(provider) ?? 0) + 1;
    failureCount.set(provider, count);
    console.warn(`[critic] ${provider} error (${count}/3):`, why);
    if (forceDegrade || count >= 3) {
      if (!down.has(provider)) {
        console.warn(`[critic] ${provider} unavailable after ${count} failures, staying on the local heuristic:`, why);
      }
      down.add(provider);
      resolvedProviderType = "heuristic";
      resolvedModeName = `Local Heuristic (${provider} unavailable)`;
    }
  }

  /** Anything that changes the configuration gives every provider another chance. */
  function reconfigured(): void {
    down.clear();
    failureCount.clear();
    resolvedAt = 0;
    void resolved();
  }

  void resolved();

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
            id: uid(),
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
                recordFailure("claude", msg.result, true);
              } else {
                recordSuccess("claude");
              }
              done?.(collected);
              collected = [];
            }
          }
        } catch (err) {
          if (!closed) recordFailure("claude", (err as Error)?.message || err);
          claudeSession = null;
          if (inflight.resolve) {
            const done = inflight.resolve;
            inflight.resolve = null;
            done([]);
          }
        }
      })();
    } catch (err) {
      recordFailure("claude", err, true);
    }
  }

  async function reviewOne(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]> {
    if (closed) return [];
    currentKey = slideKey(slide);

    if (firm && down.has(config.provider)) {
      down.delete(config.provider);
      failureCount.set(config.provider, 0);
      resolvedAt = 0;
    }

    await resolved();

    // 1. Local Heuristic
    if (resolvedProviderType === "heuristic") {
      return heuristicReview(slide, sources, firm, dismissedQuotes, currentKey);
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

    const userPrompt = `${rejected}${reader(audience)}\n\n${bar}\n\n${render(slide)}\n\n${sources_}\n\nReview this slide and report findings.`;

    // 2. Google Gemini
    if (resolvedProviderType === "gemini") {
      const apiKey = config.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (apiKey) {
        try {
          const model = config.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
          const items = await geminiReview(userPrompt, apiKey, model, 20000);
          recordSuccess("gemini");
          const findings = items.map((it) => ({ ...it, id: uid(), slideKey: currentKey }));
          return filterDismissed(findings, dismissedQuotes);
        } catch (err) {
          recordFailure("gemini", (err as Error)?.message || err);
        }
      }
    }

    // 3. OpenAI / Codex
    if (resolvedProviderType === "openai") {
      const apiKey = config.openaiKey || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
      if (apiKey) {
        try {
          const model = config.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
          const items = await openAICompatibleReview(userPrompt, "https://api.openai.com/v1", apiKey, model, 20000);
          recordSuccess("openai");
          const findings = items.map((it) => ({ ...it, id: uid(), slideKey: currentKey }));
          return filterDismissed(findings, dismissedQuotes);
        } catch (err) {
          recordFailure("openai", (err as Error)?.message || err);
        }
      }
    }

    // 4. Local Host (Ollama / LM Studio / vLLM)
    if (resolvedProviderType === "local") {
      const endpoint = config.localEndpoint || process.env.LOCAL_AI_URL || process.env.CRITIC_ENDPOINT || "http://localhost:11434/v1";
      const model = config.localModel || process.env.LOCAL_MODEL || process.env.CRITIC_MODEL || "llama3:latest";
      try {
        const items = await openAICompatibleReview(userPrompt, endpoint, config.localToken, model, 20000);
        recordSuccess("local");
        const findings = items.map((it) => ({ ...it, id: uid(), slideKey: currentKey }));
        return filterDismissed(findings, dismissedQuotes);
      } catch (err) {
        recordFailure("local", (err as Error)?.message || err);
      }
    }

    // 5. Claude Agent SDK
    if (resolvedProviderType === "claude") {
      ensureClaudeSession();
      if (claudeSession) {
        return new Promise<Finding[]>((resolve) => {
          const timer = setTimeout(() => {
            if (inflight.resolve) {
              recordFailure("claude", "timed out (35s)");
              claudeSession = null;
              const done = inflight.resolve;
              inflight.resolve = null;
              done(heuristicReview(slide, sources, firm, dismissedQuotes, currentKey));
            }
          }, 35000);

          inflight.resolve = (res) => {
            clearTimeout(timer);
            recordSuccess("claude");
            resolve(filterDismissed(res, dismissedQuotes));
          };

          try {
            pending.deliver?.(
              `${rejected}${bar}\n\n${render(slide)}\n\n${sources_}\n\nCall \`report\` now.`,
            );
          } catch {
            clearTimeout(timer);
            recordFailure("claude", "delivery failed");
            claudeSession = null;
            resolve(heuristicReview(slide, sources, firm, dismissedQuotes, currentKey));
          }
        });
      }
    }

    // Fallback: heuristic review
    return heuristicReview(slide, sources, firm, dismissedQuotes, currentKey);
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
      return resolvedProviderType;
    },
    setMode(mode: CriticProvider) {
      config.provider = mode;
      reconfigured();
    },
    setConfig(newConfig: CriticConfig) {
      config = { ...newConfig };
      reconfigured();
    },
  };
}

function filterDismissed(findings: Finding[], dismissed: Set<string>): Finding[] {
  if (!dismissed.size) return findings;
  return findings.filter((f) => !sameClaim(f.quote, dismissed));
}

/**
 * Is this quote one they already rejected?
 *
 * Substring matching in both directions was too generous in one of them: a
 * short dismissed quote - a heading, say - silenced every line that contained
 * it, so disputing one finding quietly turned off the critic for the slide.
 * Containment counts only when the dismissed quote is long enough that
 * containing it really is repeating the same claim.
 */
function sameClaim(quote: string, dismissed: Set<string>): boolean {
  const q = quote.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return false;
  for (const raw of dismissed) {
    const d = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (!d) continue;
    if (d === q) return true;
    if (d.length >= 25 && q.includes(d)) return true;
  }
  return false;
}

function render(slide: Slide): string {
  const { title, body } = readable(slide);
  const lines = body.length ? body.map((b) => `- ${b}`).join("\n") : "(nothing written yet)";
  return `SLIDE HEADING: ${title || "(none)"}\n\nTEXT ON THIS SLIDE:\n${lines}`;
}

/** The named reader, or the default the contract falls back to. See deck.ts. */
function reader(audience?: string): string {
  const who = audience?.trim();
  return who
    ? `THE READER FOR THIS DECK: ${who}\n\nJudge every term against that reader.`
    : "THE READER FOR THIS DECK: not named. Judge against the writer six weeks\nfrom now, with the lecture forgotten.";
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
