/* Tiny DOM helpers — build elements as trees instead of HTML strings. */

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(node, props, svg) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) node.dataset[k] = v;
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (!svg && key in node && key !== 'list' && key !== 'form' && key !== 'type') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props, false);
  appendChildren(node, children);
  return node;
}

export function svg(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props, true);
  appendChildren(node, children);
  return node;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function replace(node, ...children) {
  clear(node);
  appendChildren(node, children);
  return node;
}

/**
 * Re-render `host` without throwing away the keyboard.
 *
 * These panels rebuild wholesale on every state change, which used to drop
 * focus to <body> — so buying one thing in the shop, or the 30-second countdown
 * tick, silently ejected a keyboard user from wherever they were.
 */
export function withFocus(host, render) {
  const active = document.activeElement;
  const inside = active && host.contains(active);
  const key = inside ? active.dataset?.focus : null;
  const index = inside && !key
    ? Array.from(host.querySelectorAll('button, input, select, textarea, [tabindex="0"]')).indexOf(active)
    : -1;
  const caret = inside && active.selectionStart !== undefined
    ? [active.selectionStart, active.selectionEnd]
    : null;

  render();

  if (!inside) return;
  let next = key ? host.querySelector(`[data-focus="${CSS.escape(key)}"]`) : null;
  if (!next && index > -1) {
    next = host.querySelectorAll('button, input, select, textarea, [tabindex="0"]')[index] || null;
  }
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret && next.setSelectionRange) {
    try {
      next.setSelectionRange(caret[0], caret[1]);
    } catch {
      /* not a text field any more */
    }
  }
}

/** Icon set — inline SVG so the app stays offline-capable and dependency free. */
const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M10 5h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-9L3 12zM13 9.5l5 5M18 9.5l-5 5',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pencil: 'M4 20h4L20 8l-4-4L4 16v4z',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  check: 'M4 12l6 6L20 6',
  close: 'M6 6l12 12M18 6L6 18',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  star: 'M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z',
  bag: 'M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM12 2.6l1.5 2.2 2.6-.5.6 2.6 2.4 1.1-1 2.5 1 2.5-2.4 1.1-.6 2.6-2.6-.5L12 21.4l-1.5-2.2-2.6.5-.6-2.6-2.4-1.1 1-2.5-1-2.5 2.4-1.1.6-2.6 2.6.5z',
  volume: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM15.5 9.5a4 4 0 0 1 0 5M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM16 10l4.5 4.5M20.5 10L16 14.5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  skip: 'M6 6l8 6-8 6zM17 6v12',
  play: 'M7 5l12 7-12 7z',
  pause: 'M9 5v14M15 5v14',
  undo: 'M9 14l-4-4 4-4M5 10h8a5 5 0 0 1 0 10h-3',
  map: 'M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4zM9 4v13M15 6.5v13',
  flame: 'M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7 1-3 1-3s.5 2 2 2c0-3 2-5 2-8z',
};

/**
 * Per glyph: [x, y, width, height, inkCentroidX, inkCentroidY] in the 24-unit
 * box. The box drives the scale; the ink centroid drives the position.
 * Generated by rasterising each stroked path — regenerate if a path changes.
 */
