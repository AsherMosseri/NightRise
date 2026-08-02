/* The checklist itself: sections, tasks, inline editing, and all the
   reordering affordances (drag, buttons, Alt+Arrow). */

import { h, icon, iconButton, clear, $$, markIconName } from '../dom.js';
import { getState } from '../state.js';
import {
  addTask, deleteSection, deleteTask, moveSection, moveTaskByStep, moveTaskTo,
  renameSection, renameTask, reorderSection, setTaskMinutes, toggleSectionCollapsed,
  toggleSkip, toggleTask, undo, startTask,
} from '../actions.js';
import { initDragAndDrop } from '../dnd.js';
import { toast } from '../toast.js';
import { openSheet } from './sheet.js';
import { openAddTask, openFirstTask, openAddSection } from './add-task.js';
import { minutesFromToken } from '../keys.js';
import { formatMinutesLong, formatMinutesShort, plural } from '../util.js';
import { still, growTo } from './motion.js';
import { lateStage, panelGate } from '../time.js';

/** Whether this device has a pointer that can hover — the same test the CSS makes. */
function hasPointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;
}

let root = null;
let pendingFocus = null;
/** The row that just changed, so the next render can animate it. */
let justToggled = null;

export function focusNext(key) {
  pendingFocus = key;
}

/* ------------------------------------------------------------ inline edit */

/** The commit function of the inline edit currently on screen, if any. */
let liveEdit = null;

/**
 * Commit whatever is being typed before the list is torn down.
 *
 * `clear(root)` removes the focused input, and removing a focused element does
 * not fire `blur` in Safari or Chrome — so the commit-on-blur path never ran and
 * the typed name was simply gone. Rare but real: the 4am rollover on the 30s
 * tick, a cross-tab sync, an import. Committing is what blurring already does.
 */
function settleInlineEdit() {
  const commit = liveEdit;
  liveEdit = null;
  if (commit) commit(true);
}

function beginInlineEdit(labelNode, currentValue, onCommit, { label = 'Rename' } = {}) {
  const input = h('input', {
    class: 'inline-edit',
    type: 'text',
    maxlength: '200',
    value: currentValue,
    // The label it replaces is gone from the DOM by the time focus lands, so a
    // flat "Rename" was the only thing announced for both tasks and sections.
    'aria-label': label,
    spellcheck: 'false',
  });
  let settled = false;
  const commit = (save) => {
    if (settled) return;
    settled = true;
    if (liveEdit === commit) liveEdit = null;
    const value = input.value.trim();
    const owner = input.closest('[data-focus]');
    input.replaceWith(labelNode);
    if (owner) focusNext(owner.dataset.focus);
    if (save && value && value !== currentValue) onCommit(value);
    else if (owner) restorePendingFocus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(true); }
    if (event.key === 'Escape') { event.preventDefault(); commit(false); }
    event.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
  liveEdit = commit;
  labelNode.replaceWith(input);
  input.focus();
  input.select();
}

function editMinutes(chip, task) {
  const input = h('input', {
    class: 'inline-edit inline-edit--min',
    type: 'number',
    min: '0',
    max: '600',
    step: '0.5',
    inputMode: 'decimal',
    value: String(task.minutes),
    'aria-label': `Minutes for ${task.title} — half minutes allowed, so 0.5 is thirty seconds`,
  });
  let settled = false;
  const commit = (save) => {
    if (settled) return;
    settled = true;
    if (liveEdit === commit) liveEdit = null;
    const value = Number(input.value);
    input.replaceWith(chip);
    if (save && Number.isFinite(value)) setTaskMinutes(task.id, value);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(true); }
    if (event.key === 'Escape') { event.preventDefault(); commit(false); }
    event.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
  liveEdit = commit;
  chip.replaceWith(input);
  input.focus();
  input.select();
}

/* ------------------------------------------------------------- xp floater */

/**
 * Floats "+12 XP" off the row you just checked. It lives in a body-level layer
 * rather than inside the row: the state change that earns the XP rebuilds the
 * whole checklist in the same tick, so anything parented to the row was
 * destroyed before it ever painted.
 */
