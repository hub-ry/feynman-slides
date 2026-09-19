# Working on this repo with several agents

We run more than one agent at a time, in tmux panes, against this same
checkout. That is fine as long as everyone follows the rules below - all of
them exist because two agents editing one file is the only way this goes
wrong.

## Claim a file before you touch it

One agent owns a file for the length of its task. Before starting, say in your
first message which files you are taking. If a file you need is already
claimed, wait or take a different task - do not edit it "quickly".

Rough ownership lines that already exist in the code:

| Area | Files |
| --- | --- |
| Editor UI | `public/app.js`, `public/index.html`, `public/style.css` |
| Critic / agent loop | `src/critic.ts` |
| HTTP + routes | `src/server.ts` |
| Storage on disk | `src/store.ts` |
| Deck model | `src/deck.ts` |
| Export | `src/export.ts` |

`public/app.js` is one big file and the most contended thing here. Two agents
should not be in it at once.

## Ports

The dev server defaults to 4317. Each pane needs its own:

```
PORT=4317 ./bin/feynman-slides    # pane 1
PORT=4318 ./bin/feynman-slides    # pane 2
```

`PORT` collisions show up as "Port 4317 is already in use", not as a crash.

## Deck data is shared

Every pane reads and writes `~/.feynman-slides/decks`. A deck open in two
editors will fight over `deck.json` - the last save wins and the other pane
does not know. Use a scratch home when you are testing anything destructive:

```
FEYNMAN_SLIDES_HOME=/tmp/fs-agent-2 ./bin/feynman-slides
```

## Commit small and often

Commit each coherent change and push it. Do not sit on a large working tree:
another pane cannot see your uncommitted work, and a long-lived dirty tree is
what turns two edits into a conflict.

- `npx tsc --noEmit` and `node --check public/app.js` before every commit.
- Rebase, don't merge: `git pull --rebase` before pushing.
- Commit messages describe the change in the product's terms, lowercase, no
  agent attribution.

## Vocabulary

A **deck** is a topic you are teaching yourself. It holds **slides**. Source
material lives in the **bin** and belongs to the whole deck. The critic
produces **findings**; an unresolved error or jargon finding **blocks** the
export. Use these words in code, UI copy and commits - nothing calls a deck a
"presentation" or a "project".
