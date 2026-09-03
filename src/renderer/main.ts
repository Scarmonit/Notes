import { assetNameFromUrl } from '../shared/assets';
import { chordOf, isCommandChord, keyLabel } from '../shared/keys';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import type { ExportKind, ExportRequest, ImportedFile, Note, NotesFile } from '../shared/types';
import { keyMap, matchActions, type Action, type Match } from './actions';
import { isTextFile, noteFromFile } from './importer';
import { renderMarkdown } from './markdown';
import { cycleTaskLine, toggleTaskAt } from './tasks';
import {
  allTags,
  createNote,
  exportBody,
  neighborOf,
  removeNote,
  searchNotes,
  snippetOf,
  sortByEdited,
  titleOf,
  togglePin,
  updateBody,
  updateTitle,
  wordCount,
} from './notes';
import { markdownToText } from './plaintext';
import {
  MIN_IMAGE_WIDTH,
  chipsOf,
  imageChipHtml,
  isChip,
  isRule,
  lineIndexAt,
  lineIndexIn,
  lineSpans,
  markEmpty,
  moveImageBy,
  moveImageToLine,
  paragraphBounds,
  readEditor,
  renderEditor as renderEditorDom,
  makeRule,
  serializeEditor,
  setChipWidth,
  textBefore,
  type LineSpan,
} from './richeditor';
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
  tags: $('tags'),
  list: $('list'),
  count: $('count'),
  helpBtn: $<HTMLButtonElement>('help'),
  layoutBtn: $<HTMLButtonElement>('layout'),
  layoutSheet: $('layout-sheet'),
  textW: $<HTMLInputElement>('text-w'),
  textWOut: $<HTMLOutputElement>('text-w-out'),
  marginW: $<HTMLInputElement>('margin-w'),
  marginWOut: $<HTMLOutputElement>('margin-w-out'),
  marginShow: $<HTMLInputElement>('margin-show'),
  focusMode: $<HTMLInputElement>('focus-mode'),
  typewriter: $<HTMLInputElement>('typewriter'),
  closeTray: $<HTMLInputElement>('close-tray'),
  hotkeyBtn: $<HTMLButtonElement>('hotkey'),
  hotkeyClear: $<HTMLButtonElement>('hotkey-clear'),
  hotkeyNote: $('hotkey-note'),
  palette: $('palette'),
  paletteInput: $<HTMLInputElement>('palette-input'),
  paletteList: $('palette-list'),
  keyGroups: $('key-groups'),
  title: $<HTMLInputElement>('title'),
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
  pinBtn: $<HTMLButtonElement>('pin'),
  deleteBtn: $<HTMLButtonElement>('delete'),
  editorWrap: $('editor-wrap'),
  editor: $<HTMLDivElement>('editor'),
  preview: $('preview'),
  imgHandle: $('img-handle'),
  imgSize: $('img-size'),
  dropLine: $('drop-line'),
  empty: $('empty'),
  helpSheet: $('help-sheet'),
};

// --- UI state (per-machine conveniences, kept in localStorage) --------------

interface UiState {
  selectedId: string | null;
  preview: boolean;
  sidebarHidden: boolean;
  /** Width of the writing column in px, before the window's own limit. */
  textW: number;
  /** Width of the marginalia column in px. */
  marginW: number;
  marginHidden: boolean;
  /** Dim everything except the paragraph the caret is in. */
  focusMode: boolean;
  /** Keep the line being written near the middle of the editor. */
  typewriter: boolean;
}

const MARGIN_DEFAULT = 176;
const MARGIN_MIN = 90;
const MARGIN_MAX = 280;

const TEXT_DEFAULT = 960;
const TEXT_MIN = 520;
const TEXT_MAX = 1800;

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, Number(value) || fallback));

const UI_KEY = 'notes.ui';

function loadUi(): UiState {
  const fallback: UiState = {
    selectedId: null,
    preview: false,
    sidebarHidden: false,
    textW: TEXT_DEFAULT,
    marginW: MARGIN_DEFAULT,
    marginHidden: false,
    focusMode: false,
    typewriter: false,
  };
  try {
    const raw = localStorage.getItem(UI_KEY);
    const state = raw ? { ...fallback, ...(JSON.parse(raw) as Partial<UiState>) } : fallback;
    state.marginW = clamp(state.marginW, MARGIN_MIN, MARGIN_MAX, MARGIN_DEFAULT);
    state.textW = clamp(state.textW, TEXT_MIN, TEXT_MAX, TEXT_DEFAULT);
    return state;
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

/**
 * Tray and hotkey settings. These live with the main process, which acts on
 * them while the window is hidden or closing; this is the renderer's copy for
 * drawing the settings rows.
 */
let settings: Settings = { ...DEFAULT_SETTINGS };

// --- data -------------------------------------------------------------------

let notes: Note[] = [];
let query = '';
/** A tag chosen in the sidebar narrows the list until cleared. */
let tagFilter: string | null = null;
/** Which note the textarea currently holds, so re-renders never clobber the caret. */
let editorNoteId: string | null = null;

const visibleNotes = (): Note[] => searchNotes(sortByEdited(notes), query, tagFilter);
const filtering = (): boolean => query.trim() !== '' || tagFilter !== null;
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
    showAutosave();
  } catch (err) {
    dirty = true;
    console.error('[notes] save failed', err);
    showStatus('Save failed', 0);
  }
}

/** When the message on the status line has had its say. */
let statusUntil = 0;

/** Header status line. `ms` 0 keeps it until the next message. */
function showStatus(text: string, ms: number): void {
  el.status.textContent = text;
  el.status.classList.add('show');
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusUntil = ms > 0 ? Date.now() + ms : Infinity;
  statusTimer = ms > 0 ? window.setTimeout(() => el.status.classList.remove('show'), ms) : null;
}

/**
 * Autosave's own "Saved" waits its turn. Saving follows nearly every action,
 * and it should not wipe out the line that says what the action did — an
 * import or an attachment has more to report than the save that follows it.
 * Ctrl+S says "Saved" for itself, so the deliberate save is still answered.
 */
function showAutosave(): void {
  if (Date.now() < statusUntil) return;
  showStatus('Saved', 1200);
}

function clearStatus(): void {
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = null;
  statusUntil = 0;
  el.status.classList.remove('show');
}

