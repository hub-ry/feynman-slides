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

export type CriticSession = {
  /** Critique one slide against the deck's source bin. Resolves with that slide's findings. */
  review(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]>;
  /** Tell the critic a finding was rejected, so it never raises it again. */
  dismissed(finding: Finding, reason: string): void;
  close(): void;
};

/** One session per deck. Started lazily, because starting one costs a subprocess. */
export function startCritic(deckTitle: string): CriticSession {
  const pending: Pending = { deliver: null };
  let closed = false;
  // A holder, not a bare `let`: it is written in one closure and read in
  // another, which control-flow narrowing cannot follow.
  const inflight: { resolve: ((findings: Finding[]) => void) | null } = { resolve: null };
  let collected: Finding[] = [];
  let currentKey = "";
  let seq = 0;
  const rejections: string[] = [];
  let chain: Promise<void> = Promise.resolve();
  let sentBin = "\u0000"; // never equal to a real bin, so the first review always sends one

  // Every turn yielded here is exactly one review, and every review ends in
  // exactly one `result`. That one-to-one is load-bearing: an extra turn - an
  // init handshake, an acknowledged dismissal - produces an extra `result`
  // that resolves the NEXT review with an empty list. That bug cost a slide
  // with three faults in it a clean pass on the very first live run.
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

  const session = query({
    prompt: turns(),
    options: {
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `${CONTRACT}\n\nThe deck they are writing is titled: ${deckTitle}`,
      },
      mcpServers: { critic: tools },
      // The critic reads slides and reports. It has no reason to touch a file,
      // so it is not given the ability to.
      allowedTools: ["mcp__critic__report"],
    },
  });

  // Drain the session forever: each `result` message closes out one review.
  (async () => {
    try {
      for await (const msg of session as AsyncIterable<any>) {
        if (msg.type === "result") {
          const done = inflight.resolve;
          inflight.resolve = null;
          done?.(collected);
          collected = [];
        }
      }
    } catch (err) {
      if (!closed) console.error("[critic] session ended:", err);
      inflight.resolve?.([]);
    }
  })();

  function reviewOne(slide: Slide, sources: Source[], firm: boolean): Promise<Finding[]> {
    if (closed) return Promise.resolve([]);
    currentKey = slideKey(slide);
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
      inflight.resolve = resolve;
      pending.deliver?.(
        `${rejected}${bar}\n\n${render(slide)}\n\n${sources_}\n\nCall \`report\` now.`,
      );
    });
  }

  return {
    review(slide, sources, firm) {
      if (closed) return Promise.resolve([]);
      // Queued, because this is ONE conversation and a conversation is serial.
      // Reviewing two slides at once overwrote the first review's resolver
      // with the second's and silently dropped a slide's findings - the
      // editor happily fires a pause on one slide and a blur on another
      // milliseconds apart, so this is the normal case, not the edge case.
      const run = chain.then(() => reviewOne(slide, sources, firm));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    dismissed(finding, reason) {
      if (closed) return;
      // Carried into the next review rather than sent as its own turn. A turn
      // of its own would cost a `result` with no review behind it - see the
      // note on `turns`. It is also persisted in state.json, so a rejection
      // outlives this process even if no further review ever happens.
      rejections.push(
        `You said: [${finding.severity}] "${finding.quote}" - ${finding.problem}\n` +
          `They rejected it: ${reason}`,
      );
    },
    close() {
      closed = true;
      pending.deliver?.("");
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
    sources.map((s, i) => `--- source ${i + 1} ---\n${s.text.trim()}`).join("\n\n")
  );
}
