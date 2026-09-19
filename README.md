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

```bash
npm install
./bin/feynman-slides      # http://127.0.0.1:4317
```

No API key needed to start. It hooks into your local `claude` CLI login through the Agent SDK, and falls back to a built-in heuristic critic when offline or rate-limited.

## How it works

### 1. Fast, content-first writing
- Press `T` and click anywhere: the text box drops exactly where your cursor is.
- Press `Tab` / `Shift+Tab` to indent or outdent nested bullets up to 4 levels (`•`, `◦`, `▪`, `–`).
- Press `Enter` on any bullet to continue with identical indentation, or press `Enter` on an empty bullet to back out.
- Re-lay the current slide with `⇧L` anytime without touching your copy.

### 2. The critic
The critic fires twice: **when you pause** for two seconds while typing, and **when you finish** editing a box. The pause is advisory. Finishing is the firm pass.

| Severity | What it means | Blocks export? |
| :--- | :--- | :--- |
| `error` | Factually incorrect, or contradicts source material | Yes |
| `jargon` | A buzzword used in place of an explanation | Yes |
| `note` | Structural advice, length, or clarity suggestion | No |

Jargon blocks on purpose. "Collisions are handled by the collision resolution strategy" is not an explanation - it is a word pointing at itself.

If the critic is mistaken, reject the finding. It asks for one sentence explaining why, stores your reasoning, and never flags it again.

### 3. Source bin
Drop lecture PDFs or notes into the bin under the canvas. It belongs to the whole deck, not one slide. When you upload a slide deck from a professor, pages are split and tagged (e.g. `lecture-04 p12`), so the critic can point to the exact slide that contradicts you.

### 4. Feynman clarity score
Every slide gets a live 0-100 clarity score in the rail:
- **Brevity & Focus (30 pts)**: Targets 15-45 words. Penalizes dense walls of text.
- **Plain English (30 pts)**: Checks for ungrounded jargon and deductions from critic findings.
- **Structure (20 pts)**: Clear title anchor and visual hierarchy.
- **Source Grounding (20 pts)**: Verifies concept overlap with your lecture bin.

Click any score pill for the breakdown and actionable tips. Toggle **Rank** in the rail header to sort slides weakest-first so you know what to fix before exam day.

### 5. Anki active-recall study mode
Hit `P` to present. Toggle Study mode with `S`:
- Answer cards are concealed under active-recall blur until you press `Space`.
- Self-grade with `1` (Tricky) or `2` (Good) to track weak spots.

### 6. Folders & organization
Organize decks by class or semester:
- Drag and drop deck cards onto folder chips or folder sections.
- Move or rename decks via the card menu.
- Filter decks with instant live search.

### 7. Visual template creator & community stylesheets
Open **Stylesheets** to pick community themes or design your own:
- 1-click curated palette presets (Clean Light, Anki Dark, Cornell Cream, Chalkboard, Modern Pitch, Swiss Bauhaus, Nordic Minimal).
- Multi-slide live preview switcher (Bullet Concept, Title Slide, Stat Callout).
- 1-click publish to the community registry or download as standalone JSON.

### 8. Export
- **16:9 PDF**: Exact `@page` sizing (960&times;540 px) for borderless, vector-crisp PDF slides.
- **Standalone HTML**: Single offline `.html` file with embedded images.
- Unresolved blocking findings prevent export by design.

## Keys

Everything worth doing has a keyboard shortcut. Press `?` anytime for the full cheatsheet:

| Key | Action |
| :--- | :--- |
| `N` | New slide |
| `J` / `K` | Next / previous slide |
| `T` | New text box (drops at cursor) |
| `I` | Insert image (or paste directly) |
| `Tab` / `⇧Tab` | Indent / outdent nested bullets (in text) or cycle elements |
| `Enter` | Edit selection / continue bullet |
| `Esc` | Deselect or exit text box |
| `1` / `2` | Title / Normal text role |
| `⇧L` | Re-lay current slide |
| `P` | Present deck (`S` for study mode) |
| `S` / `U` | Open source bin / upload lecture slides |
| `E` | Export modal (PDF / HTML) |
| `H` | Return to all decks |
| `\` | Cycle theme (system, light, dark) |
| `⌘Z` | Undo |

## Where things live

```
~/.feynman-slides/
  decks/<slug>/
    deck.json        slides, elements, and source bin
    critiques.json   open findings and rejected reasons
    images/          pasted and uploaded figures
    deck.html        exported standalone presentation
  templates/         installed custom stylesheets
  folders.json       class folder hierarchy
```

## Hosting

Hosted with Cloudflare Tunnel + Linux PC (`slim`).

Live @ [feyn.ryhub.dev](https://feyn.ryhub.dev/)