// The main process asks for this when the window is closing.
window.notesApi.onFlushRequest(() => {
  if (!dirty) return null;
  dirty = false;
  return toFile();
});

// --- rendering --------------------------------------------------------------

const PIN_SVG =
  '<svg class="pin-mark" viewBox="0 0 12 12" aria-label="Pinned" role="img"><path d="M7.5 1.5 10.5 4.5 8.6 5.2 6.9 8.4 5.4 6.9 2 10.5 1.5 10 5.1 6.6 3.6 5.1 6.8 3.4Z" fill="currentColor"/></svg>';

function renderTags(): void {
  const tags = allTags(notes);
  if (tagFilter && !tags.some((t) => t.tag === tagFilter)) tagFilter = null;
  el.tags.hidden = tags.length === 0;
  el.tags.replaceChildren();
  for (const { tag, count } of tags) {
    const chip = document.createElement('button');
    chip.className = 'tag u';
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(tag === tagFilter));
    chip.title = tag === tagFilter ? 'Show all notes' : `Only notes tagged #${tag}`;
    const name = document.createElement('span');
    name.textContent = `#${tag}`;
    const n = document.createElement('span');
    n.className = 'tag-count';
    n.textContent = String(count);
    chip.append(name, n);
    chip.addEventListener('click', () => setTagFilter(tag === tagFilter ? null : tag));
    el.tags.append(chip);
  }
}

function setTagFilter(tag: string | null): void {
  tagFilter = tag;
  const vis = visibleNotes();
  // Keep the current note when it still shows; otherwise land on the first.
  if (vis.length > 0 && !vis.some((n) => n.id === ui.selectedId)) select(vis[0].id);
  else renderList();
}

function emptyListMessage(): HTMLElement {
  const msg = document.createElement('div');
  msg.className = 'list-empty';
  const q = query.trim();
  if (notes.length === 0) {
    msg.innerHTML = 'Nothing here yet.<span class="u">Press <kbd>Ctrl</kbd> <kbd>N</kbd> to start a note</span>';
  } else if (q) {
    msg.textContent = 'No notes match that.';
    const hint = document.createElement('span');
    hint.className = 'u';
    hint.innerHTML = 'Press <kbd>Enter</kbd> to start a note titled ';
    const title = document.createElement('b');
    title.textContent = `“${q}”`;
    hint.append(title);
    msg.append(hint);
  } else {
    msg.textContent = `No notes tagged #${tagFilter ?? ''}.`;
  }
  return msg;
}

function renderList(): void {
  renderTags();
  const vis = visibleNotes();
  el.list.replaceChildren();
  if (vis.length === 0) el.list.append(emptyListMessage());

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
    if (n.pinned) t.innerHTML = PIN_SVG;
    const tt = document.createElement('span');
    tt.textContent = title;
    t.append(tt);

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
    filtering() && notes.length > 0
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
  el.pinBtn.disabled = !has;
  el.pinBtn.setAttribute('aria-pressed', String(n?.pinned === true));
  el.pinBtn.textContent = n?.pinned ? 'Unpin' : 'Pin';
  el.deleteBtn.disabled = !has;
  renderMeta();
  if (!n) {
    editorNoteId = null;
    return;
  }

  if (editorNoteId !== n.id) {
    renderEditorDom(el.editor, n.body);
    el.editor.scrollTop = 0;
    editorNoteId = n.id;
    el.title.value = n.title ?? '';
    // Restart the short fade so switching notes reads as turning a page.
    el.text.classList.remove('swap');
    void el.text.offsetWidth;
    el.text.classList.add('swap');
  }

  el.previewToggle.setAttribute('aria-pressed', String(ui.preview));
  el.editor.hidden = ui.preview;
  el.preview.hidden = !ui.preview;
  if (ui.preview) {
    // The preview keeps its place when a checkbox is ticked, since ticking one
    // re-renders the whole article.
    const scroll = el.preview.scrollTop;
    el.preview.innerHTML = n.body.trim()
      ? renderMarkdown(n.body)
      : '<p class="preview-empty">Nothing to preview yet.</p>';
    liveTaskBoxes();
    el.preview.scrollTop = scroll;
  }
  syncChipUi();
  syncWriting();
}

/**
 * Markdown renders task lists as disabled checkboxes. Here they are the way to
 * tick things off, so they are enabled and numbered: the nth box in the
 * preview is the nth task line in the body.
 */
function liveTaskBoxes(): void {
  el.preview.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box, i) => {
    box.disabled = false;
    box.dataset.task = String(i);
    box.setAttribute('aria-label', box.checked ? 'Done' : 'Not done');
  });
}

function applySidebar(): void {
  el.app.classList.toggle('sidebar-hidden', ui.sidebarHidden);
}

function applyLayout(): void {
  el.app.style.setProperty('--text-w', `${ui.textW}px`);
  el.app.style.setProperty('--margin-w', `${ui.marginW}px`);
  el.textW.value = String(ui.textW);
  el.textWOut.value = `${ui.textW} px`;
  el.app.classList.toggle('margin-hidden', ui.marginHidden);
  el.marginW.value = String(ui.marginW);
  el.marginWOut.value = `${ui.marginW} px`;
  el.marginShow.checked = !ui.marginHidden;
  positionHandle(selectedChip());
}

// --- focus mode and typewriter scrolling ------------------------------------

/** The name the dim highlight is registered under; matched by ::highlight() in the CSS. */
const DIM = 'note-dim';

const highlights = (): HighlightRegistry | null =>
  typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;

function rangeOver(from: LineSpan, to: LineSpan): Range {
  const range = document.createRange();
  range.setStart(from.start.node, from.start.offset);
  range.setEnd(to.end.node, to.end.offset);
  return range;
}

/**
 * Dims every line outside the paragraph the caret sits in. The text is left
 * alone: the dimming is a CSS custom highlight over ranges, so no wrapper
 * elements go into the editor and nothing about the note changes.
 */
