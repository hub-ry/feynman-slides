# What the evidence says, and what it changed here

This is the reading behind the design of feynman-slides. It exists because
"the critic feels bad" is not something you can fix by rewording a prompt, and
because a tool that claims a cognitive-science pedigree should be able to say
which papers it is claiming.

Every section ends with **What changed**, naming the code. Where the evidence
is thin, it says so. Where the product was already doing the right thing for
the wrong reason, it says that too.

---

## 1. The Feynman technique is a bundle, and we were only shipping half of it

Feynman's own account is a notebook and a habit, not a method with steps. The
four-step version that circulates online (write the concept, explain it to
someone who does not know it, find the gaps and go back to the source,
simplify and use an analogy) is a later reconstruction. Direct empirical work
on "the Feynman technique" as a named package is small: a quasi-experimental
study across grades 4, 7 and 11 reported higher post-test gains for the
experimental group ([Reyes et al.,
2022](https://rmrj.usjr.edu.ph/rmrj/index.php/RMRJ/article/download/958/243/5090)),
and a 14-participant, three-day trial of an LLM "Feynman Bot" found better
outcomes than passive study ([arXiv
2506.09055](https://arxiv.org/abs/2506.09055)). Neither is strong on its own.
Fourteen people over three days is a pilot.

The technique's credibility does not rest there. It rests on the four
well-studied things it happens to bundle:

| Component | Evidence | Effect |
| --- | --- | --- |
| Self-explanation | [Bisra et al., 2018](https://link.springer.com/article/10.1007/s10648-018-9434-x), 69 effect sizes | g = 0.55 |
| Learning by teaching | [Kobayashi, 2019](https://onlinelibrary.wiley.com/doi/10.1111/jpr.12221) | g = 0.48, **conditional** |
| Elaborative interrogation | [Dunlosky et al., 2013](https://journals.sagepub.com/doi/abs/10.1177/1529100612453266) | d = 0.85–2.57 |
| Retrieval practice | [Roediger & Karpicke, 2006](https://journals.sagepub.com/doi/10.1111/j.1745-6916.2006.00012.x) | 61% vs 40% at one week |

Before this round of work the editor covered self-explanation (you write the
slide) and a fragment of gap-finding (the critic objects). It covered none of
the other three. The gap was not in the quality of the critic's prose. It was
that three quarters of the method had no representation in the product at all.

**What changed:** the rest of this document.

---

## 2. The grade was the wrong shape of feedback

This is the finding that most directly explains "I'm not happy with the
feedback."

Kluger and DeNisi's meta-analysis of 607 effect sizes remains the most
uncomfortable result in the feedback literature: **over a third of feedback
interventions made performance worse**, not better ([Kluger & DeNisi,
1996](https://www.mrbartonmaths.com/resourcesnew/8.%20Research/Marking%20and%20Feedback/The%20effects%20of%20feedback%20interventions.pdf)).
The moderator they identified is where the feedback points attention. Feedback
about the *task* helps. Feedback that moves attention to the *self* competes
with the task for the same attentional resources, and frequently loses.

A letter grade is the purest form of self-directed feedback available. The
score pane was rendering `D`, `Needs rework`, and `A+ · Masterful Feynman
clarity` over a slide someone had written thirty seconds earlier. That is a
verdict on a person, delivered in the exact moment they are still deciding
whether the idea is worth keeping.

It was also, separately, a bad measurement. Grades imply an interval scale and
a defensible cut point. There is no evidence that a slide scoring 79 is
meaningfully different from one scoring 81, and the code was picking `A` vs
`B` on exactly that boundary.

**What changed:** `public/score.js`. The letter grades and the tier adjectives
are gone. The dimensions survive, because the underlying measurements were
mostly fine, but they are now presented as a checklist of what the slide is
missing rather than a mark out of 100. The rail shows how many Feynman steps a
slide has cleared, not how good it is.

---

## 3. Source grounding was rewarding the copy-paste

The old fourth dimension gave 20 points out of 100 for vocabulary overlap
between the slide and the source bin. More shared words, more points.

This inverts the technique. The operative move in step 2 is restating the idea
in words that are not the source's words. Verbatim overlap with the lecture is
the *signature of the failure mode*, not evidence of grounding. A slide that
was a straight paste of a lecture bullet scored 20/20 on grounding and, since
the professor did not write buzzwords, was likely to score near full marks on
plain language too. The two dimensions that were supposed to catch
not-understanding were both rewarding it.

The expert blind spot literature says why the copied version feels finished.
Experts compress procedures into single retrievable chunks and then explain
the chunk as one unit ([curse of
knowledge](https://en.wikipedia.org/wiki/Curse_of_knowledge), Camerer,
Loewenstein & Weber, 1989). Your professor's bullet is a chunk label. Pasting
it moves the label without unpacking it.

**What changed:** grounding is now measured as two numbers pulling in opposite
directions. Concept coverage (did you touch what the source covers) still
counts for you. A long verbatim run shared with a bin entry now counts
against, and names the source it came from.

---

## 4. Learning by teaching only works if there is someone to teach

Kobayashi's meta-analysis carries a result that is easy to miss and hard to
design around once you have seen it: teaching after studying **without**
teaching expectancy did not differ significantly from zero. With expectancy
in place, g = 0.48 ([Kobayashi,
2019](https://onlinelibrary.wiley.com/doi/10.1111/jpr.12221)). The benefit is
not in the act of explaining. It is in having studied while knowing you would
have to explain, to somebody, whose prior knowledge you had in mind.

A deck had a title and no reader. So the critic's central judgement, whether a
term stands in for a mechanism, was being made against an imaginary audience
that the critic invented fresh on every slide. That is also why its jargon
calls felt arbitrary: "quorum" genuinely is an explanation if your reader is a
distributed systems PhD, and genuinely is not if your reader is you, six weeks
before the exam, having forgotten the lecture.

**What changed:** decks carry an `audience` line. It is one sentence, it
defaults to a sensible stand-in, and it goes into the critic's prompt so that
"would deleting this word remove the only explanation here" is asked about a
specific named reader.

---

## 5. Retrieval practice and spacing are the two biggest wins, and neither existed

Dunlosky and colleagues rated ten study techniques for utility. Exactly two
got a **high** rating: practice testing and distributed practice ([Dunlosky et
al., 2013](https://journals.sagepub.com/doi/abs/10.1177/1529100612453266)).
Self-explanation, elaborative interrogation and interleaving all landed at
moderate. Rereading and highlighting, which is what most people actually do,
landed at low.

The canonical demonstration: students who reread a text four times beat
students who read once and recalled three times when tested five minutes
later, 83% to 71%. One week later it reversed hard, 40% to 61% ([Roediger &
Karpicke, 2006](https://journals.sagepub.com/doi/10.1111/j.1745-6916.2006.00012.x)).
This is Bjork's desirable difficulties in one experiment: the condition that
felt worse during study produced the durable memory, and the learners could
not tell.

Study mode existed. It blurred the body text, you pressed Space, and you
pressed 1 or 2 to say how it went. Then the grades went nowhere. Both buttons
called `move(1)`. Closing the presenter discarded everything. So the app had
retrieval practice with the retrieval made optional (a blur you reveal is
recognition, not recall) and distributed practice with no distribution at all.

The scheduler is FSRS-6, the algorithm Anki ships. It models memory as
difficulty, stability and retrievability rather than one ease multiplier, and
its published defaults were fit on hundreds of millions of reviews; the
benchmark claim is 20–30% fewer reviews for equal retention
([open-spaced-repetition](https://github.com/open-spaced-repetition/py-fsrs)).
We use the published default weights and do not attempt per-user optimisation,
which needs a review history nobody has on day one.

**What changed:** `src/recall.ts` (FSRS-6 with the published defaults, ported
from `py-fsrs` and unit-tested against it), `public/recall.js`, a `recall.json`
per deck, and due counts on the deck cards. Study mode now asks you to type
the explanation before it shows you the slide, because a blur you reveal is
recognition and typing it is retrieval.

---

## 6. Generating the question beats being handed it

If the app is going to test you on your slides, who writes the question
matters. Learners who make their own flashcards outperform learners given
premade ones, d = 0.45 on memory and d = 0.29 on application
([Pan et al., 2022](https://sc-pan.github.io/pdf/PZIZQ_2022.pdf)). Constructing
concept maps beats studying prepared ones, g = 0.72 against g = 0.43
([Nesbit & Adesope, 2006](https://www.sfu.ca/~jcnesbit/research/NesbitAdesope2006.pdf)).

There is an honest caveat in the flashcard study: the self-generation groups
also spent about 24 minutes studying against 15. Part of that advantage is
just more time on task.

The convenient thing is that this product gets generation for free. You wrote
the slide. Its heading is the prompt and its body is the answer, both in your
own words. No card authoring step, no import, nothing to maintain. That is the
strongest structural argument the product has and it was not being used.

**What changed:** recall prompts are derived from the slide you wrote. The app
never generates the card for you.

---

## 7. AI feedback can quietly replace the thinking it was meant to provoke

Fan et al. ran 117 university students on a writing task with four kinds of
support. The ChatGPT group improved their essay scores most. Their knowledge
gain and transfer **did not differ** from the other groups. The authors call
it metacognitive laziness: the tool absorbed the regulation the learner was
supposed to be doing ([Fan et al., 2025,
BJET](https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13544)).

That is precisely the failure mode available to a critic that writes slides.
The existing `CONTRACT` already forbade it, in these words: *"fix_hint points
at what to go find out. Never write the corrected bullet for them."* That
instinct was right and now has a citation behind it. Keep it. Do not soften it
when the critic feels annoying, because the annoying version is the one that
works.

Buçinca et al. go further. Explanations alone increase reliance on wrong AI
suggestions; **cognitive forcing functions**, which make the person commit to
a position before the AI's answer is visible, measurably reduce overreliance.
The sting is in their secondary result: participants rated the designs that
helped them most as the ones they liked least ([Buçinca, Malaya & Gajos, CHI
2021](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca21trust.pdf)).

So "I don't like the feedback" is genuinely ambiguous evidence. It is what you
would expect both from a badly designed critic and from a well designed one.
The way to tell them apart is not the feeling, it is whether the objection is
locatable and whether acting on it sends you to the source. That is what the
dispute hatch is for and why it demands a sentence.

**What changed:** the dispute hatch stays as it is. The commit-before-reveal
pattern is used in recall (you type first, then see the slide), which is where
it costs least and buys most.

---

## 8. Not every finding should be a defect

Elaborative interrogation means prompting for the causal "why" behind a stated
fact. Dunlosky's review puts it at d = 0.85 to 2.57, among the largest effects
in the set, and notes the effect is larger when the elaboration is
self-generated rather than supplied.

Every one of the critic's three severities reported a defect. `error` says you
are wrong, `jargon` says you are hiding, `note` says your slide is untidy.
There was no move for the most productive thing a reader can do to a correct
slide, which is ask why it is true.

This also fixes a tonal problem that no amount of rewriting fixes. A critic
whose only register is objection reads as hostile at any politeness level,
because objection is all it structurally can do.

**What changed:** a fourth kind, `probe`. It asks one question. It never
blocks. At most one per slide, and only on a slide with no open blocking
findings, because asking someone to go deeper on a slide that is still wrong
is noise.

---

## 9. Where the feedback should land in time

Two constraints point in the same direction.

Shute's review of formative feedback finds immediate feedback suits procedural
error correction while delayed feedback does better for transfer and for
complex tasks, partly because immediate feedback interrupts the metacognitive
work ([Shute, 2008](https://onlinelibrary.wiley.com/doi/10.3102/0034654307313795)).
More recent work finds the two often tie ([Ellis et al.,
2023](https://pubmed.ncbi.nlm.nih.gov/38017648/)).

The interruption literature is more decisive about *when* within a task.
Interruptions delivered at subtask boundaries cost less in resumption lag,
frustration and error than interruptions delivered mid-subtask, and coarser
boundaries cost less still ([Iqbal & Bailey, CHI
2008](https://interruptions.net/literature/Iqbal-CHI08.pdf)).

The two-second typing pause is mid-subtask by construction. It fires while
your hands are on the keys and the sentence is half-formed. Leaving a text box
is a real boundary.

**What changed:** nothing structural, because the existing split (pause is
advisory, leaving the box is the firm pass) already matches the evidence. It
is now written down so nobody "improves" it later by making the pause firm.

---

## 10. The lineage, briefly

Worth knowing which ideas here are seventy years old.

Skinner's teaching machines (1954) established small steps, self-pacing and
immediate feedback. PLATO (Bitzer, 1960) put that on a screen and grew forums,
chat and multiplayer games as side effects. Bloom's 2-sigma paper (1984)
set the target that everything since has been chasing: one-to-one mastery
tutoring at two standard deviations over classroom instruction, and the
question of how to get there without one tutor per student.

The honest update is that 2 sigma does not replicate at that size. VanLehn's
meta-analysis puts human tutoring at d = 0.79 and, more usefully, finds
step-based computer tutoring at d = 0.76, close enough that the interesting
variable is not human versus machine ([VanLehn,
2011](https://www.tandfonline.com/doi/abs/10.1080/00461520.2011.611369)). The
variable is **granularity**. Systems that engage at the level of each step of
reasoning work; systems that only mark the final answer (d = 0.40) mostly do
not.

That is a direct argument for reviewing each slide as it is written rather
than grading the finished deck, and it is the strongest available defence of
the product's core bet.

Collins, Brown and Newman's cognitive apprenticeship (1989) names the sequence
this app is missing the end of: model, coach, scaffold, **fade**. Nothing here
fades. The critic is as loud on your fortieth deck as your first.

Matuschak and Nielsen's mnemonic medium is the closest living relative
([numinous.productions/ttft](https://numinous.productions/ttft/)). Quantum
Country embeds spaced repetition into prose the reader did not write. This is
the mirror image: the reader writes the prose, so the cards are already in
their own words, which is the part Quantum Country has to solve with expert
authoring.

---

## Deliberately not built

**Interleaving across decks.** Well supported, and a real candidate. Left out
because interleaving works on *related* material and the folder structure does
not currently say which decks are related.

**Per-user FSRS optimisation.** Needs roughly a thousand reviews before the
fit beats the defaults. Published defaults until then.

**LLM-scored teachback.** Tempting, and the rubric-grading literature is mixed
enough to wait: fine-grained checklist rubrics get reasonable human agreement,
holistic ones do not, and at least one 2025 study found no significant
agreement on authentic coursework ([Applied Sciences,
2026](https://www.mdpi.com/2076-3417/16/12/5902)). Self-grading after seeing
the slide is worse in theory and honest about its own reliability.

**Fading the critic.** Cognitive apprenticeship says it should fade. We do not
know what to fade on. Noted so it does not get lost.
