// One critic, one deck, one conversation.
//
// This is a session, not a call per slide, for the reason dum-intern learned
// the expensive way: stateless calls cannot follow up. The critic has to
// remember that it already flagged something, and it has to remember that you
// rejected a correction and WHY, or it raises the same wrong finding forever
// and you stop reading the pane.
//
// It reports through a tool rather than prose. Prose would have to be parsed
// out of free text, and `allowedTools` here is exactly one entry - the critic
// has no filesystem access at all. There is nothing to confine, which is a
// stronger position than confining it correctly.

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Slide, Source } from "./deck.ts";
import { readable, slideKey } from "./deck.ts";

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

const CONTRACT = `You are the critic in feynman-slides. Someone is writing slides to teach
themselves a topic, and you read each slide as they write it.

Your whole job is to stop them from writing a slide they cannot defend. A slide
that looks finished and is subtly wrong is the worst outcome this tool can
produce, because they will study from it.

REPORT THROUGH THE \`report\` TOOL. Never write prose at them - plain text you
emit is a side channel the interface does not show.

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

type Pending = { deliver: ((text: string) => void) | null };

export type CriticMode = "auto" | "claude" | "heuristic";

export type CriticSession = {
  /** Critique one slide against the deck's source bin. Resolves with that slide's findings. */
  review(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]>;
  /** Tell the critic a finding was rejected, so it never raises it again. */
  dismissed(finding: Finding, reason: string): void;
  close(): void;
  mode(): "claude" | "heuristic";
  setMode(mode: CriticMode): void;
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
 * Runs instantly offline or when Claude is unavailable.
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
        // Only trigger if line does not already explain the mechanism (short sentence naming the term)
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

/** One session per deck. Started lazily, because starting one costs a subprocess. */
export function startCritic(deckTitle: string): CriticSession {
  const pending: Pending = { deliver: null };
  let closed = false;
  const inflight: { resolve: ((findings: Finding[]) => void) | null } = { resolve: null };
  let collected: Finding[] = [];
  let currentKey = "";
  let seq = 0;
  const rejections: string[] = [];
  const dismissedQuotes = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let sentBin = "\u0000"; // never equal to a real bin, so the first review always sends one

  let criticConfig: CriticMode = (process.env.FEYNMAN_CRITIC as CriticMode) || "auto";
  let activeMode: "claude" | "heuristic" = criticConfig === "heuristic" ? "heuristic" : "claude";

  async function* turns(): AsyncGenerator<any> {
    for (;;) {
      const next = await new Promise<string>((res) => (pending.deliver = res));
      if (closed || !next) return;
      yield userTurn(next);
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

  let currentSlide: Slide | null = null;
  let currentSources: Source[] = [];
  let currentFirm = false;

  let session: any = null;
  if (criticConfig !== "heuristic") {
    try {
      session = query({
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
          for await (const msg of session as AsyncIterable<any>) {
            if (msg.type === "result") {
              const done = inflight.resolve;
              inflight.resolve = null;
              if (msg.is_error) {
                console.warn("[critic] Claude returned error result, falling back to heuristic critic:", msg.result || msg.terminal_reason);
                activeMode = "heuristic";
                if (currentSlide) {
                  collected = heuristicReview(currentSlide, currentSources, currentFirm, dismissedQuotes, currentKey, seq);
                  seq += collected.length;
                }
              }
              done?.(collected);
              collected = [];
            }
          }
        } catch (err) {
          if (!closed) {
            console.warn("[critic] Claude session unavailable, switching to local heuristic critic:", (err as Error)?.message || err);
          }
          activeMode = "heuristic";
          if (inflight.resolve) {
            const done = inflight.resolve;
            inflight.resolve = null;
            if (currentSlide) {
              const findings = heuristicReview(currentSlide, currentSources, currentFirm, dismissedQuotes, currentKey, seq);
              seq += findings.length;
              done(findings);
            } else {
              done([]);
            }
          }
        }
      })();
    } catch (err) {
      console.warn("[critic] Could not start Claude session, using local heuristic critic:", (err as Error)?.message || err);
      activeMode = "heuristic";
    }
  }

  function reviewOne(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]> {
    if (closed) return Promise.resolve([]);
    currentKey = slideKey(slide);
    currentSlide = slide;
    currentSources = sources;
    currentFirm = firm;

    // If configured for heuristic or fallen back because Claude is unavailable/out
    if (activeMode === "heuristic" || criticConfig === "heuristic") {
      const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
      seq += findings.length;
      return Promise.resolve(findings);
    }

    const bar = firm
      ? "They just left this slide, so it is as finished as it is going to get. Review it properly."
      : "They paused while typing in this slide. It is IN PROGRESS. Only speak up for something clearly wrong; an unfinished bullet is not a finding.";
    const rejected = rejections.length
      ? `THEY REJECTED THESE FINDINGS. Never raise them again - they may well be\nright, and you were working from your own knowledge.\n\n${rejections.join("\n\n")}\n\n`
      : "";
    rejections.length = 0;

    const now = bin(sources);
    const sources_ = now === sentBin
      ? "The source bin is unchanged from what you were shown earlier. Use it."
      : now;
    sentBin = now;

    return new Promise<Finding[]>((resolve) => {
      // Safety timeout: if Claude does not answer within 3500ms, seamlessly fall back to heuristic critic
      const timer = setTimeout(() => {
        if (inflight.resolve) {
          console.warn("[critic] Claude timed out, activating local heuristic critic fallback");
          activeMode = "heuristic";
          const done = inflight.resolve;
          inflight.resolve = null;
          const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
          seq += findings.length;
          done(findings);
        }
      }, 3500);

      inflight.resolve = (res) => {
        clearTimeout(timer);
        resolve(res);
      };

      try {
        pending.deliver?.(
          `${rejected}${bar}\n\n${render(slide)}\n\n${sources_}\n\nCall \`report\` now.`,
        );
      } catch {
        clearTimeout(timer);
        activeMode = "heuristic";
        const findings = heuristicReview(slide, sources, firm, dismissedQuotes, currentKey, seq);
        seq += findings.length;
        resolve(findings);
      }
    });
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
      return activeMode;
    },
    setMode(mode: CriticMode) {
      criticConfig = mode;
      if (mode === "heuristic") activeMode = "heuristic";
      else if (mode === "claude") activeMode = "claude";
    },
  };
}

function userTurn(text: string) {
  return {
    type: "user" as const,
    message: { role: "user" as const, content: text },
    parent_tool_use_id: null,
  };
}

/**
 * What one slide looks like to the critic.
 *
 * Reading order rather than array order, and images appear only through their
 * alt text - the critic cannot see a picture, and a slide whose whole argument
 * is in an unlabelled diagram should read as a slide with nothing on it.
 */
function render(slide: Slide): string {
  const { title, body } = readable(slide);
  const lines = body.length ? body.map((b) => `- ${b}`).join("\n") : "(nothing written yet)";
  return `SLIDE HEADING: ${title || "(none)"}\n\nTEXT ON THIS SLIDE:\n${lines}`;
}

/**
 * The source bin, sent only when it has changed.
 *
 * This is the payoff for the critic being one long conversation instead of a
 * call per slide: the bin is already in its context from the last time, so a
 * deck with a chapter pasted into it does not re-send that chapter on every
 * pause while typing.
 */
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
