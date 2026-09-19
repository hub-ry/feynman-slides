# feynman-slides

Casual Projects build!

You write slides to teach yourself a topic. A critic reads each slide as you write it and stops you when the slide says something false, or names a concept where it should explain a mechanism. Until you deal with what it found, the deck will not export.

The bet is that the moment worth catching is while you are writing the slide, not after. A slide that looks finished and is subtly wrong is the worst thing this could produce, because you end up studying from it.

### The Loop
1. Drop lecture slides or raw notes into the source bin.
2. Build your deck slide by slide. Press `T` to drop text anywhere and use nested bullets to break down concepts.
3. The critic flags errors and buzzwords. Fix them, or push back with your reasoning.
4. Check your live 0-100 Feynman score. Sort weakest-first to see what needs work.
5. Hit `P` to present, or `S` for Anki-style active recall.
6. Export crisp 16:9 PDFs once every blocking finding is cleared.

### Quickstart

```bash
npm install
./bin/feynman-slides      # runs on http://localhost:4317
```

No API key needed to start. It hooks into your local `claude` CLI login through the Agent SDK, and falls back to a built-in heuristic critic when offline or rate-limited.

### The Critic and Blocking
The critic runs checks at two points: when you pause for two seconds while typing, and when you finish editing a box. The pause is advisory. Finishing is the firm pass.

| Severity | What it means | Blocks export? |
| :--- | :--- | :--- |
| `error` | Factually incorrect, or contradicts source material | Yes |
| `jargon` | A buzzword used in place of an explanation | Yes |
| `note` | Structural advice, length, or clarity suggestion | No |

Jargon blocks on purpose. "Collisions are handled by the collision resolution strategy" is not an explanation - it is a word pointing at itself. If you write "Paxos ensures consensus through quorums," the critic will ask what a quorum actually is and what happens if one node drops out.

If the critic is wrong, reject the finding. It asks for one sentence explaining why, stores your reasoning, and never flags that exact issue again.

### Fast Writing
Slide decks usually get bogged down in drag-handles and alignment bars. Here:
- Press `T` and click anywhere: the text box drops right at your cursor.
- Press `Tab` and `Shift+Tab` to indent or outdent nested bullets up to 4 levels (`•`, `◦`, `▪`, `-`).
- Press `Enter` on any bullet to continue with identical indentation, or press `Enter` on an empty bullet to back out cleanly.
- Hit `⇧L` anytime to cycle and re-lay the slide layout without touching your text.

### Clarity Score and Ranking
A live 0-100 score sits in the left rail for each slide:
- Brevity & Focus (30 pts): targets 15-45 words; penalizes dense walls of text.
- Plain English (30 pts): checks for ungrounded buzzwords and deductions from open critic findings.
- Structure (20 pts): rewards a clear title anchor and visual hierarchy.
- Source Grounding (20 pts): measures concept overlap with material in your lecture bin.

Click any score pill to see the full breakdown and tips. Toggle **Rank** in the rail header to sort slides weakest-first so you know what to revise before an exam.

### Source Bin Grounding
Drop lecture PDFs or markdown notes into the bin under the canvas. It belongs to the whole deck, not just one slide. When you upload a 60-page deck from class, pages are split and tagged (like `lecture-04 p12`). The critic reads through them and cites the exact slide if you contradict your source.

### Anki Active-Recall Study Mode
Hit `P` to present fullscreen. Press `S` to toggle Study mode:
- Answer cards and body bullets are hidden under an active-recall blur until you tap `Space`.
- Self-grade with `1` (Tricky) or `2` (Good) to track weak spots as you rehearse.

### Folders and Organization
Organize decks by class or semester:
- Drag and drop deck cards directly onto folder chips or sections.
- Move or rename decks anytime from the card menu.
- Instant search filters across your entire deck library as you type.

### Template Studio and Stylesheets
Press `M` to open the Stylesheet Studio:
- Built-in palette presets: Clean Light, Anki Dark, Cornell Cream, Chalkboard, Modern Pitch, Swiss Bauhaus, and Nordic Minimal.
- Live multi-slide preview switcher: see how your theme looks on concept bullets, title slides, and stat callouts before applying.
- 1-click publish to the community registry or download standalone theme JSON.
- Vector iconography throughout powered by Phosphor Icons.

### Export
- **16:9 PDF**: Borderless, vector-crisp slides sized to exact `@page` print dimensions (960x540 px).
- **Standalone HTML**: Single self-contained `.html` file with embedded images for offline sharing.
- Unresolved blocking findings prevent export by design. You have to fix the gap or write down why the critic is wrong.

### Keys
Everything worth doing has a shortcut. Press `?` in the app for the cheatsheet:

| Key | Action | Context |
| :--- | :--- | :--- |
| `N` | New slide (same layout) | Deck |
| `L` | Layout picker | Slide |
| `⇧L` | Re-lay current slide | Slide |
| `J` / `↓` | Next slide | Deck |
| `K` / `↑` | Previous slide | Deck |
| `⌘⇧D` | Duplicate current slide | Slide |
| `⌘Bksp` | Delete current slide | Slide |
| `T` | New text box (drops at click) | Slide |
| `I` | Insert image (or paste directly) | Slide |
| `R` | New rectangle shape | Slide |
| `Tab` / `⇧Tab` | Indent / outdent bullets, or cycle elements | Editor |
| `Enter` | Edit selection / continue bullet | Editor |
| `Esc` | Stop editing / deselect | Editor |
| `⌘A` | Select all elements | Slide |
| `⌘D` | Duplicate selected element | Slide |
| `Bksp` / `Delete` | Delete selected element | Slide |
| `← ↑ ↓ →` | Nudge selection (hold `Shift` for 10px) / step slides | Slide |
| `]` / `[` | Bring forward / send backward | Slide |
| `1` / `2` / `3` | Switch text role (Title, Body, Detail) | Text |
| `⌘B` | Bold | Text |
| `⌘I` | Italic | Text |
| `⌘E` | Inline code | Text |
| `⌘H` | Highlight | Text |
| `⌘⇧8` | Toggle bullets | Text |
| `S` | Open or close source bin / toggle study mode | App / Presenter |
| `U` | Upload lecture slides | App |
| `C` | Show or hide critic | App |
| `M` | Stylesheets & template studio | App |
| `P` | Present deck | App |
| `Space` | Reveal blurred card | Study Mode |
| `1` / `2` | Grade slide: Tricky / Good | Study Mode |
| `E` | Export modal (PDF / HTML) | App |
| `H` | Return to all decks | App |
| `\` | Cycle theme (system, light, dark) | App |
| `⌘Z` | Undo | App |
| `?` | Keyboard shortcut cheatsheet | App |

### Storage and Architecture
State lives as plain JSON and asset files on disk under `~/.feynman-slides/`. No Postgres, no Redis, no cloud database to manage.

```
~/.feynman-slides/
  decks/<slug>/
    deck.json        slides, elements, and source bin
    critiques.json   open findings and rejected reasons
    images/          pasted figures and slide snapshots
    deck.html        exported standalone presentation
  templates/         installed custom stylesheets
  folders.json       folder hierarchy and deck assignments
```

Because this runs on a personal server accessible over the web, storage is capped at 100 GB total across all decks. Every file write, paste, and upload checks remaining space against the quota and returns a clean 507 Insufficient Storage if the disk runs tight.

### Hosting
Hosted with Cloudflare Tunnel + Linux PC (`slim`).

live @ [feyn.ryhub.dev](https://feyn.ryhub.dev/)
