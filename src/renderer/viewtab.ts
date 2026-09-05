import { cardColumns, cellOf, cellText, columnLabel, columnsOf, editorKind, editText, firstLine, groupNotes, parseCellInput, propColumn, TITLE_COLUMN, UPDATED_COLUMN, withSortClick, columnKey } from '../core/viewtable';
import type { Filter } from '../core/query';
import type { PropertyChange } from '../shared/properties';
import type { ViewLayout, ViewPresentation } from '../shared/settings';
import type { Note } from '../shared/types';

/**
 * A saved search laid out as a table or as cards, in the place of a note.
 *
 * The rows are the notes the query finds, the columns their front-matter
 * properties; a cell edits the property it shows, through the same store
 * write the Properties sheet uses. Sorting and grouping are the view's own
 * and never change which notes it finds. Cards are the same notes, read-only,
 * for looking over rather than filling in.
 *
 * Everything the view knows about the notebook comes through the host: the
 * window keeps the notes, runs the query, writes the property, and remembers
 * how the view is laid out.
 */

/** A view as a tab holds it: which search, how it is shown, and whether it is a saved search's. */
export interface ViewRecord extends ViewPresentation {
  id: string;
  /** The saved search this is, when it is one; an ad hoc view has none. */
  name?: string;
  query: string;
}

export interface ViewHost {
  /** The notes a query finds, in the order the query gives them. */
  run(query: string): { notes: Note[]; filter: Filter };
  /** The property keys the notebook uses, most common first. */
  vocabulary(): string[];
  /** Opens a note in a tab of its own, leaving the view where it is. */
  open(id: string): void;
  /** Writes one property; resolves to null, or to why it could not be written. */
  setProperty(id: string, change: PropertyChange): Promise<string | null>;
  /** Changes how the view is shown, wherever that is kept, and redraws it. */
  update(view: ViewRecord, patch: ViewPresentation): void;
  /** The layout picker, shared with the command of the same name. */
  pickLayout(view: ViewRecord): void;
  /** The app's picker, for a short list of choices. */
  pick(title: string, items: Array<{ label: string; hint?: string; run: () => void }>): void;
  status(message: string): void;
  /** Where a sheet may be put. */
  root: HTMLElement;
}