export function floatXp(taskId, text) {
  const row = root?.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
  if (!row) return;
  const rect = row.getBoundingClientRect();
  // In One Card mode `.app` is display:none, so the row still exists and
  // measures 0×0 at the origin — which put the XP number at x=-92, painting
  // itself half off the left edge of the phone. No box, no float.
  if (!rect.width || !rect.height) return;
  const float = h('span', {
    class: 'xp-float',
    'aria-hidden': 'true', // decoration, like every other transient effect
    style: {
      left: `${Math.round(rect.right - 92)}px`,
      top: `${Math.round(rect.top + 2)}px`,
    },
  }, text);
  document.body.appendChild(float);
  setTimeout(() => float.remove(), 1100);
}

/* -------------------------------------------------------------- task rows */

/** Rename by id rather than by node, so it survives a re-render in between. */
function startRenameTask(taskId) {
  const task = getState().template.tasks[taskId];
  const node = root?.querySelector(`[data-task-id="${CSS.escape(taskId)}"] .task__title`);
  if (task && node) {
    beginInlineEdit(node, task.title, (value) => renameTask(taskId, value), { label: `Rename ${task.title}` });
  }
}

function rainCheck(taskId) {
  const result = toggleSkip(taskId);
  if (!result?.blocked) return;
  // Pointing at the market is only useful if you can get there. Inside the
  // curfew — the half hour before bedtime, which is exactly when you are most
  // likely to be rain-checking things — the market is behind a confirmation
  // sheet, so the toast said "buy more" and offered a four-step detour. Outside
  // it, the toast takes you there in one tap instead of describing the route.
  const live = getState();
  const { bedtime, lastCall, curfew } = live.profile.settings;
  // The same gate the market button goes through. Asking only about the curfew
  // put a "Night Market" action on this toast that opened a sheet saying no —
  // and missed the case the toast most needs to get right, since past last call
  // there is no way through at all.
  const closed = panelGate(lateStage(live.night.key, bedtime, lastCall, new Date()), curfew) !== 'open';
  toast('No rain checks left', {
    tone: 'warn',
    iconName: 'skip',
    detail: closed ? 'Tonight has to be run on what you have.' : 'Buy more in the Night Market.',
    action: closed ? null : {
      label: 'Night Market',
      onClick: () => document.querySelector('[data-open="shop"]')?.click(),
    },
  });
}

/** One definition of what you can do to a task, shared by the row and the sheet. */
function taskActions(state, task) {
  const skipped = Boolean(state.night.skipped[task.id]);
  const done = state.night.done[task.id] !== undefined;
  return [
    // Not offered on a task you have already done. There is nothing to excuse,
    // and taking it spent a rain check *and* silently revoked the XP and
    // stardust the task had paid — the toast mentioned neither, and a rain
    // check that dropped you a level said nothing at all.
    done ? null : {
      key: 'skip',
      icon: 'skip',
      label: skipped ? 'Undo rain check' : 'Rain check',
      hint: skipped ? 'Count it against tonight again' : 'Excuse it from tonight’s percentage',
      run: () => rainCheck(task.id),
    },
    done || state.night.started[task.id] ? null : {
      key: 'start',
      icon: 'play',
      label: 'Start it',
      hint: 'Say you have begun — a little of what it pays, up front',
      run: () => startTask(task.id),
    },
    { key: 'edit', icon: 'pencil', label: 'Rename', immediate: true, run: () => startRenameTask(task.id) },
    { key: 'up', icon: 'up', label: 'Move up', run: () => { focusNext(`task:${task.id}`); expectReorder(); moveTaskByStep(task.id, -1); } },
    { key: 'down', icon: 'down', label: 'Move down', run: () => { focusNext(`task:${task.id}`); expectReorder(); moveTaskByStep(task.id, 1); } },
    { key: 'del', icon: 'trash', label: 'Delete', danger: true, run: () => removeTask(task.id) },
  ].filter(Boolean);
}

