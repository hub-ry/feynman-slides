// When the critic has earned the right to be quiet.
//
// Collins, Brown and Newman's cognitive apprenticeship names four moves:
// model, coach, scaffold, FADE. This app did the first three and then stopped.
// The critic was as loud on a slide you have recalled correctly four times as
// on one you wrote thirty seconds ago, which is not coaching, it is just
// volume. See docs/research.md section 10.
//
// The hard part was never the fading. It was finding a signal worth fading on.
// Deck count measures how long you have used the app, not whether you have
// learned anything. Finding rate measures the critic. The schedule, now that
// it exists, measures the only thing that matters: whether the slide you wrote
// is one you can still produce a week later.
//
// TWO THINGS DELIBERATELY DO NOT FADE
//
//   error   A slide that looks finished and is subtly wrong is the worst
//           thing this tool can produce, and recalling it confidently is not
//           evidence against that. It is the failure mode - you have learned
//           it, and it is wrong.
//
//   jargon  Recall here is self-graded against a slide you wrote yourself, so
//           it is close to worthless as evidence about hiding behind a word.
//           The expert blind spot predicts exactly this: a chunk label is easy
//           to reproduce and that is the problem with it, not a defence. You
//           would grade yourself `Good` on "uses a B-tree" every time.
//
// What fades is the interruption and the tidiness complaint. That is the part
// that was costing attention without buying accuracy.

import type { Finding } from "./critic.ts";
import { GOOD, type Memory } from "./recall.ts";

/**
 * How many times a slide must have come back before its recall record counts.
 *
 * Three is a judgement call, not a result. Two is one same-day pass plus one
 * real one, which is the learning ladder rather than evidence of retention.
 * Three means it has survived at least one day-scale gap.
 */
export const SETTLED_REPS = 3;

/**
 * Has this slide earned quiet?
 *
 * `digestNow` is the slide as it stands; `recalledDigest` is the slide as it
 * was the last time it was graded. They have to match. Recall evidence is
 * about the words you actually recalled - rewrite the slide and the record
 * belongs to text that no longer exists, so the critic comes back at full
 * volume until the new words have earned their own.
 */
export function settled(
  memory: Memory | undefined,
  digestNow: string,
  recalledDigest: string | undefined,
): boolean {
  if (!memory || !recalledDigest) return false;
  if (recalledDigest !== digestNow) return false;
  // Anything but `review` means it is in the learning ladder or has just been
  // failed back into relearning, either of which is the opposite of settled.
  if (memory.state !== "review") return false;
  if (memory.reps < SETTLED_REPS) return false;
  return (memory.lastRating ?? 0) >= GOOD;
}

/**
 * The findings a settled slide still gets to hear.
 *
 * `note` is the one that goes. It is the severity that says your slide is
 * untidy, which is worth saying while you are still learning the shape of a
 * good slide and is noise once you have demonstrably learned this one.
 *
 * `probe` stays, and on a settled slide it is arguably the only thing left
 * worth saying: it asks why the slide is true rather than reporting a defect,
 * and a slide you can reliably recall is exactly where going deeper pays.
 */
export function faded(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity !== "note");
}
