import type { Note, NotesFile } from '../shared/types';
import { renderMarkdown } from './markdown';
import {
  createNote,
  neighborOf,
  removeNote,
  searchNotes,
  snippetOf,
  sortByEdited,
  titleOf,
  updateBody,
  wordCount,
} from './notes';
import { absoluteTime, relativeTime } from './time';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const el = {
  app: $('app'),
  search: $<HTMLInputElement>('search'),
  newBtn: $<HTMLButtonElement>('new'),
  list: $('list'),
  count: $('count'),
  helpBtn: $<HTMLButtonElement>('help'),
  toggleSidebar: $<HTMLButtonElement>('toggle-sidebar'),
  edited: $('edited'),
  words: $('words'),
  text: $('text'),
  saved: $('saved'),
  previewToggle: $<HTMLButtonElement>('preview-toggle'),
  deleteBtn: $<HTMLButtonElement>('delete'),
  editorWrap: $('editor-wrap'),
  editor: $<HTMLTextAreaElement>('editor'),
  preview: $('preview'),
  empty: $('empty'),
  helpSheet: $('help-sheet'),
};

// --- UI state (per-machine conveniences, kept in localStorage) --------------

interface UiState {
  selectedId: string | null;
  preview: boolean;
  sidebarHidden: boolean;
}

const UI_KEY = 'notes.ui';

function loadUi(): UiState {
  const fallback: UiState = { selectedId: null, preview: false, sidebarHidden: false };
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<UiState>) } : fallback;
  } catch {
    return fallback;
  }
}

function saveUi(): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // Nothing to do: the app works fine without remembered UI state.
  }
}

const ui = loadUi();

// --- data -------------------------------------------------------------------

let notes: Note[] = [];
let query = '';
/** Which note the textarea currently holds, so re-renders never clobber the caret. */
let editorNoteId: string | null = null;

const visibleNotes = (): Note[] => searchNotes(sortByEdited(notes), query);
const selected = (): Note | null => notes.find((n) => n.id === ui.selectedId) ?? null;

// --- persistence ------------------------------------------------------------

const SAVE_DELAY = 300;
let dirty = false;
let saveTimer: number | null = null;
let savedTimer: number | null = null;

const toFile = (): NotesFile => ({ version: 1, notes });

function scheduleSave(): void {
  dirty = true;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flush(), SAVE_DELAY);
}

async function flush(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  try {
    await window.notesApi.save(toFile());
    showSaved('Saved');
  } catch (err) {
    dirty = true;
    console.error('[notes] save failed', err);
    showSaved('Save failed', true);
  }
}

function showSaved(text: string, sticky = false): void {
  el.saved.textContent = text;
  el.saved.classList.add('show');
  if (savedTimer !== null) clearTimeout(savedTimer);
  if (!sticky) savedTimer = window.setTimeout(() => el.saved.classList.remove('show'), 1200);
}

// The main process asks for this when the window is closing.
window.notesApi.onFlushRequest(() => {
  if (!dirty) return null;
  dirty = false;
  return toFile();
});

// --- rendering --------------------------------------------------------------

function renderList(): void {
  const vis = visibleNotes();
  el.list.replaceChildren();

  if (vis.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'list-empty';
    if (notes.length === 0) {
      msg.innerHTML = 'Nothing here yet.<span class="u">Press <kbd>Ctrl</kbd> <kbd>N</kbd> to start a note</span>';
    } else {
      msg.textContent = 'No notes match that.';
    }
    el.list.append(msg);
  }

  const now = Date.now();
  for (const n of vis) {
    const isSelected = n.id === ui.selectedId;
    const title = titleOf(n);
    const item = document.createElement('div');
    item.className = `item${isSelected ? ' selected' : ''}${title === 'Untitled' ? ' untitled' : ''}`;
    item.dataset.id = n.id;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));
    item.tabIndex = isSelected ? 0 : -1;

    const t = document.createElement('div');
    t.className = 'item-title';
    t.textContent = title;

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const time = document.createElement('span');
    time.className = 'item-time u';
    time.textContent = relativeTime(n.updatedAt, now);
    time.title = absoluteTime(n.updatedAt);
    const snip = document.createElement('span');
    snip.className = 'item-snippet';
    snip.textContent = snippetOf(n);
    meta.append(time, snip);

    item.append(t, meta);
    item.addEventListener('click', () => {
      select(n.id);
      focusEditor();
    });
    el.list.append(item);
  }

  el.count.textContent =
    query.trim() && notes.length > 0
      ? `${vis.length} of ${notes.length}`
      : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
}

function renderMeta(): void {
  const n = selected();
  if (!n) {
    el.edited.textContent = '';
    el.edited.title = '';
    el.words.textContent = '';
    document.title = 'Notes';
    return;
  }
  el.edited.textContent = relativeTime(n.updatedAt);
  el.edited.title = `Last edited ${absoluteTime(n.updatedAt)}`;
  const count = wordCount(n.body);
  el.words.textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
  document.title = `${titleOf(n)} – Notes`;
}