function taskRow(state, task, index, total = 0) {
  const done = state.night.done[task.id] !== undefined;
  const skipped = Boolean(state.night.skipped[task.id]);
  const actions = taskActions(state, task);

  // A drawn line rather than `text-decoration`, which cannot be animated. The
  // line sweeping across the thing you just finished is the oldest reliable
  // satisfaction in checklists and the app did not have it.
  // Two copies of the title: the plain one, and a struck one clipped to nothing
  // and swept open. A single absolutely-positioned rule cannot do this — a title
  // that wraps to four lines got one line drawn through the gap between lines
  // two and three, striking no words at all. `text-decoration` handles every
  // line correctly but cannot be animated, so it is revealed rather than drawn.
  const title = h('span', { class: 'task__title' },
    h('span', { class: 'task__label' }, task.title),
    h('span', { class: 'task__label task__label--struck', 'aria-hidden': 'true' }, task.title));
  const minutesChip = h('button', {
    type: 'button',
    class: 'task__minutes',
    title: 'Change the time estimate',
    'aria-label': `${task.title}: ${formatMinutesLong(task.minutes)}. Change estimate`,
    onClick: (event) => { event.stopPropagation(); editMinutes(minutesChip, task); },
  }, formatMinutesShort(task.minutes));

  const menuButton = iconButton('more', `More actions for ${task.title}`, (event) => {
    event.stopPropagation();
    openSheet({
      title: task.title,
      subtitle: `${formatMinutesLong(task.minutes)}${done ? ' · done' : ''}${skipped ? ' · rain-checked' : ''}`,
      invoker: menuButton,
      items: actions.map((a) => ({
        icon: a.icon, label: a.label, hint: a.hint, danger: a.danger, immediate: a.immediate, onClick: a.run,
      })),
    });
  }, { class: 'task__menu', dataset: { focus: `task-menu:${task.id}` } });

  // A focusable row needs a name and a declared key contract — a nameless tab
  // stop tells a screen reader nothing about what it is or what it can do.
  const rowLabel = [
    task.title,
    formatMinutesLong(task.minutes),
    done ? 'done' : null,
    skipped ? 'rain-checked' : null,
  ].filter(Boolean).join(', ');

  const row = h('li', {
    class: ['task', done && 'task--done', skipped && 'task--skipped'].filter(Boolean).join(' '),
    dataset: { taskId: task.id, index, focus: `task:${task.id}` },
    draggable: 'true',
    tabIndex: 0,
    // Alt+Arrow moves a row and restores focus to it, and without a declared
    // position nothing announced that anything had happened at all.
    'aria-posinset': String(index + 1),
    'aria-setsize': String(total || 1),
    'aria-label': rowLabel,
    'aria-keyshortcuts': 'Space E X Delete Alt+ArrowUp Alt+ArrowDown',
  },
  h('button', {
    type: 'button',
    class: 'task__check',
    role: 'checkbox',
    'aria-checked': done ? 'true' : 'false',
    // The name is the thing; `aria-checked` beside it is the state. Naming it
    // with a verb made a checked box announce as "Uncheck Brush teeth,
    // checkbox, checked" — the name and the state reading as contradictions.
    'aria-label': task.title,
    onClick: (event) => {
      event.stopPropagation();
      // The row is rebuilt already wearing its new state, so the transition
      // declared on .task__check has never once had an old value to run from.
      // Remembering which row moved lets the next render animate it instead.
      justToggled = { id: task.id, done: !done };
      // With hide-completed on, this row is about to vanish and take 46px of
      // the list with it. Everything below should slide, not jump.
      if (getState().profile.settings.hideCompleted) expectShift();
      toggleTask(task.id);
    },
  }, icon(markIconName(getState()), { size: 15 })),
  h('div', { class: 'task__body' }, title,
    skipped ? h('span', { class: 'task__flag' }, 'rain check') : null,
    // A row you have started but not finished says so. Not a badge for having
    // begun — a reminder that coming back to this one is cheaper than the
    // others, which is the whole reason starting is paid for.
    !done && !skipped && state.night.started[task.id]
      ? h('span', { class: 'task__flag task__flag--started' }, 'started')
      : null),
  minutesChip,
  h('div', { class: 'task__actions' },
    // "Delete task" five times over is five identical buttons to a screen
    // reader. The overflow button one line down already names the task.
    ...actions.map((a) => iconButton(a.icon, `${a.label}: ${task.title}`, (event) => {
      event.stopPropagation();
      a.run();
    }, { class: a.danger ? 'icon-btn--danger' : '', dataset: { focus: `task-${a.key}:${task.id}` } }))),
  menuButton,
  h('span', { class: 'task__grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })));

  row.addEventListener('keydown', (event) => rowKeys(event, task));
  // Pointers only. iOS fires `dblclick` for a double tap, so a mis-timed retry
  // after a tap that seemed not to register replaced the title with an edit
  // field — and `blur` commits rather than cancels, so backing out of it needs
  // a keyboard. The ⋯ menu is how you rename on touch.
  row.addEventListener('dblclick', (event) => {
    if (event.pointerType === 'touch' || !hasPointer()) return;
    startRenameTask(task.id);
  });
  return row;
}

/** The row that should take focus once `id` disappears. */
function neighbourFocusKey(id) {
  const rows = $$('[data-task-id]', root);
  const index = rows.findIndex((row) => row.dataset.taskId === id);
  const next = rows[index + 1] || rows[index - 1];
  if (next) return `task:${next.dataset.taskId}`;
  const section = rows[index]?.closest('[data-section-id]');
  return section ? `section:${section.dataset.sectionId}` : 'add-section';
}

function removeTask(id) {
  expectShift();
  focusNext(neighbourFocusKey(id)); // otherwise focus falls to <body>
  const result = deleteTask(id);
  if (!result) return;
  toast(`Deleted “${result.task.title}”`, {
    tone: 'info',
    iconName: 'trash',
    action: { label: 'Undo', onClick: () => undo(result.undoId) },
  });
}

function startRenameSection(sectionId) {
  const section = getState().template.sections[sectionId];
  const node = root?.querySelector(`[data-section-id="${CSS.escape(sectionId)}"] .section__title`);
  if (section && node) {
    beginInlineEdit(node, section.title, (value) => renameSection(sectionId, value), { label: `Rename section ${section.title}` });
  }
}

/** One definition of what you can do to a section, shared by the header and the sheet. */
function sectionActions(section, addInput) {
  return [
    {
      key: 'plus',
      icon: 'plus',
      label: 'Add a task here',
      // The inline input this used to focus is `display: none` under
      // (hover: none) and ≤640px — and this same list feeds the touch sheet,
      // so on a phone the tap did nothing at all. The add sheet works at every
      // width and is what the row's own "+" already opens.
      immediate: true, // opens a field; iOS wants the focus inside the gesture
      run: () => {
        if (addInput?.isConnected && addInput.offsetParent !== null) {
          focusNext(`section-add:${section.id}`);
          addInput.focus();
          return;
        }
        openAddTask({ sectionId: section.id });
      },
    },
    { key: 'edit', icon: 'pencil', label: 'Rename section', immediate: true, run: () => startRenameSection(section.id) },
    { key: 'up', icon: 'up', label: 'Move section up', run: () => { focusNext(`section:${section.id}`); expectReorder(); moveSection(section.id, -1); } },
    { key: 'down', icon: 'down', label: 'Move section down', run: () => { focusNext(`section:${section.id}`); expectReorder(); moveSection(section.id, 1); } },
    { key: 'del', icon: 'trash', label: 'Delete section', danger: true, run: () => removeSection(section.id) },
  ];
}

function removeSection(id) {
  expectShift();
  const state = getState();
  const section = state.template.sections[id];
  if (!section) return;
  const count = section.taskIds.length;
  const order = state.template.order;
  const at = order.indexOf(id);
  const neighbour = order[at + 1] || order[at - 1];
  focusNext(neighbour ? `section:${neighbour}` : 'add-section');

  const removed = deleteSection(id);
  if (!removed) return;
  toast(`Deleted “${section.title}”`, {
    tone: 'info',
    iconName: 'trash',
    detail: count ? `${plural(count, 'task', 'tasks')} went with it.` : null,
    duration: count ? 7000 : 4200,
    action: { label: 'Undo', onClick: () => undo(removed.undoId) },
  });
}

function moveFocus(row, delta) {
  const rows = $$('[data-task-id]', root);
  const index = rows.indexOf(row);
  const next = rows[index + delta];
  if (next) next.focus();
}

function rowKeys(event, task) {
  const row = event.currentTarget;
  if (event.target !== row) return;
  const key = event.key;

  if (key === ' ' || key === 'Enter') {
    event.preventDefault();
    toggleTask(task.id);
    focusNext(`task:${task.id}`);
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    const delta = key === 'ArrowDown' ? 1 : -1;
    if (event.altKey) {
      focusNext(`task:${task.id}`);
      expectReorder();
      moveTaskByStep(task.id, delta);
    } else {
      moveFocus(row, delta);
    }
  } else if (key.toLowerCase() === 'e') {
    event.preventDefault();
    startRenameTask(task.id);
  } else if (key === 'Delete' || key === 'Backspace') {
    event.preventDefault();
    removeTask(task.id);
  } else if (key.toLowerCase() === 'x') {
    event.preventDefault();
    // Same rule as the menu: nothing to excuse on a task already done.
    if (getState().night.done[task.id] === undefined) rainCheck(task.id);
  }
}

/* ---------------------------------------------------------------- section */

function sectionNode(state, section, index) {
  const stats = { total: 0, done: 0 };
  for (const id of section.taskIds) {
    if (!state.template.tasks[id]) continue;
    stats.total += 1;
    if (state.night.done[id] !== undefined) stats.done += 1;
  }
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  const title = h('h2', { class: 'section__title' }, section.title);
  const addInput = h('input', {
    class: 'section__add-input',
    type: 'text',
    maxlength: '200',
    placeholder: 'Add a task…',
    'aria-label': `Add a task to ${section.title}`,
    dataset: { focus: `section-add:${section.id}` },
  });

  // On touch the same row is a button that opens the add sheet; typing symbols
  // on a phone keyboard at midnight is not a reasonable ask.
  const addTap = h('button', {
    type: 'button',
    class: 'section__add-tap',
    dataset: { focus: `section-addtap:${section.id}` },
    onClick: () => openAddTask({ sectionId: section.id, invoker: addTap }),
  }, icon('plus', { size: 15 }), h('span', {}, 'Add a task'));

  const submitAdd = () => {
    const value = addInput.value.trim();
    if (!value) return;
    const parsed = parseInlineTask(value);
    addInput.value = '';
    // Armed before the mutation: arming it afterwards left a stale key that
    // hijacked focus on the next unrelated re-render.
    focusNext(`section-add:${section.id}`);
    expectShift();
    addTask(section.id, parsed.title, parsed.minutes ?? 5);
  };

  addInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitAdd(); }
    if (event.key === 'Escape') { addInput.value = ''; addInput.blur(); }
    event.stopPropagation();
  });

  const sectionMenu = iconButton('more', `More actions for ${section.title}`, (event) => {
    event.stopPropagation();
    openSheet({
      title: section.title,
      subtitle: `Section · ${stats.done}/${stats.total} done`,
      invoker: sectionMenu,
      items: sectionActions(section, addInput).map((a) => ({
        icon: a.icon, label: a.label, hint: a.hint, danger: a.danger, immediate: a.immediate, onClick: a.run,
      })),
    });
  }, { class: 'section__menu', dataset: { focus: `section-menu:${section.id}` } });

  const header = h('header', {
    class: 'section__head',
    tabIndex: 0,
    draggable: 'true',
    // A focusable element with five key commands and no name at all told a
    // screen reader nothing about what it was — or that Delete here takes the
    // whole section and every task inside it.
    role: 'group',
    'aria-label': `${section.title} section, ${stats.done} of ${stats.total} done`,
    'aria-keyshortcuts': 'Enter E Delete Alt+ArrowUp Alt+ArrowDown',
    dataset: { focus: `section:${section.id}` },
  },
  h('span', { class: 'section__grip', 'aria-hidden': 'true' }, icon('grip', { size: 15 })),
  h('button', {
    type: 'button',
    class: 'section__collapse',
    'aria-expanded': section.collapsed ? 'false' : 'true',
    'aria-label': section.collapsed ? `Expand ${section.title}` : `Collapse ${section.title}`,
    onClick: () => { focusNext(`section:${section.id}`); expectShift(); toggleSectionCollapsed(section.id); },
  }, icon(section.collapsed ? 'down' : 'up', { size: 14 })),
  title,
  h('span', { class: 'section__count' }, `${stats.done}/${stats.total}`),
  h('span', { class: 'section__bar', 'aria-hidden': 'true' },
    // Through grow(), like every other bar. It declares a 400ms width
    // transition that had never once run: a fresh node with an inline width has
    // no previous value to travel from, which is the trap motion.js exists for.
    growTo(h('span', { class: 'section__bar-fill' }), `section:${section.id}`, `${pct}%`)),
  h('div', { class: 'section__actions' },
    ...sectionActions(section, addInput).map((a) => iconButton(a.icon, a.label, () => a.run(),
      { class: a.danger ? 'icon-btn--danger' : '', dataset: { focus: `section-${a.key}:${section.id}` } }))),
  sectionMenu);

  header.addEventListener('dblclick', (event) => {
    if (event.pointerType === 'touch' || !hasPointer()) return;
    startRenameSection(section.id);
  });
  header.addEventListener('keydown', (event) => {
    if (event.target !== header) return;
    const key = event.key;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (!event.altKey) return;
      event.preventDefault();
      focusNext(`section:${section.id}`);
      expectReorder();
      moveSection(section.id, key === 'ArrowDown' ? 1 : -1);
    } else if (key.toLowerCase() === 'e') {
      event.preventDefault();
      startRenameSection(section.id);
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      removeSection(section.id);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      focusNext(`section:${section.id}`);
      expectShift();
      toggleSectionCollapsed(section.id);
    }
  });

  const list = h('ul', {
    class: 'tasks',
    role: 'list',
    dataset: { dropList: '', sectionId: section.id },
  });

  let visible = 0;
  section.taskIds.forEach((taskId, taskIndex) => {
    const task = state.template.tasks[taskId];
    if (!task) return;
    if (state.profile.settings.hideCompleted && state.night.done[taskId] !== undefined) return;
    visible += 1;
    list.appendChild(taskRow(state, task, taskIndex, section.taskIds.length));
  });

  if (!visible) {
    list.appendChild(h('li', { class: 'tasks__empty' },
      stats.total ? 'Everything here is done.' : 'Nothing here yet — add a task below.'));
  }

  return h('section', {
    class: ['section', section.collapsed && 'section--collapsed', stats.total > 0 && stats.done === stats.total && 'section--complete']
      .filter(Boolean).join(' '),
    dataset: { sectionId: section.id, index },
  },
  header,
  h('div', { class: 'section__body' },
    list,
    h('div', { class: 'section__add' },
      icon('plus', { size: 14 }),
      addInput,
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: submitAdd }, 'Add')),
    addTap));
}

