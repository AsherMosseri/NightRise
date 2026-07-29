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
    input.replaceWith(labelNode);
    if (save && value && value !== currentValue) onCommit(value);
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

export function floatXp(taskId, text) {
  const row = root?.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
  if (!row) return;
  const float = h('span', { class: 'xp-float' }, text);
  row.appendChild(float);
  setTimeout(() => float.remove(), 1100);
}

/* -------------------------------------------------------------- task rows */

function taskRow(state, task, index) {
  const done = state.night.done[task.id] !== undefined;
  const skipped = Boolean(state.night.skipped[task.id]);

  const title = h('span', { class: 'task__title' }, task.title);
  const minutesChip = h('button', {
    type: 'button',
    class: 'task__minutes',
    title: 'Change the time estimate',
    'aria-label': `${task.title}: ${plural(task.minutes, 'minute', 'minutes')}. Change estimate`,
    onClick: (event) => { event.stopPropagation(); editMinutes(minutesChip, task); },
  }, `${task.minutes}m`);

  const row = h('li', {
    class: ['task', done && 'task--done', skipped && 'task--skipped'].filter(Boolean).join(' '),
    dataset: { taskId: task.id, index, focus: `task:${task.id}` },
    draggable: 'true',
    tabIndex: 0,
    role: 'listitem',
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
    iconButton('skip', skipped ? 'Undo rain check' : 'Rain check (excuse tonight)', (event) => {
      event.stopPropagation();
      const result = toggleSkip(task.id);
      if (result?.blocked) {
        toast('No rain checks left', { tone: 'warn', iconName: 'skip', detail: 'Buy more in the Night Market.' });
      }
    }, { dataset: { focus: `task-skip:${task.id}` } }),
    iconButton('pencil', 'Rename task', (event) => { event.stopPropagation(); beginInlineEdit(title, task.title, (v) => renameTask(task.id, v)); },
      { dataset: { focus: `task-edit:${task.id}` } }),
    iconButton('up', 'Move up', (event) => { event.stopPropagation(); focusNext(`task:${task.id}`); moveTaskByStep(task.id, -1); },
      { dataset: { focus: `task-up:${task.id}` } }),
    iconButton('down', 'Move down', (event) => { event.stopPropagation(); focusNext(`task:${task.id}`); moveTaskByStep(task.id, 1); },
      { dataset: { focus: `task-down:${task.id}` } }),
    iconButton('trash', 'Delete task', (event) => { event.stopPropagation(); removeTask(task.id); },
      { class: 'icon-btn--danger', dataset: { focus: `task-del:${task.id}` } }),
  ),
  h('span', { class: 'task__grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })));

  row.addEventListener('keydown', (event) => rowKeys(event, task));
  row.addEventListener('dblclick', () => beginInlineEdit(title, task.title, (v) => renameTask(task.id, v)));
  return row;
}

function removeTask(id) {
  const task = deleteTask(id);
  if (!task) return;
  toast(`Deleted “${task.title}”`, {
    tone: 'info',
    iconName: 'trash',
    action: { label: 'Undo', onClick: () => undo() },
  });
}

function removeSection(id) {
  const state = getState();
  const section = state.template.sections[id];
  if (!section) return;
  const count = section.taskIds.length;
  const removed = deleteSection(id);
  if (!removed) return;
  toast(`Deleted “${section.title}”`, {
    tone: 'info',
    iconName: 'trash',
    detail: count ? `${plural(count, 'task', 'tasks')} went with it.` : null,
    duration: count ? 7000 : 4200,
    action: { label: 'Undo', onClick: () => undo() },
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
    beginInlineEdit(row.querySelector('.task__title'), task.title, (v) => renameTask(task.id, v));
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
    addTask(section.id, parsed.title, parsed.minutes ?? 5);
    addInput.value = '';
    focusNext(`section-add:${section.id}`);
  };

  addInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitAdd(); }
    if (event.key === 'Escape') { addInput.value = ''; addInput.blur(); }
    event.stopPropagation();
  });

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
    iconButton('plus', 'Add task here', () => { focusNext(`section-add:${section.id}`); addInput.focus(); },
      { dataset: { focus: `section-plus:${section.id}` } }),
    iconButton('pencil', 'Rename section', () => beginInlineEdit(title, section.title, (v) => renameSection(section.id, v)),
      { dataset: { focus: `section-edit:${section.id}` } }),
    iconButton('up', 'Move section up', () => { focusNext(`section:${section.id}`); moveSection(section.id, -1); },
      { dataset: { focus: `section-up:${section.id}` } }),
    iconButton('down', 'Move section down', () => { focusNext(`section:${section.id}`); moveSection(section.id, 1); },
      { dataset: { focus: `section-down:${section.id}` } }),
    iconButton('trash', 'Delete section', () => removeSection(section.id),
      { class: 'icon-btn--danger', dataset: { focus: `section-del:${section.id}` } })));

  header.addEventListener('dblclick', () => beginInlineEdit(title, section.title, (v) => renameSection(section.id, v)));
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
      beginInlineEdit(title, section.title, (v) => renameSection(section.id, v));
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

function restoreFocus(previousKey) {
  const key = pendingFocus || previousKey;
  pendingFocus = null;
  if (!key) return;
  const node = root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
  if (node) node.focus({ preventScroll: true });
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
