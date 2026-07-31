/* Every panel that opens over the app: the Night Market, the star map,
   night history, insights, settings and the shortcut list. */

import { h, svg, icon, replace, withFocus, downloadText, rovingGroup } from '../dom.js';
import { getState, update, replaceState, emit } from '../state.js';
import {
  THEMES, SOUND_PACKS, TRAILS, FONTS, CONSUMABLES, COMPANION_ITEMS,
  canBuy, owns, isEquipped, purchase, equipItem, buyConsumable,
  feedCompanion, renameCompanion, unequipCompanion,
} from '../shop.js';
import { CONSTELLATIONS, progressFor, buyStar, collectionSummary, totalRemainingCost } from '../constellations.js';
import { FEED_COST, TIER_NAMES, feedsToNextTier, companionSvg } from '../companion.js';
import { levelFromXp, titleForLevel, titleLadder, HIDDEN_TITLE } from '../game.js';
import { achievementBoard, totalTiers } from '../achievements.js';
import { taskInsights, reliableTasks, overallRate, nightsFullyCleared } from '../insights.js';
import { forceNewNight, computeStats } from '../night.js';
import { still, growTo } from './motion.js';
import {
  shiftKey, keyToDate, formatShortDate, formatNightLabel, parseClock, formatClockLabel,
} from '../time.js';
import { serializeState, parseImport, clearStorage } from '../storage.js';
import { createInitialState } from '../model.js';
import { SHORTCUTS } from '../keys.js';
import { previewPack } from '../audio.js';
import { setSkyPaused } from '../sky.js';
import { toast } from '../toast.js';
import { formatNumber, plural, clamp } from '../util.js';
import { confirmAction, chooseAction } from './confirm.js';
import { RESET_PARTS, resetPartById, applyReset } from '../reset.js';
import { refreshApp, runningVersion } from '../updates.js';
import {
  bedtimeSeries, bedtimeSummary, formatFromNoon, formatShift,
} from '../bedtime.js';

let dialog = null;
let bodyHost = null;
let titleHost = null;
let currentView = null;

export function initModals(node) {
  dialog = node;
  titleHost = node.querySelector('[data-modal-title]');
  bodyHost = node.querySelector('[data-modal-body]');
  node.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
  node.addEventListener('click', (event) => {
    if (event.target === node) closeModal();
  });
  // The close event is queued, not synchronous: if the dialog has already been
  // reopened by the time it lands, the new view must survive it.
  node.addEventListener('close', () => {
    if (!node.open) currentView = null;
    // Escape and the backdrop close the dialog natively, never going through
    // closeModal — so the sky stayed paused for the rest of the session. The
    // whole live canvas, dead, because you dismissed a panel the usual way.
    setSkyPaused(false);
  });
}

const VIEWS = {};

export function openModal(name) {
  if (!dialog || !VIEWS[name]) return;
  const changed = currentView !== name;
  currentView = name;
  renderModal({ keepScroll: !changed });
  if (!dialog.open) dialog.showModal();
  setSkyPaused(true);
}

let closing = null;

export function closeModal() {
  currentView = null;
  setSkyPaused(false);
  if (!dialog?.open) return;
  if (still()) {
    dialog.close();
    return;
  }
  // animationend can be missed — a backgrounded tab, a display change, a
  // reduced-motion switch mid-flight — and a dialog that never closes is a
  // trapped app. The timer is the contract; the event is the nicety.
  clearTimeout(closing);
  dialog.classList.add('is-closing');
  const done = () => {
    clearTimeout(closing);
    dialog.removeEventListener('animationend', done);
    dialog.classList.remove('is-closing');
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('animationend', done);
  closing = setTimeout(done, 220);
}

export function refreshModal() {
  if (currentView) renderModal();
}

function renderModal({ keepScroll = true } = {}) {
  const view = VIEWS[currentView];
  if (!view) return;
  const offset = bodyHost.scrollTop;
  withFocus(bodyHost, () => {
    const built = view();
    titleHost.textContent = built.title;
    replace(bodyHost, built.body);
  });
  // Buying one thing used to fling the shop back to the top of the list.
  bodyHost.scrollTop = keepScroll ? offset : 0;
}

/* -------------------------------------------------------------- shop view */

function priceTag(cost) {
  return h('span', { class: 'price' }, icon('star', { size: 13 }), formatNumber(cost));
}

function shopCard(state, item, { onPreview } = {}) {
  const ownedAlready = owns(state, item);
  const equipped = isEquipped(state, item);
  const check = canBuy(state, item);
  const locked = Boolean(item.reqLevel && state.profile.level < item.reqLevel);

  return h('article', {
    class: ['card', ownedAlready && 'card--owned', equipped && 'card--equipped', locked && 'card--locked'].filter(Boolean).join(' '),
  },
  h('div', { class: 'card__head' },
    h('h3', {}, item.name),
    ownedAlready ? h('span', { class: 'card__tag' }, equipped ? 'Equipped' : 'Owned') : priceTag(item.cost)),
  item.kind === 'companion'
    ? h('div', { class: 'card__art' }, companionSvg(item.id, 2, 'happy'))
    : h('div', { class: `swatch swatch--${item.kind} swatch--${item.id}`, 'aria-hidden': 'true' }),
  h('p', { class: 'card__desc' }, item.desc),
  h('div', { class: 'card__foot' },
    locked ? h('span', { class: 'card__lock' }, `Level ${item.reqLevel}`) : null,
    onPreview ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => onPreview(item) }, 'Preview') : null,
    ownedAlready
      ? (equipped
        ? h('button', { type: 'button', class: 'btn btn--sm', disabled: true }, 'In use')
        : h('button', {
          type: 'button',
          class: 'btn btn--primary btn--sm',
          dataset: { focus: `shop:${item.id}` },
          onClick: () => { equipItem(item.id); refreshModal(); },
        }, 'Equip'))
      : h('button', {
        type: 'button',
        class: 'btn btn--primary btn--sm',
        disabled: !check.ok,
        title: check.ok ? `Buy for ${item.cost} stardust` : check.reason,
        dataset: { focus: `shop:${item.id}` },
        onClick: () => { purchase(item.id); refreshModal(); },
      }, check.ok ? 'Buy' : check.reason)));
}

