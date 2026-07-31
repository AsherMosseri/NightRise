/* Bootstrap: wire the store to the views, the events to their effects,
   and keep the night ticking over. */

import { $, icon } from './dom.js';
import { getState, subscribe, update, on, hydrateState } from './state.js';
import { addSection, addTask, setSetting } from './actions.js';
import { computeStats, rolloverIfNeeded } from './night.js';
import { nightKeyOf, formatNightLabel, inCurfew, CURFEW_LEAD_MINUTES } from './time.js';
import { initChecklist, renderChecklist, floatXp } from './render/checklist.js';
import { initHeader, renderHeader, renderTonight } from './render/header.js';
import { initModals, openModal, closeModal } from './render/modals.js';
import { initSheet, openSheet } from './render/sheet.js';
import { openAddTask, openAddSection } from './render/add-task.js';
import { initGoodnight, dismissGoodnight, isGoodnightOpen } from './render/goodnight.js';
import { initCards, renderCards, enterCards, exitCards, cardsActive, cardsKeydown } from './render/cards.js';
import { initToasts, toast, celebrate } from './toast.js';
import { initSky, setMoonFill, setTrail, setConstellations, shootingStar, celebrateBurst, refreshTheme, setReducedMotion } from './sky.js';
import { completedConstellations } from './constellations.js';
import { initKeys, parseQuickAdd } from './keys.js';
import { titleForLevel } from './game.js';
import { checkAchievements } from './achievements.js';
import { playEnvelopeOpen } from './render/envelope-open.js';
import { playFinale } from './render/finale.js';
import { still, rectOf, flyBetween } from './render/motion.js';

/** Where the last check-off happened, so the finale can start from your thumb. */
let lastCheckRect = null;
import * as audio from './audio.js';
import { storageAvailable, flushPersist, STORAGE_KEY, normalizeState } from './storage.js';
import { plural } from './util.js';
import { initOptical, applyOpticalNudge } from './optical.js';
import { initUpdates, applyUpdate } from './updates.js';