function applyFocus(): void {
  const reg = highlights();
  const off = !ui.focusMode || ui.preview || el.editorWrap.hidden;
  const pos = off ? null : caretPos();
  // Without a caret there is no current paragraph, so nothing is dimmed.
  const { text, lines } = off || !pos ? { text: '', lines: [] } : readEditor(el.editor);
  if (!pos || lines.length === 0) {
    reg?.delete(DIM);
    dimBlocks(null);
    return;
  }
  const { first, last } = paragraphBounds(text.split('\n'), lineIndexIn(lines, pos));
  const ranges: Range[] = [];
  if (first > 0) ranges.push(rangeOver(lines[0], lines[first - 1]));
  if (last < lines.length - 1) ranges.push(rangeOver(lines[last + 1], lines[lines.length - 1]));
  if (reg) {
    if (ranges.length === 0) reg.delete(DIM);
    else reg.set(DIM, new Highlight(...ranges));
  }
  dimBlocks({ lines, first, last });
}

/**
 * A custom highlight only reaches text, so pictures and rules would stay
 * bright while the words around them faded. They are faded with a class
 * instead — which the serializer does not look at, so the note is unchanged.
 */
function dimBlocks(scope: { lines: LineSpan[]; first: number; last: number } | null): void {
  for (const block of el.editor.querySelectorAll<HTMLElement>('.inline-img, .inline-rule')) {
    let dim = false;
    if (scope) {
      const parent = block.parentNode;
      const at = parent ? lineIndexIn(scope.lines, { node: parent, offset: childIndex(block) }) : -1;
      dim = at >= 0 && (at < scope.first || at > scope.last);
    }
    block.classList.toggle('is-dim', dim);
  }
}

/** Where the caret is on screen, or null when it has no position of its own. */
function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.editor.contains(range.startContainer)) return null;
  const rect = range.getBoundingClientRect();
  if (rect.height > 0) return rect;
  // A collapsed caret on an empty line measures zero; the line it sits on does not.
  const line = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const fallback = line?.getBoundingClientRect();
  return fallback && fallback.height > 0 ? fallback : null;
}

/** Where in the editor the line being written should sit. */
const TYPEWRITER_AT = 0.45;

function applyTypewriter(): void {
  if (!ui.typewriter || ui.preview || el.editorWrap.hidden) return;
  const rect = caretRect();
  if (!rect) return;
  const box = el.editor.getBoundingClientRect();
  const delta = rect.top - (box.top + box.height * TYPEWRITER_AT);
  if (Math.abs(delta) > 1) el.editor.scrollTop += delta;
}

// Both react to the caret, which moves on nearly every keystroke; one frame's
// worth of coalescing keeps the DOM walk off the typing path.
let writingFrame = 0;
function syncWriting(): void {
  if (writingFrame) return;
  writingFrame = requestAnimationFrame(() => {
    writingFrame = 0;
    applyFocus();
    applyTypewriter();
  });
}

function applyWriting(): void {
  el.focusMode.checked = ui.focusMode;
  el.typewriter.checked = ui.typewriter;
  syncWriting();
}

function toggleFocusMode(): void {
  ui.focusMode = !ui.focusMode;
  saveUi();
  applyWriting();
  showStatus(ui.focusMode ? 'Focus mode on' : 'Focus mode off', 1500);
}

function toggleTypewriter(): void {
  ui.typewriter = !ui.typewriter;
  saveUi();
  applyWriting();
  showStatus(ui.typewriter ? 'Typewriter scrolling on' : 'Typewriter scrolling off', 1500);
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
  if (ui.preview) {
    el.preview.focus();
    return;
  }
  // Entering the editor from elsewhere drops the caret at the end, ready to write.
  const alreadyHere = document.activeElement === el.editor;
  el.editor.focus();
  if (!alreadyHere) caretToEnd();
}

function focusList(): void {
  const item = el.list.querySelector<HTMLElement>('.item.selected') ?? el.list.querySelector<HTMLElement>('.item');
  if (item) item.focus();
  else el.search.focus();
}

function selectedItemIntoView(): void {
  el.list.querySelector<HTMLElement>('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

/** Starts a note, optionally with a title, and puts the caret in the body. */
function newNote(title = ''): void {
  const n = createNote();
  if (title.trim()) n.title = title.trim();
  notes = [n, ...notes];
  scheduleSave();
  if (query) {
    query = '';
    el.search.value = '';
  }
  tagFilter = null;
  if (ui.preview) ui.preview = false;
  select(n.id);
  focusEditor();
}

/** A note whose title is what was typed into the search box. */
function createFromSearch(): void {
  const title = query.trim();
  if (!title) return;
  newNote(title);
  showStatus(`Started “${title}”`, 2000);
}

function togglePinSelected(): void {
  const n = selected();
  if (!n) return;
  notes = togglePin(notes, n.id);
  scheduleSave();
  renderList();
  renderEditor();
  selectedItemIntoView();
  showStatus(selected()?.pinned ? 'Pinned' : 'Unpinned', 1500);
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

/** Puts the caret at the very end of the editor's content. */
function caretToEnd(): void {
  const range = document.createRange();
  range.selectNodeContents(el.editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** True when the caret or selection is currently inside the editor. */
function selectionInEditor(): boolean {
  const sel = window.getSelection();
  return sel !== null && sel.rangeCount > 0 && el.editor.contains(sel.getRangeAt(0).commonAncestorContainer);
}

/** Inserts an attachment as a picture chip at the caret, as if it were typed. */
function insertImageChip(name: string, alt: string): void {
  el.editor.focus();
  if (!selectionInEditor()) caretToEnd();
  // execCommand keeps the caret and undo history working inside contenteditable.
  document.execCommand('insertHTML', false, imageChipHtml(name, alt));
  // A programmatic insert may not raise 'input' on every build, so store now.
  commitEditor();
}

/** Reads the editor back into the model and refreshes anything derived from it. */
function commitEditor(): void {
  const n = selected();
  if (!n || editorNoteId !== n.id) return;
  notes = updateBody(notes, n.id, serializeEditor(el.editor));
  markEmpty(el.editor);
  scheduleSave();
  renderList();
  renderMeta();
}

function altFor(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base && base.toLowerCase() !== 'image' ? base : 'image';
}

const isImage = (f: File): boolean => f.type.startsWith('image/');

/** Files dropped on the window: pictures go into the note, notes become notes. */
async function takeFiles(files: File[]): Promise<void> {
  const texts = files.filter((f) => !isImage(f) && isTextFile(f.name));
  const images = files.filter(isImage);
  if (texts.length > 0) {
    await importFiles(await Promise.all(texts.map(async (f) => ({ name: f.name, text: await f.text() }))));
  }
  if (images.length > 0) await attachFiles(images);
  if (texts.length === 0 && images.length === 0) showStatus('Only images and .md or .txt files can be dropped in', 3500);
}

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
      const name = assetNameFromUrl(url);
      if (name) insertImageChip(name, altFor(file.name));
      attached++;
    } catch (err) {
      console.error('[notes] attach failed', err);
      showStatus(err instanceof Error ? err.message.replace(/^.*Error: /, '') : 'Could not attach that image', 4000);
      return;
    }
  }
  showStatus(attached === 1 ? 'Image attached' : `${attached} images attached`, 2500);
}

/**
 * Every imported file becomes one note, newest first, and the first of them is
 * opened so the import is visibly there rather than merely reported.
 */
async function importFiles(files: ImportedFile[]): Promise<void> {
  const made: Note[] = [];
  for (const file of files) {
    const { title, body } = noteFromFile(file.name, file.text);
    const note = createNote();
    note.body = body;
    if (title) note.title = title;
    made.push(note);
  }
  if (made.length === 0) return;
  notes = [...made, ...notes];
  scheduleSave();
  query = '';
  el.search.value = '';
  tagFilter = null;
  select(made[0].id);
  showStatus(made.length === 1 ? `Imported “${titleOf(made[0])}”` : `Imported ${made.length} notes`, 3000);
}

async function pickImports(): Promise<void> {
  try {
    await importFiles(await window.notesApi.pickImports());
  } catch (err) {
    console.error('[notes] import failed', err);
    showStatus('Could not read those files', 4000);
  }
}

async function pickImages(): Promise<void> {
  const urls = await window.notesApi.pickAttachments();
  if (urls.length === 0) return;
  ensureEditable();
  for (const url of urls) {
    const name = assetNameFromUrl(url);
    if (name) insertImageChip(name, 'image');
  }
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
  if (dragChip) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    showDropLine(dropTargetAt(e.clientX, e.clientY));
    return;
  }
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
  if (dragChip) {
    // One of our own images being moved to another line, not a file from outside.
    const chip = dragChip;
    const target = dropTargetAt(e.clientX, e.clientY);
    chip.classList.remove('dragging');
    dragChip = null;
    showDropLine(null);
    if (target) moveChipToLine(chip, target.line);
    else selectChip(chip);
    return;
  }
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length > 0) void takeFiles(files);
});

