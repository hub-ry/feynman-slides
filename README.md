# feynman-slides

Casual Projects build!

You write slides to teach yourself a topic. A critic reads each slide as you write it and stops you when the slide says something false, or names a concept where it should explain a mechanism. Until you deal with what it found, the deck will not export.

The bet is that the moment worth catching is while you are writing the slide, not after. A slide that looks finished and is subtly wrong is the worst thing this could produce, because you end up studying from it.

### Why this method?
While preparing for his doctoral exams at Princeton, Richard Feynman bought a blank notebook and titled it *Notebook of Things I Don't Know About*. He spent weeks tearing physics down to its bare mechanisms, rebuilding each concept without jargon.

The technique that carries his name is a bundle of four things that are each well studied on their own: [self-explanation](https://link.springer.com/article/10.1007/s10648-018-9434-x) (g = 0.55), [learning by teaching](https://onlinelibrary.wiley.com/doi/10.1111/jpr.12221) (g = 0.48, but only when you knew you would have to teach), [elaborative interrogation](https://journals.sagepub.com/doi/abs/10.1177/1529100612453266), and [retrieval practice](https://journals.sagepub.com/doi/10.1111/j.1745-6916.2006.00012.x). Most presentation software lets you hide behind copy-pasted bullets and impressive labels. This does the opposite.

**[docs/research.md](docs/research.md)** is the reading behind every design decision here, including the ones that were wrong and got reversed. It says which paper each behaviour comes from, and where the evidence is thin.

### The Loop
1. Name who you are explaining the deck to. One sentence, and it changes what counts as jargon.
2. Drop lecture slides or raw notes into the source bin.
3. Build your deck slide by slide. Press `T` to drop text anywhere and use nested bullets to break down concepts.
4. The critic flags errors, buzzwords and pasted phrasing. Fix them, or push back with your reasoning.
5. Open the six checks on any slide to see what it is still missing. Sort by what is open.
6. Press `⇧R` to recall: say each due slide from memory before you are shown it.
7. Export crisp 16:9 PDFs once every blocking finding is cleared.

### Quickstart

```bash
npm install
./bin/feynman-slides      # runs on http://localhost:4317
```

No API key needed to start. It hooks into your local `claude` CLI login through the Agent SDK, and falls back to a built-in heuristic critic when offline or rate-limited.

```bash
npm test          # the FSRS port, against the reference implementation
npm run typecheck
```

### The Critic and Blocking
The critic runs checks at two points: when you pause for two seconds while typing, and when you finish editing a box. The pause is advisory. Finishing is the firm pass.

| Severity | What it means | Blocks export? |
| :--- | :--- | :--- |
| `error` | Factually incorrect, or contradicts source material | Yes |
| `jargon` | A buzzword used in place of an explanation | Yes |
| `note` | Structural advice, length, or a phrase pasted out of the bin | No |
| `probe` | A question about a slide that is already fine | No |

`probe` exists because every other severity reports a defect, and a critic whose only register is objection reads as hostile however politely it is worded. On a slide with nothing wrong with it, the critic gets to ask one question instead: why is this true, what is it true *instead of*, what breaks it. That is [elaborative interrogation](https://journals.sagepub.com/doi/abs/10.1177/1529100612453266), which carries some of the largest effect sizes in the study-technique literature.

Jargon blocks on purpose. "Collisions are handled by the collision resolution strategy" is not an explanation - it is a word pointing at itself. If you write "Paxos ensures consensus through quorums," the critic will ask what a quorum actually is and what happens if one node drops out.

If the critic is wrong, reject the finding. It asks for one sentence explaining why, stores your reasoning, and never flags that exact issue again.

### Who the deck is for
Click the pill next to the deck name and write one sentence about your reader.

This is not a label. Kobayashi's meta-analysis of learning-by-teaching found that teaching after studying *without* the expectation of teaching did not differ significantly from zero; with the expectation in place it was g = 0.48. The reader is the condition under which any of this works.

It is also what makes the critic's central judgement answerable. "Is this term standing in for a mechanism" has no answer in the abstract - "quorum" explains plenty to a distributed systems PhD and nothing to you in six weeks - so a deck with no named reader had the critic inventing one per slide.

### AI Critic Setup (Claude, Gemini, Local Ollama, OpenAI)
The critic checks your slides for factual accuracy, unexplained buzzwords, and contradictions with your lecture bin as you write. Click the review engine pill in the editor or the spark button on the home bar to configure your reviewer:

1. **Google Gemini (Recommended - 1 Minute, Free)**:
   - Head to [Google AI Studio](https://aistudio.google.com/app/apikey) and click **Create API Key**.
   - In Feynman Slides, choose **Google Gemini**, paste your key, and click **Save & Activate**.
   - Free tier includes 15 requests per minute with no credit card required.

2. **Local Ollama (Free, 100% Private, Offline)**:
   - Install Ollama from [ollama.com](https://ollama.com).
   - In your terminal, run `ollama run llama3` (or `mistral`).
   - In Feynman Slides, select **Local Model** with endpoint `http://localhost:11434/v1` and model `llama3:latest`.
   - All critique runs on your CPU or GPU. Zero slide text leaves your computer.

3. **Claude AI (Agent SDK / CLI)**:
   - Install the Claude CLI: `npm install -g @anthropic-ai/claude-code`.
   - Run `claude login` in your terminal to authenticate.
   - Feynman Slides automatically hooks into your local CLI login session.

4. **OpenAI / Codex (API Key)**:
   - Create an API key in your [OpenAI Dashboard](https://platform.openai.com/api-keys).
   - In Feynman Slides, select **OpenAI**, enter your key and model (`gpt-4o-mini`).

5. **Built-in Heuristic Reviewer (Offline)**:
   - Zero setup required. Uses instant pattern matching to flag ungrounded jargon words, absolute claims, and source bin contradictions offline.

### Fast Writing
Slide decks usually get bogged down in drag-handles and alignment bars. Here:
- Press `T` and click anywhere: the text box drops right at your cursor.
- Press `Tab` and `Shift+Tab` to indent or outdent nested bullets up to 4 levels (`•`, `◦`, `▪`, `-`).
- Press `Enter` on any bullet to continue with identical indentation, or press `Enter` on an empty bullet to back out cleanly.
- Hit `⇧L` anytime to cycle and re-lay the slide layout without touching your text.

### Six checks, and no grade
Every slide carries six checks. Each one is clear, open, or not answerable yet, and each says in one sentence what it saw.

1. **Nothing contradicted** - no open error findings.
2. **Your words, not the bin's** - no long verbatim run out of your source material.
3. **No name standing in** - no term doing the work an explanation should do.
4. **Says how it works** - the mechanism is on the slide, not just what it is called.
5. **One idea, sayable** - one idea, at a length you could say out loud.
6. **Reads cleanly** - a heading on top, nothing hanging off the edge.

Click the badge on any slide to see the list. Toggle sorting in the rail header to put the slides with the most open first.

There used to be a 0-100 score and a letter grade here. It is gone on purpose. Kluger and DeNisi's meta-analysis of 607 effect sizes found that **over a third of feedback interventions make performance worse**, and the thing that separates the helpful ones from the harmful ones is whether attention lands on the task or on the person. `D - Needs rework`, over a slide you wrote thirty seconds ago, is as self-directed as feedback gets. "Two checks open, here they are" is the same information pointed at the work.

Check 2 is a reversal, not a rename. The old score paid twenty points out of a hundred for **vocabulary overlap** with your lecture notes, which meant a slide that was a straight paste scored full marks on the dimension meant to catch exactly that. Copying your professor's phrasing is the signature of not having restated it, so it now counts against you and names the source it came from.

### Source Bin Grounding
Drop lecture PDFs or markdown notes into the bin under the canvas. It belongs to the whole deck, not just one slide. When you upload a 60-page deck from class, pages are split and tagged (like `lecture-04 p12`). The critic reads through them and cites the exact slide if you contradict your source.

### Recall
Press `⇧R`, or `S` from inside the presenter. Slides that are due come back one at a time:

1. You see **only the slide's heading**.
2. You type your explanation from memory. If you cannot, one click says so and grades it `Again`. Nothing you type is stored, sent anywhere, or marked.
3. *Then* the slide appears next to what you wrote.
4. You grade yourself `Again` / `Hard` / `Good` / `Easy`, and each button tells you the interval it buys.

The writing step is not ceremony. Revealing a blurred answer is **recognition**, which is what feels like knowing and is not; producing the explanation first is retrieval, and the gap between those two is the whole result in [Roediger and Karpicke](https://journals.sagepub.com/doi/10.1111/j.1745-6916.2006.00012.x) - rereaders led 83% to 71% after five minutes and lost 40% to 61% after a week. Making you commit before you see the answer is also the one intervention shown to reliably stop people deferring to what is on screen ([Buçinca et al., CHI 2021](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca21trust.pdf)).

Scheduling is **FSRS-6**, the algorithm Anki ships, with its published default parameters. It models memory as difficulty, stability and retrievability rather than one ease multiplier, and the benchmark claim is 20-30% fewer reviews for the same retention. `npm test` checks the port against values computed from the reference implementation.

You never author a card. You wrote the slide, so its heading is the prompt and its body is the answer, both already in your own words - which is the part [self-made flashcards beat premade ones on](https://sc-pan.github.io/pdf/PZIZQ_2022.pdf) (d = 0.45).

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
| `S` | Open or close source bin / go to recall | App / Presenter |
| `U` | Upload lecture slides | App |
| `C` | Show or hide critic | App |
| `M` | Stylesheets & template studio | App |
| `P` | Present deck | App |
| `⇧R` | Recall the slides that are due | App |
| `⌘Enter` | Show the slide, once you have written your answer | Recall |
| `1` – `4` | Grade: Again / Hard / Good / Easy | Recall |
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
    deck.json        slides, elements, reader, and source bin
    critiques.json   open findings and rejected reasons
    recall.json      when each slide comes back, and how it has gone
    images/          pasted figures and slide snapshots
    deck.html        exported standalone presentation
  templates/         installed custom stylesheets
  folders.json       folder hierarchy and deck assignments
```

Because this runs on a personal server accessible over the web, storage is capped at 100 GB total across all decks. Every file write, paste, and upload checks remaining space against the quota and returns a clean 507 Insufficient Storage if the disk runs tight.

### Hosting
Hosted with Cloudflare Tunnel + Linux PC (`slim`).

live @ [feyn.ryhub.dev](https://feyn.ryhub.dev/)