function companionPanel(state) {
  const companion = state.profile.companion;
  if (!companion?.type) return null;
  const toNext = feedsToNextTier(companion.fed || 0);
  const tierName = TIER_NAMES[Math.min(TIER_NAMES.length - 1, (companion.tier || 1) - 1)];
  const nameInput = h('input', {
    class: 'field__input',
    type: 'text',
    value: companion.name,
    maxlength: '24',
    'aria-label': 'Companion name',
  });
  nameInput.addEventListener('change', () => { renameCompanion(nameInput.value.trim()); refreshModal(); });

  return h('div', { class: 'companion-panel' },
    h('div', { class: 'companion-panel__art' }, companionSvg(companion.type, companion.tier || 1, 'happy')),
    h('div', { class: 'companion-panel__body' },
      h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput),
      h('p', { class: 'companion-panel__tier' }, `${tierName} · tier ${companion.tier || 1} · fed ${companion.fed || 0} times`),
      h('p', { class: 'muted' }, toNext === null
        ? 'Fully grown. It has seen everything you do at night.'
        : `${plural(toNext, 'feed', 'feeds')} to the next tier.`),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          class: 'btn btn--primary btn--sm',
          disabled: state.profile.stardust < FEED_COST,
          onClick: () => {
            const result = feedCompanion();
            if (result?.grew) toast(`${result.companion.name} grew to tier ${result.companion.tier}`, { tone: 'win', iconName: 'star' });
            refreshModal();
          },
        }, `Feed · ${FEED_COST} dust`),
        h('button', {
          type: 'button',
          class: 'btn btn--ghost btn--sm',
          onClick: () => { unequipCompanion(); refreshModal(); },
        }, 'Send away'))));
}

let shopTab = 'themes';

VIEWS.shop = () => {
  const state = getState();
  const tabs = [
    ['themes', 'Skies', THEMES.map((t) => ({ ...t, kind: 'theme', bucket: 'themes' }))],
    ['companions', 'Companions', COMPANION_ITEMS.map((c) => ({ ...c, bucket: 'companions' }))],
    ['sounds', 'Sounds', SOUND_PACKS.map((s) => ({ ...s, kind: 'sounds', bucket: 'sounds' }))],
    ['trails', 'Trails', TRAILS.map((t) => ({ ...t, kind: 'trail', bucket: 'trails' }))],
    ['fonts', 'Type', FONTS.map((f) => ({ ...f, kind: 'font', bucket: 'fonts' }))],
    ['supplies', 'Supplies', null],
  ];
  const active = tabs.find(([id]) => id === shopTab) || tabs[0];

  // The role was declared and none of the contract was kept: no tabpanel, no
  // aria-controls, no arrow keys, and every tab its own tab stop. A screen
  // reader told the user to arrow between six things and the arrows did
  // nothing, which is a worse experience than plain unlabelled buttons.
  const PANEL_ID = 'shop-panel';
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Night Market sections' },
    ...tabs.map(([id, label]) => h('button', {
      type: 'button',
      id: `shop-tab-${id}`,
      class: `tab ${id === active[0] ? 'is-active' : ''}`.trim(),
      role: 'tab',
      'aria-selected': id === active[0] ? 'true' : 'false',
      'aria-controls': PANEL_ID,
      dataset: { focus: `tab:${id}` },
      onClick: () => { shopTab = id; refreshModal(); },
    }, label)));
  rovingGroup(tabBar, { onPick: (node) => node.click() });

  let content;
  if (active[0] === 'supplies') {
    content = h('div', { class: 'cards' }, ...CONSUMABLES.map((item) => h('article', { class: 'card' },
      h('div', { class: 'card__head' }, h('h3', {}, item.name), priceTag(item.cost)),
      h('div', { class: 'card__icon' }, icon(item.icon, { size: 26 })),
      h('p', { class: 'card__desc' }, item.desc),
      h('div', { class: 'card__foot' },
        h('span', { class: 'card__tag' }, `${state.profile.tokens[item.id] || 0} held`),
        h('button', {
          type: 'button',
          class: 'btn btn--primary btn--sm',
          disabled: state.profile.stardust < item.cost,
          onClick: () => { buyConsumable(item.id); refreshModal(); },
        }, 'Buy')))));
  } else {
    const onPreview = active[0] === 'sounds' ? (item) => previewPack(item.id) : null;
    content = h('div', { class: 'cards' },
      ...active[2].map((item) => shopCard(state, item, { onPreview })));
  }
  content.id = PANEL_ID;
  content.setAttribute('role', 'tabpanel');
  content.setAttribute('aria-labelledby', `shop-tab-${active[0]}`);
  content.tabIndex = 0;

  return {
    title: 'Night Market',
    body: h('div', { class: 'shop' },
      h('p', { class: 'modal__lead' },
        'Stardust is earned alongside XP — spending it never costs you a level. ',
        h('strong', {}, `${formatNumber(state.profile.stardust)} in hand.`)),
      tabBar,
      content,
      active[0] === 'companions' ? companionPanel(state) : null),
  };
};

