/* Bootstrap: wire the store to the views, the events to their effects,
   and keep the night ticking over. */

import { $, icon, downloadText } from './dom.js';
import { getState, subscribe, update, on, hydrateState } from './state.js';
import { addSection, addTask, setSetting } from './actions.js';
import { computeStats, rolloverIfNeeded } from './night.js';
import {
  nightKeyOf, formatNightLabel, formatClockLabel, lateStage, panelGate, CURFEW_LEAD_MINUTES,
} from './time.js';
import { initChecklist, renderChecklist, floatXp } from './render/checklist.js';
import { initHeader, renderHeader, renderTonight } from './render/header.js';
import { initModals, openModal, closeModal } from './render/modals.js';
import { initSheet, openSheet } from './render/sheet.js';
import { openAddTask, openAddSection } from './render/add-task.js';
import { initGoodnight, dismissGoodnight, isGoodnightOpen } from './render/goodnight.js';
import {
  initCards, renderCards, enterCards, exitCards, cardsActive, cardsKeydown,
  pauseCardTimer, resumeCardTimer,
} from './render/cards.js';
import { initToasts, toast, celebrate } from './toast.js';
import {
  initSky, setMoonFill, setTrail, setConstellations, setNightStars, shootingStar,
  emitTrailAt, celebrateBurst, refreshTheme, setReducedMotion,
  setWeather, setMoonSkin, setHorizon,
} from './sky.js';
import { horizonById, weatherById, moonById } from './skins.js';
import { completedConstellations, progressFor } from './constellations.js';
import { onTimeNights } from './insights.js';
import { initKeys, parseQuickAdd, isTypingTarget } from './keys.js';
import { titleForLevel } from './game.js';
import { checkAchievements } from './achievements.js';
import { playEnvelopeOpen } from './render/envelope-open.js';
import { playFinale } from './render/finale.js';
import { still, rectOf, flyBetween } from './render/motion.js';

/** Where the last check-off happened, so the finale can start from your thumb. */
let lastCheckRect = null;
import * as audio from './audio.js';
import {
  storageAvailable, flushPersist, STORAGE_KEY, normalizeState,
  recoveredCorruptData, recoveredFutureSave, recoveredDamagedSave, onSaveFailure, serializeState,
} from './storage.js';
import { plural, formatMultiplier } from './util.js';
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
  root.dataset.font = equipped.font || 'sans';
  applyOpticalNudge(); // a different face centres its letters differently
  root.dataset.motion = reducedMotionActive(state) ? 'off' : 'on';
  root.classList.toggle('is-dim', Boolean(settings.dim));

  audio.setMuted(settings.muted);
  audio.setPack(equipped.sounds);

  refreshTheme();
  setTrail(equipped.trail);
  // The four skins the canvas draws. Each resolves through its catalog, so an
  // id from a save the app no longer recognises lands on the free default
  // rather than an empty sky.
  setHorizon(horizonById(equipped.horizon));
  setWeather(weatherById(equipped.weather));
  setMoonSkin(moonById(equipped.moon));
  setReducedMotion(reducedMotionActive(state));
  setConstellations(completedConstellations(state).map((c) => ({
    id: c.id,
    stars: c.stars,
    lines: c.lines,
    // Only the faint stars actually bought — the sky shows what you own, and a
    // constellation you have only just finished is the bare figure.
    faint: (c.faint || []).slice(0, progressFor(state, c.id).deep),
  })));
  // The one thing in this app that grows forever, and the only one you cannot
  // buy: a star for every night you actually went to bed on time.
  setNightStars(onTimeNights(state));
}

function syncSky() {
  setMoonFill(computeStats(getState()).pct);
}

/* ------------------------------------------------------------- quick add */