const button = (cls: string, text: string, title?: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  if (title) b.title = title;
  return b;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Draws a view into its section. */
export function renderView(section: HTMLElement, view: ViewRecord, host: ViewHost): void {
  const { notes, filter } = host.run(view.query);
  const columns = columnsOf(view, filter);
  const layout: ViewLayout = view.layout === 'cards' ? 'cards' : 'table';
  section.replaceChildren(controlBar(view, notes.length, host), layout === 'cards' ? cards(view, notes, columns, host) : table(view, notes, columns, host));
  section.dataset.layout = layout;
}

/** The one row of controls: how many, and the ways of changing what is shown. */
function controlBar(view: ViewRecord, count: number, host: ViewHost): HTMLElement {
  const bar = el('div', 'view-bar');
  bar.append(el('span', 'view-count', `${count} ${count === 1 ? 'note' : 'notes'}`));
  const columns = button('view-ctl', 'Columns…', 'Choose and order the properties shown');
  columns.addEventListener('click', () => openColumnsSheet(view, host));
  const group = button('view-ctl', view.groupBy ? `Group by ${columnLabel(view.groupBy)}` : 'Group by…', 'Gather the notes under each value of a property');
  group.addEventListener('click', () => pickGroup(view, host));
  const layout = button('view-ctl', 'Layout', 'List, table or cards');
  layout.addEventListener('click', () => host.pickLayout(view));
  bar.append(columns, group, layout);
  if (view.sortBy) {
    bar.append(el('span', 'view-sort', `Sorted by ${columnLabel(view.sortBy)} ${view.sortDir === 'desc' ? '↓' : '↑'}`));
    const clear = button('view-ctl', 'Query order', 'Back to the order the search gives');
    clear.addEventListener('click', () => host.update(view, withSortClick(view, null)));
    bar.append(clear);
  } else bar.append(el('span', 'view-sort', 'Query order'));
  if (view.layout !== 'cards') bar.append(el('span', 'view-hint', 'Click a cell to change the property. Not undoable, as in Properties.'));
  return bar;
}

function pickGroup(view: ViewRecord, host: ViewHost): void {
  const items = [{ label: 'None', hint: 'One list, in order', run: () => host.update(view, { ...view, groupBy: undefined }) }];
  for (const key of host.vocabulary()) items.push({ label: key, hint: view.groupBy === propColumn(key) ? 'Grouped by this now' : '', run: () => host.update(view, { ...view, groupBy: propColumn(key) }) });
  host.pick('Group the notes by which property?', items);
}

// --- the table -----------------------------------------------------------------

function table(view: ViewRecord, notes: Note[], columns: string[], host: ViewHost): HTMLElement {
  const wrap = el('div', 'view-scroll');
  const t = el('table', 'view-table');
  const head = el('thead');
  const hr = el('tr');
  for (const c of columns) {
    const th = el('th', `view-th ${cls(c)}`);
    th.scope = 'col';
    const sort = button('view-sort-btn', columnLabel(c), 'Sort by this column');
    if (view.sortBy === c) {
      sort.append(el('span', 'view-sort-mark', view.sortDir === 'desc' ? ' ↓' : ' ↑'));
      th.setAttribute('aria-sort', view.sortDir === 'desc' ? 'descending' : 'ascending');
    }
    sort.addEventListener('click', () => host.update(view, withSortClick(view, c)));
    th.append(sort);
    hr.append(th);
  }
  head.append(hr);
  t.append(head);
  const body = el('tbody');
  for (const group of groupNotes(notes, view)) {
    if (group.label) {
      const tr = el('tr', 'view-group');
      const th = el('th', 'view-group-head u');
      th.colSpan = columns.length;
      th.scope = 'rowgroup';
      th.textContent = `${group.label} · ${group.notes.length}`;
      tr.append(th);
      body.append(tr);
    }
    for (const n of group.notes) body.append(row(n, columns, host));
  }
  if (notes.length === 0) {
    const tr = el('tr', 'view-empty');
    const td = el('td', 'view-empty-cell', 'No note answers this search yet.');
    td.colSpan = columns.length;
    tr.append(td);
    body.append(tr);
  }
  t.append(body);
  wrap.append(t);
  return wrap;
}

const cls = (column: string): string => (column === TITLE_COLUMN ? 'col-title' : column === UPDATED_COLUMN ? 'col-updated' : 'col-prop');

function row(n: Note, columns: string[], host: ViewHost): HTMLElement {
  const tr = el('tr', 'view-row');
  tr.dataset.id = n.id;
  for (const c of columns) {
    const cell = cellOf(n, c);
    const td = el('td', `view-td ${cls(c)}`);
    if (c === TITLE_COLUMN) {
      const open = button('view-title', cellText(cell), 'Open this note in a tab');
      open.addEventListener('click', () => host.open(n.id));
      td.append(open);
    } else if (c === UPDATED_COLUMN) {
      td.textContent = cellText(cell);
    } else {
      const key = columnKey(c) ?? c;
      if (cell.kind === 'prop' && cell.complex) {
        td.textContent = cellText(cell);
        td.title = 'Nested YAML: change it in Properties…';
        td.classList.add('view-td-complex');
      } else propertyCell(td, n, key, cell, host);
    }
    tr.append(td);
  }
  return tr;
}

/** A property cell: its words, and on a click or Enter the editor for them. */
function propertyCell(td: HTMLElement, n: Note, key: string, cell: ReturnType<typeof cellOf>, host: ViewHost): void {
  td.tabIndex = 0;
  td.dataset.key = key;
  const kind = editorKind(cell);
  const show = (): void => {
    td.replaceChildren();
    if (kind === 'boolean' && cell.kind === 'prop') {
      // A box to tick: the one edit that commits on the click itself.
      const box = el('input');
      box.type = 'checkbox';
      box.className = 'view-check';
      box.checked = cell.value === true;
      box.setAttribute('aria-label', `${key}: ${cell.value === true ? 'true' : 'false'}`);
      box.addEventListener('change', () => void commit(box.checked ? 'true' : 'false'));
      td.append(box);
      return;
    }
    const text = cellText(cell);
    td.append(el('span', `view-value${text ? '' : ' view-value-empty'}`, text || '—'));
  };
  const commit = async (typed: string): Promise<boolean> => {
    const input = parseCellInput(typed);
    if (input.kind === 'error') {
      host.status(input.message);
      return false;
    }
    const change: PropertyChange = input.kind === 'remove' ? { key } : { key, value: input.value };
    const why = await host.setProperty(n.id, change);
    if (why) {
      host.status(why);
      return false;
    }
    return true;
  };
  const edit = (): void => {
    if (kind === 'boolean') return;
    const input = el('input', 'view-edit');
    input.type = kind === 'number' ? 'number' : 'text';
    if (kind === 'number') input.step = 'any';
    input.value = editText(cell);
    input.setAttribute('aria-label', `${key} of ${cellText(cellOf(n, TITLE_COLUMN))}`);
    let done = false;
    const finish = async (save: boolean): Promise<void> => {
      if (done) return;
      const value = input.value;
      if (!save || value === editText(cell)) {
        done = true;
        show();
        td.focus();
        return;
      }
      // Closed while the write is in flight: a blur arriving mid-commit must not commit twice.
      done = true;
      const ok = await commit(value);
      // The store has the note now; the window redraws the view from it.
      if (ok) return;
      done = false;
      input.classList.add('view-edit-bad');
      input.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => void finish(true));
    td.replaceChildren(input);
    input.focus();
    input.select();
  };
  td.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    edit();
  });
  td.addEventListener('keydown', (e) => {
    if (e.target !== td) return;
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      edit();
    }
  });
  show();
}