const ICON_BOX = {
  plus: [5, 5, 14, 14, 11.95, 11.95],
  // Same span as `plus`, so the two take the same scale and the bars match.
  minus: [5, 12, 14, 0, 11.95, 11.95],
  back: [3, 5, 17, 14, 12.2, 11.95],
  trash: [4, 5, 16, 15, 11.95, 12.14],
  pencil: [4, 4, 16, 16, 11.47, 12.43],
  up: [5, 5, 14, 14, 11.95, 10.4],
  down: [5, 5, 14, 14, 11.95, 13.5],
  grip: [9, 6, 6.01, 12, 11.95, 11.95],
  more: [6, 12, 12.01, 0, 11.95, 11.95],
  check: [4, 6, 16, 12, 12.15, 12.76],
  close: [6, 6, 12, 12, 11.95, 11.95],
  moon: [3.32, 4, 16.68, 16.68, 9.95, 13.95],
  star: [3.4, 3.5, 17.2, 16.6, 11.95, 12.64],
  bag: [6, 3, 12, 17, 11.95, 11.83],
  calendar: [4, 3, 16, 17, 11.95, 11.67],
  chart: [5, 4, 14, 16, 11.38, 13.88],
  gear: [4.9, 2.6, 14.2, 18.8, 11.95, 11.95],
  volume: [4, 5.5, 16.69, 13, 12.36, 11.95],
  mute: [4, 5.5, 16.5, 13, 11.47, 12.02],
  bulb: [5.96, 3, 12.08, 18, 11.95, 11.93],
  keyboard: [3, 7, 18, 10, 11.89, 12.21],
  download: [5, 4, 14, 16, 11.95, 14.53],
  upload: [5, 4, 14, 16, 11.95, 9.37],
  skip: [6, 6, 11, 12, 11.03, 11.95],
  play: [7, 5, 12, 14, 11, 11.95],
  pause: [9, 5, 6, 14, 11.95, 11.95],
  undo: [5, 6, 13, 14, 11.7, 12.98],
  map: [3, 4, 18, 15.5, 11.95, 11.7],
  flame: [7, 3, 10, 14, 11.99, 10.76],
};

/** Every glyph is centred and scaled to this optical span, so the set reads as
 *  one weight rather than as twenty-five drawings of different sizes.
 *  The measured spread before normalising was 12 to 18.8 units. */
const OPTICAL_SPAN = 16.8;
const STROKE = 1.8;
/** Dot patterns are not glyphs; scaling them just spreads the dots. */
const UNSCALED = new Set(['more', 'grip']);
/**
 * How far the ink centroid may pull a glyph off its bounding-box centre.
 *
 * A five-pointed star carries its mass low — its box centre sits above its ink,
 * so box-centring drops it, which is exactly what you see next to a word like
 * "stardust" that has no descenders to balance it. Correcting by the centroid
 * fixes that. But an up-arrow, a download arrow and a bar chart are *meant* to
 * be lopsided (their mass is in the head, or along the bottom), and their
 * centroids are 1.5-2.6 units out. Capping the correction fixes the accidental
 * asymmetries and leaves the deliberate ones alone.
 */
const MAX_OPTICAL_NUDGE = 1;

export function icon(name, { size = 18, className = '' } = {}) {
  const path = ICON_PATHS[name] || ICON_PATHS.star;
  const box = ICON_BOX[name];

  let transform = null;
  let strokeWidth = STROKE;
  if (box && !UNSCALED.has(name)) {
    const [x, y, w, h, inkX, inkY] = box;
    const span = Math.max(w, h);
    // Clamped so a deliberately small glyph is nudged, not inflated.
    const scale = Math.min(1.3, Math.max(0.92, OPTICAL_SPAN / span));
    const nudge = (ink, mid) => {
      const delta = ink - mid;
      return Math.abs(delta) <= MAX_OPTICAL_NUDGE ? delta : 0;
    };
    const cx = x + w / 2 + nudge(inkX, x + w / 2);
    const cy = y + h / 2 + nudge(inkY, y + h / 2);
    if (Math.abs(scale - 1) > 0.01 || Math.abs(cx - 12) > 0.05 || Math.abs(cy - 12) > 0.05) {
      transform = `translate(${(12 - cx * scale).toFixed(3)} ${(12 - cy * scale).toFixed(3)}) scale(${scale.toFixed(4)})`;
      // Compensate so the scale cannot change the apparent stroke weight.
      strokeWidth = +(STROKE / scale).toFixed(3);
    }
  }

  const drawn = svg('path', { d: path, 'stroke-width': strokeWidth });
  return svg('svg', {
    class: `icon ${className}`.trim(),
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': STROKE,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, transform ? svg('g', { transform }, drawn) : drawn);
}

/** Icon-only button with an accessible label + tooltip. */
export function iconButton(name, label, onClick, extra = {}) {
  return h('button', {
    type: 'button',
    class: `icon-btn ${extra.class || ''}`.trim(),
    title: label,
    'aria-label': label,
    dataset: extra.dataset,
    onClick,
  }, icon(name, { size: extra.size || 16 }));
}
