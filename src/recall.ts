// When a slide comes back.
//
// A deck is a thing you are teaching yourself, so the moment you finish
// writing it is the least interesting moment in its life. What decides
// whether you still know it in six weeks is when you next try to say it
// without looking. Dunlosky et al. (2013) rated ten study techniques and gave
// a HIGH utility rating to exactly two of them: practice testing and
// distributed practice. This file is the second one, and public/recall.js is
// the first. See docs/research.md.
//
// The algorithm is FSRS-6, the scheduler Anki ships. It is a port of
// open-spaced-repetition/py-fsrs `fsrs/scheduler.py`, with its published
// default weights. Two things are deliberately NOT ported:
//
//   Per-user optimisation. The weights below were fit on hundreds of millions
//   of reviews; fitting your own needs a review history in the thousands,
//   which nobody has on the day they install this.
//
//   Interval fuzz. Anki spreads due dates so a thousand cards added on one
//   day do not all come back on one day. A deck is thirty slides. The fuzz
//   would only make "due in 4 days" a lie.
//
// Everything else - the difficulty/stability/retrievability model, the
// learning steps, the short-term branch for same-day reviews - is the real
// thing, and src/recall.test.ts checks it against values computed straight
// from the reference source.

/**
 * How it went, from the person doing the recalling.
 *
 * These are the four FSRS grades and the numbers matter: the model indexes
 * weights by them. `Again` is a failure and the only one that counts as a
 * lapse. `Hard` means you got there but it hurt.
 */
export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;
export type Rating = 1 | 2 | 3 | 4;

export const RATINGS: Rating[] = [AGAIN, HARD, GOOD, EASY];

/**
 * FSRS-6 default parameters, from py-fsrs `DEFAULT_PARAMETERS`.
 *
 * w[20] is the decay term; the other twenty drive stability and difficulty.
 * Do not tidy these into named constants - they are a fitted vector and the
 * indices are the interface the formulas below are written against.
 */
export const DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
] as const;

const MIN_DIFFICULTY = 1.0;
const MAX_DIFFICULTY = 10.0;
const MIN_STABILITY = 0.001;

/** Beyond this a slide is not being remembered, it is being kept. Anki's default. */
const MAX_INTERVAL_DAYS = 36500;

/**
 * The probability of recall you are scheduling for.
 *
 * Higher means more reviews for firmer memory. 0.9 is the FSRS default and
 * the number its intervals are calibrated around: at t = S, R is exactly 0.9.
 */
export const DESIRED_RETENTION = 0.9;

/**
 * Minutes before a slide you just failed comes back.
 *
 * Anki's defaults. The first two are the learning ladder for a slide you have
 * never recalled; the third is where a mature slide lands when you blank on
 * it. They are minutes rather than days on purpose: a slide you could not say
 * should come back inside the same sitting, while you still remember trying.
 */
const LEARNING_STEPS_MIN = [1, 10];
const RELEARNING_STEPS_MIN = [10];

export const DECAY = -DEFAULT_W[20];
export const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

const MIN = 60_000;
const DAY = 86_400_000;

export type CardState = "learning" | "review" | "relearning";

/**
 * One slide's memory, as the model sees it.
 *
 * `stability` is how many days until recall probability falls to 0.9.
 * `difficulty` is 1-10, how hard this slide is for you specifically, and it
 * drifts with your grades rather than being set once.
 *
 * Both are null before the first review, which is the difference between a
 * slide you have never been asked about and a slide you have.
 */
export type Memory = {
  state: CardState;
  /** Which learning or relearning step, or null once it is a review card. */
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  /** ISO. When it should next be asked. */
  due: string;
  /** ISO. Absent until the first review. */
  last?: string;
  reps: number;
  lapses: number;
  /** The last grade given, so the UI can say what you did last time. */
  lastRating?: Rating;
};

/** A slide that has never been studied is due the moment it exists. */
export function newMemory(now: Date = new Date()): Memory {
  return {
    state: "learning",
    step: 0,
    stability: null,
    difficulty: null,
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
  };
}