function renderEditor(): void {
  const n = selected();
  const has = n !== null;
  el.editorWrap.hidden = !has;
  el.empty.hidden = has;
  el.previewToggle.disabled = !has;
  el.deleteBtn.disabled = !has;
  renderMeta();
  if (!n) {
    editorNoteId = null;
    return;
  }

  if (editorNoteId !== n.id) {
    el.editor.value = n.body;
    el.editor.scrollTop = 0;
    el.editor.setSelectionRange(n.body.length, n.body.length);
    editorNoteId = n.id;
    // Restart the short fade so switching notes reads as turning a page.
    el.text.classList.remove('swap');
    void el.text.offsetWidth;
    el.text.classList.add('swap');
  }

  el.previewToggle.setAttribute('aria-pressed', String(ui.preview));
  el.editor.hidden = ui.preview;
  el.preview.hidden = !ui.preview;
  if (ui.preview) {
    el.preview.innerHTML = n.body.trim()
      ? renderMarkdown(n.body)
      : '<p class="preview-empty">Nothing to preview yet.</p>';
  }
}

function applySidebar(): void {
  el.app.classList.toggle('sidebar-hidden', ui.sidebarHidden);
}

// --- actions ----------------------------------------------------------------

function select(id: string | null): void {
  if (ui.selectedId !== id) disarmDelete();
  ui.selectedId = id;
  saveUi();
  renderList();
  renderEditor();
}

function focusEditor(): void {
  if (!selected()) return;
  if (ui.preview) el.preview.focus();
  else el.editor.focus();
}

function focusList(): void {
  const item = el.list.querySelector<HTMLElement>('.item.selected') ?? el.list.querySelector<HTMLElement>('.item');
  if (item) item.focus();
  else el.search.focus();
}

function selectedItemIntoView(): void {
  el.list.querySelector<HTMLElement>('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

function newNote(): void {
  const n = createNote();
  notes = [n, ...notes];
  scheduleSave();
  if (query) {
    query = '';
    el.search.value = '';
  }
  if (ui.preview) ui.preview = false;
  select(n.id);
  focusEditor();
}

/** Move the selection up or down the visible list, keeping focus where it is. */
function step(delta: number): void {
  const vis = visibleNotes();
  if (vis.length === 0) return;
  const i = vis.findIndex((n) => n.id === ui.selectedId);
  const next = i < 0 ? (delta > 0 ? 0 : vis.length - 1) : Math.min(vis.length - 1, Math.max(0, i + delta));
  const inList = el.list.contains(document.activeElement);
  select(vis[next].id);
  selectedItemIntoView();
  if (inList) focusList();
}

function togglePreview(): void {
  if (!selected()) return;
  const wasFocused = document.activeElement === el.editor || document.activeElement === el.preview;
  ui.preview = !ui.preview;
  saveUi();
  renderEditor();
  if (wasFocused) focusEditor();
}

function toggleSidebar(): void {
  ui.sidebarHidden = !ui.sidebarHidden;
  saveUi();
  applySidebar();
  if (ui.sidebarHidden && el.app.querySelector('.sidebar')?.contains(document.activeElement)) focusEditor();
}

// Delete is two presses within three seconds; no native dialog.
const ARM_MS = 3000;
let armed = false;
let armTimer: number | null = null;
let armReturnFocus: HTMLElement | null = null;

function armDelete(): void {
  if (!selected()) return;
  if (armed) {
    deleteSelected();
    return;
  }
  armed = true;
  armReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  el.deleteBtn.textContent = 'Confirm delete';
  el.deleteBtn.classList.add('armed');
  el.deleteBtn.focus();
  armTimer = window.setTimeout(() => disarmDelete(true), ARM_MS);
}

function disarmDelete(restoreFocus = false): void {
  if (!armed) return;
  armed = false;
  if (armTimer !== null) clearTimeout(armTimer);
  armTimer = null;
  el.deleteBtn.textContent = 'Delete';
  el.deleteBtn.classList.remove('armed');
  if (restoreFocus && document.activeElement === el.deleteBtn) armReturnFocus?.focus();
  armReturnFocus = null;
}

function deleteSelected(): void {
  const n = selected();
  if (!n) return;
  const next = neighborOf(visibleNotes(), n.id);
  notes = removeNote(notes, n.id);
  scheduleSave();
  disarmDelete();
  select(next);
  if (next) focusList();
  else el.search.focus();
}

function toggleHelp(force?: boolean): void {
  const open = force ?? el.helpSheet.hidden;
  el.helpSheet.hidden = !open;
  if (open) el.helpSheet.querySelector<HTMLElement>('.sheet-card')?.focus();
  else focusEditor();
}

// --- editor input -----------------------------------------------------------

el.editor.addEventListener('input', () => {
  const n = selected();
  if (!n || editorNoteId !== n.id) return;
  notes = updateBody(notes, n.id, el.editor.value);
  scheduleSave();
  renderList();
  renderMeta();
});

el.editor.addEventListener('keydown', (e) => {
  // Tab indents instead of leaving the editor; Escape is the way out.
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (e.shiftKey) {
      const start = el.editor.selectionStart;
      const lineStart = el.editor.value.lastIndexOf('\n', start - 1) + 1;
      if (el.editor.value.startsWith('  ', lineStart)) {
        el.editor.setRangeText('', lineStart, lineStart + 2, 'end');
        el.editor.setSelectionRange(Math.max(lineStart, start - 2), Math.max(lineStart, start - 2));
        el.editor.dispatchEvent(new Event('input'));
      }
    } else {
      el.editor.setRangeText('  ', el.editor.selectionStart, el.editor.selectionEnd, 'end');
      el.editor.dispatchEvent(new Event('input'));
    }
  }
});

// --- search -----------------------------------------------------------------

el.search.addEventListener('input', () => {
  query = el.search.value;
  const vis = visibleNotes();
  // Keep the current note when it still matches; otherwise land on the best hit.
  if (vis.length > 0 && !vis.some((n) => n.id === ui.selectedId)) {
    select(vis[0].id);
  } else {
    renderList();
  }
});

el.search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    step(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    focusEditor();
  }
});