const TOPBAR_ICON_SIZE = 18;

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
  applyOpticalNudge(); // a different face centres its letters differently
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
    // The rect of the box you just tapped, while the old DOM is still standing:
    // this handler runs inside update(), before subscribers re-render. If this
    // is the last task, the finale needs somewhere to start from.
    lastCheckRect = rectOf(document.querySelector(`[data-task-id="${CSS.escape(task.id)}"] .task__check`))
      || rectOf(document.querySelector('.onecard__check'));
    const remaining = computeStats(getState()).remaining;
    // Nothing competes with the finale's own ribbon on the final check.
    if (remaining > 0) shootingStar();
    floatXp(task.id, `+${award.xp} XP`);
    // XP floats off the row already; stardust — the currency that buys every
    // single thing you actually want — arrived with no sign it had happened at
    // all, which is why the shop felt disconnected from the checklist.
    if (award.dust > 0) flyBetween(lastCheckRect, rectOf(document.querySelector('.stat--stardust')));
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

  // Taking XP back can take a level with it. Saying so is kinder than letting
  // the number in the corner quietly change on its own.
  on('level:lost', ({ to }) => {
    toast(`Back to level ${to}`, {
      tone: 'warn',
      iconName: 'undo',
      detail: `${titleForLevel(to)} · that level's bonus went back too.`,
    });
  });

  on('achievement', (earned) => {
    for (const step of earned) announceTier(step);
  });

  on('achievement:lost', (lost) => {
    for (const step of lost) {
      toast(`${step.name} lost`, {
        tone: 'warn',
        iconName: 'undo',
        detail: 'You undid the thing that earned it. Do it again and it comes back.',
      });
    }
  });

  on('night:complete', ({ stats, bonus, first }) => {
    // Only the first time tonight. Un-ticking and re-ticking the last task
    // pays the bonus again, correctly, but must not replay the ceremony.
    if (!first) return;
    playFinale({ from: lastCheckRect });
    // In still mode the sky cannot announce anything, so the sentence does it.
    if (still()) {
      celebrate('Night complete', `${plural(stats.done, 'task', 'tasks')} done · +${bonus.xp} XP · +${bonus.dust} stardust`);
    }
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

  on('envelope', ({ drop, amount, rect, key }) => {
    audio.play('buy');
    shootingStar();
    // The ceremony is the announcement. In still mode there is no ceremony, so
    // the toast stays — same information, delivered by words instead of motion.
    if (!playEnvelopeOpen({ drop, amount, rect, key })) {
      celebrate(drop.label, drop.detail(amount));
    }
  });

  on('lightsout', ({ reward, onTime }) => {
    if (reward) audio.play('complete');
    if (onTime) celebrateBurst();
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
  if (isGoodnightOpen() && getState().night.lightsOutAt === null) dismissGoodnight({ reopened: false });
  renderChecklist();
  renderHeader();
  renderCards();
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
  for (const step of result.achievements || []) announceTier(step);
}

/** One tier reached. Says which rung of how many, and what it paid. */
function announceTier(step) {
  const rung = step.tiers > 1 ? ` · tier ${step.tier} of ${step.tiers}` : '';
  const paid = step.dust ? ` · +${step.dust} stardust` : '';
  toast(step.name, {
    tone: 'win',
    iconName: step.icon,
    detail: `${step.hint}${rung}${paid}`,
    duration: 6000,
  });
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

/**
 * Flags the document while the page is moving. One listener for the lifetime of
 * the app, rather than one per render of a button that is rebuilt constantly.
 */
function watchScrolling() {
  let idle = null;
  const root = document.documentElement;
  window.addEventListener('scroll', () => {
    if (!idle) root.classList.add('is-scrolling');
    else clearTimeout(idle);
    idle = setTimeout(() => {
      idle = null;
      root.classList.remove('is-scrolling');
    }, 500);
  }, { passive: true });
}

function boot() {
  // Settle the achievement ladders before anything renders. A save can arrive
  // already past a rung it never recorded — an old badge list migrated, a night
  // banked in another tab, a save edited by hand — and a card that showed the
  // tier while the profile held the one below would be promising something
  // nothing had actually written down. No toasts: these are not news, they
  // happened before this launch.
  update((s) => { checkAchievements(s, computeStats(s)); });

  watchScrolling();
  initToasts($('#toasts'), $('#toasts-modal'));
  initChecklist($('#sections'));
  initHeader({
    stats: $('#topstats'),
    tonight: $('#tonight'),
    companion: $('#companion'),
    nightEnd: $('#nightend'),
  });
  initModals($('#modal'));
  initOptical();
  initSheet($('#sheet'));
  initGoodnight($('#goodnight'));
  initCards($('#cards'), { onClose: () => renderAll() });
  initSky($('#sky'), { reduceMotion: reducedMotionActive(getState()) });
  initQuickAdd($('#quick-add-input'), $('#quick-add-button'));
  $('#quick-add-tap').addEventListener('click', () => openAddTask({ invoker: $('#quick-add-tap') }));
  wireEffects();

  // One icon source, one size: fill every declarative [data-icon] slot in the shell.
  for (const slot of document.querySelectorAll('[data-icon]')) {
    slot.prepend(icon(slot.dataset.icon, { size: TOPBAR_ICON_SIZE }));
  }

  // Curfew: the four browsing panels close half an hour before bedtime. You can
  // still get in, but it takes a second, deliberate tap.
  const BROWSING = new Set(['shop', 'starmap', 'history', 'insights']);
  const openPanel = (name) => {
    const state = getState();
    const gated = BROWSING.has(name)
      && state.profile.settings.curfew
      && inCurfew(state.night.key, state.profile.settings.bedtime);
    if (!gated) {
      openModal(name);
      return;
    }
    openSheet({
      title: 'The market is closed',
      subtitle: `It shuts ${CURFEW_LEAD_MINUTES} minutes before bedtime. It will all still be here in the morning.`,
      items: [
        { icon: 'moon', label: 'Fair enough', hint: 'Back to the list', onClick: () => {} },
        { icon: 'bag', label: 'Open it anyway', hint: 'Just this once', onClick: () => openModal(name) },
      ],
    });
  };

  for (const button of document.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => openPanel(button.dataset.open));
  }

  const muteButton = $('#toggle-sound');
  const dimButton = $('#toggle-dim');
  const syncToggles = () => {
    const { settings } = getState().profile;
    muteButton.setAttribute('aria-pressed', settings.muted ? 'false' : 'true');
    muteButton.title = settings.muted ? 'Sounds are off' : 'Sounds are on';
    muteButton.replaceChildren(icon(settings.muted ? 'mute' : 'volume', { size: TOPBAR_ICON_SIZE }));
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
    onNewSection: () => openAddSection(),
    onQuickAdd: () => $('#quick-add-input').focus(),
    onShop: () => openPanel('shop'),
    onStarMap: () => openPanel('starmap'),
    onHistory: () => openPanel('history'),
    onInsights: () => openPanel('insights'),
    onSettings: () => openModal('settings'),
    onHelp: () => openModal('help'),
    onFocusMode: () => (cardsActive() ? exitCards() : enterCards()),
    onToggleMute: () => { muteButton.click(); },
    onToggleDim: () => { dimButton.click(); },
  });

  subscribe(() => {
    renderChecklist();
    renderHeader();
    renderCards();
    syncSky();
    syncToggles();
  });

  // One-at-a-time owns the keyboard while it is up.
  window.addEventListener('keydown', (event) => {
    if (!cardsActive()) return;
    if (document.querySelector('.sheet')) return;
    if (cardsKeydown(event)) event.preventDefault();
  }, true);

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
    // Commit before the OS can suspend us; a lost check-off is unforgivable.
    if (document.hidden) flushPersist();
    else if (!checkRollover()) renderTonight();
  });
  window.addEventListener('pagehide', flushPersist);

  // Two tabs (or a phone and a laptop on the same browser) used to clobber each
  // other silently — last writer won and the other tab's night vanished on its
  // next save. Adopt whatever the other tab wrote instead of overwriting it.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      hydrateState(normalizeState(JSON.parse(event.newValue)));
      renderAll();
      applyCosmetics();
      toast('Synced from another tab', { tone: 'info', iconName: 'undo', duration: 3000 });
    } catch (err) {
      console.warn('NightCheck: could not adopt another tab\'s state', err);
    }
  });
  motionQuery.addEventListener?.('change', () => applyCosmetics());

  initUpdates({
    onUpdateReady: () => toast('A new version is ready', {
      tone: 'info',
      iconName: 'download',
      duration: 15000,
      detail: 'Your night, streak and unlocks all stay put.',
      action: { label: 'Load it', onClick: () => applyUpdate() },
    }),
  });

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