// --- images: select, resize, move -------------------------------------------

/** The image or rule chip the selection wraps exactly, if any. */
function selectedBlock(): HTMLElement | null {
  if (el.editor.hidden) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return null;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1) return null;
  const node = r.startContainer.childNodes[r.startOffset];
  return (isChip(node) || isRule(node)) && el.editor.contains(node) ? node : null;
}

/** The image chip the selection wraps exactly, if any. */
function selectedChip(): HTMLImageElement | null {
  const block = selectedBlock();
  return isChip(block) ? block : null;
}

function selectChip(chip: HTMLElement): void {
  el.editor.focus();
  const range = document.createRange();
  range.selectNode(chip);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  syncChipUi();
}

/** Drops the caret just after a node, leaving nothing selected. */
function caretAfter(node: Node): void {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Keeps the selected-chip outline and the resize handle in step with the selection. */
function syncChipUi(): void {
  const block = selectedBlock();
  for (const c of el.editor.querySelectorAll('.inline-img, .inline-rule')) c.classList.toggle('is-selected', c === block);
  positionHandle(isChip(block) ? block : null);
}

function positionHandle(chip: HTMLImageElement | null): void {
  if (!chip) {
    el.imgHandle.hidden = true;
    el.imgSize.hidden = true;
    return;
  }
  const text = el.text.getBoundingClientRect();
  const r = chip.getBoundingClientRect();
  el.imgHandle.style.left = `${r.right - text.left}px`;
  el.imgHandle.style.top = `${r.bottom - text.top}px`;
  el.imgHandle.hidden = false;
  if (!el.imgSize.hidden) {
    el.imgSize.style.left = `${r.right - text.left}px`;
    el.imgSize.style.top = `${r.bottom - text.top}px`;
    el.imgSize.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
  }
}

/** The widest an image can be: the editor's text column. */
function maxImageWidth(): number {
  const cs = getComputedStyle(el.editor);
  return Math.max(MIN_IMAGE_WIDTH, el.editor.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
}

let resizing: { chip: HTMLImageElement; startX: number; startW: number } | null = null;

el.imgHandle.addEventListener('pointerdown', (e) => {
  const chip = selectedChip();
  if (!chip || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  el.imgHandle.setPointerCapture(e.pointerId);
  resizing = { chip, startX: e.clientX, startW: chip.getBoundingClientRect().width };
  el.text.classList.add('resizing');
  el.imgSize.hidden = false;
  positionHandle(chip);
});

el.imgHandle.addEventListener('pointermove', (e) => {
  if (!resizing) return;
  const w = Math.min(maxImageWidth(), Math.max(MIN_IMAGE_WIDTH, resizing.startW + (e.clientX - resizing.startX)));
  setChipWidth(resizing.chip, w);
  positionHandle(resizing.chip);
});

function endResize(): void {
  if (!resizing) return;
  const chip = resizing.chip;
  resizing = null;
  el.text.classList.remove('resizing');
  el.imgSize.hidden = true;
  commitEditor();
  selectChip(chip);
}
el.imgHandle.addEventListener('pointerup', endResize);
el.imgHandle.addEventListener('pointercancel', endResize);

el.editor.addEventListener('click', (e) => {
  if (isChip(e.target) || isRule(e.target)) selectChip(e.target);
});

// --- section dividers -------------------------------------------------------

/** The caret as a DOM position, or null when it is not a collapsed point in the editor. */
function caretPos(): { node: Node; offset: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1 || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  return el.editor.contains(r.startContainer) ? { node: r.startContainer, offset: r.startOffset } : null;
}

/**
 * Puts a section rule at the caret on a line of its own, with a blank line
 * above it. The blank line matters: in markdown, dashes directly under a line
 * of text turn that line into a heading rather than drawing a rule.
 */
function insertDivider(): void {
  ensureEditable();
  if (!selectionInEditor()) caretToEnd();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  // Built straight into the DOM: Chromium's insert commands merge whatever
  // follows a non-editable block onto its line, so the newline after the rule
  // would be lost and the next words would end up glued to the dashes.
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const before = textBefore(el.editor, { node: range.startContainer, offset: range.startOffset });
  const pad = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const frag = document.createDocumentFragment();
  if (pad) frag.append(document.createTextNode(pad));
  const tail = document.createTextNode('\n');
  frag.append(makeRule(), tail);
  range.insertNode(frag);
  // At the very end of the note the newline would be the last character, which
  // Chromium treats as the placeholder for the empty last line and overwrites
  // with the next keystroke. Its own idiom is a trailing <br>; give it one.
  let next = tail.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && next.textContent === '') next = next.nextSibling;
  if (!next) tail.after(document.createElement('br'));
  const after = document.createRange();
  after.setStart(tail, 1);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  commitEditor();
}

/** When the line being finished is just ---, swap the dashes for a real rule. */
function convertDashesOnEnter(): boolean {
  const pos = caretPos();
  if (!pos || pos.node.nodeType !== Node.TEXT_NODE) return false;
  const before = textBefore(el.editor, pos);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (!/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) return false;
  const text = pos.node.textContent ?? '';
  if (pos.offset < line.length || text.slice(pos.offset - line.length, pos.offset) !== line) return false;
  const range = document.createRange();
  range.setStart(pos.node, pos.offset - line.length);
  range.setEnd(pos.node, pos.offset);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand('delete');
  insertDivider();
  return true;
}

// --- checklists -------------------------------------------------------------

/** Replaces the body of the open note and puts the editor back in step with it. */
function setBody(body: string): void {
  const n = selected();
  if (!n || n.body === body) return;
  notes = updateBody(notes, n.id, body);
  scheduleSave();
  // The editor only re-renders on a note switch, so tell it this counts as one.
  editorNoteId = null;
  renderList();
  renderEditor();
}

// Ticking a box in the preview writes the change back into the markdown.
el.preview.addEventListener('click', (e) => {
  const box = e.target;
  if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox' || box.dataset.task === undefined) return;
  const n = selected();
  if (!n) return;
  setBody(toggleTaskAt(n.body, Number(box.dataset.task)));
});

/**
 * Turns the line the caret is on into a checklist item, ticks it, or takes the
 * checkbox away again. The whole body is rewritten and re-rendered rather than
 * the line patched in place, because a line can hold a picture or a rule.
 */
function toggleTaskHere(): void {
  ensureEditable();
  const pos = caretPos();
  if (!pos) return;
  const { text, lines } = readEditor(el.editor);
  const line = lineIndexIn(lines, pos);
  const next = cycleTaskLine(text, line);
  if (next === text) return;
  setBody(next);
  // The re-render throws away the old caret. It comes back at the end of the
  // line, which is where the next word of a checklist item goes anyway.
  caretToLineEnd(line);
}

/** Puts the caret at the end of a line, after the editor has been re-rendered. */
function caretToLineEnd(line: number): void {
  el.editor.focus();
  const spans = lineSpans(el.editor);
  const span = spans[Math.min(line, spans.length - 1)];
  if (!span) return;
  const range = document.createRange();
  range.setStart(span.end.node, span.end.offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  syncWriting();
}

// Double-click puts an image back at its natural size.
el.editor.addEventListener('dblclick', (e) => {
  if (!isChip(e.target)) return;
  e.preventDefault();
  setChipWidth(e.target, null);
  commitEditor();
  selectChip(e.target);
});

document.addEventListener('selectionchange', () => {
  syncChipUi();
  syncWriting();
});
el.editor.addEventListener('scroll', () => positionHandle(selectedChip()));
window.addEventListener('resize', () => {
  positionHandle(selectedChip());
  syncWriting();
});

/** Re-renders the editor from a moved body and leaves the moved image selected. */
function applyMove(moved: { body: string; index: number }): void {
  const n = selected();
  if (!n || moved.body === n.body) return;
  renderEditorDom(el.editor, moved.body);
  commitEditor();
  const chip = chipsOf(el.editor)[moved.index];
  if (chip) {
    selectChip(chip);
    chip.scrollIntoView({ block: 'nearest' });
  }
}

function moveChipBy(chip: HTMLImageElement, delta: -1 | 1): void {
  const body = serializeEditor(el.editor);
  applyMove(moveImageBy(body, chipsOf(el.editor).indexOf(chip), delta));
}

function moveChipToLine(chip: HTMLImageElement, line: number): void {
  const body = serializeEditor(el.editor);
  applyMove(moveImageToLine(body, chipsOf(el.editor).indexOf(chip), line));
}

interface DropTarget {
  /** Markdown line the image would be inserted before. */
  line: number;
  /** Where to draw the indicator, in viewport pixels. */
  y: number;
}

const childIndex = (node: Node): number => Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node);

/** Which line a point over the editor would drop an image onto: above or below the line under it. */
function dropTargetAt(x: number, y: number): DropTarget | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit || !el.editor.contains(hit)) return null;
  if (isChip(hit)) {
    const r = hit.getBoundingClientRect();
    const line = lineIndexAt(el.editor, { node: hit.parentNode as Node, offset: childIndex(hit) });
    return y < r.top + r.height / 2 ? { line, y: r.top } : { line: line + 1, y: r.bottom };
  }
  const caret = document.caretRangeFromPoint(x, y);
  if (!caret || !el.editor.contains(caret.startContainer)) return null;
  const line = lineIndexAt(el.editor, { node: caret.startContainer, offset: caret.startOffset });
  const span = lineSpans(el.editor)[line];
  let rect: DOMRect | undefined;
  if (span) {
    const r = document.createRange();
    r.setStart(span.start.node, span.start.offset);
    r.setEnd(span.end.node, span.end.offset);
    rect = r.getBoundingClientRect();
  }
  if (!rect || rect.height === 0) rect = caret.getClientRects()[0];
  if (!rect || rect.height === 0) return { line, y };
  return y < rect.top + rect.height / 2 ? { line, y: rect.top } : { line: line + 1, y: rect.bottom };
}