/* ---------------------------------------------------------------- starmap */

function constellationPreview(def, lit) {
  const w = 150;
  const hgt = 96;
  const points = def.stars.map(([x, y]) => ({ x: 10 + x * (w - 20), y: 8 + y * (hgt - 16) }));
  return svg('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'constellation__svg', 'aria-hidden': 'true' },
    ...def.lines.map(([a, b]) => svg('line', {
      x1: points[a].x, y1: points[a].y, x2: points[b].x, y2: points[b].y,
      class: a < lit && b < lit ? 'constellation__line is-lit' : 'constellation__line',
    })),
    ...points.map((p, i) => svg('circle', {
      cx: p.x, cy: p.y, r: i < lit ? 3.4 : 2,
      class: i < lit ? 'constellation__star is-lit' : 'constellation__star',
    })));
}

VIEWS.starmap = () => {
  const state = getState();
  const summary = collectionSummary(state);

  const cards = CONSTELLATIONS.map((def) => {
    const info = progressFor(state, def.id);
    const affordable = info.nextCost !== null && state.profile.stardust >= info.nextCost;
    return h('article', { class: `constellation ${info.complete ? 'is-complete' : ''}`.trim() },
      constellationPreview(def, info.lit),
      h('div', { class: 'constellation__body' },
        h('div', { class: 'constellation__head' },
          h('h3', {}, def.name),
          h('span', { class: 'constellation__count' }, `${info.lit}/${info.total}`)),
        h('p', { class: 'muted' }, def.lore),
        info.complete
          ? h('p', { class: 'constellation__done' }, icon('check', { size: 13 }), 'Shining in your sky')
          : h('div', { class: 'row' },
            h('button', {
              type: 'button',
              class: 'btn btn--primary btn--sm',
              dataset: { focus: `star:${def.id}` },
              disabled: !affordable,
              onClick: () => {
                const result = update((s) => buyStar(s, def.id));
                if (result?.complete) {
                  toast(`${def.name} is complete`, { tone: 'win', iconName: 'map', detail: 'It now appears in your night sky.' });
                  emit('constellation:complete', { def });
                } else if (result) {
                  emit('star:lit', { def });
                }
                refreshModal();
              },
            }, `Light a star · ${info.nextCost}`),
            h('span', { class: 'muted small' }, `${formatNumber(totalRemainingCost(state, def.id))} to finish`))));
  });

  return {
    title: 'Star Map',
    body: h('div', {},
      h('p', { class: 'modal__lead' },
        `Light stars one at a time. Finish a constellation and it is drawn into your sky for good. `,
        h('strong', {}, `${summary.done}/${summary.total} complete · ${summary.litStars}/${summary.totalStars} stars lit.`)),
      h('div', { class: 'constellations' }, ...cards)),
  };
};

/* ---------------------------------------------------------------- history */

function heatLevel(pct) {
  if (pct >= 100) return 4;
  if (pct >= 70) return 3;
  if (pct >= 40) return 2;
  if (pct > 0) return 1;
  return 0;
}

