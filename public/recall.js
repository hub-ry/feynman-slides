// Active recall study session.
//
// Dunlosky et al. (2013) rated practice testing and distributed practice as
// the only two study techniques with HIGH utility. Rereading and highlighting,
// which feel productive, landed at LOW. Roediger & Karpicke (2006) showed why:
// retrieval practice produced 61% retention at one week against 40% for
// rereading, even though learners in the rereading group predicted they would
// remember more. The difficulty of pulling an idea out of memory is what makes
// it stick.
//
// In this editor, a blur you reveal is RECOGNITION, not retrieval. Recognition
// is what feels like knowing when you look at an answer you could not have
// produced yourself. Buçinca et al. (2021) demonstrated that explanations
// increase unwarranted trust in suggestions, and that a cognitive forcing
// function - committing to a position before seeing the real answer - is the
// only reliable way to prevent deferring to what is on screen.
//
// So this session forces an explanation from memory first. You see only the
// slide's heading. You type your explanation into a blank box. If you cannot
// say it, you admit that with "I can't - show me", which forces grading to
// Again because not knowing IS the result and should not require pretense.
// Only after committing do you see what you wrote side by side with the real
// slide to self-grade against FSRS-6 intervals.
//
// Done states facts without praise or scores. Kluger & DeNisi (1996) showed
// that over a third of feedback interventions impair performance when they
// direct attention to the self rather than the task. A grade or percentage is
// a verdict on a person; factual review counts keep attention on the work.

import { miniature } from "./preview.js";
import { colorOf, W, H, normalize } from "./theme.js";
import { iconSvg } from "./icons.js";
import { plain, esc } from "./render.js";

/** Active singleton session to prevent overlapping overlays. */
let activeSession = null;

/**
 * Format a duration in milliseconds into a concise interval string.
 * Uses plain dashes and lowercase notation matching the FSRS-6 scheduler.
 */
