/* Every panel that opens over the app: the Night Market, the star map,
   night history, insights, settings and the shortcut list. */

import { h, svg, icon, replace } from '../dom.js';
import { getState, update, replaceState, emit } from '../state.js';
import {
  THEMES, SOUND_PACKS, TRAILS, FONTS, CONSUMABLES, COMPANION_ITEMS,
  canBuy, owns, isEquipped, purchase, equipItem, buyConsumable,
  feedCompanion, renameCompanion, unequipCompanion,
} from '../shop.js';
import { CONSTELLATIONS, progressFor, buyStar, collectionSummary, totalRemainingCost } from '../constellations.js';
import { FEED_COST, TIER_NAMES, feedsToNextTier, companionSvg } from '../companion.js';
import { BADGES, levelFromXp, titleForLevel, TITLES } from '../game.js';
import { taskInsights, reliableTasks, overallRate } from '../insights.js';
import { forceNewNight } from '../night.js';
import { shiftKey, keyToDate, formatShortDate, formatNightLabel } from '../time.js';
import { serializeState, parseImport, clearStorage } from '../storage.js';
import { createInitialState } from '../model.js';
import { SHORTCUTS } from '../keys.js';
import { previewPack } from '../audio.js';
import { setSkyPaused } from '../sky.js';
import { toast } from '../toast.js';
import { formatNumber, plural } from '../util.js';

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

export function closeModal() {
  currentView = null;
  if (dialog?.open) dialog.close();
  setSkyPaused(false);
}

export function refreshModal() {
  if (currentView) renderModal();
}

function renderModal({ keepScroll = true } = {}) {
  const view = VIEWS[currentView];
  if (!view) return;
  const offset = bodyHost.scrollTop;
  const built = view();
  titleHost.textContent = built.title;
  replace(bodyHost, built.body);
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
          onClick: () => { equipItem(item.id); refreshModal(); },
        }, 'Equip'))
      : h('button', {
        type: 'button',
        class: 'btn btn--primary btn--sm',
        disabled: !check.ok,
        title: check.ok ? `Buy for ${item.cost} stardust` : check.reason,
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

  const tabBar = h('div', { class: 'tabs', role: 'tablist' },
    ...tabs.map(([id, label]) => h('button', {
      type: 'button',
      class: `tab ${id === active[0] ? 'is-active' : ''}`.trim(),
      role: 'tab',
      'aria-selected': id === active[0] ? 'true' : 'false',
      onClick: () => { shopTab = id; refreshModal(); },
    }, label)));

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

  const totals = Object.values(state.history);
  const perfect = totals.filter((h2) => h2.pct >= 100).length;

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
        h('div', { class: 'stat-box' }, h('strong', {}, String(perfect)), h('span', {}, 'perfect nights'))),
      h('div', { class: 'heatmap' }, ...cells),
      h('div', { class: 'heatmap__key' },
        h('span', { class: 'muted small' }, 'less'),
        ...[0, 1, 2, 3, 4].map((l) => h('span', { class: `heat heat--l${l}`, 'aria-hidden': 'true' })),
        h('span', { class: 'muted small' }, 'more')),
      detail),
  };
};

/* --------------------------------------------------------------- insights */

VIEWS.insights = () => {
  const state = getState();
  const rows = taskInsights(state);
  const reliable = reliableTasks(state);
  const level = levelFromXp(state.profile.xp);

  const badgeGrid = h('div', { class: 'badges' }, ...BADGES.map((badge) => {
    const earned = state.profile.badges.includes(badge.id);
    return h('div', { class: `badge ${earned ? 'is-earned' : ''}`.trim(), title: badge.hint },
      icon(badge.icon, { size: 18 }),
      h('span', { class: 'badge__name' }, badge.name),
      h('span', { class: 'badge__hint' }, earned ? 'Earned' : badge.hint));
  }));

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
        h('div', { class: 'stat-box' }, h('strong', {}, String(state.profile.badges.length)), h('span', {}, 'badges'))),
      reliable.length
        ? h('p', { class: 'modal__lead' }, 'Most reliable: ', h('strong', {}, reliable.map((r) => r.title).join(', ')), '.')
        : null,
      h('h3', { class: 'modal__section' }, 'Task by task'),
      table,
      h('h3', { class: 'modal__section' }, 'Badges'),
      badgeGrid,
      h('h3', { class: 'modal__section' }, 'Titles'),
      h('ul', { class: 'titles' }, ...TITLES.map((t) => h('li', {
        class: level.level >= t.level ? 'is-earned' : '',
      }, h('strong', {}, t.name), h('span', { class: 'muted small' }, `level ${t.level}`))))),
  };
};

/* --------------------------------------------------------------- settings */

function field(label, control, hint) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    control,
    hint ? h('p', { class: 'muted small' }, hint) : null);
}

function downloadBackup(state) {
  const blob = new Blob([serializeState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `nightcheck-${state.night.key}.json` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

VIEWS.settings = () => {
  const state = getState();
  const settings = state.profile.settings;

  const bedtime = h('input', { class: 'field__input', type: 'time', value: settings.bedtime });
  bedtime.addEventListener('change', () => {
    update((s) => { s.profile.settings.bedtime = bedtime.value || '23:30'; });
  });

  const motion = h('select', { class: 'field__input' },
    h('option', { value: 'auto', selected: settings.motion === 'auto' }, 'Follow my system setting'),
    h('option', { value: 'on', selected: settings.motion === 'on' }, 'Always animate'),
    h('option', { value: 'off', selected: settings.motion === 'off' }, 'Reduce motion'));
  motion.addEventListener('change', () => {
    update((s) => { s.profile.settings.motion = motion.value; });
    emit('setting', { key: 'motion', value: motion.value });
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
        ? `Importing replaces everything in this browser: ${nights} banked ${nights === 1 ? 'night' : 'nights'}, level ${current.profile.level}, ${current.profile.stardust} stardust and every unlock. Continue?`
        : 'Importing replaces everything currently in this browser. Continue?';
      if (!window.confirm(warning)) {
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
          onClick: () => {
            if (!window.confirm('Erase every task, section, level and unlock? This cannot be undone.')) return;
            clearStorage();
            replaceState(createInitialState());
            emit('imported', getState());
            toast('Everything reset', { tone: 'warn', iconName: 'undo' });
            closeModal();
          },
        }, 'Reset everything')),
      h('p', { class: 'muted small' },
        'A night rolls over at 4am, so anything you check off at 1am still counts for the night before.')),
  };
};

/* ------------------------------------------------------------------- help */

VIEWS.help = () => ({
  title: 'Keyboard',
  body: h('div', {},
    h('p', { class: 'modal__lead' }, 'Quick add understands ', h('code', {}, '#section'), ' and ', h('code', {}, '!minutes'), ' — for example ', h('code', {}, 'Floss #wind-down !2'), '.'),
    h('ul', { class: 'shortcuts' }, ...SHORTCUTS.map(([keys, description]) => h('li', {},
      h('kbd', {}, keys), h('span', {}, description))))),
});

export const MODAL_NAMES = Object.keys(VIEWS);