function showDropLine(target: DropTarget | null): void {
  if (!target) {
    el.dropLine.hidden = true;
    return;
  }
  el.dropLine.style.top = `${target.y - el.text.getBoundingClientRect().top}px`;
  el.dropLine.hidden = false;
}

let dragChip: HTMLImageElement | null = null;

el.editor.addEventListener('dragstart', (e) => {
  if (!isChip(e.target) || !e.dataTransfer) return;
  dragChip = e.target;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-notes-image', e.target.dataset.asset ?? '');
  e.target.classList.add('dragging');
  positionHandle(null);
});

el.editor.addEventListener('dragend', () => {
  dragChip?.classList.remove('dragging');
  dragChip = null;
  showDropLine(null);
  syncChipUi();
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
  const body = exportBody(n);
  let request: ExportRequest;
  if (kind === 'md') request = { kind, title, body };
  else if (kind === 'txt') request = { kind, title, text: markdownToText(body) };
  else request = { kind, title, html: renderMarkdown(body), css: stylesText, edited: `Edited ${absoluteTime(n.updatedAt)}` };

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
  commitEditor();
  syncWriting();
});

// Enter inserts a plain line break rather than a new paragraph block, so the
// content stays a flat run of text, breaks and image chips.
el.editor.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertParagraph') {
    e.preventDefault();
    if (!convertDashesOnEnter()) document.execCommand('insertLineBreak');
  }
});