VIEWS.history = () => {
  const state = getState();
  const today = state.night.key;
  const WEEKS = 18;
  const days = [];
  const firstDate = keyToDate(shiftKey(today, -(WEEKS * 7 - 1)));
  const leadIn = (firstDate.getDay() + 6) % 7; // grid columns start on Monday
  for (let i = 0; i < leadIn; i += 1) days.push(null);
  for (let i = WEEKS * 7 - 1; i >= 0; i -= 1) days.push(shiftKey(today, -i));

  const detail = h('p', {
    class: 'heatmap__detail muted',
    role: 'status',
    'aria-live': 'polite',
  }, 'Hover or click a night for detail.');

  const cells = days.map((key) => {
    if (!key) return h('span', { class: 'heat heat--pad', 'aria-hidden': 'true' });
    const entry = state.history[key];
    const isTonight = key === today;
    const level = entry ? heatLevel(entry.pct) : 0;
    const label = entry
      ? `${formatShortDate(key)}: ${entry.pct}% (${entry.done}/${entry.total})`
      : `${formatShortDate(key)}: no record`;
    const cell = h('button', {
      type: 'button',
      class: `heat heat--l${level} ${isTonight ? 'heat--today' : ''} ${entry?.frozen ? 'heat--frozen' : ''}`.trim(),
      title: label,
      'aria-label': label,
      // Empty nights are not worth a tab stop; 126 of them buried the panel.
      tabIndex: entry || isTonight ? 0 : -1,
      onClick: () => {
        const stopped = entry?.lightsOutAt
          ? `, lights out ${new Date(entry.lightsOutAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${entry.onTime ? ' (on time)' : ''}`
          : '';
        detail.textContent = entry
          ? `${formatNightLabel(key)} — ${entry.done} of ${entry.total} done, ${entry.pct}%, ${entry.xp} XP${stopped}${entry.quest ? ', quest claimed' : ''}${entry.frozen ? ', streak freeze used' : ''}.`
          : `${formatNightLabel(key)} — nothing recorded.`;
      },
    });
    return cell;
  });

  // "Perfect nights" sat one tile away from "to bed on time" and read like a
  // second bedtime stat. It was never about bedtime: it counts nights you got
  // through the list. So it now says that, and counts it strictly.
  const cleared = nightsFullyCleared(state.history);

  return {
    title: 'Night History',
    body: h('div', {},
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat-box' }, h('strong', {}, String(state.profile.streak)), h('span', {}, 'current streak')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(state.profile.bestStreak)), h('span', {}, 'best streak')),
        h('div', {
          class: 'stat-box',
          title: 'Nights you called it before your target bedtime — the number this app actually cares about',
        }, h('strong', {}, String(state.profile.lightsOut?.streak || 0)), h('span', {}, 'to bed on time')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(state.profile.nightsLogged)), h('span', {}, 'nights logged')),
        h('div', { class: 'stat-box' }, h('strong', {}, `${overallRate(state) ?? 0}%`), h('span', {}, 'average night')),
        h('div', {
          class: 'stat-box',
          title: 'Nights you ticked off every task on the list. Nothing to do with what time you went to bed — a rain-checked task does not count as done.',
        }, h('strong', {}, String(cleared)), h('span', {}, 'every task done'))),
      h('div', { class: 'heatmap' }, ...cells),
      h('div', { class: 'heatmap__key' },
        h('span', { class: 'muted small' }, 'less'),
        ...[0, 1, 2, 3, 4].map((l) => h('span', { class: `heat heat--l${l}`, 'aria-hidden': 'true' })),
        h('span', { class: 'muted small' }, 'more')),
      detail),
  };
};

/* --------------------------------------------------------------- insights */

/* --------------------------------------------------------------- bedtime */

const CHART_NIGHTS = 21;

/** The bedtime target in minutes from noon, matching the series. */
function targetFromNoon(bedtime) {
  const parsed = parseClock(bedtime);
  if (!parsed) return null;
  const minutes = parsed.hours * 60 + parsed.minutes - 12 * 60;
  // A 1am target belongs to the small hours of the *next* morning, same as the
  // night it ends — otherwise it plots twenty-three hours early.
  return parsed.hours < 4 ? minutes + 1440 : minutes;
}

/**
 * Three weeks of bedtimes against the line you are aiming at.
 *
 * A calendar grid would say whether each night passed; this says by how much,
 * which is the part that shows a habit moving. The dots are the nights, the
 * dashed line is your target, and the stems make lateness a length rather than
 * a colour you have to decode.
 */