const clampD = (d: number) => Math.min(Math.max(d, MIN_DIFFICULTY), MAX_DIFFICULTY);
const clampS = (s: number) => Math.max(s, MIN_STABILITY);

export const initialStability = (g: Rating) => clampS(DEFAULT_W[g - 1]!);

export function initialDifficulty(g: Rating, clamp = true): number {
  const d = DEFAULT_W[4] - Math.exp(DEFAULT_W[5] * (g - 1)) + 1;
  return clamp ? clampD(d) : d;
}

/**
 * How likely you are to recall it right now.
 *
 * The forgetting curve: R = (1 + FACTOR * t/S) ^ DECAY, a power law rather
 * than the exponential the older SM-2 family assumed. At t = S it is 0.9 by
 * construction, which is what FACTOR is solving for.
 */
export function retrievability(m: Memory, now: Date = new Date()): number {
  if (m.stability == null || !m.last) return 0;
  const elapsedDays = Math.max(0, (now.getTime() - new Date(m.last).getTime()) / DAY);
  return Math.pow(1 + (FACTOR * elapsedDays) / m.stability, DECAY);
}

/** Days until recall probability falls to DESIRED_RETENTION. At least one. */
export function intervalDays(stability: number): number {
  const days = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return Math.min(Math.max(Math.round(days), 1), MAX_INTERVAL_DAYS);
}

/**
 * Difficulty after a grade.
 *
 * Two things happen. The grade pushes difficulty around, damped so that an
 * already-hard slide moves less than an easy one. Then the result is pulled
 * back towards where an `Easy` first answer would have put it, which is what
 * stops a run of bad days from pinning a slide at 10 forever.
 */
export function nextDifficulty(d: number, g: Rating): number {
  const arg1 = initialDifficulty(EASY, false);
  const deltaD = -(DEFAULT_W[6] * (g - 3));
  const damped = d + ((10.0 - d) * deltaD) / 9.0;
  return clampD(DEFAULT_W[7] * arg1 + (1 - DEFAULT_W[7]) * damped);
}

/**
 * Stability for a second look on the same day.
 *
 * Reviewing something twice in an afternoon does not multiply how long you
 * will keep it, and this is the term that says so. Below Good it can even go
 * down; at Good and above it is clamped so a same-day pass never costs you.
 */
export function shortTermStability(s: number, g: Rating): number {
  let inc = Math.exp(DEFAULT_W[17] * (g - 3 + DEFAULT_W[18])) * Math.pow(s, -DEFAULT_W[19]);
  if (g >= HARD) inc = Math.max(inc, 1.0);
  return clampS(s * inc);
}

/**
 * Stability after you blanked on it.
 *
 * Note this is not zero. Having known it once and forgotten it leaves you
 * better off than never having known it, and how much better depends on how
 * long you had held it - which is the `(S+1)^w13` term - and on how overdue
 * it already was when you failed.
 */
export function forgetStability(d: number, s: number, r: number): number {
  const longTerm =
    DEFAULT_W[11] *
    Math.pow(d, -DEFAULT_W[12]) *
    (Math.pow(s + 1, DEFAULT_W[13]) - 1) *
    Math.exp((1 - r) * DEFAULT_W[14]);
  const shortTerm = s / Math.exp(DEFAULT_W[17] * DEFAULT_W[18]);
  return Math.min(longTerm, shortTerm);
}

/**
 * Stability after you got it.
 *
 * The `(1 - r)` term is the one worth understanding: the gain is largest when
 * retrievability was LOW, meaning you only just managed it. Recalling
 * something you were about to forget is what makes it stick, which is
 * Bjork's desirable difficulty written as arithmetic.
 */
