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

**Upload the deck your professor handed you.** Drop a PDF on the bin, or use
*Upload lecture slides*, and each page becomes one entry labelled with where it
came from - `lecture-04 p12`. The critic is shown those labels, so a finding
can tell you *which* slide of the lecture contradicts you rather than only that
something does.

The text is pulled out in the browser, so the file never leaves your machine
and there is no build step for it. A scanned PDF has no text to pull, and says
so instead of filling the bin with blank pages. An image dropped on the bin
goes onto the slide instead: nothing here does OCR, so a picture in the bin
would look like source material while contributing nothing.

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

## Light and dark

The theme button cycles **system, light, dark** and remembers which. System is
the default and a real third state, not a fallback. The slide itself stays
white in every theme - it is paper, and it is what you will export.

## Keys

Everything worth doing has a key, and the toolbar is the discoverable copy of
that rather than the other way round: reaching for the mouse is paid for in
attention you were spending on whether the slide is true.

Press `?` for the list. It is generated from the same table that dispatches
the keys, and the buttons take their tooltips from it too, so a shortcut
cannot come loose from the label advertising it.

| | |
|---|---|
| `N` | new slide |
| `J` `K` | next, previous slide - arrows do this too when nothing is selected |
| `T` | new text box |
| `I` | insert image (or just paste one) |
| `Tab` | select the next element, `shift` for the previous |
| `Enter` | edit the selection, double-click does the same |
| `Esc` | back to the slide from any field, again to deselect |
| arrows | nudge the selection, `shift` for ten |
| `1` `2` | Title, Normal |
| `⌘D` | duplicate |
| `Bksp` | delete the selection, `⌘Bksp` deletes the slide |
| `S` `U` | open the bin, upload lecture slides |
| `E` | export |
| `\` | theme: system, light, dark |
| `⌘Z` | undo |

Single letters act, unmodified, and that is safe for one reason: you are never
typing unless you asked to be. A text box takes keystrokes only after `Enter`
or a double-click, and `Esc` is always the way back out of a field.

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