function bedtimeChart(state) {
  const series = bedtimeSeries(state.history, state.night.key, CHART_NIGHTS);
  const recorded = series.filter((n) => n.recorded);
  const target = targetFromNoon(state.profile.settings.bedtime);
  if (!recorded.length) {
    return h('p', { class: 'muted' },
      'Nothing to chart yet. End a night with Lights out and it lands here.');
  }

  const W = 320;
  const H = 116;
  const padX = 8;
  const padTop = 10;
  const padBottom = 18;
  const values = recorded.map((n) => n.minutes);
  if (target !== null) values.push(target);
  let lo = Math.min(...values) - 20;
  let hi = Math.max(...values) + 20;
  if (hi - lo < 90) { // one night should not be drawn on a hairline scale
    const mid = (hi + lo) / 2;
    lo = mid - 45;
    hi = mid + 45;
  }
  const x = (i) => padX + (i * (W - padX * 2)) / (CHART_NIGHTS - 1);
  const y = (m) => padTop + ((m - lo) / (hi - lo)) * (H - padTop - padBottom);
  const baseY = H - padBottom + 6;

  const marks = [];
  if (target !== null) {
    marks.push(svg('line', {
      class: 'bt__target', x1: 0, x2: W, y1: y(target).toFixed(2), y2: y(target).toFixed(2),
    }));
  }

  series.forEach((night, i) => {
    if (!night.recorded) {
      marks.push(svg('circle', { class: 'bt__gap', cx: x(i).toFixed(2), cy: baseY, r: 1.6 },
        svg('title', {}, `${formatShortDate(night.key)}: no Lights out`)));
      return;
    }
    const cy = y(night.minutes);
    const label = `${formatShortDate(night.key)}: ${formatFromNoon(night.minutes, night.key)}`
      + (typeof night.late === 'number'
        ? ` · ${night.late <= 0 ? `${Math.abs(night.late)} min early` : `${night.late} min late`}`
        : '');
    if (target !== null) {
      marks.push(svg('line', {
        class: `bt__stem ${night.onTime ? 'is-ontime' : 'is-late'}`,
        x1: x(i).toFixed(2), x2: x(i).toFixed(2), y1: y(target).toFixed(2), y2: cy.toFixed(2),
      }));
    }
    marks.push(svg('circle', {
      class: `bt__dot ${night.onTime ? 'is-ontime' : 'is-late'}`,
      cx: x(i).toFixed(2), cy: cy.toFixed(2), r: 3.4,
    }, svg('title', {}, label)));
  });

  return h('div', { class: 'bt' },
    svg('svg', {
      class: 'bt__svg',
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': `Bedtime for the last ${CHART_NIGHTS} nights against a target of ${formatClockLabel(state.profile.settings.bedtime)}`,
    }, ...marks),
    h('div', { class: 'bt__axis' },
      h('span', {}, formatShortDate(series[0].key)),
      target !== null
        ? h('span', { class: 'bt__legend' }, `target ${formatClockLabel(state.profile.settings.bedtime)}`)
        : null,
      h('span', {}, 'tonight')));
}

function bedtimeSection(state) {
  const summary = bedtimeSummary(state.history, state.night.key, 7);
  const lights = state.profile.lightsOut || {};

  const box = (value, label, title = null) => h('div', { class: 'stat-box', title },
    h('strong', {}, value), h('span', {}, label));

  return h('div', {},
    h('p', { class: 'modal__lead' },
      'When you actually stopped, night by night. Only nights you ended with ',
      h('strong', {}, 'Lights out'), ' are on the record — close the app without it and there '
      + 'is nothing to measure.'),
    h('div', { class: 'stat-row' },
      box(String(lights.streak || 0), 'on time in a row',
        `Best run: ${lights.best || 0}. This is the number the app is actually about.`),
      box(summary.onTimeRate === null ? '—' : `${summary.onTimeRate}%`, 'on time this week',
        `${summary.onTime} of ${summary.recorded} recorded nights in the last 7`),
      box(formatFromNoon(summary.average), 'average bedtime', 'Mean of the last 7 recorded nights'),
      box(formatShift(summary.delta), 'vs the week before',
        summary.previous === null
          ? 'Not enough nights yet to compare'
          : `Previously ${formatFromNoon(summary.previous)}`),
      box(formatFromNoon(summary.earliest), 'earliest'),
      box(formatFromNoon(summary.latest), 'latest')),
    bedtimeChart(state));
}

