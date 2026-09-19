// Phosphor Icons SVG Catalog & Helpers (https://phosphoricons.com/)
//
// Clean, flexible 256x256 vector icons with consistent 16px stroke and rounded joints.
// Pure offline SVG - zero external dependencies, zero layout shifts, styled with currentColor.

export const PHOSPHOR_ICONS = {
  brain: `
    <path d="M168,40a40,40,0,0,0-40,40v96a40,40,0,0,0,40,40,39.9,39.9,0,0,0,38-27.6A40,40,0,0,0,216,152a39.4,39.4,0,0,0-5.7-20.4A40,40,0,0,0,208,80,40,40,0,0,0,168,40Z"/>
    <path d="M88,40A40,40,0,0,0,48,80a40,40,0,0,0-2.3,51.6A39.4,39.4,0,0,0,40,152a40,40,0,0,0,9.9,26.4A39.9,39.9,0,0,0,88,216a40,40,0,0,0,40-40V80A40,40,0,0,0,88,40Z"/>
    <path d="M128,120h40a24,24,0,0,1,24,24"/>
    <path d="M128,152h40"/>
    <path d="M128,88h40"/>
    <path d="M88,144a24,24,0,0,1,24-24h16"/>
    <path d="M88,152h40"/>
    <path d="M88,88h40"/>
  `,

  copy: `
    <rect x="40" y="40" width="136" height="136" rx="8"/>
    <path d="M80,80v128a8,8,0,0,0,8,8H216a8,8,0,0,0,8-8V88a8,8,0,0,0-8-8H88"/>
  `,

  "pencil-simple": `
    <path d="M92.7,216H48a8,8,0,0,1-8-8V163.3a7.9,7.9,0,0,1,2.3-5.6l120-120a8,8,0,0,1,11.4,0l44.6,44.7a8,8,0,0,1,0,11.3l-120,120A7.9,7.9,0,0,1,92.7,216Z"/>
    <line x1="136" y1="64" x2="192" y2="120"/>
  `,

  folder: `
    <path d="M32,80a8,8,0,0,1,8-8H92.7a8.2,8.2,0,0,1,5.7,2.3L128,104h88a8,8,0,0,1,8,8v96a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8Z"/>
  `,

  "folder-open": `
    <path d="M32,80a8,8,0,0,1,8-8H92.7a8.2,8.2,0,0,1,5.7,2.3L128,104h88a8,8,0,0,1,8,8v16H40.8a8,8,0,0,0-7.8,6.2L20.4,195.8A8,8,0,0,1,12.6,188V80A8,8,0,0,1,32,80Z"/>
    <path d="M228.4,142.1A8,8,0,0,0,221.7,136H40.8a8,8,0,0,0-7.8,6.2L8.7,214.6A8,8,0,0,0,16.5,224H216a8,8,0,0,0,7.8-6.2Z"/>
  `,

  trash: `
    <line x1="216" y1="56" x2="40" y2="56"/>
    <line x1="104" y1="104" x2="104" y2="168"/>
    <line x1="152" y1="104" x2="152" y2="168"/>
    <path d="M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56"/>
    <path d="M168,56V40a16,16,0,0,0-16-16H104A16,16,0,0,0,88,40V56"/>
  `,

  "magnifying-glass": `
    <circle cx="112" cy="112" r="80"/>
    <line x1="168.5" y1="168.5" x2="224" y2="224"/>
  `,

  "graduation-cap": `
    <polygon points="128 32 16 96 128 160 240 96 128 32"/>
    <path d="M56,120v64c0,35.3,32.2,64,72,64s72-28.7,72-64V120"/>
    <path d="M240,96v64"/>
  `,

  "rocket-launch": `
    <path d="M136,40h-8a8,8,0,0,0-8,8V96a8,8,0,0,0,8,8h8a8,8,0,0,0,8-8V48A8,8,0,0,0,136,40Z"/>
    <path d="M192,88c0,48-40,88-88,88H72a8,8,0,0,1-8-8V136c0-48,40-88,88-88h40"/>
    <path d="M72,168l-40,40"/>
    <path d="M104,200l-40,40"/>
    <circle cx="168" cy="72" r="16"/>
  `,

  sparkle: `
    <path d="M128,24L148,96L220,116L148,136L128,208L108,136L36,116L108,96Z"/>
    <path d="M192,176L200,200L224,208L200,216L192,240L184,216L160,208L184,200Z"/>
    <path d="M64,32L70,50L88,56L70,62L64,80L58,62L40,56L58,50Z"/>
  `,

  "terminal-window": `
    <rect x="32" y="48" width="192" height="160" rx="8"/>
    <line x1="32" y1="96" x2="224" y2="96"/>
    <polyline points="80 136 104 152 80 168"/>
    <line x1="128" y1="168" x2="152" y2="168"/>
  `,

  palette: `
    <path d="M196,176a36,36,0,0,1-36,36H116a84,84,0,1,1,84-84c0,8.8-3.6,16-10.5,21.5A35.8,35.8,0,0,1,196,176Z"/>
    <circle cx="92" cy="100" r="10" fill="currentColor"/>
    <circle cx="140" cy="84" r="10" fill="currentColor"/>
    <circle cx="164" cy="132" r="10" fill="currentColor"/>
  `,

  "warning-circle": `
    <circle cx="128" cy="128" r="96"/>
    <line x1="128" y1="80" x2="128" y2="136"/>
    <circle cx="128" cy="172" r="10" fill="currentColor"/>
  `,

  "check-circle": `
    <circle cx="128" cy="128" r="96"/>
    <polyline points="88 136 112 160 168 104"/>
  `,

  play: `
    <polygon points="80 40 208 128 80 216 80 40" fill="currentColor" stroke="none"/>
  `,

  eye: `
    <path d="M128,56C48,56,16,128,16,128s32,72,112,72,112-72,112-72S208,56,128,56Z"/>
    <circle cx="128" cy="128" r="40"/>
  `,

  "shield-check": `
    <path d="M208,40H48A8,8,0,0,0,40,48V112c0,56.7,35.9,103.8,85.2,118.9a7.8,7.8,0,0,0,5.6,0C180.1,215.8,216,168.7,216,112V48A8,8,0,0,0,208,40Z"/>
    <polyline points="88 112 112 136 168 80"/>
  `,

  "lock-simple": `
    <rect x="40" y="88" width="176" height="128" rx="8"/>
    <path d="M88,88V56a40,40,0,0,1,80,0V88"/>
  `,

  "arrows-clockwise": `
    <polyline points="176.4 99.7 224.2 99.7 224.2 51.9"/>
    <path d="M190.2,190.2a88,88,0,1,1,0-124.4l34,33.9"/>
  `,

  check: `
    <polyline points="216 72 104 184 48 128"/>
  `,

  "sliders-horizontal": `
    <line x1="40" y1="80" x2="152" y2="80"/>
    <line x1="184" y1="80" x2="216" y2="80"/>
    <circle cx="168" cy="80" r="16"/>
    <line x1="40" y1="176" x2="72" y2="176"/>
    <line x1="104" y1="176" x2="216" y2="176"/>
    <circle cx="88" cy="176" r="16"/>
  `,
};

/**
 * Return an SVG HTML string for a Phosphor icon.
 *
 * @param {string} name - Icon name
 * @param {number} [size=16] - Pixel dimension
 * @param {string} [cls=""] - Optional CSS class
 * @returns {string}
 */
export function iconSvg(name, size = 16, cls = "") {
  const inner = PHOSPHOR_ICONS[name] || PHOSPHOR_ICONS.sparkle;
  const classes = `ph ph-${name} ${cls}`.trim();
  const sw = size <= 12 ? 26 : size <= 16 ? 24 : 20;
  return `<svg class="${classes}" viewBox="0 0 256 256" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * Create an SVG DOM element for a Phosphor icon.
 *
 * @param {string} name - Icon name
 * @param {number} [size=16] - Pixel dimension
 * @param {string} [cls=""] - Optional CSS class
 * @returns {SVGSVGElement}
 */
export function icon(name, size = 16, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  const sw = size <= 12 ? "26" : size <= 16 ? "24" : "20";
  svg.setAttribute("stroke-width", sw);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `ph ph-${name} ${cls}`.trim());
  svg.innerHTML = PHOSPHOR_ICONS[name] || PHOSPHOR_ICONS.sparkle;
  return svg;
}
