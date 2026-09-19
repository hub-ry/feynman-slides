// Layouts, and where templates come from.
//
// This is the whole customisation story of the editor, deliberately kept out
// of the slide. You do not choose a font while writing a slide; you choose a
// template, and if none of them is right you make one - out of a deck you have
// already arranged, or in a small form, or by editing the JSON in your own
// folder, which is a file and not a setting.
//
// The catalogue is Obsidian's model without the plugin risk: a list that is
// itself a file, an install that writes one validated JSON document, and a
// folder you can open in a file manager and delete things out of.

import { S, post, emit, loadTemplates, template } from "./state.js";
import { miniature } from "./preview.js";
import { normalize, TOKENS, colorOf, W } from "./theme.js";
import * as ops from "./ops.js";
import { iconSvg } from "./icons.js";

// --- a dialog -------------------------------------------------------------

function modal(title, note = "") {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  const head = document.createElement("header");
  head.append(Object.assign(document.createElement("h2"), { textContent: title }));
  if (note) head.append(Object.assign(document.createElement("p"), { textContent: note }));
  const x = Object.assign(document.createElement("button"), { className: "x", innerHTML: "&times;" });
  x.title = "Close  (Esc)";
  x.onclick = () => close();
  head.append(x);
  const body = document.createElement("div");
  body.className = "sheet-body";
  dlg.append(head, body);
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener("cancel", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.showModal();
  return { dlg, body, close };
}

const button = (label, cls, onclick) =>
  Object.assign(document.createElement("button"), { textContent: label, className: cls, onclick });

// --- layouts --------------------------------------------------------------

/**
 * The layout gallery.
 *
 * `apply` re-lays the slide you are on instead of adding one. Same pictures,
 * because the question is the same question - what shape is this slide.
 */
export function openLayouts({ apply = false } = {}) {
  const t = template();
  const { body, close } = modal(
    apply ? "Re-lay this slide" : "New slide",
    apply
      ? `${t.name} - your words move into the new slots, nothing is thrown away.`
      : `${t.name} - pick a shape. N repeats the last one you used.`,
  );
  const grid = document.createElement("div");
  grid.className = "layouts";
  for (const l of t.layouts) {
    const card = document.createElement("button");
    card.className = "layout" + (S.lastLayout === l.id && !apply ? " on" : "");
    card.append(miniature(l.els, t, { width: 208, hints: true }));
    card.append(Object.assign(document.createElement("span"), { className: "lname", textContent: l.name }));
    card.onclick = () => { close(); apply ? ops.applyLayout(l.id) : ops.newSlide(l.id); };
    grid.append(card);
  }
  body.append(grid);
}

// --- templates ------------------------------------------------------------

const SAMPLE = (t) => {
  const l = t.layouts.find((x) => x.id === "title-body") ?? t.layouts[0];
  return l.els.map((e) =>
    e.type !== "text"
      ? e
      : {
          ...e,
          text:
            e.role === "title"
              ? "Chaining, in one line"
              : e.hint === "Subtitle"
                ? "CS 251 - week 4"
                : "- Two keys hash to one bucket\n- The bucket is a list, so both stay\n- Lookup walks that list",
        },
  );
};

export async function openTemplates(tab = "community") {
  const { body, close, dlg } = modal("Stylesheets & Templates", "The visual identity of your deck. Pick a community theme, or design your own.");
  dlg.classList.add("wide");
  const tabs = document.createElement("nav");
  tabs.className = "tabs";
  const panel = document.createElement("div");
  panel.className = "tabpanel";
  body.append(tabs, panel);

  const show = async (name) => {
    for (const b of tabs.children) b.classList.toggle("on", b.dataset.tab === name);
    panel.replaceChildren();
    panel.append(await PANES[name]({ close, show }));
  };
  for (const [name, label] of [["community", "Crowdsourced Hub"], ["installed", "My Stylesheets"], ["make", "Create Stylesheet"]]) {
    const b = button(label, "tab", () => show(name));
    b.dataset.tab = name;
    tabs.append(b);
  }
  await show(tab);
}

function card(t, actions) {
  const el = document.createElement("div");
  el.className = "tcard" + (S.deck?.template === t.id ? " using" : "");
  const shot = document.createElement("div");
  shot.className = "tshot";
  shot.append(miniature(SAMPLE(normalize(t)), normalize(t), { width: 236 }));
  el.append(shot);
  const head = document.createElement("div");
  head.className = "thead";
  head.append(Object.assign(document.createElement("b"), { textContent: t.name }));
  const dots = document.createElement("span");
  dots.className = "dots";
  for (const token of TOKENS) {
    const d = document.createElement("i");
    d.style.background = colorOf(normalize(t), token);
    d.title = token;
    dots.append(d);
  }
  head.append(dots);
  el.append(head);
  el.append(Object.assign(document.createElement("p"), {
    className: "tdesc",
    textContent: t.description || `by ${t.author || "you"}`,
  }));
  const row = document.createElement("div");
  row.className = "trow";
  row.append(...actions);
  el.append(row);
  return el;
}

const PANES = {
  async installed({ close, show }) {
    await loadTemplates();
    const wrap = document.createElement("div");
    const grid = document.createElement("div");
    grid.className = "tgrid";
    for (const t of S.templates) {
      const actions = [];
      if (S.deck?.template === t.id) {
        actions.push(Object.assign(document.createElement("span"), { className: "using-tag", textContent: "in use" }));
      } else if (S.deck) {
        actions.push(button("Use", "primary small", () => { ops.setTemplate(t.id); close(); }));
      }
      actions.push(button(t.builtin ? "Duplicate" : "Edit", "small ghost", () => {
        close();
        openEditor(t.id, { fork: Boolean(t.builtin) });
      }));
      actions.push(button("Export", "small ghost", async () => {
        const rawTpl = await fetch(`/api/templates/raw/${t.id}`).then((r) => r.json()).catch(() => null);
        if (!rawTpl) return alertLine(wrap, "could not load template");
        const blob = new Blob([JSON.stringify(rawTpl, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${t.id}.json`;
        a.click();
      }));
      if (!t.builtin) {
        actions.push(button("Remove", "small ghost danger", async () => {
          const { ok, data } = await post("/api/templates/remove", { id: t.id });
          if (!ok) return alertLine(wrap, data.error);
          if (S.deck?.template === t.id) ops.setTemplate("feynman");
          await loadTemplates();
          show("installed");
        }));
      }
      grid.append(card(t, actions));
    }
    wrap.append(grid);
    if (S.templatesDir) {
      wrap.append(Object.assign(document.createElement("p"), {
        className: "folder",
        textContent: `Your stylesheets live in ${S.templatesDir} - drop a .json in there and it appears here.`,
      }));
    }
    return wrap;
  },

  async community({ show, close }) {
    const wrap = document.createElement("div");
    wrap.className = "crowd-wrap";

    const r = await fetch("/api/templates/catalog").then((x) => x.json()).catch(() => null);
    const allEntries = r?.entries ?? [];

    const topBar = document.createElement("div");
    topBar.className = "crowd-topbar";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "crowd-search";
    searchInput.placeholder = "Search crowdsourced stylesheets by name, description, author...";
    topBar.append(searchInput);

    const designerBtn = button("+ Design New Template", "primary small strong", () => {
      close();
      openEditor(S.deck?.template ?? "feynman", { fork: true });
    });
    topBar.append(designerBtn);

    const publishBtn = button("Publish a stylesheet", "ghost small strong", () => {
      openPublishDialog(() => show("community"));
    });
    topBar.append(publishBtn);

    wrap.append(topBar);

    const filterRow = document.createElement("div");
    filterRow.className = "crowd-tags";
    const TAGS = [
      { id: "all", label: "All Stylesheets" },
      { id: "study", icon: "brain", label: "Study & Anki" },
      { id: "academic", icon: "graduation-cap", label: "Cornell & Lecture" },
      { id: "pitch", icon: "rocket-launch", label: "Modern Pitch" },
      { id: "minimal", icon: "sparkle", label: "Minimal & Swiss" },
      { id: "dark", icon: "terminal-window", label: "Dark & Code" },
    ];

    let currentTag = "all";
    let filterText = "";

    const grid = document.createElement("div");
    grid.className = "tgrid crowd-grid";

    const renderGrid = () => {
      grid.replaceChildren();
      const filtered = allEntries.filter((e) => {
        const textMatch = !filterText ||
          e.name.toLowerCase().includes(filterText) ||
          e.description.toLowerCase().includes(filterText) ||
          e.id.toLowerCase().includes(filterText) ||
          (e.author && e.author.toLowerCase().includes(filterText));
        if (!textMatch) return false;
        if (currentTag === "all") return true;
        const tagTokens = [e.id, e.name, e.description, ...(e.tags ?? [])].join(" ").toLowerCase();
        if (currentTag === "study") return tagTokens.includes("anki") || tagTokens.includes("study") || tagTokens.includes("flashcard");
        if (currentTag === "academic") return tagTokens.includes("cornell") || tagTokens.includes("lecture") || tagTokens.includes("course");
        if (currentTag === "pitch") return tagTokens.includes("pitch") || tagTokens.includes("modern") || tagTokens.includes("canva");
        if (currentTag === "minimal") return tagTokens.includes("minimal") || tagTokens.includes("swiss") || tagTokens.includes("handout");
        if (currentTag === "dark") return tagTokens.includes("dark") || tagTokens.includes("terminal") || tagTokens.includes("code") || tagTokens.includes("chalkboard");
        return true;
      });

      if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "empty-note";
        empty.textContent = "No crowdsourced stylesheets match this search.";
        grid.append(empty);
        return;
      }

      for (const e of filtered) {
        const isInstalled = e.installed || S.templates.some((t) => t.id === e.id);
        const isUsing = S.deck?.template === e.id;
        const actions = [];

        if (isUsing) {
          actions.push(Object.assign(document.createElement("span"), { className: "using-tag", textContent: "in use" }));
        } else if (isInstalled && S.deck) {
          actions.push(button("Apply", "primary small", () => {
            ops.setTemplate(e.id);
            close();
          }));
        } else {
          actions.push(button("Install" + (S.deck ? " & Apply" : ""), "primary small", async (ev) => {
            ev.target.disabled = true;
            ev.target.textContent = "installing...";
            const { ok, data } = await post("/api/templates/install", { url: e.url });
            if (!ok) return alertLine(wrap, data.error);
            await loadTemplates();
            if (S.deck) ops.setTemplate(e.id);
            close();
            emit("say", `applied ${e.name} stylesheet`);
          }));
        }

        actions.push(Object.assign(document.createElement("span"), {
          className: "ver",
          textContent: `v${e.version ?? "1.0"}`,
        }));

        grid.append(card({ ...e, layouts: [], roles: {} }, actions));
      }
    };

    TAGS.forEach((tag) => {
      const chip = document.createElement("button");
      chip.className = "tag-chip" + (currentTag === tag.id ? " on" : "");
      chip.innerHTML = tag.icon ? `${iconSvg(tag.icon, 13)} <span>${tag.label}</span>` : `<span>${tag.label}</span>`;
      chip.onclick = () => {
        currentTag = tag.id;
        filterRow.querySelectorAll(".tag-chip").forEach((c, idx) => c.classList.toggle("on", TAGS[idx].id === currentTag));
        renderGrid();
      };
      filterRow.append(chip);
    });
    wrap.append(filterRow);

    searchInput.oninput = () => {
      filterText = searchInput.value.trim().toLowerCase();
      renderGrid();
    };

    renderGrid();
    wrap.append(grid);

    // Install from URL footer
    const form = document.createElement("form");
    form.className = "fromurl";
    const input = Object.assign(document.createElement("input"), {
      placeholder: "Or install by public template URL (https://.../template.json)",
      title: "Install a template someone published",
    });
    form.append(input, button("Install from URL", "small", () => {}));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!input.value.trim()) return;
      const { ok, data } = await post("/api/templates/install", { url: input.value.trim() });
      if (!ok) return alertLine(wrap, data.error);
      input.value = "";
      await loadTemplates();
      show("community");
    };
    wrap.append(form);
    return wrap;
  },

  async make({ close }) {
    const wrap = document.createElement("div");
    wrap.className = "make";

    const hero = document.createElement("section");
    hero.className = "make-hero";
    hero.append(Object.assign(document.createElement("h3"), { textContent: "Visual Template Creator" }));
    hero.append(Object.assign(document.createElement("p"), {
      textContent: "Interactively design color palettes, typography pairings, and layout styling with real-time preview and 1-click install or community sharing.",
    }));
    hero.append(button("Launch Visual Template Creator", "primary", () => {
      close();
      openEditor(S.deck?.template ?? "feynman", { fork: true });
    }));
    wrap.append(hero);

    const one = document.createElement("section");
    one.append(Object.assign(document.createElement("h3"), { textContent: "From this deck" }));
    one.append(Object.assign(document.createElement("p"), {
      textContent:
        "Every slide becomes a layout, keeping its positions and losing its words. " +
        "This is the intended way in: arrange one deck until it looks right, then keep the arrangement.",
    }));
    const f = document.createElement("form");
    const name = Object.assign(document.createElement("input"), {
      placeholder: "What is this template called?",
      value: `${S.deck.title} template`,
    });
    f.append(name, button("Make it", "primary small", () => {}));
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const id = slugOf(name.value);
      if (!id) return alertLine(wrap, "give it a name");
      const { ok, data } = await post("/api/templates/from-deck", { slug: S.slug, id, name: name.value.trim() });
      if (!ok) return alertLine(wrap, data.error);
      await loadTemplates();
      close();
      openEditor(data.template.id);
    };
    one.append(f);

    const two = document.createElement("section");
    two.append(Object.assign(document.createElement("h3"), { textContent: "From another template" }));
    two.append(Object.assign(document.createElement("p"), {
      textContent: "Start from one that is close and change the colours and the type scale.",
    }));
    const row = document.createElement("div");
    row.className = "trow";
    for (const t of S.templates) {
      row.append(button(t.name, "small ghost", () => { close(); openEditor(t.id, { fork: true }); }));
    }
    two.append(row);

    wrap.append(one, two);
    return wrap;
  },
};

const slugOf = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function alertLine(wrap, msg) {
  let line = wrap.querySelector(".oops");
  if (!line) {
    line = Object.assign(document.createElement("p"), { className: "oops" });
    wrap.prepend(line);
  }
  line.textContent = msg ?? "that did not work";
}

// --- the template editor --------------------------------------------------

const STACKS = {
  Sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  Serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  Mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const PALETTE_PRESETS = [
  { name: "Clean Light", paper: "#ffffff", ink: "#111827", muted: "#6b7280", accent: "#2563eb" },
  { name: "Anki Dark", paper: "#0f172a", ink: "#f8fafc", muted: "#94a3b8", accent: "#38bdf8" },
  { name: "Cornell Cream", paper: "#fbf7ee", ink: "#292524", muted: "#78716c", accent: "#ea580c" },
  { name: "Chalkboard", paper: "#1a2421", ink: "#f4f6f5", muted: "#8ca299", accent: "#facc15" },
  { name: "Modern Pitch", paper: "#1e1b4b", ink: "#ffffff", muted: "#c084fc", accent: "#f43f5e" },
  { name: "Swiss Bauhaus", paper: "#f4f4f5", ink: "#18181b", muted: "#71717a", accent: "#dc2626" },
  { name: "Nordic Minimal", paper: "#2e3440", ink: "#eceff4", muted: "#d8dee9", accent: "#88c0d0" },
];

const FONT_PAIRINGS = [
  { name: "Modern Sans", title: "Sans", body: "Sans" },
  { name: "Editorial Classic", title: "Serif", body: "Serif" },
  { name: "Technical / Code", title: "Sans", body: "Mono" },
  { name: "Academic Punch", title: "Serif", body: "Sans" },
];

const SAMPLE_SLIDES = [
  {
    name: "Bullet Concept",
    getEls: (t) => {
      const l = t.layouts.find((x) => x.id === "title-body") ?? t.layouts[0];
      return l.els.map((e) =>
        e.type !== "text"
          ? e
          : {
              ...e,
              text:
                e.role === "title"
                  ? "How Raft Achieves Consensus"
                  : "- Leader election via randomized heartbeats\n  - Followers transition on timeout\n  - Majority vote required to win\n- Log replication guarantees linearizability",
            },
      );
    },
  },
  {
    name: "Title Slide",
    getEls: (t) => {
      const l = t.layouts.find((x) => x.id === "title") ?? t.layouts[0];
      return l.els.map((e) =>
        e.type !== "text"
          ? e
          : {
              ...e,
              text: e.role === "title" ? "Distributed Systems" : "A Feynman Study Guide",
            },
      );
    },
  },
  {
    name: "Stat Callout",
    getEls: (t) => {
      const l = t.layouts.find((x) => x.id === "stat" || x.id === "statement") ?? t.layouts[0];
      return l.els.map((e) =>
        e.type !== "text"
          ? e
          : {
              ...e,
              text: e.role === "title" ? "O(log n)" : "B-tree search depth with 1M items",
            },
      );
    },
  },
];

export async function openEditor(id, { fork = false } = {}) {
  const raw = await fetch(`/api/templates/raw/${id}`).then((r) => (r.ok ? r.json() : null));
  if (!raw) return;
  const draft = structuredClone(raw);
  if (fork) {
    draft.id = `${raw.id}-custom`;
    draft.name = `${raw.name} (Custom)`;
    draft.author = "you";
  }
  delete draft.builtin;

  const { body, close } = modal(
    fork ? "Visual Template Creator" : `Edit Stylesheet: ${raw.name}`,
    "Design colors, typography pairings, and layout styling with live interactive preview.",
  );
  body.parentElement.classList.add("wide");

  let activeSlideIdx = 0;

  const form = document.createElement("div");
  form.className = "editor-grid";
  const fields = document.createElement("div");
  fields.className = "fields";
  const previewWrap = document.createElement("div");
  previewWrap.className = "epreview-wrap";
  form.append(fields, previewWrap);
  body.append(form);

  const preview = document.createElement("div");
  preview.className = "epreview";

  const previewSwitcher = document.createElement("div");
  previewSwitcher.className = "epreview-tabs";
  SAMPLE_SLIDES.forEach((sample, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "epreview-tab" + (idx === activeSlideIdx ? " on" : "");
    btn.textContent = sample.name;
    btn.onclick = () => {
      activeSlideIdx = idx;
      for (const b of previewSwitcher.children) b.classList.remove("on");
      btn.classList.add("on");
      redraw();
    };
    previewSwitcher.append(btn);
  });
  previewWrap.append(previewSwitcher, preview);

  const redraw = () => {
    const t = normalize(draft);
    const els = SAMPLE_SLIDES[activeSlideIdx].getEls(t);
    preview.replaceChildren(miniature(els, t, { width: 380, hints: true }));
  };

  const field = (label, node) => {
    const row = document.createElement("label");
    row.className = "field";
    row.append(Object.assign(document.createElement("span"), { textContent: label }), node);
    return row;
  };

  // --- 1-Click Color Presets ---
  const presetSection = document.createElement("div");
  presetSection.className = "field-section";
  presetSection.innerHTML = `<span class="section-label">1-Click Color Themes</span>`;
  const presetRow = document.createElement("div");
  presetRow.className = "preset-chips";
  PALETTE_PRESETS.forEach((p) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.innerHTML = `
      <span class="preset-dots">
        <i style="background:${p.paper};border:1px solid rgba(128,128,128,0.3)"></i>
        <i style="background:${p.ink}"></i>
        <i style="background:${p.accent}"></i>
      </span>
      <span>${p.name}</span>
    `;
    chip.onclick = () => {
      draft.palette = { paper: p.paper, ink: p.ink, muted: p.muted, accent: p.accent };
      updateColorInputs();
      redraw();
    };
    presetRow.append(chip);
  });
  presetSection.append(presetRow);
  fields.append(presetSection);

  // --- Identity Metadata ---
  const metaSection = document.createElement("div");
  metaSection.className = "field-section";
  metaSection.innerHTML = `<span class="section-label">Template Details</span>`;
  const nameIn = Object.assign(document.createElement("input"), { value: draft.name, placeholder: "Template Name" });
  nameIn.oninput = () => { draft.name = nameIn.value; };
  const idIn = Object.assign(document.createElement("input"), { value: draft.id, placeholder: "template-id" });
  idIn.oninput = () => { draft.id = slugOf(idIn.value); idIn.value = draft.id; };
  metaSection.append(
    field("Name", nameIn),
    field("Folder / ID", idIn),
  );
  fields.append(metaSection);

  // --- Colors Grid ---
  const colorsSection = document.createElement("div");
  colorsSection.className = "field-section";
  colorsSection.innerHTML = `<span class="section-label">Palette Colors</span>`;
  const colours = document.createElement("div");
  colours.className = "colours-grid";

  const colorInputs = {};
  for (const token of TOKENS) {
    const cell = document.createElement("div");
    cell.className = "colour-card";
    const input = Object.assign(document.createElement("input"), {
      type: "color",
      value: (draft.palette?.[token] ?? "#000000").slice(0, 7),
    });
    const hex = Object.assign(document.createElement("input"), {
      type: "text",
      value: input.value,
      className: "hex-input",
    });
    input.oninput = () => {
      (draft.palette ??= {})[token] = input.value;
      hex.value = input.value;
      redraw();
    };
    hex.oninput = () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
        input.value = hex.value;
        (draft.palette ??= {})[token] = hex.value;
        redraw();
      }
    };
    colorInputs[token] = { input, hex };
    cell.append(input, Object.assign(document.createElement("span"), { className: "cname", textContent: token }), hex);
    colours.append(cell);
  }

  function updateColorInputs() {
    for (const token of TOKENS) {
      if (colorInputs[token] && draft.palette?.[token]) {
        colorInputs[token].input.value = draft.palette[token];
        colorInputs[token].hex.value = draft.palette[token];
      }
    }
  }

  colorsSection.append(colours);
  fields.append(colorsSection);

  // --- Typography Section ---
  const typoSection = document.createElement("div");
  typoSection.className = "field-section";
  typoSection.innerHTML = `<span class="section-label">Typography Pairings</span>`;

  const pairingRow = document.createElement("div");
  pairingRow.className = "preset-chips";
  FONT_PAIRINGS.forEach((fp) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.textContent = fp.name;
    chip.onclick = () => {
      for (const role of Object.keys(draft.roles ?? normalize(draft).roles)) {
        draft.roles ??= {};
        draft.roles[role] ??= normalize(draft).roles[role];
        const isHeading = role === "title" || role === "subtitle" || role === "kicker" || role === "stat";
        draft.roles[role].family = STACKS[isHeading ? fp.title : fp.body] ?? draft.roles[role].family;
      }
      redraw();
    };
    pairingRow.append(chip);
  });
  typoSection.append(pairingRow);
  fields.append(typoSection);

  // Advanced roles
  for (const role of Object.keys(draft.roles ?? normalize(draft).roles)) {
    draft.roles ??= {};
    draft.roles[role] ??= normalize(draft).roles[role];
    const r = draft.roles[role];
    const line = document.createElement("div");
    line.className = "roleline";

    const fam = document.createElement("select");
    for (const [label, stack] of Object.entries(STACKS)) {
      fam.append(Object.assign(document.createElement("option"), { value: stack, textContent: label }));
    }
    if (!Object.values(STACKS).includes(r.family)) {
      fam.append(Object.assign(document.createElement("option"), { value: r.family, textContent: "Custom" }));
    }
    fam.value = r.family;
    fam.onchange = () => { r.family = fam.value; redraw(); };

    const num = (key, min, max, step = 1) => {
      const n = Object.assign(document.createElement("input"), {
        type: "number", value: r[key], min, max, step, className: "num",
      });
      n.title = key;
      n.oninput = () => { r[key] = Number(n.value); redraw(); };
      return n;
    };
    const colour = document.createElement("select");
    for (const token of TOKENS) {
      colour.append(Object.assign(document.createElement("option"), { value: token, textContent: token }));
    }
    colour.value = r.color ?? "ink";
    colour.onchange = () => { r.color = colour.value; redraw(); };

    line.append(fam, num("size", 8, 120), num("weight", 100, 900, 50), num("line", 0.9, 2.4, 0.01), colour);
    fields.append(field(role, line));
  }

  // --- Footer Actions ---
  const foot = document.createElement("div");
  foot.className = "efoot";

  const save = button("Save & Apply to Deck", "primary", async () => {
    const { ok, data } = await post("/api/templates/save", draft);
    if (!ok) return alertLine(body, data.error);
    await loadTemplates();
    close();
    ops.setTemplate(data.template.id);
    emit("say", `applied ${data.template.name}`);
  });

  const publish = button("Publish to Community", "ghost", async () => {
    const { ok: saveOk, data: savedData } = await post("/api/templates/save", draft);
    if (!saveOk) return alertLine(body, savedData?.error);
    await loadTemplates();
    const { ok, data } = await post("/api/templates/community/publish", {
      template: draft,
      category: "custom",
      tags: ["custom", "community"],
      author: draft.author || "Community Designer",
      description: draft.description || `${draft.name} custom stylesheet`,
    });
    if (ok) {
      emit("say", `published ${draft.name} to Community Catalog`);
      close();
      ops.setTemplate(draft.id);
    } else {
      alertLine(body, data?.error || "could not publish");
    }
  });

  const exportJson = button("Download JSON", "ghost", () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.id}.json`;
    a.click();
  });

  foot.append(save, publish, exportJson, Object.assign(document.createElement("span"), {
    className: "folder",
    textContent: S.templatesDir ? `${S.templatesDir}/${draft.id}.json` : "",
  }));
  body.append(foot);
  redraw();
}

// --- a new deck -----------------------------------------------------------

export function openNewDeck({ folder } = {}) {
  const { body, close } = modal(
    folder ? `New deck in ${folder}` : "New deck",
    "One deck is one topic you are teaching yourself.",
  );
  const form = document.createElement("form");
  const title = Object.assign(document.createElement("input"), {
    className: "big",
    placeholder: "What are you teaching yourself?",
  });
  form.append(title);

  const grid = document.createElement("div");
  grid.className = "tgrid pick";
  let chosen = S.deck?.template ?? "feynman";
  const draw = () => {
    grid.replaceChildren();
    for (const t of S.templates) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tpick" + (chosen === t.id ? " on" : "");
      b.append(miniature(SAMPLE(t), t, { width: 196 }));
      b.append(Object.assign(document.createElement("span"), { className: "lname", textContent: t.name }));
      b.onclick = () => { chosen = t.id; draw(); };
      grid.append(b);
    }
  };
  draw();
  form.append(grid);
  const go = button("Create deck", "primary", () => {});
  go.type = "submit";
  form.append(go);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!title.value.trim()) return title.focus();
    const { ok, data } = await post("/api/decks", {
      title: title.value.trim(),
      template: chosen,
      ...(folder ? { folder } : {}),
    });
    if (!ok) return;
    close();
    location.hash = `#/deck/${data.slug}`;
  };
  body.append(form);
  title.focus();
}

// --- move deck dialog (Google Drive style) ---------------------------------

export async function openMoveDialog(slug, deckTitle, currentFolder, onDone) {
  const { folders } = await fetch("/api/folders").then((r) => r.json()).catch(() => ({ folders: [] }));
  const { body, close } = modal(`Move "${deckTitle}"`, "Choose a destination folder for this deck.");

  const list = document.createElement("div");
  list.className = "move-list";

  let selectedFolder = currentFolder ?? null;

  const renderItems = () => {
    list.replaceChildren();

    const rootItem = document.createElement("div");
    rootItem.className = "move-item" + (selectedFolder === null ? " on" : "");
    rootItem.innerHTML = `<span>${iconSvg("folder-open", 14)} <em>No folder (unfiled)</em></span>`;
    rootItem.onclick = () => { selectedFolder = null; renderItems(); };
    list.append(rootItem);

    for (const f of folders) {
      const item = document.createElement("div");
      item.className = "move-item" + (selectedFolder === f ? " on" : "");
      item.innerHTML = `<span>${iconSvg("folder", 14)} ${f}</span>`;
      item.onclick = () => { selectedFolder = f; renderItems(); };
      list.append(item);
    }
  };
  renderItems();
  body.append(list);

  const actions = document.createElement("div");
  actions.className = "move-actions";

  const newBtn = button("+ New folder", "ghost small", async () => {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    const n = name.trim();
    if (!folders.includes(n)) folders.push(n);
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    selectedFolder = n;
    renderItems();
  });

  const moveBtn = button("Move here", "primary", async () => {
    await fetch(`/api/deck/${slug}/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder: selectedFolder }),
    });
    close();
    onDone?.(selectedFolder);
  });

  actions.append(newBtn, moveBtn);
  body.append(actions);
}

// --- publish template to community -----------------------------------------

export async function openPublishDialog(onDone) {
  await loadTemplates();
  const { body, close } = modal("Publish Stylesheet to Community", "Share your custom stylesheet so it appears in the community registry.");

  const desc = Object.assign(document.createElement("p"), {
    className: "folder",
    textContent: "Select one of your installed stylesheets to publish or export:",
  });
  body.append(desc);

  const selectList = document.createElement("div");
  selectList.className = "move-list";

  let chosen = S.templates[0]?.id;

  const renderSelect = () => {
    selectList.replaceChildren();
    for (const t of S.templates) {
      const item = document.createElement("div");
      item.className = "move-item" + (chosen === t.id ? " on" : "");
      item.innerHTML = `<span>${iconSvg("palette", 14)} <strong>${t.name}</strong> <small style="color:var(--faint)">(${t.id})</small></span>`;
      item.onclick = () => { chosen = t.id; renderSelect(); };
      selectList.append(item);
    }
  };
  renderSelect();
  body.append(selectList);

  const actions = document.createElement("div");
  actions.className = "move-actions";

  const exportBtn = button("Export as JSON", "ghost small", async () => {
    const rawTpl = await fetch(`/api/templates/raw/${chosen}`).then((r) => r.json()).catch(() => null);
    if (!rawTpl) return alertLine(body, "could not load template JSON");
    const blob = new Blob([JSON.stringify(rawTpl, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${chosen}.json`;
    a.click();
  });

  const pubBtn = button("Publish to Registry", "primary", async () => {
    pubBtn.disabled = true;
    pubBtn.textContent = "Publishing...";
    const { ok, data } = await post("/api/templates/community/publish", { id: chosen });
    if (!ok) {
      pubBtn.disabled = false;
      pubBtn.textContent = "Publish to Registry";
      return alertLine(body, data?.error ?? "publish failed");
    }
    close();
    onDone?.();
  });

  actions.append(exportBtn, pubBtn);
  body.append(actions);
}
