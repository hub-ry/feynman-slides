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

Write markdown in the left pane. Slides are `##` headings, bullets are the
body, a `>` blockquote is source material.

```markdown
# Data Structures

## Hash tables
- The key is turned into a number, and that number is reduced to an index

> Paste your lecture slide or textbook passage here.
```

The critic fires twice: **when you pause** for two seconds inside a slide, and
**when you leave** that slide for another. The pause is advisory - a half-typed
bullet is not a finding. Leaving is the firm pass.

Paste source material and the critic checks you against it. Leave it out and it
falls back on its own knowledge and labels every finding `knowledge`, so you
know when it is arguing with your professor's notation rather than with you.

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

## Export

One self-contained HTML file next to your outline. No accounts, no OAuth, opens
offline. Refused while anything blocking is open - enforced in the export path,
not by a disabled button.

## Where things live

```
~/.feynman-slides/decks/<slug>/
  outline.md       the source of truth, editable in any editor
  critiques.json   open findings and your rejections - disposable
  deck.html        the export
```

## Not in scope

No teaching aloud, no voice, no spaced repetition. This ends when the deck is
accurate. The rest is [feynman](../feynman).
