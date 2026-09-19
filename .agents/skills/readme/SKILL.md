---
name: readme
description: >
  Write, rewrite, audit, and structure project READMEs in Ryan's authentic engineering style.
  Combines human writing principles (anti-slop, no em dashes, punchy cadence, facts-first) with
  concrete mechanics, intuition-driven design decisions, quickstarts, complete keybind charts,
  and straightforward hosting notes modeled after repos like phackers-hacknight1, feynman, and feynman-slides.
license: MIT
metadata:
  version: "1.0.0"
---

# README Style Guide & Skill

Write READMEs that read like one builder explaining a real system to another engineer.

This skill synthesizes the core human-writing guidelines with the engineering documentation style seen across Ryan's repositories (`phackers-hacknight1`, `feynman`, `swatch`, and `feynman-slides`).

---

## 1. Core Principles & Voice

1. **Lead with the Bet**:
   State what the project does and the exact intuition behind it within the first two paragraphs. Do not write marketing copy. Explain the core hypothesis: why does this need to exist, and what failure mode in existing tools does it fix?
2. **Explain Mechanisms, Not Just Features**:
   Do not just list capabilities. Explain *why* choices were made:
   - Why 4 taste vectors instead of 1? Because averaging two dissimilar items creates a mediocre vector that splits the difference.
   - Why block exports on jargon? Because jargon is a label pretending to be an explanation.
   - Why plain JSON on disk? Because a local app does not need PostgreSQL to store slides.
3. **Ground in History or Research (When Relevant)**:
   If a project is based on a learning technique, cognitive principle, or mathematical model, include a short 2-3 sentence quip citing real papers (with DOIs or canonical links) or historical notes (e.g. Feynman's Princeton notebook, the protégé effect, cosine similarity). Never fabricate sources.
4. **Everything Has a Key**:
   For interactive web apps, desktop apps, or terminal tools, document every single keyboard shortcut in a clean Markdown table.
5. **Show the State & File Tree**:
   Always show where files live on disk (`~/.<app>/`), how data is serialized, and any safety limits (like storage caps).
6. **Honest Hosting Footprint**:
   End with how it runs in production (e.g. Cloudflare Tunnel + Linux PC (`slim`)) and the live URL.

---

## 2. Hard Writing & Mechanics Rules

- **Never use em dashes (`—`)**: Always use plain hyphens with spaces (` - `) or clean punctuation.
- **Zero AI Buzzwords**: Eliminate words like *delve*, *tapestry*, *testament*, *crucial*, *paramount*, *beacon*, *foster*, *landscape*, *pivotal*, *in conclusion*, *serves as*, *stands as*, and *not just X, but Y*.
- **Sentence Rhythm**:
  - Keep 30-45% of sentences under 15 words.
  - Avoid uniform paragraph lengths.
  - Let thoughts end when they are done. Avoid padding with participial tails (", highlighting the importance of...").
- **Plain Verbs**: Use plain copulas and active verbs (`is`, `uses`, `runs`, `stores`, `drops`, `checks`, `blocks`).
- **Substance Gate**: An edit or rewrite must never lose concrete facts, commands, keyboard bindings, or technical limits.

---

## 3. Structural Blueprint

A complete project README follows this sequence:

```markdown
# project-name

Casual Projects build!

One or two sentences summarizing the project, the core premise, and what you are not allowed to get wrong.

A short paragraph detailing the bet: what happens when tools get this wrong, and why this design solves it.

### Why this method? (Optional)
Historical origin or cognitive research backing the approach, linking to real papers (DOIs).

### The Loop
1. Step 1: Input source material or configuration.
2. Step 2: Build or run the workflow.
3. Step 3: Feedback, checks, or validation loop.
4. Step 4: Output, presentation, or export.

### Quickstart
```bash
npm install (or pip install -e .)
./bin/run-app
```
Brief note on prerequisites, credentials, or offline fallbacks.

### Core Feature Deep-Dives
(Break into 2-4 clean sections like `### The Critic and Blocking`, `### Fast Writing`, `### Scoring`, `### Taste Vectors`)
- Concrete breakdown of how the mechanism works.
- Why the constraint or design decision was made.

### Keys (If UI / CLI)
Complete table of all keyboard shortcuts:
| Key | Action | Context |
| :--- | :--- | :--- |

### Storage and Architecture
Directory tree and file format:
```
~/.project-name/
  data/
  config.json
```
Notes on database choice (e.g. plain JSON, SQLite) and quota enforcement.

### Hosting
Hosted with Cloudflare Tunnel + Linux PC (`slim`).

live @ [subdomain.ryhub.dev](https://subdomain.ryhub.dev/)
```

---

## 4. Reference Archetypes

### Archetype A: Algorithmic / Prototype Build (`phackers-hacknight1` / `swatch`)
- Starts with `Casual Projects build!`
- Explains data collection and embedding dimensions (e.g. 12 brands, 512-d CLIP vectors).
- Explains recommendation math plainly: normalizing vectors to avoid Euclidean distance, subtracting corpus average to exaggerate differences.
- Explains why multiple taste vectors beat one single vector.
- Ends with simple hosting note and live link.

### Archetype B: CLI Study Workflow (`feynman`)
- Sharp opening: "Study by building a deck and then teaching it out loud. The deck is the studying; the teaching pass is the check that you actually understood it."
- Four-step loop from outline to speech grading to spaced repetition.
- Clear scoring philosophy: lower of your rating and model rating.
- File layout table.
- "State is plain JSON on disk. No server, no database."

### Archetype C: Interactive Desktop / Web App (`feynman-slides`)
- Sharp thesis: "Slides you are not allowed to get wrong."
- Why the method works: Feynman's Princeton notebook, self-explanation effect, protégé effect.
- The critic and why jargon blocks export.
- Full table of keyboard shortcuts.
- Local storage schema + 100GB safety cap.
- Production hosting on `slim` via Cloudflare Tunnel.

---

## 5. Audit & Revision Checklist

Before saving a README, run this check:
- [ ] No em dashes (`—`) anywhere in the document.
- [ ] First sentence directly names the tool and what makes it distinct.
- [ ] The underlying intuition or bet is clearly stated.
- [ ] All keyboard shortcuts are captured in a clean table (if an interactive app).
- [ ] Storage paths and data formats are explicit.
- [ ] No stock AI vocabulary (*delve*, *tapestry*, *testament*, *crucial*, *foster*, etc.).
- [ ] 30-45% of sentences are short (under 15 words).
- [ ] Validated with `python3 ~/.gemini/config/skills/human-writing/scripts/scan.py README.md`.