el.editor.addEventListener('keydown', (e) => {
  const chip = selectedBlock();
  if (chip) {
    if (isChip(chip) && e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveChipBy(chip, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    // A selected picture should not vanish under the next keystroke the way
    // selected text does: Enter and typing continue after it. Delete and
    // Backspace still remove it.
    const typing = e.key === 'Enter' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey);
    if (typing) caretAfter(chip);
  }
  // Tab indents by two spaces instead of leaving the editor; Escape is the way out.
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (e.shiftKey) {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      // Outdent: drop up to two spaces immediately before the caret.
      if (sel?.isCollapsed && node?.nodeType === Node.TEXT_NODE) {
        const offset = sel.anchorOffset;
        const text = node.textContent ?? '';
        const remove = text.slice(Math.max(0, offset - 2), offset).length - text.slice(Math.max(0, offset - 2), offset).replace(/ {1,2}$/, '').length;
        if (remove > 0) {
          (node as Text).deleteData(offset - remove, remove);
          commitEditor();
        }
      }
    } else {
      document.execCommand('insertText', false, '  ');
    }
  }
});

// --- title ------------------------------------------------------------------

el.title.addEventListener('input', () => {
  const n = selected();
  if (!n) return;
  notes = updateTitle(notes, n.id, el.title.value);
  scheduleSave();
  renderList();
  renderMeta();
});

el.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (ui.preview) {
      el.preview.focus();
      return;
    }
    el.editor.focus();
    const range = document.createRange();
    range.selectNodeContents(el.editor);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
});

function focusTitle(): void {
  if (!selected()) newNote();
  el.title.focus();
  el.title.select();
}

// --- layout sheet -----------------------------------------------------------

function toggleLayout(force?: boolean): void {
  const open = force ?? el.layoutSheet.hidden;
  el.layoutSheet.hidden = !open;
  if (open) el.textW.focus();
  else focusEditor();
}

el.textW.addEventListener('input', () => {
  ui.textW = Number(el.textW.value);
  saveUi();
  applyLayout();
});
el.marginW.addEventListener('input', () => {
  ui.marginW = Number(el.marginW.value);
  saveUi();
  applyLayout();
});
el.marginShow.addEventListener('change', () => {
  ui.marginHidden = !el.marginShow.checked;
  saveUi();
  applyLayout();
});
el.focusMode.addEventListener('change', () => {
  if (el.focusMode.checked !== ui.focusMode) toggleFocusMode();
});
el.typewriter.addEventListener('change', () => {
  if (el.typewriter.checked !== ui.typewriter) toggleTypewriter();
});
el.layoutBtn.addEventListener('click', () => toggleLayout(true));
el.layoutSheet.addEventListener('click', (e) => {
  if (e.target === el.layoutSheet) toggleLayout(false);
});

// --- tray and the summon hotkey ---------------------------------------------

/** True while the hotkey button is listening for the chord to record. */
let recording = false;

function renderSettings(note = ''): void {
  el.closeTray.checked = settings.closeToTray;
  el.hotkeyBtn.classList.toggle('recording', recording);
  el.hotkeyBtn.replaceChildren();
  if (recording) {
    el.hotkeyBtn.append('Press a combination…');
  } else if (settings.hotkey) {
    for (const part of keyLabel(settings.hotkey)) {
      const k = document.createElement('kbd');
      k.textContent = part;
      el.hotkeyBtn.append(k);
    }
  } else {
    el.hotkeyBtn.append('None');
  }
  el.hotkeyClear.hidden = !settings.hotkey || recording;
  el.hotkeyNote.textContent = note;
}

/** Hands the settings to the main process, which is the one that acts on them. */
async function saveSettings(next: Settings): Promise<void> {
  const previous = settings;
  settings = next;
  renderSettings();
  try {
    const stored = await window.notesApi.setSettings(next);
    settings = { closeToTray: stored.closeToTray, hotkey: stored.hotkey };
    renderSettings(stored.hotkeyFailed ? 'Another program already uses that combination.' : '');
  } catch (err) {
    console.error('[notes] could not save settings', err);
    settings = previous;
    renderSettings('Could not save that setting.');
  }
}

el.closeTray.addEventListener('change', () => {
  void saveSettings({ ...settings, closeToTray: el.closeTray.checked });
});

function stopRecording(): void {
  if (!recording) return;
  recording = false;
  renderSettings();
}

el.hotkeyBtn.addEventListener('click', () => {
  recording = !recording;
  renderSettings(recording ? 'Esc cancels, Backspace clears.' : '');
});

// The chord is read here, before the app's own keyboard map sees it, so
// recording Ctrl+Shift+P does not also pin the note.
el.hotkeyBtn.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopRecording();
    return;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    recording = false;
    void saveSettings({ ...settings, hotkey: null });
    return;
  }
  const chord = chordOf(e);
  if (!chord) return;
  if (!isCommandChord(chord)) {
    renderSettings('Hold Ctrl or Alt as part of the combination.');
    return;
  }
  recording = false;
  void saveSettings({ ...settings, hotkey: chord });
});

