import type { ExportKind, ExportRequest, Note, NotesFile } from '../shared/types';
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
import { markdownToText } from './plaintext';
import stylesText from './styles.css?inline';
import { absoluteTime, relativeTime } from './time';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const el = {
  app: $('app'),
  pane: $('pane'),
  search: $<HTMLInputElement>('search'),
  newBtn: $<HTMLButtonElement>('new'),
  list: $('list'),
  count: $('count'),
  helpBtn: $<HTMLButtonElement>('help'),
  toggleSidebar: $<HTMLButtonElement>('toggle-sidebar'),
  edited: $('edited'),
  words: $('words'),
  text: $('text'),
  status: $('status'),
  previewToggle: $<HTMLButtonElement>('preview-toggle'),
  attachBtn: $<HTMLButtonElement>('attach'),
  exportWrap: $('export-wrap'),
  exportBtn: $<HTMLButtonElement>('export'),
  exportMenu: $('export-menu'),
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
let statusTimer: number | null = null;

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
    showStatus('Saved', 1200);
  } catch (err) {
    dirty = true;
    console.error('[notes] save failed', err);
    showStatus('Save failed', 0);
  }
}

/** Header status line. `ms` 0 keeps it until the next message. */
function showStatus(text: string, ms: number): void {
  el.status.textContent = text;
  el.status.classList.add('show');
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = ms > 0 ? window.setTimeout(() => el.status.classList.remove('show'), ms) : null;
}

function clearStatus(): void {
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = null;
  el.status.classList.remove('show');
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
  el.exportBtn.disabled = !has;
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

// --- attachments ------------------------------------------------------------

/** Make sure there is a note and the textarea is showing before inserting into it. */
function ensureEditable(): void {
  if (!selected()) newNote();
  if (ui.preview) {
    ui.preview = false;
    saveUi();
    renderEditor();
  }
  el.editor.focus();
}

/** Inserts a snippet at the caret on its own line and treats it as typed input. */
function insertAtCursor(snippet: string): void {
  const { selectionStart: start, selectionEnd: end, value } = el.editor;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const tail = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
  el.editor.setRangeText(`${lead}${snippet}${tail}`, start, end, 'end');
  el.editor.dispatchEvent(new Event('input'));
}

function altFor(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base && base.toLowerCase() !== 'image' ? base : 'image';
}

const isImage = (f: File): boolean => f.type.startsWith('image/');

async function attachFiles(files: File[]): Promise<void> {
  const images = files.filter(isImage);
  if (images.length === 0) {
    showStatus('Only images can be attached', 3000);
    return;
  }
  ensureEditable();
  let attached = 0;
  for (const file of images) {
    try {
      const url = await window.notesApi.attach(new Uint8Array(await file.arrayBuffer()), file.name || 'image.png');
      insertAtCursor(`![${altFor(file.name)}](${url})`);
      attached++;
    } catch (err) {
      console.error('[notes] attach failed', err);
      showStatus(err instanceof Error ? err.message.replace(/^.*Error: /, '') : 'Could not attach that image', 4000);
      return;
    }
  }
  showStatus(attached === 1 ? 'Image attached' : `${attached} images attached`, 2500);
}

async function pickImages(): Promise<void> {
  const urls = await window.notesApi.pickAttachments();
  if (urls.length === 0) return;
  ensureEditable();
  for (const url of urls) insertAtCursor(`![image](${url})`);
  showStatus(urls.length === 1 ? 'Image attached' : `${urls.length} images attached`, 2500);
}

// Paste an image from anywhere in the window, whatever holds focus. A text
// paste has no files, so it falls through to the browser untouched.
window.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files ?? []).filter(isImage);
  if (files.length === 0) return;
  e.preventDefault();
  void attachFiles(files);
});

// Drop an image file onto any part of the window to attach it. The whole
// document is the target, and every dragover is cancelled so a stray drop can
// never navigate the window away to the file.
let dragDepth = 0;
const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');

document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  el.pane.classList.add('dropping');
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (hasFiles(e) && e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    el.pane.classList.remove('dropping');
  }
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.pane.classList.remove('dropping');
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length > 0) void attachFiles(files);
});

// --- export -----------------------------------------------------------------

const menuItems = (): HTMLButtonElement[] => Array.from(el.exportMenu.querySelectorAll<HTMLButtonElement>('.menu-item'));

function openExportMenu(): void {
  if (!selected()) return;
  el.exportMenu.hidden = false;
  el.exportBtn.setAttribute('aria-expanded', 'true');
  menuItems()[0]?.focus();
}

function closeExportMenu(restoreFocus: boolean): void {
  if (el.exportMenu.hidden) return;
  el.exportMenu.hidden = true;
  el.exportBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) el.exportBtn.focus();
}

const fileNameOf = (p: string): string => p.split(/[\\/]/).pop() ?? p;

async function runExport(kind: ExportKind): Promise<void> {
  const n = selected();
  if (!n) return;
  closeExportMenu(false);
  focusEditor();
  const title = titleOf(n);
  let request: ExportRequest;
  if (kind === 'md') request = { kind, title, body: n.body };
  else if (kind === 'txt') request = { kind, title, text: markdownToText(n.body) };
  else request = { kind, title, html: renderMarkdown(n.body), css: stylesText, edited: `Edited ${absoluteTime(n.updatedAt)}` };

  showStatus('Exporting…', 0);
  try {
    const savedTo = await window.notesApi.exportNote(request);
    if (savedTo) showStatus(`Exported to ${fileNameOf(savedTo)}`, 4000);
    else clearStatus();
  } catch (err) {
    console.error('[notes] export failed', err);
    showStatus('Export failed', 4000);
  }
}

el.exportBtn.addEventListener('click', () => {
  if (el.exportMenu.hidden) openExportMenu();
  else closeExportMenu(true);
});

for (const item of menuItems()) {
  item.addEventListener('click', () => void runExport(item.dataset.kind as ExportKind));
}

el.exportMenu.addEventListener('keydown', (e) => {
  const items = menuItems();
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
      break;
    case 'ArrowUp':
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
      break;
    case 'Home':
      e.preventDefault();
      items[0]?.focus();
      break;
    case 'End':
      e.preventDefault();
      items[items.length - 1]?.focus();
      break;
    case 'Tab':
      closeExportMenu(false);
      break;
    default: {
      const kind = ({ m: 'md', t: 'txt', p: 'png' } as Record<string, ExportKind>)[e.key.toLowerCase()];
      if (kind && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        void runExport(kind);
      }
    }
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!el.exportMenu.hidden && !el.exportWrap.contains(e.target as Node)) closeExportMenu(false);
});

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
el.attachBtn.addEventListener('click', () => void pickImages());
el.deleteBtn.addEventListener('click', armDelete);
el.toggleSidebar.addEventListener('click', toggleSidebar);
el.helpBtn.addEventListener('click', () => toggleHelp(true));
el.helpSheet.addEventListener('click', (e) => {
  if (e.target === el.helpSheet) toggleHelp(false);
});

// --- global keys ------------------------------------------------------------

function onEscape(): void {
  if (!el.exportMenu.hidden) {
    closeExportMenu(true);
  } else if (!el.helpSheet.hidden) {
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

  if (mod && e.shiftKey && !e.altKey) {
    switch (key) {
      case 'd':
        e.preventDefault();
        armDelete();
        return;
      case 's':
        e.preventDefault();
        if (el.exportMenu.hidden) openExportMenu();
        else closeExportMenu(true);
        return;
      case 'i':
        e.preventDefault();
        void pickImages();
        return;
    }
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
          if (!dirty) showStatus('Saved', 1200);
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
