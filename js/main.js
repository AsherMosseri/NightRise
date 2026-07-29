/* Bootstrap: wire the store to the views, the events to their effects,
   and keep the night ticking over. */

import { $, icon } from './dom.js';
import { getState, subscribe, update, on } from './state.js';
import { addSection, addTask, setSetting } from './actions.js';
import { computeStats, rolloverIfNeeded } from './night.js';
import { nightKeyOf, formatNightLabel } from './time.js';
import { initChecklist, renderChecklist, floatXp } from './render/checklist.js';
import { initHeader, renderHeader, renderTonight } from './render/header.js';
import { initModals, openModal, closeModal } from './render/modals.js';
import { initToasts, toast, celebrate } from './toast.js';
import { initSky, setMoonFill, setTrail, setConstellations, shootingStar, celebrateBurst, refreshTheme, setReducedMotion } from './sky.js';
import { completedConstellations } from './constellations.js';
import { initKeys, parseQuickAdd } from './keys.js';
import { badgeById, titleForLevel } from './game.js';
import * as audio from './audio.js';
import { storageAvailable } from './storage.js';
import { plural } from './util.js';

const motionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener: () => {} };

function reducedMotionActive(state) {
  const setting = state.profile.settings.motion;
  if (setting === 'off') return true;
  if (setting === 'on') return false;
  return motionQuery.matches;
}

/* ------------------------------------------------------------- cosmetics */

function applyCosmetics() {
  const state = getState();
  const { equipped, settings } = state.profile;
  const root = document.documentElement;
  root.dataset.theme = equipped.theme || 'midnight';
  root.dataset.font = equipped.font || 'aurora';
  root.dataset.motion = reducedMotionActive(state) ? 'off' : 'on';
  root.classList.toggle('is-dim', Boolean(settings.dim));

  audio.setMuted(settings.muted);
  audio.setPack(equipped.sounds);

  refreshTheme();
  setTrail(equipped.trail);
  setReducedMotion(reducedMotionActive(state));
  setConstellations(completedConstellations(state).map((c) => ({ id: c.id, stars: c.stars, lines: c.lines })));
}

function syncSky() {
  setMoonFill(computeStats(getState()).pct);
}

/* ------------------------------------------------------------- quick add */

function initQuickAdd(input, button) {
  const submit = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const state = getState();
    const sections = state.template.order
      .map((id) => state.template.sections[id])
      .filter(Boolean)
      .map((s) => ({ id: s.id, title: s.title }));
    const parsed = parseQuickAdd(raw, sections);
    if (!parsed.title) {
      toast('Give the task a name', { tone: 'warn' });
      return;
    }
    let targetId = parsed.sectionId || sections[0]?.id;
    if (!targetId) targetId = addSection('Tonight').id;
    const { task } = addTask(targetId, parsed.title, parsed.minutes ?? 5);
    input.value = '';
    input.focus();
    if (parsed.sectionHint && !parsed.sectionId) {
      toast(`No section matched “${parsed.sectionHint}”`, { tone: 'info', detail: `Added “${task.title}” to the first section instead.` });
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { input.value = ''; input.blur(); }
    event.stopPropagation();
  });
  button.addEventListener('click', submit);
}

/* --------------------------------------------------------------- effects */