VIEWS.insights = () => {
  const state = getState();
  const rows = taskInsights(state);
  const reliable = reliableTasks(state);
  const level = levelFromXp(state.profile.xp);

  const board = achievementBoard(state, computeStats(state));
  const badgeGrid = h('div', { class: 'achs' }, ...board.map((a) => h('div', {
    class: `ach ${a.earned ? 'is-earned' : ''} ${a.complete ? 'is-maxed' : ''}`.trim(),
    title: a.complete ? `${a.name} — every tier earned` : a.goal,
  },
  h('div', { class: 'ach__badge' }, icon(a.icon, { size: 20 })),
  h('div', { class: 'ach__body' },
    h('div', { class: 'ach__head' },
      h('span', { class: 'ach__name' }, a.name),
      // Which rung of how many, so a family that has levelled reads as one
      // thing that grew rather than a badge whose name quietly changed.
      h('span', { class: 'ach__tier' }, `${a.tier}/${a.tiers}`)),
    h('div', {
      class: 'ach__bar',
      role: 'progressbar',
      'aria-valuenow': String(a.pct),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': a.goal,
    }, growTo(h('span', {}), `ach:${a.id}`, `${a.pct}%`)),
    h('span', { class: 'ach__hint' }, a.complete ? 'Every tier earned' : `${a.progress} · ${a.goal.toLowerCase()}`)),
  h('div', { class: 'ach__pips' }, ...Array.from({ length: a.tiers }, (_, i) => h('span', {
    class: `ach__pip ${i < a.tier ? 'is-lit' : ''}`.trim(), 'aria-hidden': 'true',
  }))))));

  const table = rows.length
    ? h('ul', { class: 'insight-list' }, ...rows.slice(0, 20).map((row) => h('li', { class: 'insight' },
      h('div', { class: 'insight__head' },
        h('span', { class: 'insight__title' }, row.title),
        h('span', { class: 'insight__rate' }, row.rate === null ? '—' : `${row.rate}%`)),
      h('div', { class: 'insight__bar' }, h('span', { style: { width: `${row.rate ?? 0}%` } })),
      h('p', { class: 'muted small' },
        `${row.done}/${row.seen} nights`,
        row.skipped ? ` · ${row.skipped} rain-checked` : '',
        row.missStreak >= 2 ? ` · missed ${row.missStreak} in a row` : ''))))
    : h('p', { class: 'muted' }, 'Insights appear once you have banked a night or two.');

  return {
    title: 'Insights',
    body: h('div', {},
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat-box' }, h('strong', {}, String(level.level)), h('span', {}, titleForLevel(level.level))),
        h('div', { class: 'stat-box' }, h('strong', {}, formatNumber(state.profile.xp)), h('span', {}, 'total XP')),
        h('div', { class: 'stat-box' }, h('strong', {}, formatNumber(state.profile.stardust)), h('span', {}, 'stardust')),
        h('div', {
          class: 'stat-box',
          title: 'Achievement tiers you hold, counted across every family',
        }, h('strong', {}, String(totalTiers(state.profile))), h('span', {}, 'tiers earned'))),
      h('h3', { class: 'modal__section' }, 'Bedtime'),
      bedtimeSection(state),
      reliable.length
        ? h('p', { class: 'modal__lead' }, 'Most reliable: ', h('strong', {}, reliable.map((r) => r.title).join(', ')), '.')
        : null,
      h('h3', { class: 'modal__section' }, 'Task by task'),
      table,
      h('h3', { class: 'modal__section' }, 'Achievements'),
      h('p', { class: 'muted small' }, 'Each one levels up. You get the number you are working toward; the name of the next tier is a surprise.'),
      badgeGrid,
      h('h3', { class: 'modal__section' }, 'Titles'),
      h('p', { class: 'muted small' }, 'You find out what each one is called when you get there.'),
      h('ul', { class: 'titles' }, ...titleLadder(level.level).map((t) => h('li', {
        class: t.earned ? 'is-earned' : 'is-locked',
        'aria-label': t.earned ? `${t.name}, level ${t.level}` : `Unknown title, level ${t.level}`,
      },
      h('strong', {}, t.name ?? HIDDEN_TITLE),
      h('span', { class: 'muted small' }, `level ${t.level}`))))),
  };
};

/* --------------------------------------------------------------- settings */

function field(label, control, hint) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    control,
    hint ? h('p', { class: 'muted small' }, hint) : null);
}

/**
 * A row of choices instead of a <select>. A native dropdown at midnight is a
 * grey system sheet sliding up over the app in a font we did not pick; this is
 * three buttons you can already see, and it never covers anything.
 */