// --- list -------------------------------------------------------------------

el.list.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
      break;
    case 'Home':
    case 'End': {
      e.preventDefault();
      const vis = visibleNotes();
      if (vis.length === 0) break;
      select(vis[e.key === 'Home' ? 0 : vis.length - 1].id);
      selectedItemIntoView();
      focusList();
      break;
    }
    case 'Enter':
      e.preventDefault();
      focusEditor();
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      armDelete();
      break;
  }
});

// --- buttons ----------------------------------------------------------------

el.newBtn.addEventListener('click', newNote);
el.previewToggle.addEventListener('click', togglePreview);
el.deleteBtn.addEventListener('click', armDelete);
el.toggleSidebar.addEventListener('click', toggleSidebar);
el.helpBtn.addEventListener('click', () => toggleHelp(true));
el.helpSheet.addEventListener('click', (e) => {
  if (e.target === el.helpSheet) toggleHelp(false);
});

// --- global keys ------------------------------------------------------------

function onEscape(): void {
  if (!el.helpSheet.hidden) {
    toggleHelp(false);
  } else if (armed) {
    disarmDelete(true);
  } else if (document.activeElement === el.search) {
    if (query) {
      query = '';
      el.search.value = '';
      renderList();
    } else {
      focusList();
    }
  } else if (document.activeElement === el.editor || document.activeElement === el.preview) {
    if (ui.sidebarHidden) toggleSidebar();
    focusList();
  }
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && e.shiftKey && !e.altKey && key === 'd') {
    e.preventDefault();
    armDelete();
    return;
  }

  if (mod && !e.shiftKey && !e.altKey) {
    switch (key) {
      case 'n':
        e.preventDefault();
        newNote();
        return;
      case 'k':
      case 'f':
        e.preventDefault();
        if (ui.sidebarHidden) toggleSidebar();
        el.search.focus();
        el.search.select();
        return;
      case 'e':
        e.preventDefault();
        togglePreview();
        return;
      case 's':
        e.preventDefault();
        void flush().then(() => {
          if (!dirty) showSaved('Saved');
        });
        return;
      case '\\':
        e.preventDefault();
        toggleSidebar();
        return;
      case '/':
        e.preventDefault();
        toggleHelp();
        return;
      case 'arrowup':
      case 'arrowdown':
        e.preventDefault();
        step(key === 'arrowdown' ? 1 : -1);
        return;
    }
  }

  if (e.key === 'Escape') onEscape();
});

// Losing the window is a good moment to make sure everything is on disk.
window.addEventListener('blur', () => void flush());
window.addEventListener('beforeunload', () => void flush());

// Relative timestamps drift; refresh them once a minute.
window.setInterval(() => {
  renderList();
  renderMeta();
}, 60_000);

// --- boot -------------------------------------------------------------------

async function init(): Promise<void> {
  const file = await window.notesApi.load();
  notes = file.notes;
  if (ui.selectedId && !notes.some((n) => n.id === ui.selectedId)) ui.selectedId = null;
  if (!ui.selectedId) ui.selectedId = sortByEdited(notes)[0]?.id ?? null;
  applySidebar();
  renderList();
  renderEditor();
  if (selected()) focusEditor();
  else el.search.focus();
}

void init();
