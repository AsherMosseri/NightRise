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

/** Icon set — inline SVG so the app stays offline-capable and dependency free. */
const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
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
  undo: 'M9 14l-4-4 4-4M5 10h8a5 5 0 0 1 0 10h-3',
  map: 'M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4zM9 4v13M15 6.5v13',
  flame: 'M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7 1-3 1-3s.5 2 2 2c0-3 2-5 2-8z',
};

export function icon(name, { size = 18, className = '' } = {}) {
  const path = ICON_PATHS[name] || ICON_PATHS.star;
  return svg('svg', {
    class: `icon ${className}`.trim(),
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, svg('path', { d: path }));
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