/** Lightweight "Title !5" parse for the per-section add box. */
function parseInlineTask(value) {
  const match = /(^|\s)[!~](\d{1,3}(?:\.\d+)?)\s?(m|min|mins|minutes|s|sec|secs|seconds)?(?=\s|$)/i.exec(value);
  if (!match) return { title: value.trim(), minutes: null };
  return {
    title: value.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
    minutes: minutesFromToken(match[2], match[3]),
  };
}

/* ----------------------------------------------------------------- render */

let expectMove = false;

/**
 * Arm the FLIP measurement for the next render.
 *
 * This used to be called only by the reorder paths, on the reasoning that
 * nothing else moves a row. That was wrong: deleting, adding, collapsing a
 * section and — worst of all — checking a task with hide-completed on all
 * shift everything below by a row height, instantly. With hide-completed that
 * fires on every single check-off, and a 46px teleport under your thumb is the
 * most physically wrong thing the list does.
 */
export function expectShift() {
  expectMove = true;
}

/**
 * The same thing under its older name, as a real binding.
 *
 * This was `export { expectShift as expectReorder }`, and an export alias is not
 * a local binding: it renames the symbol for importers and declares nothing
 * inside this module. So all eight `expectReorder()` calls in this file threw
 * ReferenceError before the line beside them ever ran — and those eight are
 * every way this app has of moving anything. Both arrow buttons, both action
 * sheets, Alt+Arrow on a task and on a section header, and dropping either after
 * a drag. Reordering was entirely dead, on every surface, and silent: the throw
 * is inside an event handler, so it landed in the console and nowhere else.
 */