// --- cards ------------------------------------------------------------------------

function cards(view: ViewRecord, notes: Note[], columns: string[], host: ViewHost): HTMLElement {
  const wrap = el('div', 'view-cards-wrap');
  const shown = cardColumns(columns);
  for (const group of groupNotes(notes, view)) {
    if (group.label) wrap.append(el('h3', 'view-group-head u', `${group.label} · ${group.notes.length}`));
    const grid = el('div', 'view-cards');
    for (const n of group.notes) {
      const card = el('article', 'view-card');
      const title = button('view-card-title', cellText(cellOf(n, TITLE_COLUMN)), 'Open this note in a tab');
      title.addEventListener('click', () => host.open(n.id));
      card.append(title);
      const dl = el('dl', 'view-card-props');
      for (const c of shown) {
        const cell = cellOf(n, c);
        if (cell.kind === 'missing') continue;
        dl.append(el('dt', 'view-card-key u', columnLabel(c)), el('dd', 'view-card-value', cellText(cell)));
      }
      if (dl.childNodes.length > 0) card.append(dl);
      const line = firstLine(n.body.replace(/^---\n[\s\S]*?\n---\n?/, ''));
      if (line) card.append(el('p', 'view-card-line', line));
      grid.append(card);
    }
    wrap.append(grid);
  }
  if (notes.length === 0) wrap.append(el('p', 'view-empty-cell', 'No note answers this search yet.'));
  return wrap;
}

// --- the columns sheet --------------------------------------------------------------

/**
 * Which properties the table shows, and in what order: a sheet of checkboxes
 * with Move up and Move down, the notebook's own keys offered and a box for
 * one it does not use yet. Title stays first and cannot go.
 */
export function openColumnsSheet(view: ViewRecord, host: ViewHost): void {
  const filter = host.run(view.query).filter;
  let columns = columnsOf(view, filter);
  const sheet = el('div', 'sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Columns');
  const card = el('div', 'sheet-card columns-card');
  card.tabIndex = -1;
  const h = el('h2', undefined, 'Columns');
  const list = el('div', 'columns-list');
  const add = el('div', 'columns-add');
  const input = el('input', 'layout-input columns-input');
  input.type = 'text';
  input.placeholder = 'Add a property…';
  input.setAttribute('aria-label', 'Add a property column');
  const datalist = el('datalist');
  datalist.id = `columns-keys-${view.id}`;
  for (const key of host.vocabulary()) datalist.append(el('option', undefined, key));
  input.setAttribute('list', datalist.id);
  const addBtn = button('pill u', 'Add');
  add.append(input, datalist, addBtn);
  const foot = el('p', 'sheet-foot u');
  foot.innerHTML = 'Press <kbd>Esc</kbd> to close';
  card.append(h, list, add, foot);
  sheet.append(card);

  const apply = (): void => {
    host.update(view, { ...view, columns: [...columns] });
    draw();
  };
  const draw = (): void => {
    list.replaceChildren();
    const offered = [...columns];
    for (const key of host.vocabulary()) if (!offered.includes(propColumn(key))) offered.push(propColumn(key));
    if (!offered.includes(UPDATED_COLUMN)) offered.push(UPDATED_COLUMN);
    offered.forEach((c) => {
      const row = el('label', 'columns-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = columns.includes(c);
      box.disabled = c === TITLE_COLUMN;
      box.addEventListener('change', () => {
        columns = box.checked ? [...columns, c] : columns.filter((x) => x !== c);
        apply();
      });
      const name = el('span', 'columns-name', columnLabel(c));
      row.append(box, name);
      const at = columns.indexOf(c);
      if (at > 0) {
        const up = button('columns-move', '↑', 'Move up');
        up.disabled = at <= 1;
        up.addEventListener('click', (e) => {
          e.preventDefault();
          const next = [...columns];
          [next[at - 1], next[at]] = [next[at], next[at - 1]];
          columns = next;
          apply();
        });
        const down = button('columns-move', '↓', 'Move down');
        down.disabled = at >= columns.length - 1;
        down.addEventListener('click', (e) => {
          e.preventDefault();
          const next = [...columns];
          [next[at + 1], next[at]] = [next[at], next[at + 1]];
          columns = next;
          apply();
        });
        row.append(up, down);
      }
      list.append(row);
    });
  };
  const addKey = (): void => {
    const key = input.value.trim();
    if (!key) return;
    const c = propColumn(key);
    if (!columns.includes(c)) columns = [...columns, c];
    input.value = '';
    apply();
  };
  addBtn.addEventListener('click', addKey);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKey();
    }
  });
  const close = (): void => {
    sheet.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', onKey, true);
  draw();
  host.root.append(sheet);
  card.focus();
}
