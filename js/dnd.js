/* Drag and drop for tasks (within and across sections) and for sections.
   Everything it does is also reachable from the move buttons and Alt+Arrow,
   so dragging stays a convenience, never the only way. */

let dragged = null; // { kind: 'task' | 'section', id }

/**
 * The one node currently wearing a drop indicator, and the rect of the row the
 * pointer is over.
 *
 * `dragover` fires at pointer rate, and it used to query the whole checklist for
 * indicator classes, remove them, then call getBoundingClientRect — a style
 * invalidation, a forced synchronous layout, and another invalidation, on every
 * event, over the whole list. Remembering the marked node makes the clear O(1),
 * and caching the row's rect for as long as the pointer stays on that row takes
 * the layout out of the loop entirely.
 */
let marked = null;
let hoverRow = null;
let hoverRect = null;

function clearIndicators(root) {
  if (marked) {
    marked.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into');
    marked = null;
    return;
  }
  // The slow path, for a render that replaced the node we were holding.
  for (const node of root.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-into')) {
    node.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into');
  }
}

function mark(node, className) {
  node.classList.add(className);
  marked = node;
}

function taskDropTarget(row, clientY) {
  // Cached per row: the geometry cannot change while a drag is in flight, and
  // this was the forced layout in the middle of a read-after-write.
  if (row !== hoverRow) {
    hoverRow = row;
    hoverRect = row.getBoundingClientRect();
  }
  return clientY < hoverRect.top + hoverRect.height / 2 ? 'before' : 'after';
}

/** A drag is over; nothing measured is valid any more. */
function forgetHover() {
  hoverRow = null;
  hoverRect = null;
}

export function initDragAndDrop(root, handlers) {
  root.addEventListener('dragstart', (event) => {
    const taskRow = event.target.closest('[data-task-id]');
    const sectionEl = event.target.closest('[data-section-id]');
    if (taskRow && root.contains(taskRow)) {
      dragged = { kind: 'task', id: taskRow.dataset.taskId };
    } else if (sectionEl) {
      dragged = { kind: 'section', id: sectionEl.dataset.sectionId };
    } else {
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.id);
    (taskRow || sectionEl).classList.add('is-dragging');
    document.body.classList.add('is-dragging-active');
  });

  root.addEventListener('dragend', () => {
    forgetHover();
    dragged = null;
    clearIndicators(root);
    for (const node of root.querySelectorAll('.is-dragging')) node.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-active');
  });

  root.addEventListener('dragover', (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearIndicators(root);

    if (dragged.kind === 'task') {
      const row = event.target.closest('[data-task-id]');
      if (row && row.dataset.taskId !== dragged.id) {
        mark(row, taskDropTarget(row, event.clientY) === 'before' ? 'is-drop-before' : 'is-drop-after');
        return;
      }
      const list = event.target.closest('[data-drop-list]');
      if (list) mark(list, 'is-drop-into');
      return;
    }

    const sectionEl = event.target.closest('[data-section-id]');
    if (sectionEl && sectionEl.dataset.sectionId !== dragged.id) {
      mark(sectionEl, taskDropTarget(sectionEl, event.clientY) === 'before' ? 'is-drop-before' : 'is-drop-after');
    }
  });

  root.addEventListener('drop', (event) => {
    if (!dragged) return;
    event.preventDefault();
    const current = dragged;
    clearIndicators(root);

    if (current.kind === 'task') {
      const row = event.target.closest('[data-task-id]');
      if (row && row.dataset.taskId !== current.id) {
        const list = row.closest('[data-drop-list]');
        const sectionId = list?.dataset.sectionId;
        const index = Number(row.dataset.index);
        const where = taskDropTarget(row, event.clientY);
        handlers.onDropTask(current.id, sectionId, where === 'before' ? index : index + 1);
        return;
      }
      const list = event.target.closest('[data-drop-list]');
      // Dropping a task back onto itself is a cancelled drag, not a request to
      // send it to the bottom of its own section.
      if (list && !(row && row.dataset.taskId === current.id)) {
        const count = list.querySelectorAll('[data-task-id]').length;
        handlers.onDropTask(current.id, list.dataset.sectionId, count);
      }
      return;
    }

    const sectionEl = event.target.closest('[data-section-id]');
    if (sectionEl && sectionEl.dataset.sectionId !== current.id) {
      const index = Number(sectionEl.dataset.index);
      const where = taskDropTarget(sectionEl, event.clientY);
      handlers.onDropSection(current.id, where === 'before' ? index : index + 1);
    }
  });

  root.addEventListener('dragleave', (event) => {
    if (!root.contains(event.relatedTarget)) clearIndicators(root);
  });
}