export const expectReorder = expectShift;

function captureRects() {
  const map = new Map();
  // getBoundingClientRect per row forces layout twice on every render. Only a
  // reorder can move anything, so only a reorder is worth measuring.
  if (!root || !expectMove) return map;
  for (const node of root.querySelectorAll('[data-task-id], [data-section-id]')) {
    const key = node.dataset.taskId ? `t:${node.dataset.taskId}` : `s:${node.dataset.sectionId}`;
    map.set(key, node.getBoundingClientRect());
  }
  return map;
}

/** FLIP: animate rows from where they were to where they now are. */
function playFlip(previous) {
  expectMove = false;
  if (!previous.size) return;
  if (document.documentElement.dataset.motion === 'off') return;
  for (const node of root.querySelectorAll('[data-task-id], [data-section-id]')) {
    const key = node.dataset.taskId ? `t:${node.dataset.taskId}` : `s:${node.dataset.sectionId}`;
    const before = previous.get(key);
    if (!before) continue;
    const after = node.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.3,1)' },
    );
  }
}

function focusByKey(key) {
  if (!key || !root) return false;
  const node = root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
  if (!node) return false;
  node.focus({ preventScroll: true });
  return true;
}

/** Consume a pending focus without waiting for a render (nothing changed). */
function restorePendingFocus() {
  const key = pendingFocus;
  pendingFocus = null;
  focusByKey(key);
}

