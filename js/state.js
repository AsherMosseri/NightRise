/* The single store: one state object, subscribers, and a small event bus
   for one-off effects (sounds, shooting stars, toasts). */

import { loadState, persist } from './storage.js';

let state = loadState();
const listeners = new Set();
const channels = new Map();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of Array.from(listeners)) {
    try {
      fn(state);
    } catch (err) {
      console.error('NightCheck: render failed', err);
    }
  }
}

/** Run a mutation against the live state, then persist + re-render. */
export function update(mutator, { silent = false, save = true } = {}) {
  const result = mutator(state);
  if (save) persist(state);
  if (!silent) notify();
  return result;
}

export function replaceState(next) {
  state = next;
  persist(state);
  notify();
}

/** Adopt state written by another tab. Deliberately does not write it back. */
export function hydrateState(next) {
  state = next;
  notify();
}

export function on(event, fn) {
  if (!channels.has(event)) channels.set(event, new Set());
  channels.get(event).add(fn);
  return () => channels.get(event).delete(fn);
}

export function emit(event, payload) {
  const subs = channels.get(event);
  if (!subs) return;
  for (const fn of Array.from(subs)) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`NightCheck: handler for "${event}" failed`, err);
    }
  }
}
