/* The checklist itself: sections, tasks, inline editing, and all the
   reordering affordances (drag, buttons, Alt+Arrow). */

import { h, icon, iconButton, clear, $$ } from '../dom.js';
import { getState } from '../state.js';
import {
  addSection, addTask, deleteSection, deleteTask, moveSection, moveTaskByStep, moveTaskTo,
  renameSection, renameTask, reorderSection, setTaskMinutes, toggleSectionCollapsed,
  toggleSkip, toggleTask, undo,
} from '../actions.js';
import { initDragAndDrop } from '../dnd.js';
import { toast } from '../toast.js';
import { openSheet } from './sheet.js';
import { plural } from '../util.js';

let root = null;
let pendingFocus = null;

export function focusNext(key) {
  pendingFocus = key;
}

/* ------------------------------------------------------------ inline edit */

function beginInlineEdit(labelNode, currentValue, onCommit) {
  const input = h('input', {
    class: 'inline-edit',
    type: 'text',
    value: currentValue,
    'aria-label': 'Rename',
    spellcheck: 'false',
  });
  let settled = false;
  const commit = (save) => {
    if (settled) return;
    settled = true;
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
    value: String(task.minutes),
    'aria-label': `Minutes for ${task.title}`,
  });
  let settled = false;
  const commit = (save) => {
    if (settled) return;
    settled = true;
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
  const float = h('span', {
    class: 'xp-float',
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
  if (task && node) beginInlineEdit(node, task.title, (value) => renameTask(taskId, value));
}

function rainCheck(taskId) {
  const result = toggleSkip(taskId);
  if (result?.blocked) {
    toast('No rain checks left', { tone: 'warn', iconName: 'skip', detail: 'Buy more in the Night Market.' });
  }
}

/** One definition of what you can do to a task, shared by the row and the sheet. */
function taskActions(state, task) {
  const skipped = Boolean(state.night.skipped[task.id]);
  return [
    {
      key: 'skip',
      icon: 'skip',
      label: skipped ? 'Undo rain check' : 'Rain check',
      hint: skipped ? 'Count it against tonight again' : 'Excuse it from tonight’s percentage',
      run: () => rainCheck(task.id),
    },
    { key: 'edit', icon: 'pencil', label: 'Rename', run: () => startRenameTask(task.id) },
    { key: 'up', icon: 'up', label: 'Move up', run: () => { focusNext(`task:${task.id}`); moveTaskByStep(task.id, -1); } },
    { key: 'down', icon: 'down', label: 'Move down', run: () => { focusNext(`task:${task.id}`); moveTaskByStep(task.id, 1); } },
    { key: 'del', icon: 'trash', label: 'Delete', danger: true, run: () => removeTask(task.id) },
  ];
}

function taskRow(state, task, index) {
  const done = state.night.done[task.id] !== undefined;
  const skipped = Boolean(state.night.skipped[task.id]);
  const actions = taskActions(state, task);

  const title = h('span', { class: 'task__title' }, task.title);
  const minutesChip = h('button', {
    type: 'button',
    class: 'task__minutes',
    title: 'Change the time estimate',
    'aria-label': `${task.title}: ${plural(task.minutes, 'minute', 'minutes')}. Change estimate`,
    onClick: (event) => { event.stopPropagation(); editMinutes(minutesChip, task); },
  }, `${task.minutes}m`);

  const menuButton = iconButton('more', `More actions for ${task.title}`, (event) => {
    event.stopPropagation();
    openSheet({
      title: task.title,
      subtitle: `${plural(task.minutes, 'minute', 'minutes')}${done ? ' · done' : ''}${skipped ? ' · rain-checked' : ''}`,
      invoker: menuButton,
      items: actions.map((a) => ({ icon: a.icon, label: a.label, hint: a.hint, danger: a.danger, onClick: a.run })),
    });
  }, { class: 'task__menu', dataset: { focus: `task-menu:${task.id}` } });

  // A focusable row needs a name and a declared key contract — a nameless tab
  // stop tells a screen reader nothing about what it is or what it can do.
  const rowLabel = [
    task.title,
    plural(task.minutes, 'minute', 'minutes'),
    done ? 'done' : null,
    skipped ? 'rain-checked' : null,
  ].filter(Boolean).join(', ');

  const row = h('li', {
    class: ['task', done && 'task--done', skipped && 'task--skipped'].filter(Boolean).join(' '),
    dataset: { taskId: task.id, index, focus: `task:${task.id}` },
    draggable: 'true',
    tabIndex: 0,
    'aria-label': rowLabel,
    'aria-keyshortcuts': 'Space E X Delete Alt+ArrowUp Alt+ArrowDown',
  },
  h('button', {
    type: 'button',
    class: 'task__check',
    role: 'checkbox',
    'aria-checked': done ? 'true' : 'false',
    'aria-label': `${done ? 'Uncheck' : 'Check off'} ${task.title}`,
    onClick: (event) => { event.stopPropagation(); toggleTask(task.id); },
  }, icon('check', { size: 15 })),
  h('div', { class: 'task__body' }, title,
    skipped ? h('span', { class: 'task__flag' }, 'rain check') : null),
  minutesChip,
  h('div', { class: 'task__actions' },
    ...actions.map((a) => iconButton(a.icon, a.key === 'skip' ? a.label : `${a.label} task`, (event) => {
      event.stopPropagation();
      a.run();
    }, { class: a.danger ? 'icon-btn--danger' : '', dataset: { focus: `task-${a.key}:${task.id}` } }))),
  menuButton,
  h('span', { class: 'task__grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })));

  row.addEventListener('keydown', (event) => rowKeys(event, task));
  row.addEventListener('dblclick', () => startRenameTask(task.id));
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
  if (section && node) beginInlineEdit(node, section.title, (value) => renameSection(sectionId, value));
}

/** One definition of what you can do to a section, shared by the header and the sheet. */
function sectionActions(section, addInput) {
  return [
    {
      key: 'plus',
      icon: 'plus',
      label: 'Add a task here',
      run: () => { focusNext(`section-add:${section.id}`); addInput.focus(); },
    },
    { key: 'edit', icon: 'pencil', label: 'Rename section', run: () => startRenameSection(section.id) },
    { key: 'up', icon: 'up', label: 'Move section up', run: () => { focusNext(`section:${section.id}`); moveSection(section.id, -1); } },
    { key: 'down', icon: 'down', label: 'Move section down', run: () => { focusNext(`section:${section.id}`); moveSection(section.id, 1); } },
    { key: 'del', icon: 'trash', label: 'Delete section', danger: true, run: () => removeSection(section.id) },
  ];
}

function removeSection(id) {
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
    toggleSkip(task.id);
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
    placeholder: 'Add a task…  (try  Floss !2)',
    'aria-label': `Add a task to ${section.title}`,
    dataset: { focus: `section-add:${section.id}` },
  });

  const submitAdd = () => {
    const value = addInput.value.trim();
    if (!value) return;
    const parsed = parseInlineTask(value);
    addInput.value = '';
    // Armed before the mutation: arming it afterwards left a stale key that
    // hijacked focus on the next unrelated re-render.
    focusNext(`section-add:${section.id}`);
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
        icon: a.icon, label: a.label, hint: a.hint, danger: a.danger, onClick: a.run,
      })),
    });
  }, { class: 'section__menu', dataset: { focus: `section-menu:${section.id}` } });

  const header = h('header', {
    class: 'section__head',
    tabIndex: 0,
    draggable: 'true',
    dataset: { focus: `section:${section.id}` },
  },
  h('span', { class: 'section__grip', 'aria-hidden': 'true' }, icon('grip', { size: 15 })),
  h('button', {
    type: 'button',
    class: 'section__collapse',
    'aria-expanded': section.collapsed ? 'false' : 'true',
    'aria-label': section.collapsed ? `Expand ${section.title}` : `Collapse ${section.title}`,
    onClick: () => { focusNext(`section:${section.id}`); toggleSectionCollapsed(section.id); },
  }, icon(section.collapsed ? 'down' : 'up', { size: 14 })),
  title,
  h('span', { class: 'section__count' }, `${stats.done}/${stats.total}`),
  h('span', { class: 'section__bar', 'aria-hidden': 'true' },
    h('span', { class: 'section__bar-fill', style: { width: `${pct}%` } })),
  h('div', { class: 'section__actions' },
    ...sectionActions(section, addInput).map((a) => iconButton(a.icon, a.label, () => a.run(),
      { class: a.danger ? 'icon-btn--danger' : '', dataset: { focus: `section-${a.key}:${section.id}` } }))),
  sectionMenu);

  header.addEventListener('dblclick', () => startRenameSection(section.id));
  header.addEventListener('keydown', (event) => {
    if (event.target !== header) return;
    const key = event.key;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (!event.altKey) return;
      event.preventDefault();
      focusNext(`section:${section.id}`);
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
    list.appendChild(taskRow(state, task, taskIndex));
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
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: submitAdd }, 'Add'))));
}