function restoreFocus(previousKey) {
  const key = pendingFocus || previousKey;
  pendingFocus = null;
  focusByKey(key);
}

export function initChecklist(node) {
  root = node;
  initDragAndDrop(root, {
    onDropTask: (taskId, sectionId, index) => {
      if (!sectionId) return;
      focusNext(`task:${taskId}`);
      expectReorder();
      moveTaskTo(taskId, sectionId, index);
    },
    onDropSection: (sectionId, index) => {
      focusNext(`section:${sectionId}`);
      expectReorder();
      reorderSection(sectionId, index);
    },
  });
}

/** Text someone is mid-way through typing must survive an unrelated render. */
function captureDrafts() {
  const drafts = new Map();
  if (!root) return drafts;
  for (const input of root.querySelectorAll('.section__add-input')) {
    if (input.value) drafts.set(input.dataset.focus, input.value);
  }
  return drafts;
}

function restoreDrafts(drafts) {
  for (const [key, value] of drafts) {
    const input = root.querySelector(`.section__add-input[data-focus="${CSS.escape(key)}"]`);
    if (input) input.value = value;
  }
}

export function renderChecklist() {
  if (!root) return;
  settleInlineEdit();
  const state = getState();
  const previousRects = captureRects();
  const drafts = captureDrafts();
  const focusKey = document.activeElement?.dataset?.focus || null;

  clear(root);

  if (!state.template.order.length) {
    root.appendChild(h('div', { class: 'empty-state' },
      icon('moon', { size: 34 }),
      h('h2', {}, 'Your night is a blank sky'),
      h('p', {}, 'Sections group your night — Wind Down, Tidy Up, whatever suits. Start with one.'),
      h('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => openFirstTask(),
      }, 'Add your first task')));
    // The same tail the normal path runs. Returning early left `expectMove`
    // armed, so the next render measured every row for a FLIP nobody asked for,
    // and left `pendingFocus` set — removeSection() arms 'add-section' before
    // deleting the last section, and the button it names does not exist here,
    // so the key sat waiting to hijack focus on an unrelated later render.
    playFlip(previousRects);
    playToggle();
    restoreDrafts(drafts);
    restoreFocus(focusKey);
    return;
  }

  state.template.order.forEach((id, index) => {
    const section = state.template.sections[id];
    if (section) root.appendChild(sectionNode(state, section, index));
  });

  const addSectionButton = h('button', {
    type: 'button',
    class: 'add-section',
    dataset: { focus: 'add-section' },
    onClick: () => openAddSection({
      invoker: addSectionButton,
      onCreated: (section) => openAddTask({ sectionId: section.id }),
    }),
  }, icon('plus', { size: 16 }), 'Add a section');
  root.appendChild(addSectionButton);

  playFlip(previousRects);
  playToggle();
  restoreDrafts(drafts);
  restoreFocus(focusKey);
}