function choiceRow(label, options, current, onPick) {
  const row = h('div', { class: 'chipset', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map(([value, text]) => h('button', {
    type: 'button',
    class: `chip-toggle ${value === current ? 'is-on' : ''}`.trim(),
    role: 'radio',
    'aria-checked': value === current ? 'true' : 'false',
    onClick: () => {
      for (const [i, other] of buttons.entries()) {
        const on = options[i][0] === value;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      onPick(value);
      sync();
    },
  }, text));
  row.append(...buttons);
  // The role promises arrow keys and a single tab stop; without this it was six
  // tab stops and arrows that did nothing, which is worse than plain buttons.
  const sync = rovingGroup(row);
  return row;
}

const BEDTIME_STEP = 15;
const BEDTIME_PRESETS = ['21:30', '22:00', '22:30', '23:00', '23:30', '00:00'];

/** Same idea for the clock: `<input type="time">` is a native wheel on a phone. */
function bedtimePicker(current, onChange) {
  let value = parseClock(current) ? current : '23:30';

  const readout = h('span', { class: 'timeset__value', role: 'status', 'aria-live': 'polite' },
    formatClockLabel(value));
  const chips = [];

  const sync = () => {
    readout.textContent = formatClockLabel(value);
    for (const [i, chip] of chips.entries()) {
      const on = BEDTIME_PRESETS[i] === value;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    rovingSync?.();
    onChange(value);
  };


  // The steppers used to wrap the whole 1440-minute clock, so sixteen taps of
  // "later" from midnight reached 4am — a time the night cycle reads as this
  // morning rather than tomorrow's. Measured from noon, an evening is a simple
  // range: 19:00 is 420 and 03:45 is 945, and there is nothing to wrap through.
  const EARLIEST = 7 * 60; // 19:00
  const LATEST = 15 * 60 + 45; // 03:45 — one step short of the 4am rollover
  const fromNoon = (h, m) => (h * 60 + m - 720 + 1440) % 1440;

  const shift = (minutes) => {
    const parsed = parseClock(value) || { hours: 23, minutes: 30 };
    const next = clamp(fromNoon(parsed.hours, parsed.minutes) + minutes, EARLIEST, LATEST);
    const total = (next + 720) % 1440;
    value = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    sync();
  };

  const stepper = h('div', { class: 'timeset' },
    h('button', {
      type: 'button', class: 'timeset__btn', 'aria-label': 'Fifteen minutes earlier', onClick: () => shift(-BEDTIME_STEP),
    }, icon('minus', { size: 16 })),
    readout,
    h('button', {
      type: 'button', class: 'timeset__btn', 'aria-label': 'Fifteen minutes later', onClick: () => shift(BEDTIME_STEP),
    }, icon('plus', { size: 16 })));

  let rovingSync = null;
  const row = h('div', { class: 'chipset', role: 'radiogroup', 'aria-label': 'Common bedtimes' });
  for (const preset of BEDTIME_PRESETS) {
    const chip = h('button', {
      type: 'button',
      class: `chip-toggle ${preset === value ? 'is-on' : ''}`.trim(),
      role: 'radio',
      'aria-checked': preset === value ? 'true' : 'false',
      onClick: () => { value = preset; sync(); },
    }, formatClockLabel(preset));
    chips.push(chip);
    row.append(chip);
  }
  rovingSync = rovingGroup(row);

  return h('div', { class: 'timepick' }, stepper, row);
}

function downloadBackup(state) {
  downloadText(serializeState(state), `nightcheck-${state.night.key}.json`);
}

VIEWS.settings = () => {
  const state = getState();
  const settings = state.profile.settings;

  const bedtime = bedtimePicker(settings.bedtime, (value) => {
    update((s) => { s.profile.settings.bedtime = value; });
    emit('setting', { key: 'bedtime', value });
  });

  const motion = choiceRow('Motion', [
    ['auto', 'Follow my system'],
    ['on', 'Always animate'],
    ['off', 'Reduce motion'],
  ], settings.motion, (value) => {
    update((s) => { s.profile.settings.motion = value; });
    emit('setting', { key: 'motion', value });
  });

  const importInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const next = parseImport(text);
      const current = getState();
      const nights = Object.keys(current.history).length;
      const warning = nights
        ? `This replaces everything in this browser: ${nights} banked ${nights === 1 ? 'night' : 'nights'}, level ${current.profile.level}, ${current.profile.stardust} stardust and every unlock.`
        : 'This replaces everything currently in this browser.';
      const go = await confirmAction({
        title: 'Restore this backup?',
        body: warning,
        confirmLabel: 'Restore it',
        cancelLabel: 'Keep what I have',
        iconName: 'upload',
      });
      if (!go) {
        importInput.value = '';
        return;
      }
      replaceState(next);
      emit('imported', next);
      toast('Backup restored', { tone: 'win', iconName: 'upload' });
      refreshModal();
    } catch (err) {
      toast('That file could not be read', { tone: 'warn', iconName: 'upload', detail: err.message });
    }
    importInput.value = '';
  });

  const toggle = (key, label, hint) => {
    const input = h('input', { type: 'checkbox', checked: Boolean(settings[key]) });
    input.addEventListener('change', () => {
      update((s) => { s.profile.settings[key] = input.checked; });
      emit('setting', { key, value: input.checked });
    });
    return h('label', { class: 'switch' }, input,
      h('span', { class: 'switch__track' }, h('span', { class: 'switch__thumb' })),
      h('span', { class: 'switch__label' }, label, hint ? h('span', { class: 'muted small' }, hint) : null));
  };

  return {
    title: 'Settings',
    body: h('div', { class: 'settings' },
      field('Target bedtime', bedtime, 'Drives the countdown and the on-pace reading.'),
      field('Motion', motion, 'The sky, the FLIP animations and the pointer trail.'),
      h('div', { class: 'field' },
        toggle('dim', 'Sleep-safe dim', 'Warms and dims the whole page for late nights.'),
        toggle('muted', 'Mute sounds', 'Sound effects are off by default.'),
        toggle('hideCompleted', 'Hide completed tasks', 'They still count — they just get out of the way.'),
        toggle('autoTimer', 'Start the timer automatically', 'In one-at-a-time, the clock runs the moment a card appears instead of waiting for Start.'),
        toggle('curfew', 'Close the market before bed', 'The shop, star map, history and insights shut 30 minutes before bedtime, so this app is not the thing keeping you up.')),
      h('h3', { class: 'modal__section' }, 'Your data'),
      h('p', { class: 'muted small' }, 'Everything lives in this browser only. Export if you want it anywhere else.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--sm', onClick: () => downloadBackup(getState()) },
          icon('download', { size: 14 }), 'Export JSON'),
        h('button', { type: 'button', class: 'btn btn--sm', onClick: () => importInput.click() },
          icon('upload', { size: 14 }), 'Import JSON'),
        importInput),
      h('h3', { class: 'modal__section' }, 'Night control'),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          class: 'btn btn--sm',
          onClick: () => {
            const result = update((s) => forceNewNight(s));
            emit('rollover', result);
            toast('Started a fresh night', { tone: 'info', iconName: 'moon', detail: 'The last one was banked into your history.' });
            refreshModal();
          },
        }, 'Bank tonight and start fresh'),
        h('button', {
          type: 'button',
          class: 'btn btn--sm btn--danger',
          onClick: () => runReset(),
        }, 'Choose what to reset…')),
      h('p', { class: 'muted small' },
        'A night rolls over at 4am, so anything you check off at 1am still counts for the night before.'),
      h('h3', { class: 'modal__section' }, 'This app'),
      appVersionPanel()),
  };
};