el.hotkeyBtn.addEventListener('blur', stopRecording);
el.hotkeyClear.addEventListener('click', () => void saveSettings({ ...settings, hotkey: null }));

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
    // Search or create: what you typed becomes the title when nothing matches
    // (or whenever Shift is held), so finding and starting are one motion.
    if (query.trim() && (e.shiftKey || visibleNotes().length === 0)) createFromSearch();
    else focusEditor();
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

el.newBtn.addEventListener('click', () => newNote());
el.previewToggle.addEventListener('click', togglePreview);
el.attachBtn.addEventListener('click', () => void pickImages());
el.pinBtn.addEventListener('click', togglePinSelected);
el.deleteBtn.addEventListener('click', armDelete);
el.toggleSidebar.addEventListener('click', toggleSidebar);
el.helpBtn.addEventListener('click', () => toggleHelp(true));
el.helpSheet.addEventListener('click', (e) => {
  if (e.target === el.helpSheet) toggleHelp(false);
});

// --- the command registry ---------------------------------------------------

/**
 * Every command in one list. The keyboard map, the shortcuts sheet and the
 * command palette are all built from it below, so a command cannot gain a key
 * without appearing in the sheet, and nothing in the sheet can be a key that
 * no longer runs.
 */
const hasNote = (): boolean => selected() !== null;

const ACTIONS: Action[] = [
  { id: 'new', label: 'New note', group: 'Notes', chord: 'ctrl+n', run: () => newNote() },
  {
    id: 'find',
    label: 'Find a note',
    group: 'Notes',
    chord: 'ctrl+k',
    also: ['ctrl+f'],
    terms: 'search filter',
    run: () => {
      if (ui.sidebarHidden) toggleSidebar();
      el.search.focus();
      el.search.select();
    },
  },
  { id: 'prev', label: 'Previous note', group: 'Notes', chord: 'ctrl+arrowup', run: () => step(-1) },
  { id: 'next', label: 'Next note', group: 'Notes', chord: 'ctrl+arrowdown', run: () => step(1) },
  { id: 'title', label: 'Rename this note', group: 'Notes', chord: 'ctrl+t', terms: 'title', run: focusTitle },
  {
    id: 'pin',
    label: 'Pin or unpin this note',
    hint: 'Pinned notes sort above the rest, whatever their edit time',
    group: 'Notes',
    chord: 'ctrl+shift+p',
    enabled: hasNote,
    on: () => selected()?.pinned === true,
    run: togglePinSelected,
  },
  {
    id: 'delete',
    label: 'Delete this note',
    hint: 'Press again within three seconds to confirm',
    group: 'Notes',
    chord: 'ctrl+shift+d',
    enabled: hasNote,
    run: armDelete,
  },
  {
    id: 'import',
    label: 'Import markdown or text files…',
    hint: 'One note per file; dropping files on the window does the same',
    group: 'Notes',
    chord: 'ctrl+shift+o',
    terms: 'open md txt',
    run: () => void pickImports(),
  },
  {
    id: 'export',
    label: 'Export this note…',
    hint: 'As Markdown, plain text or an image',
    group: 'Notes',
    chord: 'ctrl+shift+s',
    enabled: hasNote,
    terms: 'save as md txt png',
    run: () => {
      if (el.exportMenu.hidden) openExportMenu();
      else closeExportMenu(true);
    },
  },
  {
    id: 'save',
    label: 'Save now',
    hint: 'Autosave is always on; this only makes it immediate',
    group: 'Notes',
    chord: 'ctrl+s',
    run: () =>
      void flush().then(() => {
        if (!dirty) showStatus('Saved', 1200);
      }),
  },

  {
    id: 'attach',
    label: 'Attach an image…',
    hint: 'Pasting or dropping a picture does the same',
    group: 'Writing',
    chord: 'ctrl+shift+i',
    terms: 'picture photo insert',
    run: () => void pickImages(),
  },
  {
    id: 'divider',
    label: 'Insert a section divider',
    hint: 'Or type --- on its own line and press Enter',
    group: 'Writing',
    chord: 'ctrl+shift+h',
    terms: 'rule horizontal line break',
    run: insertDivider,
  },
  {
    id: 'task',
    label: 'Checklist item on this line',
    hint: 'Cycles the line: plain text, then to do, then done',
    group: 'Writing',
    chord: 'ctrl+shift+x',
    terms: 'todo checkbox tick',
    run: toggleTaskHere,
  },

  {
    id: 'preview',
    label: 'Markdown preview',
    group: 'View',
    chord: 'ctrl+e',
    enabled: hasNote,
    on: () => ui.preview,
    run: togglePreview,
  },
  {
    id: 'focus',
    label: 'Focus mode',
    hint: 'Dims everything but the paragraph you are in',
    group: 'View',
    chord: 'ctrl+shift+f',
    terms: 'dim distraction free',
    on: () => ui.focusMode,
    run: toggleFocusMode,
  },
  {
    id: 'typewriter',
    label: 'Typewriter scrolling',
    hint: 'Keeps the line you are writing in the middle of the page',
    group: 'View',
    chord: 'ctrl+shift+t',
    terms: 'centre center scroll',
    on: () => ui.typewriter,
    run: toggleTypewriter,
  },

  { id: 'sidebar', label: 'Toggle the sidebar', group: 'Window', chord: 'ctrl+\\', run: toggleSidebar },
  {
    id: 'layout',
    label: 'Layout and window settings',
    hint: 'Line width, margin, focus, the tray and the summon shortcut',
    group: 'Window',
    chord: 'ctrl+,',
    terms: 'preferences options tray hotkey margin width',
    run: () => toggleLayout(),
  },
  {
    id: 'palette',
    label: 'Command palette',
    group: 'Window',
    chord: 'ctrl+shift+k',
    also: ['ctrl+p'],
    terms: 'commands run',
    run: () => togglePalette(true),
  },
  { id: 'help', label: 'Keyboard shortcuts', group: 'Window', chord: 'ctrl+/', terms: 'keys help', run: () => toggleHelp() },
];

const CHORDS = keyMap(ACTIONS);

/** One <kbd> per part of a chord. */
function chordKeys(chord: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const part of keyLabel(chord)) {
    const k = document.createElement('kbd');
    k.textContent = part;
    frag.append(k);
  }
  return frag;
}