/**
 * The one beat the app was missing: the row you just touched reacting.
 *
 * Everything else already fired somewhere else on screen — a shooting star at
 * the top, a number in the right margin, a sound — and the thing under your
 * thumb did nothing at all.
 */
function playToggle() {
  const pending = justToggled;
  justToggled = null;
  if (!pending || !root || still()) return;
  const row = root.querySelector(`[data-task-id="${CSS.escape(pending.id)}"]`);
  const box = row?.querySelector('.task__check');
  if (!box) return;

  box.animate(pending.done
    ? [{ transform: 'scale(1)' }, { transform: 'scale(0.82)', offset: 0.28 }, { transform: 'scale(1.14)', offset: 0.62 }, { transform: 'scale(1)' }]
    : [{ transform: 'scale(1)' }, { transform: 'scale(0.9)', offset: 0.4 }, { transform: 'scale(1)' }],
  { duration: pending.done ? 340 : 200, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)' });

  if (pending.done) {
    const tick = box.querySelector('svg');
    if (tick) {
      tick.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 220, delay: 60, easing: 'cubic-bezier(0.34, 1.5, 0.5, 1)', fill: 'both' });
    }
    const strike = row.querySelector('.task__label--struck');
    if (strike) {
      strike.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
        { duration: 300, delay: 40, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
    }
  }
}