export function recallStability(d: number, s: number, r: number, g: Rating): number {
  const hardPenalty = g === HARD ? DEFAULT_W[15] : 1;
  const easyBonus = g === EASY ? DEFAULT_W[16] : 1;
  return (
    s *
    (1 +
      Math.exp(DEFAULT_W[8]) *
        (11 - d) *
        Math.pow(s, -DEFAULT_W[9]) *
        (Math.exp((1 - r) * DEFAULT_W[10]) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function nextStability(d: number, s: number, r: number, g: Rating): number {
  return clampS(g === AGAIN ? forgetStability(d, s, r) : recallStability(d, s, r, g));
}

/**
 * Grade one slide and say when it comes back.
 *
 * Returns a NEW memory; the caller decides whether to keep it. The shape of
 * the state machine is Anki's: a slide climbs the learning steps, graduates
 * to day-scale intervals, and drops into relearning when you blank on it.
 */
export function grade(m: Memory, rating: Rating, now: Date = new Date()): Memory {
  const next: Memory = { ...m, reps: m.reps + 1, lastRating: rating };
  const sinceDays = m.last ? (now.getTime() - new Date(m.last).getTime()) / DAY : null;
  const sameDay = sinceDays !== null && sinceDays < 1;

  const advance = () => {
    if (next.stability == null || next.difficulty == null) return;
    if (sameDay) {
      next.stability = shortTermStability(next.stability, rating);
    } else {
      next.stability = nextStability(
        next.difficulty,
        next.stability,
        retrievability(m, now),
        rating,
      );
    }
    next.difficulty = nextDifficulty(next.difficulty, rating);
  };

  let waitMs: number;

  if (m.state === "learning" || m.state === "relearning") {
    const steps = m.state === "learning" ? LEARNING_STEPS_MIN : RELEARNING_STEPS_MIN;

    if (next.stability == null || next.difficulty == null) {
      next.stability = initialStability(rating);
      next.difficulty = initialDifficulty(rating);
    } else {
      advance();
    }

    const step = m.step ?? 0;
    if (rating === AGAIN) {
      next.step = 0;
      waitMs = steps[0]! * MIN;
      if (m.state === "relearning") next.lapses = m.lapses + 1;
    } else if (rating === HARD) {
      next.step = step;
      // Anki's rule for holding position: with one step, wait half again as
      // long; with two, split the difference between them.
      waitMs =
        steps.length === 1
          ? steps[0]! * 1.5 * MIN
          : step === 0
            ? ((steps[0]! + steps[1]!) / 2) * MIN
            : steps[Math.min(step, steps.length - 1)]! * MIN;
    } else if (rating === GOOD && step + 1 < steps.length) {
      next.step = step + 1;
      waitMs = steps[step + 1]! * MIN;
    } else {
      // Graduated: either Good on the last step, or Easy from anywhere.
      next.state = "review";
      next.step = null;
      waitMs = intervalDays(next.stability!) * DAY;
    }
  } else {
    advance();
    if (rating === AGAIN) {
      next.state = "relearning";
      next.step = 0;
      next.lapses = m.lapses + 1;
      waitMs = RELEARNING_STEPS_MIN[0]! * MIN;
    } else {
      waitMs = intervalDays(next.stability!) * DAY;
    }
  }

  next.last = now.toISOString();
  next.due = new Date(now.getTime() + waitMs).toISOString();
  return next;
}

/**
 * What each button will cost you, before you press it.
 *
 * Shown on the grade buttons. Someone who can see that `Good` means eight
 * days and `Hard` means two is being told what the model believes about them,
 * which is the only part of this that is worth surfacing.
 */
export function preview(m: Memory, now: Date = new Date()): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const r of RATINGS) {
    out[r] = new Date(grade(m, r, now).due).getTime() - now.getTime();
  }
  return out;
}

export const isDue = (m: Memory, now: Date = new Date()): boolean =>
  new Date(m.due).getTime() <= now.getTime();

/** Overdue first, then longest-waiting. The slide you are least likely to still know. */
export function dueOrder<T extends { memory: Memory }>(items: T[], now: Date = new Date()): T[] {
  return items
    .filter((i) => isDue(i.memory, now))
    .sort((a, b) => new Date(a.memory.due).getTime() - new Date(b.memory.due).getTime());
}

/** "in 3 days", "in 12 min", "now". For the grade buttons and the deck cards. */
export function human(ms: number): string {
  if (ms <= 0) return "now";
  const min = ms / MIN;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)} hr`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d`;
  const months = days / 30.4;
  if (months < 12) return `${Math.round(months)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}
