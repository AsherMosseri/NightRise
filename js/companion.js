/* The nocturnal companion: adoption, feeding, evolution and its little SVG body. */

import { svg } from './dom.js';

export const COMPANIONS = [
  { id: 'owl', name: 'Owl', cost: 480, desc: 'Silent, watchful, mildly judgemental.', palette: ['#c9a26b', '#7b5c34'] },
  { id: 'cat', name: 'Cat', cost: 550, desc: 'Supervises from the edge of the screen.', palette: ['#6f7fbc', '#3c4570'] },
  { id: 'fox', name: 'Fox', cost: 700, desc: 'Sharp-eyed, and never far from the last task.', palette: ['#e08a4a', '#8c4a20'] },
  { id: 'bat', name: 'Bat', cost: 660, desc: 'Awake at this hour on purpose, unlike you.', palette: ['#9b7fd4', '#4b3a78'] },
  { id: 'hare', name: 'Hare', cost: 720, desc: 'Ready to bolt, and never does.', palette: ['#c8b49a', '#6d5942'] },
  { id: 'hedgehog', name: 'Hedgehog', cost: 780, desc: 'Out on business of its own, most of the night.', palette: ['#b09a86', '#54443a'] },
  { id: 'moth', name: 'Moth', cost: 840, desc: 'Turned up for the lamp and stayed for the company.', palette: ['#d6cbb6', '#615647'] },
  { id: 'raccoon', name: 'Raccoon', cost: 900, desc: 'Has been through your things and regrets nothing.', palette: ['#9aa3b4', '#454c5e'] },
];

/** Stardust to feed from tier N to N+1, and the total feeds needed. */
export const TIER_FEEDS = [0, 5, 14, 30];
export const FEED_COST = 33;

export function companionById(id) {
  return COMPANIONS.find((c) => c.id === id) || null;
}

export function tierForFeeds(fed) {
  let tier = 1;
  for (let i = 1; i < TIER_FEEDS.length; i += 1) {
    if (fed >= TIER_FEEDS[i]) tier = i + 1;
  }
  return tier;
}

export function feedsToNextTier(fed) {
  const tier = tierForFeeds(fed);
  if (tier >= TIER_FEEDS.length) return null;
  return TIER_FEEDS[tier] - fed;
}

export const TIER_NAMES = ['Fledgling', 'Companion', 'Familiar', 'Guardian'];

/**
 * Build the companion's SVG. Species differ by silhouette; tier adds glow,
 * stars and a small crown of light. Mood drives the eyes.
 */
/**
 * Each species as path data in a shared 100x100 box.
 *
 * This was an if / else-if chain whose final `else` was the bat, so a species
 * added to COMPANIONS but not to the chain rendered silently as a bat — a whole
 * animal you paid for, drawn as a different one, with nothing anywhere saying
 * so. A miss here returns null instead, which every caller already handles.
 *
 * `body` takes the species gradient; each layer after it is drawn in order.
 * `fill: 'dark'` resolves to the species' own dark palette colour, which is why
 * the layers are data rather than finished attributes.
 */
