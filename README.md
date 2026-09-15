# feynman-slides

Slides you are not allowed to get wrong.

You write slides to teach yourself a topic. A critic reads each slide as you
write it and stops you when the slide says something false, or names a thing
where it should explain a mechanism. Until you deal with what it found, the
deck does not export.

The bet is that the moment worth catching is while you are writing the slide,
not after. A slide that looks finished and is subtly wrong is the worst thing
this could produce, because you will study from it.

## Run it

```
npm install
./bin/feynman-slides      # http://127.0.0.1:4317
```

No API key. It reuses your `claude` CLI login through the Agent SDK.

## The loop

Build slides on a canvas: text boxes and images placed, dragged and resized
wherever you want them. A text box is a **Title** or it is **Normal** - that is
the whole typography system, because every knob offered while you are writing a
slide is a decision you make instead of thinking about whether the slide is
true.

The critic fires twice: **when you pause** for two seconds while typing, and
**when you finish** with a text box. The pause is advisory - a half-typed
bullet is not a finding. Finishing is the firm pass.

### The source bin

Drop your lecture slides, passages and definitions into the bin under the
canvas. It belongs to the **whole deck**, not to one slide: source material
does not divide neatly, and the definition you pasted while writing slide 2 is
exactly what the critic needs on slide 9. Every slide is checked against all of
it.

Leave the bin empty and the critic falls back on its own knowledge, labelling
every finding `knowledge` so you can tell when it is arguing with your
professor's notation rather than with you.

## The three severities

| | what it means | blocks export |
|---|---|---|
| `error` | factually wrong, or the source says otherwise | yes |
| `jargon` | a term used in the *place* of a mechanism | yes |
| `note` | ordering, length, a slide holding two concepts | no |

Jargon blocks on purpose. "Collisions are handled by the collision resolution
strategy" is not a slide, it is a word pointing at itself - and it is the
failure that feels most like understanding while you are writing it. The test
is not whether the word is technical. It is whether deleting the word removes
the only explanation on the slide.

## Rejecting a finding

The critic is sometimes wrong, particularly with no source material. You can
reject any finding, but it costs you a sentence saying why. That reason is
stored, fed back into the session so it is never raised again, and survives a
restart.

A one-click dismiss would not be a forcing function. Writing down why a
correction is wrong is the same exercise the deck is for.

## Keys

`T` new text box · double-click to edit · `Enter` edit the selection · arrows
nudge, `shift` for ten · `backspace` delete · `cmd+Z` undo · paste an image
straight onto the slide.

## Export

One self-contained HTML file next to your slides, images inlined. No accounts,
no OAuth, opens offline, and it presents: arrow keys, click, print to PDF.
Refused while anything blocking is open - enforced in the export path, not by a
disabled button.

## Where things live

```
~/.feynman-slides/decks/<slug>/
  deck.json        slides, elements, and the source bin - the source of truth
  critiques.json   open findings and your rejections - disposable
  images/          what you pasted in
  deck.html        the export
```

## Not in scope

No teaching aloud, no voice, no spaced repetition. This ends when the deck is
accurate. The rest is [feynman](../feynman).