function humanInterval(ms) {
  if (ms <= 0) return "now";
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)} hr`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d`;
  const months = days / 30.4;
  if (months < 12) return `${Math.round(months)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

/**
 * Extract the primary heading from a slide.
 * Prefers an explicit title role, then falls back to the highest text element.
 */
function headingOf(slide) {
  if (!slide || !Array.isArray(slide.els)) return "Untitled slide";
  const titleEl =
    slide.els.find((e) => e.type === "text" && e.role === "title" && e.text?.trim()) ??
    slide.els.find((e) => e.role === "title" && e.text?.trim()) ??
    slide.els.filter((e) => e.type === "text" && e.text?.trim()).sort((a, b) => a.y - b.y)[0];
  if (!titleEl || !titleEl.text?.trim()) return "Untitled slide";
  return plain(titleEl.text).trim();
}

/**
 * Open a full-screen active-recall study session for a deck.
 *
 * @param {string} slug - Deck identifier
 * @param {object} deck - Deck model containing slides
 * @param {object|string} template - Template object or id
 * @param {function} [onClose] - Callback when the session closes
 */
export function openRecall(slug, deck, template, onClose) {
  if (activeSession) {
    activeSession.stop();
  }

  const tpl = typeof template === "object" && template?.palette ? template : normalize(template);
  const slidesById = new Map((deck?.slides ?? []).map((s) => [s.id, s]));

  let queue = [];
  // Not due, weakest memory first. Only ever offered once the queue is
  // empty, and never mixed into it: a session that quietly kept going
  // would stop meaning "you are caught up" when it ended.
  let ahead = [];
  let studyingAhead = false;
  let schedule = {};
  let memories = {};
  let currentSlide = null;
  let currentResizeObserver = null;
  let isSubmitting = false;
  let stopped = false;

  const grades = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let totalGraded = 0;
  /** Slides graded in this sitting whose grade never reached the server. */
  const unsaved = new Set();

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  // --- Root container -----------------------------------------------------

  const box = document.createElement("div");
  box.id = "recall-session";
  box.className = "recall-session";
  box.tabIndex = -1;

  const header = document.createElement("header");
  header.className = "recall-header";

  const headerLeft = document.createElement("div");
  headerLeft.className = "recall-header-left";
  headerLeft.innerHTML = `
    <span class="recall-pill">${iconSvg("brain", 13)} recall</span>
    <span class="recall-deck-title">${esc(deck?.title || "Untitled")}</span>
  `;

  const headerCenter = document.createElement("div");
  headerCenter.className = "recall-header-center";
  const countSpan = document.createElement("span");
  countSpan.className = "recall-count";
  headerCenter.append(countSpan);

  const headerRight = document.createElement("div");
  headerRight.className = "recall-header-right";

  const closeBtn = document.createElement("button");
  closeBtn.className = "recall-close-btn";
  closeBtn.title = "Exit session (Esc)";
  closeBtn.setAttribute("aria-label", "Exit session");
  closeBtn.innerHTML = `<span>close</span><kbd class="recall-key">Esc</kbd>`;
  closeBtn.onclick = () => stop();
  headerRight.append(closeBtn);

  header.append(headerLeft, headerCenter, headerRight);

  const main = document.createElement("main");
  main.className = "recall-main";

  box.append(header, main);
  document.body.append(box);

  // --- Fullscreen and session lifecycle -----------------------------------

  box.requestFullscreen?.().catch(() => {
    // Browsers block fullscreen without a direct click; the overlay is
    // position:fixed over the whole viewport either way, so this is a nicety
    // rather than a requirement and failing it changes nothing.
  });

  function stop() {
    if (stopped) return;
    stopped = true;

    if (currentResizeObserver) {
      currentResizeObserver.disconnect();
      currentResizeObserver = null;
    }

    window.removeEventListener("keydown", onGlobalKeyDown, true);
    window.removeEventListener("resize", onWindowResize);

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    box.remove();
    activeSession = null;

    if (typeof onClose === "function") {
      onClose();
    }
  }

  // Leaving fullscreen deliberately does NOT end the session.
  //
  // It used to, by analogy with the presenter, where dropping out of
  // fullscreen leaves a black overlay with no cursor and looks like a hang.
  // This overlay is an ordinary full-page UI with a visible close button, so
  // there is nothing to rescue the user from - and the listener was a race:
  // opening this from the presenter meant the presenter's own pending
  // exitFullscreen fired a change event that this handler read as the user
  // leaving, and the session closed itself milliseconds after opening.
  //
  // Escape closes it. That is the whole contract.

  // Global keydown handler catches Escape at all times so the user is never trapped.
  function onGlobalKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stop();
    }
  }

  window.addEventListener("keydown", onGlobalKeyDown, true);

  function onWindowResize() {
    // Redraw current compare slide if active
    if (currentSlide && box.querySelector(".recall-slide-content")) {
      renderSlidePreview(box.querySelector(".recall-slide-content"), currentSlide);
    }
  }

  window.addEventListener("resize", onWindowResize);

  activeSession = { stop };

  // --- Loading initial schedule -------------------------------------------

  const loadingEl = document.createElement("div");
  loadingEl.className = "recall-loading";
  loadingEl.textContent = "loading queue...";
  main.append(loadingEl);

  async function init() {
    try {
      const [recallRes, schedRes] = await Promise.all([
        fetch(`/api/deck/${slug}/recall`),
        fetch(`/api/deck/${slug}/schedule`),
      ]);

      if (!recallRes.ok || !schedRes.ok) {
        throw new Error("Failed to load recall schedule");
      }

      const recallData = await recallRes.json();
      const schedData = await schedRes.json();

      memories = recallData.memories || {};
      schedule = schedData || {};

      // Server returns due in most-overdue order. Only keep slides that exist.
      queue = (recallData.due || []).filter((id) => slidesById.has(id));
      ahead = (recallData.ahead || []).filter((id) => slidesById.has(id));

      if (queue.length === 0) {
        showDone();
      } else {
        nextCard();
      }
    } catch (err) {
      loadingEl.className = "recall-error";
      loadingEl.innerHTML = `
        <p>Could not load recall session.</p>
        <button class="recall-done-btn">Close</button>
      `;
      loadingEl.querySelector("button").onclick = () => stop();
    }
  }

  function updateHeaderCount() {
    if (stopped) return;
    const remaining = queue.length + (currentSlide ? 1 : 0);
    countSpan.textContent =
      remaining === 0 ? "queue empty" : `${remaining} ${studyingAhead ? "ahead" : "due"}`;
    countSpan.classList.toggle("unsaved", unsaved.size > 0);
    countSpan.title = unsaved.size
      ? `${unsaved.size} grade${unsaved.size > 1 ? "s" : ""} did not reach the server. They will be asked again next time.`
      : "";
  }

  // --- Step 1 & 2: Prompt and Write ---------------------------------------

  function nextCard() {
    if (queue.length === 0) {
      currentSlide = null;
      showDone();
      return;
    }

    const slideId = queue.shift();
    currentSlide = slidesById.get(slideId);
    if (!currentSlide) {
      nextCard();
      return;
    }

    updateHeaderCount();
    showWritePhase(currentSlide);
  }

  function showWritePhase(slide) {
    if (currentResizeObserver) {
      currentResizeObserver.disconnect();
      currentResizeObserver = null;
    }

    main.replaceChildren();

    const stage = document.createElement("div");
    stage.className = "recall-stage recall-stage-write";

    // 1. PROMPT: Heading only, on deck template colours.
    const promptCard = document.createElement("div");
    promptCard.className = "recall-prompt-card";
    promptCard.style.background = colorOf(tpl, "paper");
    promptCard.style.color = colorOf(tpl, "ink");

    const headingText = headingOf(slide);
    const headingEl = document.createElement("h1");
    headingEl.className = "recall-prompt-heading";
    headingEl.style.fontFamily = tpl.roles?.title?.family ?? "inherit";
    headingEl.textContent = headingText;

    const subEl = document.createElement("p");
    subEl.className = "recall-prompt-sub";
    subEl.style.color = colorOf(tpl, "muted");
    subEl.textContent = "Say it out loud, then write it down.";

    promptCard.append(headingEl, subEl);

    // 2. WRITE: Textarea for retrieval practice.
    const writeBox = document.createElement("div");
    writeBox.className = "recall-write-box";

    const textarea = document.createElement("textarea");
    textarea.className = "recall-textarea";
    textarea.placeholder = "Type your explanation from memory...";
    textarea.autocomplete = "off";
    textarea.spellcheck = true;

    const footer = document.createElement("div");
    footer.className = "recall-write-footer";

    const note = document.createElement("span");
    note.className = "recall-write-note";
    note.textContent = "Nothing you type here is stored or marked.";

    const commitBtn = document.createElement("button");
    commitBtn.className = "recall-commit-btn cant";
    const commitLabel = document.createElement("span");
    commitLabel.textContent = "I can't - show me";
    const commitHint = document.createElement("span");
    commitHint.className = "recall-commit-hint";
    commitHint.textContent = isMac ? "⌘Enter" : "Ctrl+Enter";
    commitBtn.append(commitLabel, commitHint);

    footer.append(note, commitBtn);
    writeBox.append(textarea, footer);

    stage.append(promptCard, writeBox);
    main.append(stage);

    function updateCommitState() {
      const isBlank = textarea.value.trim().length === 0;
      if (isBlank) {
        commitBtn.className = "recall-commit-btn cant";
        commitLabel.textContent = "I can't - show me";
      } else {
        commitBtn.className = "recall-commit-btn show";
        commitLabel.textContent = "Show the slide";
      }
    }

    textarea.addEventListener("input", updateCommitState);

    function commit() {
      const text = textarea.value.trim();
      const forcedAgain = text.length === 0;
      showComparePhase(slide, text, forcedAgain);
    }

    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });

    commitBtn.onclick = () => commit();

    // Ensure immediate focus on the input so keyboard flow is uninterrupted.
    setTimeout(() => textarea.focus(), 10);
  }

  // --- Step 3 & 4: Compare and Grade --------------------------------------

  function renderSlidePreview(container, slide) {
    if (!container || !slide) return;
    const pad = 24;
    const availW = Math.max(100, container.clientWidth - pad);
    const availH = Math.max(60, container.clientHeight - pad);
    const width = Math.min(availW, (availH * W) / H);

    const paper = miniature(slide.els, tpl, {
      width,
      srcFor: (e) => `/api/deck/${slug}/images/${encodeURIComponent(e.src)}`,
    });
    container.replaceChildren(paper);
  }

  function showComparePhase(slide, userText, forcedAgain) {
    main.replaceChildren();

    const stage = document.createElement("div");
    stage.className = "recall-stage recall-stage-compare";

    // 3. COMPARE: Two panes side by side (stacked under 900px).
    const grid = document.createElement("div");
    grid.className = "recall-compare-grid";

    // Left pane: What they wrote.
    const userPane = document.createElement("section");
    userPane.className = "recall-compare-pane";

    const userHeader = document.createElement("div");
    userHeader.className = "recall-pane-header";
    userHeader.innerHTML = `<span class="recall-pane-title">what you wrote</span>`;

    const userContent = document.createElement("div");
    userContent.className = "recall-user-content";
    if (forcedAgain) {
      const emptyNote = document.createElement("p");
      emptyNote.className = "recall-user-empty";
      emptyNote.textContent = "(nothing written - admitted gap)";
      userContent.append(emptyNote);
    } else {
      userContent.textContent = userText;
    }

    userPane.append(userHeader, userContent);

    // Right pane: Real slide rendered with miniature.
    const slidePane = document.createElement("section");
    slidePane.className = "recall-compare-pane";

    const slideHeader = document.createElement("div");
    slideHeader.className = "recall-pane-header";
    slideHeader.innerHTML = `<span class="recall-pane-title">slide</span>`;

    const slideContent = document.createElement("div");
    slideContent.className = "recall-slide-content";

    slidePane.append(slideHeader, slideContent);

    grid.append(userPane, slidePane);

    // 4. GRADE: Four buttons carrying intervals (Again / Hard / Good / Easy).
    const gradeBar = document.createElement("footer");
    gradeBar.className = "recall-grade-bar";

    const actions = document.createElement("div");
    actions.className = "recall-grade-actions";

    const sched = schedule[slide.id] || {};
    const intervals = {
      1: sched["1"] || "10 min",
      2: sched["2"] || "2 d",
      3: sched["3"] || "8 d",
      4: sched["4"] || "21 d",
    };

    const gradeBtns = [];

    const gradesMeta = [
      { rating: 1, name: "Again", key: "1", cls: "again" },
      { rating: 2, name: "Hard", key: "2", cls: "hard" },
      { rating: 3, name: "Good", key: "3", cls: "good" },
      { rating: 4, name: "Easy", key: "4", cls: "easy" },
    ];

    for (const g of gradesMeta) {
      const btn = document.createElement("button");
      btn.className = `recall-grade-btn ${g.cls}`;
      btn.dataset.rating = String(g.rating);

      const label = `${g.name} - ${intervals[g.rating]}`;
      btn.innerHTML = `<span>${label}</span><kbd class="recall-key">${g.key}</kbd>`;

      if (forcedAgain && g.rating > 1) {
        btn.disabled = true;
        btn.title = "Grading is forced to Again because no explanation was written.";
      } else {
        btn.onclick = () => handleGrade(g.rating);
      }

      gradeBtns.push(btn);
      actions.append(btn);
    }

    gradeBar.append(actions);

    if (forcedAgain) {
      const forcedNotice = document.createElement("div");
      forcedNotice.className = "recall-forced-notice";
      forcedNotice.textContent = "Grading forced to Again because no explanation was written.";
      gradeBar.append(forcedNotice);
    }

    stage.append(grid, gradeBar);
    main.append(stage);

    // Render slide miniature and observe size changes.
    renderSlidePreview(slideContent, slide);

    if (currentResizeObserver) {
      currentResizeObserver.disconnect();
    }
    currentResizeObserver = new ResizeObserver(() => {
      renderSlidePreview(slideContent, slide);
    });
    currentResizeObserver.observe(slideContent);

    // Handle keys 1 2 3 4 during compare.
    function onCompareKeyDown(e) {
      if (isSubmitting) return;

      if (forcedAgain) {
        if (e.key === "1" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cleanup();
          handleGrade(1);
        }
        return;
      }

      if (e.key === "1") { e.preventDefault(); cleanup(); handleGrade(1); }
      else if (e.key === "2") { e.preventDefault(); cleanup(); handleGrade(2); }
      else if (e.key === "3") { e.preventDefault(); cleanup(); handleGrade(3); }
      else if (e.key === "4") { e.preventDefault(); cleanup(); handleGrade(4); }
    }

    function cleanup() {
      window.removeEventListener("keydown", onCompareKeyDown, true);
    }

    window.addEventListener("keydown", onCompareKeyDown, true);

    async function handleGrade(rating) {
      if (isSubmitting) return;
      isSubmitting = true;
      cleanup();

      for (const btn of gradeBtns) {
        btn.disabled = true;
      }

      totalGraded++;
      grades[rating] = (grades[rating] || 0) + 1;

      // Again (1) puts the slide back at the end of the current sitting's queue.
      if (rating === 1) {
        queue.push(slide.id);
      }

      // A grade that did not reach the server is a grade that never happened,
      // and the next session will ask for this slide again as though you had
      // not sat through it. Carrying on is right - being stuck mid-session
      // over a failed write is worse - but saying nothing is not: the whole
      // value of the schedule is that you can trust it is keeping count.
      try {
        const res = await fetch(`/api/deck/${slug}/recall`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slideId: slide.id, rating }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.next) schedule[slide.id] = data.next;
          if (data.memory) memories[slide.id] = data.memory;
          if (data.ahead) {
            ahead = data.ahead.filter((id) => slidesById.has(id) && !queue.includes(id));
          }
          unsaved.delete(slide.id);
        } else {
          unsaved.add(slide.id);
        }
      } catch (err) {
        unsaved.add(slide.id);
      }
      updateHeaderCount();

      isSubmitting = false;
      nextCard();
    }
  }

  // --- Step 5: Done -------------------------------------------------------

  async function showDone() {
    if (currentResizeObserver) {
      currentResizeObserver.disconnect();
      currentResizeObserver = null;
    }

    currentSlide = null;
    updateHeaderCount();
    main.replaceChildren();

    // Fetch latest schedule state to report when the next slide is due.
    let nextDueText = "";
    try {
      const res = await fetch(`/api/deck/${slug}/recall`);
      if (res.ok) {
        const data = await res.json();
        if (data.memories) Object.assign(memories, data.memories);
        if (data.due && data.due.length > 0) {
          nextDueText = "now";
        }
      }
    } catch (err) {
      // Fallback to local memory cache.
    }

    if (!nextDueText) {
      const now = Date.now();
      let earliestMs = Infinity;
      for (const m of Object.values(memories)) {
        if (m?.due) {
          const t = new Date(m.due).getTime();
          if (t < earliestMs) earliestMs = t;
        }
      }
      if (earliestMs !== Infinity) {
        const diff = earliestMs - now;
        nextDueText = diff <= 0 ? "now" : `in ${humanInterval(diff)}`;
      } else {
        nextDueText = "no slides scheduled";
      }
    }

    const stage = document.createElement("div");
    stage.className = "recall-stage recall-stage-done";

    const card = document.createElement("div");
    card.className = "recall-done-card";

    const title = document.createElement("h1");
    title.className = "recall-done-title";
    title.textContent = "session complete";

    const summary = document.createElement("p");
    summary.className = "recall-done-summary";
    summary.textContent = `${totalGraded} ${totalGraded === 1 ? "slide graded" : "slides graded"}`;

    const split = document.createElement("div");
    split.className = "recall-done-split";

    const stats = [
      { label: "again", val: grades[1], cls: "again" },
      { label: "hard", val: grades[2], cls: "hard" },
      { label: "good", val: grades[3], cls: "good" },
      { label: "easy", val: grades[4], cls: "easy" },
    ];

    for (const s of stats) {
      const item = document.createElement("div");
      // A zero is not a result, and colouring it draws the eye to the thing
      // that did not happen.
      item.className = `recall-done-stat ${s.cls}` + (s.val ? "" : " none");
      item.innerHTML = `
        <span class="recall-stat-label">${s.label}</span>
        <span class="recall-stat-value">${s.val}</span>
      `;
      split.append(item);
    }

    const dueP = document.createElement("p");
    dueP.className = "recall-done-due";
    dueP.textContent = `next slide due ${nextDueText}`;

    const warn = document.createElement("p");
    if (unsaved.size) {
      warn.className = "recall-done-warn";
      warn.textContent = `${unsaved.size} grade${unsaved.size > 1 ? "s" : ""} did not save. Those slides will come back next session as though this one had not happened.`;
    }

    const doneBtn = document.createElement("button");
    doneBtn.className = "recall-done-btn";
    doneBtn.textContent = "Done";
    doneBtn.onclick = () => stop();

    // Clearing the queue is the honest end of a session, and the offer to keep
    // going sits below that line rather than in place of it. Studying ahead is
    // a worse use of the same minutes than waiting is - that is the whole
    // finding - but "come back Thursday" is not a thing an app can say to
    // someone who wants to work now, so it says what it costs instead.
    let aheadBtn = null;
    if (ahead.length > 0 && !studyingAhead) {
      aheadBtn = document.createElement("button");
      aheadBtn.className = "recall-ahead-btn";
      aheadBtn.textContent = `Study ahead (${ahead.length})`;
      aheadBtn.onclick = () => {
        window.removeEventListener("keydown", onDoneKeyDown, true);
        queue = ahead.slice();
        ahead = [];
        studyingAhead = true;
        nextCard();
      };
    }

    const aheadNote = document.createElement("p");
    if (aheadBtn) {
      aheadNote.className = "recall-ahead-note";
      aheadNote.textContent =
        "Weakest first. Reviewing early is worth less than waiting is, and the schedule prices it that way - it will not push these much further out.";
    }

    card.append(title, summary, split, dueP);
    if (unsaved.size) card.append(warn);
    card.append(doneBtn);
    if (aheadBtn) card.append(aheadBtn, aheadNote);
    stage.append(card);
    main.append(stage);

    function onDoneKeyDown(e) {
      if (e.key === "Enter" || e.key === " ") {
        // Let the ahead button answer for itself when it has the focus,
        // or this handler closes the session out from under it.
        if (aheadBtn && document.activeElement === aheadBtn) return;
        e.preventDefault();
        window.removeEventListener("keydown", onDoneKeyDown, true);
        stop();
      }
    }

    window.addEventListener("keydown", onDoneKeyDown, true);
    setTimeout(() => doneBtn.focus(), 10);
  }

  // Kick off schedule fetch.
  init();
}