// --- the shortcuts sheet, written from the registry -------------------------

const GROUPS: Action['group'][] = ['Notes', 'Writing', 'View', 'Window'];

function renderKeyGroups(): void {
  el.keyGroups.replaceChildren();
  for (const group of GROUPS) {
    const rows = ACTIONS.filter((a) => a.group === group && a.chord);
    if (rows.length === 0) continue;
    const head = document.createElement('h3');
    head.className = 'keys-head';
    head.textContent = group;
    const list = document.createElement('dl');
    list.className = 'keys';
    for (const action of rows) {
      const dt = document.createElement('dt');
      dt.append(chordKeys(action.chord as string));
      for (const other of action.also ?? []) {
        dt.append(' / ', chordKeys(other));
      }
      const dd = document.createElement('dd');
      dd.textContent = action.hint ?? action.label;
      list.append(dt, dd);
    }
    el.keyGroups.append(head, list);
  }
}

// --- the command palette, also written from the registry --------------------

let matches: Match[] = [];
let cursor = 0;

function togglePalette(force?: boolean): void {
  const open = force ?? el.palette.hidden;
  if (open === !el.palette.hidden) return;
  el.palette.hidden = !open;
  if (!open) {
    focusEditor();
    return;
  }
  el.paletteInput.value = '';
  refreshPalette();
  el.paletteInput.focus();
}

function refreshPalette(): void {
  matches = matchActions(ACTIONS, el.paletteInput.value);
  cursor = 0;
  drawPalette();
}

/** The label with the characters the query matched picked out. */
function labelWithHits(match: Match): DocumentFragment {
  const frag = document.createDocumentFragment();
  const { label } = match.action;
  let at = 0;
  for (const hit of match.hits) {
    if (hit > at) frag.append(label.slice(at, hit));
    const b = document.createElement('b');
    b.textContent = label[hit];
    frag.append(b);
    at = hit + 1;
  }
  frag.append(label.slice(at));
  return frag;
}

function drawPalette(): void {
  el.paletteList.replaceChildren();
  if (matches.length === 0) {
    const none = document.createElement('div');
    none.className = 'palette-none u';
    none.textContent = 'No command matches that.';
    el.paletteList.append(none);
    return;
  }
  matches.forEach((match, i) => {
    const row = document.createElement('div');
    row.className = `palette-row${i === cursor ? ' at' : ''}`;
    row.id = `palette-row-${i}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === cursor));

    const name = document.createElement('span');
    name.className = 'palette-name';
    name.append(labelWithHits(match));
    if (match.action.on?.()) {
      const dot = document.createElement('span');
      dot.className = 'palette-on';
      dot.title = 'On';
      name.append(dot);
    }

    const group = document.createElement('span');
    group.className = 'palette-group u';
    group.textContent = match.action.group;

    const keys = document.createElement('span');
    keys.className = 'palette-keys';
    if (match.action.chord) keys.append(chordKeys(match.action.chord));

    row.append(name, group, keys);
    row.addEventListener('mousemove', () => moveCursor(i, false));
    row.addEventListener('click', () => runMatch(i));
    el.paletteList.append(row);
  });
  syncCursor();
}

function moveCursor(to: number, scroll = true): void {
  if (matches.length === 0 || to === cursor) return;
  cursor = Math.max(0, Math.min(matches.length - 1, to));
  el.paletteList.querySelectorAll('.palette-row').forEach((row, i) => {
    row.classList.toggle('at', i === cursor);
    row.setAttribute('aria-selected', String(i === cursor));
  });
  syncCursor(scroll);
}

function syncCursor(scroll = true): void {
  const row = el.paletteList.children[cursor];
  el.paletteInput.setAttribute('aria-activedescendant', row instanceof HTMLElement ? row.id : '');
  if (scroll) row?.scrollIntoView({ block: 'nearest' });
}

function runMatch(index: number): void {
  const action = matches[index]?.action;
  if (!action) return;
  // Closed first, so a command that moves focus is not fighting the palette for it.
  el.palette.hidden = true;
  action.run();
}

el.paletteInput.addEventListener('input', refreshPalette);

el.paletteInput.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      moveCursor(cursor + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveCursor(cursor - 1);
      break;
    case 'Home':
      e.preventDefault();
      moveCursor(0);
      break;
    case 'End':
      e.preventDefault();
      moveCursor(matches.length - 1);
      break;
    case 'Enter':
      e.preventDefault();
      runMatch(cursor);
      break;
    case 'Tab':
      e.preventDefault();
      break;
  }
});

el.palette.addEventListener('click', (e) => {
  if (e.target === el.palette) togglePalette(false);
});

// --- global keys ------------------------------------------------------------

function onEscape(): void {
  const chip = selectedChip();
  if (chip) {
    caretAfter(chip);
    return;
  }
  if (!el.palette.hidden) {
    togglePalette(false);
  } else if (!el.exportMenu.hidden) {
    closeExportMenu(true);
  } else if (!el.layoutSheet.hidden) {
    toggleLayout(false);
  } else if (!el.helpSheet.hidden) {
    toggleHelp(false);
  } else if (armed) {
    disarmDelete(true);
  } else if (document.activeElement === el.search) {
    if (query) {
      query = '';
      el.search.value = '';
      renderList();
    } else if (tagFilter) {
      setTagFilter(null);
    } else {
      focusList();
    }
  } else if (document.activeElement === el.editor || document.activeElement === el.preview || document.activeElement === el.title) {
    if (ui.sidebarHidden) toggleSidebar();
    focusList();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    onEscape();
    return;
  }
  const chord = chordOf(e);
  if (!isCommandChord(chord)) return;
  const action = CHORDS.get(chord);
  if (!action || action.enabled?.() === false) return;
  e.preventDefault();
  action.run();
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
  renderKeyGroups();
  applySidebar();
  applyLayout();
  applyWriting();
  renderList();
  renderEditor();
  if (selected()) focusEditor();
  else el.search.focus();
  // The tray's New note item, and the settings the main process is acting on.
  window.notesApi.onNewNote(() => newNote());
  try {
    settings = await window.notesApi.getSettings();
  } catch (err) {
    console.error('[notes] could not read settings', err);
  }
  renderSettings();
}

void init();