/** The quick-add box if it is on screen, otherwise the sheet that replaces it. */
function focusQuickAddOrSheet() {
  const box = $('#quick-add-input');
  if (box && box.offsetParent !== null) box.focus();
  else openAddTask();
}

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
    // The trail, at the box you just tapped. It used to follow the pointer and
    // nothing else, which on a phone meant it appeared only while dragging.
    if (lastCheckRect) {
      emitTrailAt(lastCheckRect.x + lastCheckRect.width / 2, lastCheckRect.y + lastCheckRect.height / 2);
    }
    floatXp(task.id, `+${award.xp} XP`);
    // XP floats off the row already; stardust — the currency that buys every
    // single thing you actually want — arrived with no sign it had happened at
    // all, which is why the shop felt disconnected from the checklist.
    if (award.dust > 0) flyBetween(lastCheckRect, rectOf(document.querySelector('.stat--stardust')));
    if (award.multiplier >= 2) {
      toast(`${formatMultiplier(award.multiplier)} combo`, { tone: 'win', iconName: 'flame', duration: 2200, detail: `+${award.dust} stardust` });
    }
  });

  on('task:undone', () => audio.play('uncheck'));
  on('task:skip', () => toast('Rain check used', { tone: 'info', iconName: 'skip', detail: 'It will not count against tonight.' }));

  // A sound and nothing else. The advance already floats off the button, and a
  // toast for having started something is the app congratulating you for
  // standing up — noise, at the moment you are trying to leave the phone.
  on('task:start', () => audio.play('uncheck'));

  on('level', (levels) => {
    audio.play('level');
    const top = levels[levels.length - 1];
    // Only if it paid. Crossing a boundary you have crossed before pays nothing
    // — the high-water mark sees to that — and this said otherwise regardless.
    const paid = levels.dust || 0;
    celebrate(`Level ${top}`, paid
      ? `${titleForLevel(top)} · +${paid} stardust`
      : titleForLevel(top));
  });

  // Taking XP back can take a level with it. Saying so is kinder than letting
  // the number in the corner quietly change on its own.
  on('level:lost', ({ to, reclaimed }) => {
    toast(`Back to level ${to}`, {
      tone: 'warn',
      iconName: 'undo',
      // The refund breaks out the moment the balance cannot cover it, and this
      // announced it unconditionally — claiming a reclaim that never happened.
      detail: reclaimed
        ? `${titleForLevel(to)} · ${reclaimed} stardust went back too.`
        : `${titleForLevel(to)} · you keep the stardust it paid.`,
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
    // One Card is the likeliest route here — it is the mode for the night you
    // dread everything — and under it `.app`, `.lightsout` and the top bar are
    // all display:none and the sky is paused, so the finale played to nobody.
    // The mode getting out of the way is the first beat: let its own 260ms fade
    // run, then the sky is visible and the Lights out pill is back.
    if (cardsActive()) {
      exitCards();
      setTimeout(() => playFinale({ from: null }), 300);
    } else {
      playFinale({ from: lastCheckRect });
    }
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
    if (onTime) {
      celebrateBurst();
      // Tonight's star, added the moment you earn it rather than at 4am. The
      // ending fades the app away and leaves the sky, so it is the thing you
      // are actually looking at when it arrives.
      setNightStars(onTimeNights(getState()));
    }
  });

  on('equip', () => applyCosmetics());
  on('star:lit', () => audio.play('star'));
  on('constellation:complete', () => { applyCosmetics(); celebrateBurst(); });
  on('setting', () => applyCosmetics());
  on('imported', () => { applyCosmetics(); renderAll(); });
  on('tokens:empty', () => audio.play('error'));
}

/* ---------------------------------------------------------------- render */

/**
 * Put how late it is on the root element, so CSS can answer it.
 *
 * On `<html>` beside `is-dim` and `is-onecard` rather than as a new full-screen
 * layer. A new fixed layer would have to be added by hand to the list at
 * css/themes.css that warms everything sleep-safe dim cannot reach through a
 * backdrop-filter, and that list has been forgotten before — One Card, the
 * envelope and the finale each escaped it once. A class changes what is already
 * painted and cannot escape anything.
 */
function syncLateStage() {
  const state = getState();
  const { bedtime, lastCall } = state.profile.settings;
  const stage = state.night.lightsOutAt
    // You have already stopped. The night ran long, and the app saying so over
    // the good-night screen would be scolding you for the thing it just
    // thanked you for.
    ? 'clear'
    : lateStage(state.night.key, bedtime, lastCall);
  document.documentElement.classList.toggle('is-lastcall', stage === 'lastcall');
}

function renderAll() {
  if (isGoodnightOpen() && getState().night.lightsOutAt === null) dismissGoodnight({ reopened: false });
  renderChecklist();
  renderHeader();
  renderCards();
  syncSky();
  syncLateStage();
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
  // "Streak safe" used to be chosen by `met`, which only asks whether *tonight*
  // hit 60% and knows nothing about the nights you were away. Come back after
  // four missed nights with no freezes, finish your list, and the app cheerfully
  // announced your streak was safe on the very rollover that reset it to 1.
  // The streak growing is the only thing that means the streak survived.
  const kept = result.streakAfter > result.streakBefore;
  const broken = result.streakAfter < result.streakBefore;
  toast(kept ? 'Night banked — streak safe' : broken ? 'Night banked — streak reset' : 'Night banked', {
    tone: kept ? 'win' : broken ? 'warn' : 'info',
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

let futureKeyWarned = false;

function checkRollover() {
  const state = getState();
  if (nightKeyOf(new Date()) === state.night.key) return false;
  const result = update((s) => rolloverIfNeeded(s));
  // `rolloverIfNeeded` deliberately refuses to touch a night dated more than a
  // day ahead — retitling one across a week could land on a real history entry.
  // But "refuse" used to mean this ran a full persisted update and a full
  // re-render on the 30-second tick forever, while the header showed a date a
  // year out and a bedtime countdown to match, with nothing ever said.
  if (!result && nightKeyOf(new Date()) !== getState().night.key) {
    if (!futureKeyWarned) {
      futureKeyWarned = true;
      toast('Tonight is dated in the future', {
        tone: 'warn',
        iconName: 'calendar',
        detail: 'Check your device clock. Nothing will be banked until the dates line up.',
        duration: 0,
      });
    }
    return false; // let the countdown keep painting rather than churning
  }
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
    // Through the gate, not straight to openModal. The morning reckoning offers
    // "show me the pattern", and a second door into the browsing panels that
    // skips the curfew and last-call checks is how those checks stop meaning
    // anything — it only takes one caller that forgot.
    onPanel: (name) => openPanel(name),
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
    const { bedtime, lastCall, curfew } = state.profile.settings;
    const stage = lateStage(state.night.key, bedtime, lastCall);
    const gate = BROWSING.has(name) ? panelGate(stage, curfew) : 'open';
    if (gate === 'open') {
      openModal(name);
      return;
    }
    // Past last call the escape hatch goes. Before it, "just this once" is the
    // right amount of friction — a second deliberate tap, and you are an adult.
    // After it, an app still offering a way into four browsing surfaces with a
    // currency attached is not closing, it is asking. The list and One Card are
    // untouched at every stage: they are how the night ends.
    if (gate === 'shut') {
      openSheet({
        title: 'That is closed now',
        subtitle: `It shut at last call, ${lastCall} minutes past ${formatClockLabel(bedtime)}. It will all still be here in the morning.`,
        items: [
          { icon: 'moon', label: 'Back to the list', hint: 'Finish up and stop', onClick: () => {} },
        ],
      });
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
    // The quick-add row is `display: none` on touch, so both of these were
    // no-ops on a phone while the Keyboard panel still advertised them.
    onNewTask: () => focusQuickAddOrSheet(),
    onNewSection: () => openAddSection(),
    onQuickAdd: () => focusQuickAddOrSheet(),
    onShop: () => openPanel('shop'),
    onStarMap: () => openPanel('starmap'),
    onHistory: () => openPanel('history'),
    onInsights: () => openPanel('insights'),
    onSettings: () => openModal('settings'),
    onHelp: () => openModal('help'),
    onFocusMode: () => (cardsActive() ? exitCards() : enterCards()),
    onToggleMute: () => { muteButton.click(); },
    onToggleDim: () => { dimButton.click(); },
  }, { enabled: () => getState().profile.settings.shortcuts !== false });

  subscribe(() => {
    // `.is-onecard .app { display: none }`, so rebuilding the whole list and
    // header behind it was ~600 nodes per check-off that nobody could see.
    // Leaving the mode runs renderAll() through the onClose hook, so nothing is
    // stale by the time it is on screen again.
    if (!cardsActive()) {
      renderChecklist();
      renderHeader();
    }
    renderCards();
    syncSky();
    syncToggles();
    // Here as well as on the ticker: the bedtime and last call are settings, so
    // changing either has to re-answer "how late is it" now rather than within
    // thirty seconds — and pressing Lights out has to take the state off again
    // in the same frame the good-night screen arrives.
    syncLateStage();
  });

  // One-at-a-time owns the keyboard while it is up — but only while it is the
  // top surface. It bailed for the sheet and nothing else, so opening the shop
  // from One Card left this handler swallowing Escape in the capture phase: the
  // card mode exited underneath and the dialog you were trying to close stayed.
  window.addEventListener('keydown', (event) => {
    if (!cardsActive()) return;
    if (document.querySelector('dialog[open], .sheet, .goodnight__panel')) return;
    if (isTypingTarget(event.target)) return;
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

  // The unreadable save was being stashed under `nightcheck.v1.corrupt` and
  // then never mentioned: `recoveredCorruptData()` existed and nothing called
  // it. So the promise — "preserved rather than silently discarded" — was true
  // of the data and false of the experience: you opened the app, your year of
  // nights was gone, and nothing said why or that anything had been kept.
  // A refused write means everything from here on is going nowhere. Quota,
  // private browsing, a full disk — all real, all previously a console warning
  // nobody was going to read at 11:40pm.
  onSaveFailure(() => {
    toast('Tonight is not being saved', {
      tone: 'warn',
      iconName: 'download',
      detail: 'This browser refused to store it. Export a copy before you close the app.',
      duration: 0,
      action: { label: 'Export', onClick: () => downloadText(serializeState(getState()), 'nightcheck-backup.json') },
    });
  });

  if (recoveredFutureSave()) {
    toast('This save came from a newer version', {
      tone: 'info',
      iconName: 'undo',
      detail: 'It has been read as best this build can, and the original is kept safe.',
      duration: 9000,
    });
  }

  const wreckage = recoveredCorruptData();
  if (wreckage) {
    toast('Your saved night could not be read', {
      tone: 'warn',
      iconName: 'download',
      detail: 'Nothing was thrown away. Download the unreadable copy and start fresh.',
      duration: 0,
      action: {
        label: 'Download it',
        onClick: () => downloadText(localStorage.getItem(wreckage) || '', 'nightcheck-unreadable.json'),
      },
    });
  }

  // Damage that parses is the quiet kind: the app opens looking almost right,
  // missing a section or a month of history, and the first debounced write puts
  // that version where the real one was. Say so while the original still exists.
  const damaged = recoveredDamagedSave();
  if (damaged && !wreckage) {
    toast('Some of your saved data did not survive', {
      tone: 'warn',
      iconName: 'download',
      detail: 'The app opened with what it could read. The original is kept — download it before adding anything tonight.',
      duration: 0,
      action: {
        label: 'Download it',
        onClick: () => downloadText(localStorage.getItem(damaged) || '', 'nightcheck-damaged.json'),
      },
    });
  }

  // Keep the countdown honest and roll the night over on time. Last call is a
  // line the clock crosses while nobody touches the app, so it is read here
  // rather than only on a render — otherwise the night goes hard whenever you
  // next happen to tap something, which could be an hour later.
  setInterval(() => {
    if (!checkRollover()) renderTonight();
    syncLateStage();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // A phone in a pocket must not accumulate an hour on a task clock. The
      // pause is the whole design of that timer, not a nicety — a clock that
      // keeps running while you are elsewhere is a guilt machine.
      pauseCardTimer();
      // Commit before the OS can suspend us; a lost check-off is unforgivable.
      flushPersist();
    } else {
      // Hand the card its clock back before anything else redraws: the pause
      // above was the app's doing, not yours, and until this existed nothing on
      // the way back in ever touched the card at all.
      resumeCardTimer();
      if (!checkRollover()) renderTonight();
      syncLateStage();
    }
  });
  window.addEventListener('pagehide', flushPersist);

  // Two tabs (or a phone and a laptop on the same browser) used to clobber each
  // other silently — last writer won and the other tab's night vanished on its
  // next save. Adopt whatever the other tab wrote instead of overwriting it.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      // hydrateState drops our own queued write: adopting the other tab's state
      // and then letting a 250ms debounce fire with what we had a moment ago is
      // last-writer-wins by a different route — the sync would silently undo
      // the very tab it just synced from.
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
    // Theme, horizon, weather, moon, trail and typeface all arrive through
    // here, and renderAll does not call it — so a harness that sets an equipped
    // id and re-renders measures the sky it started with.
    applyCosmetics: () => { applyCosmetics(); renderAll(); },
    openModal,
    closeModal,
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
