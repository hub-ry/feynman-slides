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

export async function openTemplates(tab = "installed") {
  const { body, close, dlg } = modal("Templates", "The look of a deck lives here, not on the slide.");
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
  for (const [name, label] of [["installed", "Installed"], ["community", "Community"], ["make", "Make one"]]) {
    const b = button(label, "tab", () => show(name));
    b.dataset.tab = name;
    tabs.append(b);
  }
  await show(tab);
}

function card(t, actions) {
  const el = document.createElement("div");
  el.className = "tcard" + (S.deck.template === t.id ? " using" : "");
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
      if (S.deck.template === t.id) {
        actions.push(Object.assign(document.createElement("span"), { className: "using-tag", textContent: "in use" }));
      } else {
        actions.push(button("Use", "primary small", () => { ops.setTemplate(t.id); close(); }));
      }
      actions.push(button(t.builtin ? "Duplicate" : "Edit", "small ghost", () => {
        close();
        openEditor(t.id, { fork: Boolean(t.builtin) });
      }));
      if (!t.builtin) {
        actions.push(button("Remove", "small ghost danger", async () => {
          const { ok, data } = await post("/api/templates/remove", { id: t.id });
          if (!ok) return alertLine(wrap, data.error);
          if (S.deck.template === t.id) ops.setTemplate("feynman");
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
        textContent: `Your templates are files in ${S.templatesDir} - drop a .json in there and it appears here.`,
      }));
    }
    return wrap;
  },

  async community({ show }) {
    const wrap = document.createElement("div");
    const r = await fetch("/api/templates/catalog").then((x) => x.json()).catch(() => null);
    const line = document.createElement("p");
    line.className = "folder";
    line.textContent = !r
      ? "Could not read the catalogue."
      : r.error
        ? `Showing the bundled catalogue - the registry did not answer (${r.error}).`
        : r.source === "bundled"
          ? "The catalogue that ships with the tool. Point FEYNMAN_TEMPLATE_REGISTRY at your own to add to it."
          : `From ${r.source}.`;
    wrap.append(line);

    const grid = document.createElement("div");
    grid.className = "tgrid";
    for (const e of r?.entries ?? []) {
      const install = e.installed
        ? Object.assign(document.createElement("span"), { className: "using-tag", textContent: "installed" })
        : button("Install", "primary small", async (ev) => {
            ev.target.disabled = true;
            ev.target.textContent = "installing";
            const { ok, data } = await post("/api/templates/install", { url: e.url });
            if (!ok) return alertLine(wrap, data.error);
            await loadTemplates();
            show("community");
          });
      grid.append(card({ ...e, layouts: [], roles: {} }, [
        install,
        Object.assign(document.createElement("span"), { className: "ver", textContent: `v${e.version}` }),
      ]));
    }
    wrap.append(grid);

    // Sharing one is the same shape as installing one: a file at a URL.
    const form = document.createElement("form");
    form.className = "fromurl";
    const input = Object.assign(document.createElement("input"), {
      placeholder: "https://.../template.json",
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
//
// Four colours and a type scale. Not a design tool - the things in here are
// the things the renderer actually reads, and anything more expressive is a
// reason to open the JSON, which is why the path to it is printed at the
// bottom of this form.

const STACKS = {
  Sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  Serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  Mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export async function openEditor(id, { fork = false } = {}) {
  const raw = await fetch(`/api/templates/raw/${id}`).then((r) => (r.ok ? r.json() : null));
  if (!raw) return;
  const draft = structuredClone(raw);
  if (fork) {
    draft.id = `${raw.id}-mine`;
    draft.name = `${raw.name} (mine)`;
    draft.author = "you";
  }
  delete draft.builtin;

  const { body, close } = modal(fork ? "New template" : `Edit ${raw.name}`,
    "Colours and type. Layouts come from the deck you made it out of.");
  body.parentElement.classList.add("wide");

  const form = document.createElement("div");
  form.className = "editor-grid";
  const fields = document.createElement("div");
  fields.className = "fields";
  const preview = document.createElement("div");
  preview.className = "epreview";
  form.append(fields, preview);
  body.append(form);

  const redraw = () => {
    const t = normalize(draft);
    preview.replaceChildren(miniature(SAMPLE(t), t, { width: 380 }));
  };

  const field = (label, node) => {
    const row = document.createElement("label");
    row.className = "field";
    row.append(Object.assign(document.createElement("span"), { textContent: label }), node);
    return row;
  };

  const nameIn = Object.assign(document.createElement("input"), { value: draft.name });
  nameIn.oninput = () => { draft.name = nameIn.value; };
  const idIn = Object.assign(document.createElement("input"), { value: draft.id });
  idIn.oninput = () => { draft.id = slugOf(idIn.value); idIn.value = draft.id; };
  fields.append(field("Name", nameIn), field("Folder name", idIn));

  const colours = document.createElement("div");
  colours.className = "colours";
  for (const token of TOKENS) {
    const input = Object.assign(document.createElement("input"), {
      type: "color",
      value: (draft.palette?.[token] ?? "#000000").slice(0, 7),
    });
    input.oninput = () => { (draft.palette ??= {})[token] = input.value; redraw(); };
    const cell = document.createElement("label");
    cell.className = "colour";
    cell.append(input, Object.assign(document.createElement("span"), { textContent: token }));
    colours.append(cell);
  }
  fields.append(field("Colours", colours));

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

  const foot = document.createElement("div");
  foot.className = "efoot";
  const save = button("Save template", "primary", async () => {
    const { ok, data } = await post("/api/templates/save", draft);
    if (!ok) return alertLine(body, data.error);
    await loadTemplates();
    close();
    ops.setTemplate(data.template.id);
    emit("say", `saved ${data.template.name}`);
  });
  foot.append(save, Object.assign(document.createElement("span"), {
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