/**
 * Pick what to throw away, then confirm exactly that. One button that erased
 * your list, your level, your unlocks and your settings together was the only
 * answer the app had to "I just want the boxes unticked".
 */
async function runReset() {
  const chosen = await chooseAction({
    title: 'What should go?',
    body: 'Everything you leave unticked is kept exactly as it is. Pick as few as you like.',
    options: RESET_PARTS,
    confirmLabel: 'Reset these',
    cancelLabel: 'Cancel',
    danger: true,
    iconName: 'undo',
  });
  if (!chosen || !chosen.length) return;

  const names = chosen.map((id) => resetPartById(id).label.toLowerCase());
  const listed = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const everything = chosen.length === RESET_PARTS.length;

  const go = await confirmAction({
    title: everything ? 'Erase everything?' : 'Reset these?',
    body: everything
      ? 'Every task, section, level, streak, unlock and setting goes. There is no undo, and no copy anywhere else unless you exported one.'
      : `This clears ${listed}. There is no undo.`,
    confirmLabel: everything ? 'Erase it all' : 'Reset',
    cancelLabel: 'Never mind',
    danger: true,
    iconName: 'trash',
  });
  if (!go) return;

  if (everything) {
    clearStorage();
    replaceState(createInitialState());
    emit('imported', getState());
    toast('Everything reset', { tone: 'warn', iconName: 'undo' });
    closeModal();
    return;
  }

  update((state) => applyReset(state, chosen));
  emit('imported', getState()); // same shape of change: re-apply cosmetics, re-render
  toast(`Reset ${listed}`, { tone: 'warn', iconName: 'undo', detail: 'Everything else is untouched.' });
  refreshModal();
}

/**
 * Installed to a home screen, the app is a cache that boots — and it will
 * happily boot last week's copy for days. This is the lever for when it does.
 */
function appVersionPanel() {
  const line = h('p', { class: 'muted small' }, 'Checking which version is running…');
  runningVersion().then((version) => {
    line.textContent = version
      ? `Running ${version}. It updates itself on launch; this is for when it hasn't.`
      : 'Running from the network, so you always have the newest one.';
  });

  const button = h('button', {
    type: 'button',
    class: 'btn btn--sm',
    onClick: async () => {
      button.disabled = true;
      button.replaceChildren(icon('undo', { size: 14 }), 'Refreshing…');
      const outcome = await refreshApp();
      if (outcome === 'offline') {
        button.disabled = false;
        button.replaceChildren(icon('undo', { size: 14 }), 'Refresh the app');
        toast('No connection', {
          tone: 'warn',
          iconName: 'download',
          detail: 'A refresh has to fetch the new version first.',
        });
      }
      // Every other outcome ends in a reload, so there is nothing to restore.
    },
  }, icon('undo', { size: 14 }), 'Refresh the app');

  return h('div', { class: 'field' },
    h('div', { class: 'row' }, button),
    line,
    h('p', { class: 'muted small' },
      'Nothing you have done is stored in the app itself — your night, streak, '
      + 'stardust and unlocks live in this browser and are untouched by a refresh.'));
}

/* ------------------------------------------------------------------- help */

VIEWS.help = () => ({
  title: 'Keyboard',
  body: h('div', {},
    h('p', { class: 'modal__lead' },
      'Adding a task is a text box, a time and a section — no syntax needed. If you '
      + 'prefer to type, the quick-add box also understands ',
      h('code', {}, '#section'), ' and ', h('code', {}, '!minutes'), ': ',
      h('code', {}, 'Floss #wind-down !2'), '. Odd durations are fine — ',
      h('code', {}, '!7.5'), ' and ', h('code', {}, '!30s'), ' both work.'),
    h('p', { class: 'modal__lead' },
      'Press ', h('kbd', {}, 'F'), ' for one task at a time — a single card with a big '
      + 'target, which is the easy way through a long list at midnight.'),
    h('ul', { class: 'shortcuts' }, ...SHORTCUTS.map(([keys, description]) => h('li', {},
      h('kbd', {}, keys), h('span', {}, description))))),
});

export const MODAL_NAMES = Object.keys(VIEWS);