const SPECIES = {
  owl: {
    body: 'M50 18c16 0 26 14 26 32s-11 32-26 32-26-14-26-32 10-32 26-32z',
    layers: [
      { d: 'M28 26l10 8-12 4zM72 26L62 34l12 4z', fill: 'dark' },
      { d: 'M50 56l-6 10h12z', fill: '#f4c86a' },
    ],
    eyeY: 48,
  },
  cat: {
    body: 'M50 22c15 0 24 12 24 28S65 82 50 82 26 66 26 50 35 22 50 22z',
    layers: [
      { d: 'M30 30l2-14 13 9zM70 30l-2-14-13 9z', fill: 'dark' },
      {
        d: 'M42 58h16M50 54v6',
        stroke: '#f6f2ff', 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none', opacity: 0.7,
      },
    ],
    eyeY: 48,
  },
  fox: {
    body: 'M50 24c14 0 23 11 23 26 0 17-10 32-23 32S27 67 27 50c0-15 9-26 23-26z',
    layers: [
      { d: 'M29 32l-3-16 15 8zM71 32l3-16-15 8z', fill: 'dark' },
      { d: 'M50 62l-5 8h10z', fill: '#2a1a10' },
    ],
    eyeY: 48,
  },
  bat: {
    body: 'M50 30c11 0 18 9 18 22s-7 22-18 22-18-9-18-22 7-22 18-22z',
    layers: [
      { d: 'M32 42C20 30 10 32 8 28c6 2 10-6 24 6zM68 42c12-12 22-10 24-14-6 2-10-6-24 6z', fill: 'dark', opacity: 0.95 },
      { d: 'M40 30l3-10 4 8zM60 30l-3-10-4 8z', fill: 'dark' },
    ],
    eyeY: 46,
  },
  hare: {
    body: 'M50 30c13 0 21 11 21 26s-9 26-21 26-21-11-21-26 8-26 21-26z',
    layers: [
      // The ears are the whole animal at this size, so they are long and
      // slightly splayed rather than symmetric — a hare's never match.
      { d: 'M41 32c-4-14-5-24-2-26s7 8 8 24zM59 32c4-13 6-23 9-21s0 11-4 23z', fill: 'dark' },
      { d: 'M50 60l-4 6h8z', fill: '#e79aa6' },
    ],
    eyeY: 50,
  },
  hedgehog: {
    body: 'M50 34c14 0 22 10 22 24S64 82 50 82 28 72 28 58s8-24 22-24z',
    layers: [
      { d: 'M30 50l-6-11 10 4 2-12 7 9 5-12 5 12 7-9 2 12 10-4-6 11z', fill: 'dark' },
      { d: 'M50 64l-3 5h6z', fill: '#2a1a14' },
    ],
    eyeY: 54,
  },
  moth: {
    body: 'M50 34c7 0 11 7 11 18s-4 20-11 20-11-9-11-20 4-18 11-18z',
    layers: [
      { d: 'M39 44C24 30 10 34 9 44s10 20 30 14zM61 44c15-14 29-10 30 0s-10 20-30 14z', fill: 'dark', opacity: 0.9 },
      { d: 'M45 32c-3-9-8-13-11-12s0 7 8 13zM55 32c3-9 8-13 11-12s0 7-8 13z', fill: 'dark' },
    ],
    eyeY: 46,
  },
  raccoon: {
    body: 'M50 26c15 0 24 12 24 28S65 82 50 82 26 68 26 54 35 26 50 26z',
    layers: [
      { d: 'M31 30l1-13 12 8zM69 30l-1-13-12 8z', fill: 'dark' },
      // The mask, which is the only reason anyone recognises a raccoon.
      { d: 'M32 46q8-6 15 0-7 8-15 0zM68 46q-8-6-15 0 7 8 15 0z', fill: 'dark', opacity: 0.85 },
      { d: 'M50 60l-4 6h8z', fill: '#241a16' },
    ],
    eyeY: 46,
  },
};

/** Which species can actually be drawn — the shop is tested against it. */
export const SPECIES_IDS = Object.keys(SPECIES);

export function companionSvg(type, tier = 1, mood = 'idle') {
  const def = companionById(type);
  if (!def) return null;
  const [light, dark] = def.palette;
  const eyeOpen = mood !== 'sleepy';
  const grin = mood === 'happy';

  const parts = [];
  const gradientId = `cg-${type}`;

  parts.push(svg('defs', {},
    svg('radialGradient', { id: gradientId, cx: '50%', cy: '35%' },
      svg('stop', { offset: '0%', 'stop-color': light }),
      svg('stop', { offset: '100%', 'stop-color': dark }))));

  if (tier >= 2) {
    parts.push(svg('circle', { cx: 50, cy: 52, r: 40, fill: light, opacity: 0.12, class: 'companion__halo' }));
  }

  // Species silhouettes, all built from the same 100x100 box.
  const shape = SPECIES[type];
  if (!shape) return null;
  parts.push(svg('path', { d: shape.body, fill: `url(#${gradientId})` }));
  for (const layer of shape.layers) {
    parts.push(svg('path', { ...layer, fill: layer.fill === 'dark' ? dark : layer.fill }));
  }

  const eyeY = shape.eyeY;
  if (eyeOpen) {
    parts.push(svg('circle', { cx: 42, cy: eyeY, r: 4.4, fill: '#0d0b1c' }));
    parts.push(svg('circle', { cx: 58, cy: eyeY, r: 4.4, fill: '#0d0b1c' }));
    parts.push(svg('circle', { cx: 43.4, cy: eyeY - 1.4, r: 1.5, fill: '#fff', opacity: 0.9 }));
    parts.push(svg('circle', { cx: 59.4, cy: eyeY - 1.4, r: 1.5, fill: '#fff', opacity: 0.9 }));
  } else {
    parts.push(svg('path', {
      d: `M37 ${eyeY}q5 4 10 0M53 ${eyeY}q5 4 10 0`,
      stroke: '#0d0b1c', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none',
    }));
  }

  if (grin) {
    parts.push(svg('path', {
      d: 'M43 66q7 6 14 0', stroke: '#0d0b1c', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none', opacity: 0.75,
    }));
  }

  if (tier >= 3) {
    parts.push(svg('path', {
      d: 'M50 8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z',
      fill: '#ffe9a8', opacity: 0.95,
    }));
  }
  if (tier >= 4) {
    parts.push(svg('circle', { cx: 50, cy: 52, r: 46, fill: 'none', stroke: light, 'stroke-dasharray': '3 7', opacity: 0.55, class: 'companion__ring' }));
  }

  return svg('svg', {
    viewBox: '0 0 100 100', class: `companion__art companion__art--${type}`, 'aria-hidden': 'true', focusable: 'false',
  }, ...parts);
}