/** Lightweight "Title !5" parse for the per-section add box. */
function parseInlineTask(value) {
  const match = /(^|\s)[!~](\d{1,3})m?\b/.exec(value);
  if (!match) return { title: value.trim(), minutes: null };
  return {
    title: value.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
    minutes: Number(match[2]),
  };
}

/* ----------------------------------------------------------------- render */

function captureRects() {
  const map = new Map();
  if (!root) return map;
  for (const node of root.querySelectorAll('[data-task-id], [data-section-id]')) {
    const key = node.dataset.taskId ? `t:${node.dataset.taskId}` : `s:${node.dataset.sectionId}`;
    map.set(key, node.getBoundingClientRect());
  }
  return map;
}

/** FLIP: animate rows from where they were to where they now are. */
function playFlip(previous) {
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
      moveTaskTo(taskId, sectionId, index);
    },
    onDropSection: (sectionId, index) => {
      focusNext(`section:${sectionId}`);
      reorderSection(sectionId, index);
    },
  });
}

export function renderChecklist() {
  if (!root) return;
  const state = getState();
  const previousRects = captureRects();
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
        onClick: () => {
          const section = addSection('Tonight');
          focusNext(`section-add:${section.id}`);
          renderChecklist();
        },
      }, 'Create your first section')));
    return;
  }

  state.template.order.forEach((id, index) => {
    const section = state.template.sections[id];
    if (section) root.appendChild(sectionNode(state, section, index));
  });

  root.appendChild(h('button', {
    type: 'button',
    class: 'add-section',
    dataset: { focus: 'add-section' },
    onClick: () => {
      const section = addSection('New section');
      focusNext(`section-edit:${section.id}`);
    },
  }, icon('plus', { size: 16 }), 'Add a section'));

  playFlip(previousRects);
  restoreFocus(focusKey);
}
