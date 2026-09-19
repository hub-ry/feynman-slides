---
name: phosphor-icons
description: >
  Guide, catalog reference, and implementation patterns for Phosphor Icons (https://phosphoricons.com/
  and https://github.com/phosphor-icons). Use when designing user interfaces, selecting icons,
  implementing SVG icon systems, replacing emojis with vector icons, using @phosphor-icons/core
  or @phosphor-icons/web, and establishing consistent iconography across web applications and presentations.
license: MIT
metadata:
  version: "1.0.0"
  homepage: "https://phosphoricons.com/"
  repository: "https://github.com/phosphor-icons/homepage"
---

# Phosphor Icons Guide & Reference

Phosphor is a flexible icon family for interfaces, diagrams, presentations, and design systems.
It provides a cohesive visual language with over 1,200 icons across 6 distinct weights.

## 1. Core Principles & Vector Specifications

- **Grid Canvas**: 256&times;256 px bounding box.
- **Stroke Weights**:
  - `Regular`: 16px stroke width, rounded caps (`stroke-linecap="round"`), rounded joins (`stroke-linejoin="round"`).
  - `Bold`: 24px stroke width for strong emphasis and tiny sizes (&le;16px).
  - `Light`: 12px stroke width for delicate, spacious UIs.
  - `Thin`: 8px stroke width for editorial and minimal display layouts.
  - `Fill`: Solid silhouette for active tabs, selected states, and filled badges.
  - `Duotone`: Two-tone depth using a 0.2 opacity fill on secondary paths.
- **Styling**: Always use `fill="none" stroke="currentColor"` so icons automatically inherit text color, dark mode themes, and hover states.

---

## 2. Why Replace Emojis with Phosphor Icons

1. **Cross-Platform Consistency**: Emojis render completely differently on Apple (Apple Color Emoji), Google (Noto Color), Microsoft (Segoe UI Emoji), and Linux. Phosphor renders identically across every browser and operating system.
2. **Color & Theme Harmony**: Emojis have rigid, baked-in bright colors that clash with custom palettes and dark modes. Phosphor icons inherit `currentColor` or specific brand accents.
3. **Stroke Weight Alignment**: Phosphor icons align optically with your typography and interface rules.
4. **Professionalism**: Eliminates cartoonish visual noise from cards, menus, tags, and buttons.

---

## 3. Implementation Patterns

### Pattern A: Self-Contained Offline SVG Component (Recommended for Zero-Dep Web Apps)

For apps requiring zero network calls, zero npm bloat, and instant rendering:

```js
// icons.js
export const PHOSPHOR_ICONS = {
  brain: `<path d="M168,40a40,40,0,0,0-40,40v96a40,40,0,0,0,40,40,39.9,39.9,0,0,0,38-27.6A40,40,0,0,0,216,152a39.4,39.4,0,0,0-5.7-20.4A40,40,0,0,0,208,80,40,40,0,0,0,168,40Z"/>...`,
  folder: `<path d="M32,80a8,8,0,0,1,8-8H92.7a8.2,8.2,0,0,1,5.7,2.3L128,104h88a8,8,0,0,1,8,8v96a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8Z"/>`,
  copy: `<rect x="40" y="40" width="136" height="136" rx="8"/><path d="M80,80v128a8,8,0,0,0,8,8H216a8,8,0,0,0,8-8V88a8,8,0,0,0-8-8H88"/>`,
  trash: `<line x1="216" y1="56" x2="40" y2="56"/><path d="M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56"/>...`,
};

export function iconSvg(name, size = 16, cls = "") {
  const inner = PHOSPHOR_ICONS[name] || "";
  return `<svg class="ph ph-${name} ${cls}".trim() viewBox="0 0 256 256" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
```

CSS Alignment:
```css
.ph {
  display: inline-block;
  vertical-align: -0.15em;
  flex-shrink: 0;
}
```

### Pattern B: Webfont / `@phosphor-icons/web`

```html
<link rel="stylesheet" type="text/css" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css" />
<i class="ph ph-brain"></i>
<i class="ph ph-folder"></i>
```

### Pattern C: React / Vue / Svelte

```jsx
import { Brain, Folder, Copy, Trash } from "@phosphor-icons/react";

<Brain size={18} weight="regular" color="currentColor" />
```

---

## 4. Emoji to Phosphor Mapping Quick Reference

| UI Action / Concept | Former Emoji | Recommended Phosphor Icon | Icon Name |
| :--- | :--- | :--- | :--- |
| **Study / Active Recall** | 🧠 | Brain | `brain` |
| **Duplicate / Clone** | 📋 | Copy | `copy` |
| **Edit / Rename** | ✏️ | Pencil Simple | `pencil-simple` |
| **Folders / Hierarchy** | 📁 | Folder | `folder` |
| **Open / Unfiled** | 📂 | Folder Open | `folder-open` |
| **Delete / Remove** | 🗑️ | Trash | `trash` |
| **Search / Find** | 🔍 | Magnifying Glass | `magnifying-glass` |
| **Academic / Lecture** | 🎓 | Graduation Cap | `graduation-cap` |
| **Pitch / Launch** | 🚀 | Rocket Launch | `rocket-launch` |
| **Minimal / Polish** | ✨ | Sparkle | `sparkle` |
| **Code / Technical** | 💻 | Terminal Window / Code | `terminal-window` / `code` |
| **Themes / Palettes** | 🎨 | Palette | `palette` |
| **Alert / Warning** | ⚠️ | Warning Circle / Warning | `warning-circle` |
| **Success / Strength** | ✅ / ✓ | Check Circle / Check | `check-circle` |
| **Present / Play** | ▶️ | Play | `play` |
| **Download / Export** | 💾 / 📥 | Download Simple | `download-simple` |

---

## 5. Best Practices Checklist

- [x] **Set `aria-hidden="true"` on decorative icons** to prevent screen-readers from announcing raw SVG paths.
- [x] **Use `vertical-align: -0.15em`** so inline icons align naturally with adjacent font baselines.
- [x] **Rely on `currentColor`**: Avoid hardcoded hex fills in icon SVG strings so that `:hover`, `:active`, and dark mode work without extra code.
- [x] **Match stroke weight to scale**: At 14–16px, Phosphor's 16px stroke remains crisp and legible on retina and non-retina screens.