function wireEffects() {
  on('task:done', ({ task, award }) => {
    audio.play('check');
    shootingStar();
    floatXp(task.id, `+${award.xp} XP`);
    if (award.multiplier >= 2) {
      const label = `x${award.multiplier.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
      toast(`${label} combo`, { tone: 'win', iconName: 'flame', duration: 2200, detail: `+${award.dust} stardust` });
    }
  });

  on('task:undone', () => audio.play('uncheck'));
  on('task:skip', () => toast('Rain check used', { tone: 'info', iconName: 'skip', detail: 'It will not count against tonight.' }));

  on('level', (levels) => {
    audio.play('level');
    const top = levels[levels.length - 1];
    celebrate(`Level ${top}`, `${titleForLevel(top)} · bonus stardust awarded`);
  });

  on('badge', (ids) => {
    for (const id of ids) {
      const badge = badgeById(id);
      if (badge) toast(`Badge: ${badge.name}`, { tone: 'win', iconName: badge.icon, detail: badge.hint });
    }
  });

  on('night:complete', ({ stats, bonus }) => {
    audio.play('complete');
    celebrateBurst();
    celebrate('Night complete', `${plural(stats.done, 'task', 'tasks')} done · +${bonus.xp} XP · +${bonus.dust} stardust`);
  });

  on('quest:claim', ({ def }) => {
    audio.play('quest');
    celebrate(`Quest complete: ${def.name}`, `+${def.xp} XP · +${def.dust} stardust`);
  });

  on('purchase', ({ item }) => {
    audio.play('buy');
    toast(`Unlocked ${item.name}`, { tone: 'win', iconName: 'bag' });
    applyCosmetics();
  });

  on('purchase:failed', ({ reason }) => {
    audio.play('error');
    toast('Not yet', { tone: 'warn', iconName: 'star', detail: reason });
  });

  on('equip', () => applyCosmetics());
  on('star:lit', () => audio.play('star'));
  on('constellation:complete', () => { applyCosmetics(); celebrateBurst(); });
  on('setting', () => applyCosmetics());
  on('imported', () => { applyCosmetics(); renderAll(); });
  on('tokens:empty', () => audio.play('error'));
}

/* ---------------------------------------------------------------- render */

function renderAll() {
  renderChecklist();
  renderHeader();
  syncSky();
}

/* -------------------------------------------------------------- rollover */

function announceRollover(result) {
  if (!result) return;
  if (result.stats.total === 0) {
    toast('A new night', { tone: 'info', iconName: 'moon', detail: formatNightLabel(getState().night.key) });
    return;
  }
  const parts = [`${result.stats.pct}% of ${plural(result.stats.total, 'task', 'tasks')}`];
  if (result.frozenUsed) parts.push(`${plural(result.frozenUsed, 'streak freeze', 'streak freezes')} used`);
  toast(result.met ? 'Night banked — streak safe' : 'Night banked', {
    tone: result.met ? 'win' : 'info',
    iconName: 'calendar',
    detail: `${parts.join(' · ')} · streak now ${result.streakAfter}`,
    duration: 6500,
  });
  for (const id of result.badges || []) {
    const badge = badgeById(id);
    if (badge) toast(`Badge: ${badge.name}`, { tone: 'win', iconName: badge.icon, detail: badge.hint });
  }
}

function checkRollover() {
  const state = getState();
  if (nightKeyOf(new Date()) === state.night.key) return false;
  const result = update((s) => rolloverIfNeeded(s));
  announceRollover(result);
  renderAll();
  return true;
}

/* ------------------------------------------------------------------ boot */

function boot() {
  initToasts($('#toasts'));
  initChecklist($('#sections'));
  initHeader({ stats: $('#topstats'), tonight: $('#tonight'), companion: $('#companion') });
  initModals($('#modal'));
  initSky($('#sky'), { reduceMotion: reducedMotionActive(getState()) });
  initQuickAdd($('#quick-add-input'), $('#quick-add-button'));
  wireEffects();

  for (const button of document.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => openModal(button.dataset.open));
  }

  const muteButton = $('#toggle-sound');
  const dimButton = $('#toggle-dim');
  const syncToggles = () => {
    const { settings } = getState().profile;
    muteButton.setAttribute('aria-pressed', settings.muted ? 'false' : 'true');
    muteButton.title = settings.muted ? 'Sounds are off' : 'Sounds are on';
    muteButton.replaceChildren(icon(settings.muted ? 'mute' : 'volume', { size: 16 }));
    dimButton.setAttribute('aria-pressed', settings.dim ? 'true' : 'false');
    dimButton.title = settings.dim ? 'Sleep-safe dim is on' : 'Sleep-safe dim is off';
  };
  muteButton.addEventListener('click', () => {
    const wasMuted = getState().profile.settings.muted;
    setSetting('muted', !wasMuted);
    audio.setMuted(!wasMuted);
    if (wasMuted) audio.play('check'); // unmuting: confirm it works
    syncToggles();
  });
  dimButton.addEventListener('click', () => {
    setSetting('dim', !getState().profile.settings.dim);
    syncToggles();
  });

  initKeys({
    onNewTask: () => $('#quick-add-input').focus(),
    onNewSection: () => {
      const section = addSection('New section');
      const node = document.querySelector(`[data-focus="section-edit:${section.id}"]`);
      node?.focus();
    },
    onQuickAdd: () => $('#quick-add-input').focus(),
    onShop: () => openModal('shop'),
    onStarMap: () => openModal('starmap'),
    onHistory: () => openModal('history'),
    onInsights: () => openModal('insights'),
    onSettings: () => openModal('settings'),
    onHelp: () => openModal('help'),
    onToggleMute: () => { muteButton.click(); },
    onToggleDim: () => { dimButton.click(); },
  });

  subscribe(() => {
    renderChecklist();
    renderHeader();
    syncSky();
    syncToggles();
  });

  applyCosmetics();
  checkRollover();
  renderAll();
  syncToggles();

  if (!storageAvailable) {
    toast('Saving is unavailable', {
      tone: 'warn',
      iconName: 'download',
      detail: 'This browser is blocking local storage, so tonight will not be remembered.',
      duration: 9000,
    });
  }

  // Keep the countdown honest and roll the night over on time.
  setInterval(() => {
    if (!checkRollover()) renderTonight();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !checkRollover()) renderTonight();
  });
  motionQuery.addEventListener?.('change', () => applyCosmetics());

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // Small dev hatch, documented in the README, used for testing the night cycle.
  window.__nightcheck = {
    getState,
    rollover: () => checkRollover(),
    setNightKey: (key) => { update((s) => { s.night.key = key; }); renderAll(); },
    addStardust: (n) => { update((s) => { s.profile.stardust += n; }); },
    addXp: (n) => { update((s) => { s.profile.xp += n; }); renderAll(); },
    openModal,
    closeModal,
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
