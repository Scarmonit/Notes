import { assetNameFromUrl } from '../shared/assets';
import { chordOf, isCommandChord, keyLabel } from '../shared/keys';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import type { CliStatus, ExportKind, ExportRequest, ImportedFile, Note, NotesFile } from '../shared/types';
import { keyMap, matchActions, type Action, type Match } from './actions';
import { toggleFence } from './fences';
import { findMatches, matchFrom, replaceAll, replaceOne, validQuery, type FindMatch, type FindOptions } from './find';
import { isTextFile, noteFromFile } from './importer';
import { decorateLines, isDecorated, type Protected } from './inline';
import { renderMarkdown } from './markdown';
import { headingAt, headingsIn, type Heading } from './outline';
import { cycleTaskLine, toggleTaskAt, toggleTaskLine } from './tasks';
import {
  backlinksOf,
  createNote,
  exportBody,
  linkKey,
  neighborOf,
  noteForLink,
  removeNote,
  searchNotes,
  snippetOf,
  sortByEdited,
  tagMatches,
  tagTree,
  titleOf,
  togglePin,
  updateBody,
  updateTitle,
  wordCount,
  type TagNode,
} from './notes';
import { markdownToText } from './plaintext';
import {
  MIN_IMAGE_WIDTH,
  bodyTokens,
  chipsOf,
  docOf,
  imageChipHtml,
  isChip,
  isLink,
  isRule,
  linkTargetOf,
  lineIndexAt,
  lineIndexIn,
  lineSpans,
  markEmpty,
  moveImageBy,
  moveImageToLine,
  offsetOf,
  paragraphBounds,
  posAt,
  rangeBetween,
  readEditor,
  renderEditor as renderEditorDom,
  makeLink,
  makeRule,
  serializeEditor,
  setChipWidth,
  textBefore,
  textOfRange,
  type LineSpan,
  type Segment,
} from './richeditor';
import stylesText from './styles.css?inline';
import { absoluteTime, relativeTime } from './time';
import type { SnapshotSummary } from '../shared/history';
import type { ExternalChanges, RenderedExport, TrashedNote } from '../shared/types';
// 0.13: templates, scheduled tasks, search operators, math and diagrams, related notes and the graph.
import { dueLabel, dueTasks, type DueTask } from '../core/due';
import { applyFilter, hasOperators, OPERATORS, parseQuery } from '../core/query';
import { graphOf, neighbourhood, relatedNotes, type Graph } from '../core/related';
import { DATE_FORMAT, expandTemplate, formatDate, templatesOf, TIME_FORMAT } from '../core/templates';
import { hasDiagrams, hasMath } from '../shared/markdown-core';
import { renderDiagrams } from './diagrams';
import { layoutGraph, nodeAt, type LaidOut } from './graph';
import './generated/katex.css';
import katexText from './generated/katex.css?inline';

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
  backlinks: $('backlinks'),
  historySheet: $('history-sheet'),
  historyList: $('history-list'),
  historyPreview: $('history-preview'),
  historyRestore: $<HTMLButtonElement>('history-restore'),
  historyNote: $('history-note'),
  imgHandle: $('img-handle'),
  imgSize: $('img-size'),
  dropLine: $('drop-line'),
  empty: $('empty'),
  helpSheet: $('help-sheet'),
  outline: $('outline'),
  outlineShow: $<HTMLInputElement>('outline-show'),
  liveFormat: $<HTMLInputElement>('live-format'),
  findBar: $('find-bar'),
  findInput: $<HTMLInputElement>('find-input'),
  findCount: $('find-count'),
  findCase: $<HTMLButtonElement>('find-case'),
  findRegex: $<HTMLButtonElement>('find-regex'),
  findPrev: $<HTMLButtonElement>('find-prev'),
  findNext: $<HTMLButtonElement>('find-next'),
  findToggleReplace: $<HTMLButtonElement>('find-toggle-replace'),
  findClose: $<HTMLButtonElement>('find-close'),
  findReplaceRow: $('find-replace-row'),
  replaceInput: $<HTMLInputElement>('replace-input'),
  replaceOne: $<HTMLButtonElement>('replace-one'),
  replaceAll: $<HTMLButtonElement>('replace-all'),
  trashSheet: $('trash-sheet'),
  trashList: $('trash-list'),
  trashPreview: $('trash-preview'),
  trashNote: $('trash-note'),
  trashRestore: $<HTMLButtonElement>('trash-restore'),
  trashPurge: $<HTMLButtonElement>('trash-purge'),
  historyTrash: $<HTMLButtonElement>('history-trash'),
  captureHotkeyBtn: $<HTMLButtonElement>('capture-hotkey'),
  captureHotkeyClear: $<HTMLButtonElement>('capture-hotkey-clear'),
  captureHotkeyNote: $('capture-hotkey-note'),
  openFolder: $<HTMLButtonElement>('open-folder'),
  cliText: $<HTMLSpanElement>('cli-text'),
  cliInstall: $<HTMLButtonElement>('cli-install'),
  cliNote: $<HTMLParagraphElement>('cli-note'),
  searchOps: $<HTMLParagraphElement>('search-ops'),
  related: $('related'),
  remindersOn: $<HTMLInputElement>('reminders-on'),
  pickSheet: $('pick-sheet'),
  pickInput: $<HTMLInputElement>('pick-input'),
  pickList: $('pick-list'),
  dueSheet: $('due-sheet'),
  dueList: $('due-list'),
  graphSheet: $('graph-sheet'),
  graphCanvas: $<HTMLCanvasElement>('graph-canvas'),
  graphScope: $<HTMLButtonElement>('graph-scope'),
  graphNote: $('graph-note'),
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
  /** The note's headings in a column beside it. */
  outline: boolean;
  /** Markdown drawn as what it means while it is typed. */
  liveFormat: boolean;
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
    outline: true,
    liveFormat: true,
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

/**
 * The notes the sidebar shows. Plain words go through the search box's own
 * matching, as always; a query with an operator in it — `todo:`,
 * `due:today`, `links:Plan`, `/regex/` — is read by the same grammar the
 * command line uses, so the two never disagree about what a query means.
 */
const visibleNotes = (): Note[] => {
  if (!hasOperators(query)) return searchNotes(sortByEdited(notes), query, tagFilter);
  const filter = parseQuery(query);
  if (tagFilter) filter.tags.push(tagFilter);
  return applyFilter(sortByEdited(notes), filter);
};
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

/**
 * The tag rail, as a tree: #wow/commands sits under #wow, and a tag is only
 * unfolded while it is on the way to the one being filtered by. Choosing a
 * tag both filters by it and reveals what is nested inside it, so the rail
 * never needs a control of its own.
 */
function renderTags(): void {
  const tree = tagTree(notes);
  const known = new Set<string>();
  const gather = (nodes: TagNode[]): void => {
    for (const node of nodes) {
      known.add(node.tag);
      gather(node.children);
    }
  };
  gather(tree);
  if (tagFilter && !known.has(tagFilter)) tagFilter = null;
  el.tags.hidden = tree.length === 0;
  el.tags.replaceChildren();
  drawTags(tree, 0);
}

function drawTags(nodes: TagNode[], depth: number): void {
  for (const node of nodes) {
    const on = node.tag === tagFilter;
    const chip = document.createElement('button');
    chip.className = `tag u${depth > 0 ? ' tag-child' : ''}`;
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(on));
    chip.title = on ? 'Show all notes' : `Only notes tagged #${node.tag}`;
    const name = document.createElement('span');
    // Nested tags read as their own level: #wow, then /commands beneath it.
    name.textContent = depth > 0 ? `/${node.label}` : `#${node.label}`;
    const n = document.createElement('span');
    n.className = 'tag-count';
    n.textContent = String(node.count);
    chip.append(name, n);
    chip.addEventListener('click', () => setTagFilter(on ? null : node.tag));
    el.tags.append(chip);
    // Unfolded while the filter is this tag or something inside it.
    if (node.children.length > 0 && tagFilter && tagMatches(tagFilter, node.tag)) drawTags(node.children, depth + 1);
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
    if (hasOperators(q)) {
      hint.textContent = 'Operators: todo: done: due:today tag: pinned: created:>7d links: sort:title /regex/';
    } else {
      hint.innerHTML = 'Press <kbd>Enter</kbd> to start a note titled ';
      const title = document.createElement('b');
      title.textContent = `“${q}”`;
      hint.append(title);
    }
    msg.append(hint);
  } else {
    msg.textContent = `No notes tagged #${tagFilter ?? ''}.`;
  }
  return msg;
}

function renderList(): void {
  renderTags();
  const vis = visibleNotes();
  // Rebuilding the rows removes the one that has focus, and focus would fall
  // to the body: the list must be redrawn, and then be the list again.
  const hadFocus = el.list.contains(document.activeElement);
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
  if (hadFocus) focusList();
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
    drawEditor(n.body);
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
    liveCodeBlocks();
    // Diagrams are drawn in after the words are on the page; the source
    // block stands in until then, so nothing jumps.
    void renderDiagrams(el.preview).catch((err) => console.error('[notes] diagrams failed', err));
    el.preview.scrollTop = scroll;
  }
  renderBacklinks();
  renderRelated();
  renderOutline();
  syncChipUi();
  syncWriting();
}

/** Puts a body into the editor: the DOM for it, then the live formatting over that. */
function drawEditor(body: string): void {
  renderEditorDom(el.editor, body);
  decorateAll();
}

/**
 * The notes that link here. Drawn when the note changes rather than as it is
 * typed: what points at this note is a fact about the others, and does not
 * move while these words are being written.
 */
function renderBacklinks(): void {
  const n = selected();
  const back = n ? backlinksOf(notes, n.id) : [];
  el.backlinks.hidden = back.length === 0 || el.editorWrap.hidden;
  el.backlinks.replaceChildren();
  if (back.length === 0) return;
  const label = document.createElement('span');
  label.className = 'backlinks-label u';
  label.textContent = 'Linked from';
  el.backlinks.append(label);
  for (const other of back) {
    const chip = document.createElement('button');
    chip.className = 'backlink';
    chip.type = 'button';
    chip.textContent = titleOf(other);
    chip.title = `Go to “${titleOf(other)}”`;
    chip.addEventListener('click', () => {
      select(other.id);
      focusEditor();
    });
    el.backlinks.append(chip);
  }
}

/**
 * Notes near this one that nothing on the page already points at: the
 * ones sharing its tags, and the ones two links away. Under the backlinks,
 * in the same dress, because they answer the same question — what else
 * belongs with this? — from the other direction.
 */
function renderRelated(): void {
  const n = selected();
  const near = n ? relatedNotes(notes, n.id, 8) : [];
  el.related.hidden = near.length === 0 || el.editorWrap.hidden;
  el.related.replaceChildren();
  if (near.length === 0) return;
  const label = document.createElement('span');
  label.className = 'backlinks-label u';
  label.textContent = 'Related';
  el.related.append(label);
  for (const r of near) {
    const chip = document.createElement('button');
    chip.className = 'backlink';
    chip.type = 'button';
    chip.textContent = titleOf(r.note);
    chip.title = r.reasons.join(' · ');
    chip.addEventListener('click', () => {
      select(r.note.id);
      focusEditor();
    });
    el.related.append(chip);
  }
}

/**
 * Follows a [[link]]: to the note whose title it names, or to a new note with
 * that title. Writing the link is how a note gets started, the way it works
 * in every app that has them.
 */
function openLink(target: string): void {
  const name = target.trim();
  if (!name) return;
  const hit = noteForLink(notes, name);
  if (hit) {
    if (query || tagFilter) clearFilters();
    select(hit.id);
    focusEditor();
    return;
  }
  newNote(name);
  showStatus(`Started “${name}”`, 2500);
}

/** A finished [[link]] just before the caret. */
const LINK_JUST_TYPED = /\[\[([^[\]\n]+)\]\]$/;

/**
 * Turns a link into its chip the moment the writer closes it, so a link is
 * something you can follow as soon as you have written it rather than after
 * the note has been opened again.
 */
function convertLinkOnClose(): void {
  const pos = caretPos();
  if (!pos || pos.node.nodeType !== Node.TEXT_NODE) return;
  const before = (pos.node.textContent ?? '').slice(0, pos.offset);
  const m = LINK_JUST_TYPED.exec(before);
  if (!m || !m[1].trim()) return;
  const range = document.createRange();
  range.setStart(pos.node, pos.offset - m[0].length);
  range.setEnd(pos.node, pos.offset);
  range.deleteContents();
  const chip = makeLink(m[1].trim());
  range.insertNode(chip);
  caretAfter(chip);
}

/** Clears the search box and any tag filter, so a note can always be shown. */
function clearFilters(): void {
  query = '';
  el.search.value = '';
  tagFilter = null;
}

/**
 * Each code block in the preview gets a button that copies it. The clipboard
 * is written by the main process: this window is a file:// page, and Electron's
 * own clipboard is the one thing certain to work from one.
 */
function liveCodeBlocks(): void {
  for (const pre of Array.from(el.preview.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains('code-block')) continue;
    // A diagram's source is about to become a picture; no copy button for it.
    if (pre.classList.contains('mermaid') || pre.closest('.diagram')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.replaceWith(wrap);
    wrap.append(pre);
    const copy = document.createElement('button');
    copy.className = 'code-copy u';
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.title = 'Copy this code';
    copy.addEventListener('click', () => void copyCode(pre, copy));
    wrap.append(copy);
  }
}

async function copyCode(pre: HTMLElement, button: HTMLButtonElement): Promise<void> {
  try {
    await window.notesApi.copyText(pre.textContent ?? '');
  } catch (err) {
    console.error('[notes] copy failed', err);
    showStatus('Could not copy that', 3000);
    return;
  }
  button.textContent = 'Copied';
  button.classList.add('copied');
  window.setTimeout(() => {
    button.textContent = 'Copy';
    button.classList.remove('copied');
  }, 1400);
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
  // A collapsed caret at a line boundary — before a newline, beside a <br> —
  // measures zero; the character or node it sits against does not.
  const { startContainer: holder, startOffset: offset } = range;
  const probe = document.createRange();
  if (holder.nodeType === Node.TEXT_NODE) {
    const length = (holder.textContent ?? '').length;
    probe.setStart(holder, Math.max(0, offset - 1));
    probe.setEnd(holder, Math.min(length, Math.max(offset, 1)));
  } else {
    const beside = holder.childNodes[offset - 1] ?? holder.childNodes[offset];
    if (beside) probe.selectNode(beside);
    else probe.selectNodeContents(holder);
  }
  const near = probe.getBoundingClientRect();
  if (near.height > 0) return near;
  // A collapsed caret on an empty line measures zero; the line it sits on does not.
  const line = holder instanceof Element ? holder : holder.parentElement;
  const fallback = line?.getBoundingClientRect();
  return fallback && fallback.height > 0 ? fallback : null;
}

/** Scrolls the editor so a rect — the caret's, a line's — is on screen, when a re-render has left it off. */
function scrollEditorTo(rect: DOMRect | null): void {
  if (!rect) return;
  const box = el.editor.getBoundingClientRect();
  if (rect.top < box.top || rect.bottom > box.bottom) el.editor.scrollTop += rect.top - (box.top + box.height / 2);
}

function keepCaretInView(): void {
  scrollEditorTo(caretRect());
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
    applyCaretLine();
  });
}

/**
 * What follows the caret from line to line: the outline's current heading,
 * and the markers revealed on the line being written. One DOM walk serves
 * both, and none happens while neither is wanted.
 */
function applyCaretLine(): void {
  const off = ui.preview || el.editorWrap.hidden;
  const wantMarks = !off && ui.liveFormat;
  const wantOutline = !off && !el.outline.hidden;
  if (!wantMarks && !wantOutline) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    if (wantMarks) revealMarks(null, -1, -1);
    return;
  }
  const range = sel.getRangeAt(0);
  const { lines } = readEditor(el.editor);
  const a = lineIndexIn(lines, { node: range.startContainer, offset: range.startOffset });
  const b = range.collapsed ? a : lineIndexIn(lines, { node: range.endContainer, offset: range.endOffset });
  if (wantMarks) revealMarks(lines, Math.min(a, b), Math.max(a, b));
  if (wantOutline) markOutlineAt(Math.min(a, b));
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
  if (ui.selectedId !== id) {
    disarmDelete();
    // The history sheet and the find bar are about one note; they do not
    // follow you to another.
    if (!el.historySheet.hidden) toggleHistory(false);
    if (!el.findBar.hidden) closeFind(false);
    // A command waiting on `notes open --wait` learns the note left the screen.
    if (ui.selectedId) window.notesApi.noteClosed(ui.selectedId);
  }
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
  clearFilters();
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
  const title = titleOf(n);
  notes = removeNote(notes, n.id);
  editLogs.delete(n.id);
  scheduleSave();
  disarmDelete();
  select(next);
  if (next) focusList();
  else el.search.focus();
  showStatus(`Deleted “${title}” · in Deleted notes for a month`, 4000);
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
  range.selectNodeContents(docOf(el.editor));
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
  // execCommand keeps the caret working inside contenteditable.
  markEdit();
  document.execCommand('insertHTML', false, imageChipHtml(name, alt));
  // A programmatic insert may not raise 'input' on every build, so store now.
  commitEditor();
}

/** Reads the editor back into the model and refreshes anything derived from it. */
function commitEditor(): void {
  const n = selected();
  if (!n || editorNoteId !== n.id) return;
  notes = updateBody(notes, n.id, serializeEditor(el.editor));
  // Whatever was taken before an edit is now behind the model, not ahead of it.
  pendingEdit = null;
  markEmpty(el.editor);
  scheduleSave();
  renderList();
  renderMeta();
  renderOutline();
  if (!el.findBar.hidden) refreshFind();
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
  clearFilters();
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
  rememberNow('resize');
  commitEditor();
  selectChip(chip);
}
el.imgHandle.addEventListener('pointerup', endResize);
el.imgHandle.addEventListener('pointercancel', endResize);

el.editor.addEventListener('click', (e) => {
  if (isLink(e.target)) {
    e.preventDefault();
    openLink(linkTargetOf(e.target));
    return;
  }
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
  // would be lost and the next words would end up glued to the dashes. No
  // input event comes of that, so the step is remembered here by hand.
  rememberNow('command');
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
  // The dashes go straight out of the DOM rather than through a delete
  // command, whose input event would log a step of its own: the whole swap
  // is one edit, and insertDivider remembers it from the model, which still
  // holds the dashes.
  const range = document.createRange();
  range.setStart(pos.node, pos.offset - line.length);
  range.setEnd(pos.node, pos.offset);
  range.deleteContents();
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  insertDivider();
  return true;
}

// --- checklists -------------------------------------------------------------

/** Replaces the body of the open note and puts the editor back in step with it. Undoable. */
function setBody(body: string): void {
  const n = selected();
  if (!n || n.body === body) return;
  rememberEdit({ text: n.body, caret: caretOffsetOrStart() }, 'command');
  applyBody(body);
}

/** The same, without remembering: for undo and redo themselves. */
function applyBody(body: string): void {
  const n = selected();
  if (!n || n.body === body) return;
  notes = updateBody(notes, n.id, body);
  scheduleSave();
  // The editor only re-renders on a note switch, so tell it this counts as one.
  editorNoteId = null;
  renderList();
  renderEditor();
}

// --- undo -------------------------------------------------------------------

/**
 * Undo and redo are kept here, per note, as the text and the caret before
 * each edit. The browser has an undo history of its own, but it is a log of
 * DOM changes, and the live formatting changes the DOM without the text
 * changing; that history would replay redraws as if they were typing. Text
 * is what the note is, so text is what is remembered. Putting a state back
 * is a plain re-render, the way every other rewrite of the body is done.
 */
interface EditState {
  text: string;
  caret: number;
}

interface EditLog {
  undo: EditState[];
  redo: EditState[];
  /** When and of what kind the last edit was, so a run of typing is one step. */
  lastAt: number;
  lastKind: string;
}

const UNDO_LIMIT = 300;
/** Keystrokes closer together than this, of the same kind, are one step to undo. */
const UNDO_RUN_MS = 800;
const RUN_KINDS = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward', 'insertCompositionText']);

const editLogs = new Map<string, EditLog>();
/** The state before the edit the browser is about to make, taken at beforeinput. */
let pendingEdit: EditState | null = null;

function editLogFor(id: string): EditLog {
  let log = editLogs.get(id);
  if (!log) {
    log = { undo: [], redo: [], lastAt: 0, lastKind: '' };
    editLogs.set(id, log);
  }
  return log;
}

/** Where the selection starts, as an offset into the text; 0 when it is elsewhere. */
function caretOffsetOrStart(): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.editor.contains(range.startContainer)) return 0;
  return offsetOf(el.editor, { node: range.startContainer, offset: range.startOffset });
}

/**
 * Takes the state before an edit the app is about to make itself through an
 * editing command, which raises no beforeinput of its own.
 */
function markEdit(): void {
  const n = selected();
  if (n && editorNoteId === n.id) pendingEdit = { text: n.body, caret: caretOffsetOrStart() };
}

/**
 * Remembers the state before an edit the app makes straight into the DOM,
 * which raises no input event at all: the model still holds the text as it
 * was, so it is taken from there, before the change is committed.
 */
function rememberNow(kind: string): void {
  const n = selected();
  if (n && editorNoteId === n.id) rememberEdit({ text: n.body, caret: caretOffsetOrStart() }, kind);
}

/** Keeps the state before an edit of `kind`, folding a run of typing into one step. */
function rememberEdit(before: EditState, kind: string): void {
  const n = selected();
  if (!n) return;
  const log = editLogFor(n.id);
  const now = Date.now();
  const sameRun = RUN_KINDS.has(kind) && kind === log.lastKind && now - log.lastAt < UNDO_RUN_MS && log.undo.length > 0;
  if (!sameRun) {
    log.undo.push(before);
    if (log.undo.length > UNDO_LIMIT) log.undo.shift();
  }
  log.lastAt = now;
  log.lastKind = kind;
  log.redo = [];
}

function restoreEdit(state: EditState): void {
  applyBody(state.text);
  el.editor.focus();
  const { segments } = readEditor(el.editor);
  const pos = posAt(segments, state.caret);
  if (pos) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.collapse(true);
    sel?.addRange(range);
    keepCaretInView();
  }
  syncWriting();
}

function undoEdit(): void {
  const n = selected();
  if (!n) return;
  const log = editLogFor(n.id);
  const before = log.undo.pop();
  if (!before) return;
  log.redo.push({ text: n.body, caret: caretOffsetOrStart() });
  log.lastKind = '';
  restoreEdit(before);
}

function redoEdit(): void {
  const n = selected();
  if (!n) return;
  const log = editLogFor(n.id);
  const after = log.redo.pop();
  if (!after) return;
  log.undo.push({ text: n.body, caret: caretOffsetOrStart() });
  log.lastKind = '';
  restoreEdit(after);
}

// Links in the preview are the same links, and go to the same place.
el.preview.addEventListener('click', (e) => {
  if (isLink(e.target)) {
    e.preventDefault();
    openLink(linkTargetOf(e.target));
  }
});

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

// --- code blocks ------------------------------------------------------------

/** The lines the selection covers, or the paragraph the caret is in. */
function selectedLines(lines: LineSpan[], text: string): { first: number; last: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.editor.contains(range.commonAncestorContainer)) return null;
  if (sel.isCollapsed) {
    return paragraphBounds(text.split('\n'), lineIndexIn(lines, { node: range.startContainer, offset: range.startOffset }));
  }
  const first = lineIndexIn(lines, { node: range.startContainer, offset: range.startOffset });
  const last = lineIndexIn(lines, { node: range.endContainer, offset: range.endOffset });
  return { first: Math.min(first, last), last: Math.max(first, last) };
}

/**
 * Fences the selection, or the paragraph the caret is in, as a code block —
 * and takes the fence away again when it is already there. Inside a fence
 * nothing is reflowed, which is what a wall of commands lined up by hand
 * needs to stay readable.
 */
function toggleCodeBlock(): void {
  ensureEditable();
  const { text, lines } = readEditor(el.editor);
  const range = selectedLines(lines, text);
  if (!range) return;
  const next = toggleFence(text, range.first, range.last);
  if (next.body === text) return;
  setBody(next.body);
  caretToLineEnd(next.line);
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
  // The re-render put the editor back at the top; the line is wherever it is.
  // The line's own box is the surer measure: a caret at its end sits on a
  // boundary, which can measure as nothing at all.
  const lineRect = rangeOver(span, span).getBoundingClientRect();
  scrollEditorTo(lineRect.height > 0 ? lineRect : caretRect());
  syncWriting();
}

// Double-click puts an image back at its natural size.
el.editor.addEventListener('dblclick', (e) => {
  if (!isChip(e.target)) return;
  e.preventDefault();
  rememberNow('resize');
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
  rememberNow('move');
  drawEditor(moved.body);
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

/**
 * The note as the preview shows it, ready to be laid on a page: math
 * rendered, diagrams drawn (in the theme the page will have), and the
 * stylesheets the page needs. The PNG, the PDF and the HTML export all
 * start from this, as does `notes render --html` through the window.
 */
async function renderedExport(n: Note, look: 'ink' | 'paper' = 'ink'): Promise<RenderedExport> {
  const body = exportBody(n);
  let html = renderMarkdown(body);
  if (hasDiagrams(html)) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    await renderDiagrams(holder, look === 'paper' ? 'neutral' : 'dark');
    html = holder.innerHTML;
  }
  return { title: titleOf(n), html, css: stylesText, mathCss: hasMath(html) ? katexText : undefined, edited: `Edited ${absoluteTime(n.updatedAt)}` };
}

async function runExport(kind: ExportKind): Promise<void> {
  const n = selected();
  if (!n) return;
  closeExportMenu(false);
  focusEditor();
  const title = titleOf(n);
  const body = exportBody(n);
  showStatus('Exporting…', 0);
  let request: ExportRequest;
  if (kind === 'md') request = { kind, title, body };
  else if (kind === 'txt') request = { kind, title, text: markdownToText(body) };
  else request = { kind, ...(await renderedExport(n, kind === 'pdf' ? 'paper' : 'ink')) };

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
      const kind = ({ m: 'md', t: 'txt', p: 'png', h: 'html', d: 'pdf' } as Record<string, ExportKind>)[e.key.toLowerCase()];
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

/** True between compositionstart and compositionend: an IME owns the text then. */
let composing = false;
el.editor.addEventListener('compositionstart', () => {
  composing = true;
});
el.editor.addEventListener('compositionend', () => {
  composing = false;
  decorateAfterInput();
});

el.editor.addEventListener('input', (e) => {
  const kind = e instanceof InputEvent ? e.inputType : '';
  // Closing a link is the moment it becomes one, the way --- becomes a rule
  // on Enter. Anything else typed leaves the text exactly as it was typed.
  if (e instanceof InputEvent && e.data === ']') convertLinkOnClose();
  // An edit that gave no warning — a script-driven command, a drop — is
  // remembered from the model, which still holds the text before it.
  const n = selected();
  if (n && editorNoteId === n.id) rememberEdit(pendingEdit ?? { text: n.body, caret: caretOffsetOrStart() }, kind);
  pendingEdit = null;
  commitEditor();
  if (!composing) decorateAfterInput();
  syncWriting();
});

// What leaves the editor is markdown, whatever the browser would have made
// of the formatting spans — and with the markers on other lines hidden,
// the browser's own copy would leave them out.
function selectionRangeInEditor(): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  return el.editor.contains(range.commonAncestorContainer) ? range : null;
}
el.editor.addEventListener('copy', (e) => {
  const range = selectionRangeInEditor();
  if (!range || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', textOfRange(range));
});
el.editor.addEventListener('cut', (e) => {
  const range = selectionRangeInEditor();
  if (!range || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', textOfRange(range));
  document.execCommand('delete');
});
// What comes in is text: pasted HTML would bring its own tags, which the
// serializer would drop and the formatting would then fight.
el.editor.addEventListener('paste', (e) => {
  if (!e.clipboardData || e.clipboardData.files.length > 0) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  markEdit();
  document.execCommand('insertText', false, text.replace(/\r\n/g, '\n'));
});

// Enter inserts a plain line break rather than a new paragraph block, so the
// content stays a flat run of text, breaks and image chips.
el.editor.addEventListener('beforeinput', (e) => {
  // Undo and redo are the app's own, kept as text: the browser's would try to
  // undo the formatting's redraws along with the typing and lose its way.
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    e.preventDefault();
    if (e.inputType === 'historyUndo') undoEdit();
    else redoEdit();
    return;
  }
  // What the note looked like before this edit, kept if the edit goes through.
  const n = selected();
  if (n && editorNoteId === n.id) pendingEdit = { text: n.body, caret: caretOffsetOrStart() };
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
          rememberNow('outdent');
          (node as Text).deleteData(offset - remove, remove);
          commitEditor();
        }
      }
    } else {
      markEdit();
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
    range.selectNodeContents(docOf(el.editor));
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
  if (open) {
    el.textW.focus();
    void refreshCliRow();
  } else focusEditor();
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
el.outlineShow.addEventListener('change', () => {
  if (el.outlineShow.checked !== ui.outline) toggleOutline();
});
el.liveFormat.addEventListener('change', () => {
  if (el.liveFormat.checked !== ui.liveFormat) toggleLiveFormat();
});
el.layoutBtn.addEventListener('click', () => toggleLayout(true));
el.layoutSheet.addEventListener('click', (e) => {
  if (e.target === el.layoutSheet) toggleLayout(false);
});

// --- version history --------------------------------------------------------

/** The versions listed in the open sheet, newest first. */
let versions: SnapshotSummary[] = [];
/** Which of them is being previewed, by the moment it was taken. */
let versionAt: number | null = null;

function toggleHistory(force?: boolean): void {
  const open = force ?? el.historySheet.hidden;
  if (open && !selected()) return;
  el.historySheet.hidden = !open;
  if (!open) {
    focusEditor();
    return;
  }
  el.historySheet.querySelector<HTMLElement>('.sheet-card')?.focus();
  void loadHistory();
}

async function loadHistory(): Promise<void> {
  const n = selected();
  if (!n) return;
  versions = [];
  versionAt = null;
  el.historyList.replaceChildren();
  el.historyPreview.textContent = '';
  el.historyNote.textContent = 'Reading…';
  el.historyRestore.disabled = true;
  try {
    versions = await window.notesApi.historyList(n.id);
  } catch (err) {
    console.error('[notes] could not read the history', err);
    el.historyNote.textContent = 'Could not read the history of this note.';
    return;
  }
  drawHistory();
  if (versions.length > 0) void showVersion(versions[0].at);
}

function drawHistory(): void {
  el.historyList.replaceChildren();
  if (versions.length === 0) {
    const none = document.createElement('div');
    none.className = 'history-none u';
    none.textContent = 'No earlier versions of this note yet.';
    el.historyList.append(none);
    el.historyNote.textContent = 'Versions are kept as you write, at most one every few minutes, for a week.';
    return;
  }
  const now = Date.now();
  for (const version of versions) {
    const row = document.createElement('button');
    row.className = `history-row${version.at === versionAt ? ' at' : ''}`;
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(version.at === versionAt));
    const when = document.createElement('span');
    when.className = 'history-when u';
    when.textContent = relativeTime(version.at, now);
    when.title = absoluteTime(version.at);
    const what = document.createElement('span');
    what.className = 'history-what';
    what.textContent = version.preview || 'Empty';
    row.append(when, what);
    row.addEventListener('click', () => void showVersion(version.at));
    el.historyList.append(row);
  }
}

async function showVersion(at: number): Promise<void> {
  const n = selected();
  if (!n) return;
  versionAt = at;
  drawHistory();
  el.historyRestore.disabled = true;
  const snap = await window.notesApi.historyGet(n.id, at).catch(() => null);
  // The sheet may have moved on while this was being read.
  if (!snap || versionAt !== at) return;
  el.historyPreview.textContent = snap.body || '(empty)';
  el.historyNote.textContent = `${absoluteTime(at)} · ${snap.body.length} characters`;
  el.historyRestore.disabled = false;
}

async function restoreVersion(): Promise<void> {
  const n = selected();
  if (!n || versionAt === null) return;
  const at = versionAt;
  const snap = await window.notesApi.historyGet(n.id, at).catch(() => null);
  if (!snap) {
    showStatus('That version could not be read', 3000);
    return;
  }
  // Keep what is there now first, so going back is itself something to go back from.
  await window.notesApi.historyKeep(n).catch((err) => console.error('[notes] could not keep the current version', err));
  if ((snap.title ?? '') !== (n.title ?? '')) {
    notes = updateTitle(notes, n.id, snap.title ?? '');
    el.title.value = snap.title ?? '';
  }
  setBody(snap.body);
  scheduleSave();
  renderList();
  renderEditor();
  toggleHistory(false);
  showStatus(`Restored the version from ${relativeTime(at)}`, 3500);
}

el.historyRestore.addEventListener('click', () => void restoreVersion());
el.historySheet.addEventListener('click', (e) => {
  if (e.target === el.historySheet) toggleHistory(false);
});

// --- tray and the summon hotkey ---------------------------------------------

/** One of the two system-wide chords, with the row of the sheet that records it. */
interface HotkeyRow {
  key: 'hotkey' | 'captureHotkey';
  failed: 'hotkeyFailed' | 'captureHotkeyFailed';
  btn: HTMLButtonElement;
  clear: HTMLButtonElement;
  note: HTMLElement;
  /** True while the button is listening for the chord to record. */
  recording: boolean;
}

const hotkeyRows: HotkeyRow[] = [
  { key: 'hotkey', failed: 'hotkeyFailed', btn: el.hotkeyBtn, clear: el.hotkeyClear, note: el.hotkeyNote, recording: false },
  { key: 'captureHotkey', failed: 'captureHotkeyFailed', btn: el.captureHotkeyBtn, clear: el.captureHotkeyClear, note: el.captureHotkeyNote, recording: false },
];

function renderSettings(notes: Partial<Record<HotkeyRow['key'], string>> = {}): void {
  el.closeTray.checked = settings.closeToTray;
  el.remindersOn.checked = settings.reminders;
  for (const row of hotkeyRows) {
    const chord = settings[row.key];
    row.btn.classList.toggle('recording', row.recording);
    row.btn.replaceChildren();
    if (row.recording) {
      row.btn.append('Press a combination…');
    } else if (chord) {
      for (const part of keyLabel(chord)) {
        const k = document.createElement('kbd');
        k.textContent = part;
        row.btn.append(k);
      }
    } else {
      row.btn.append('None');
    }
    row.clear.hidden = !chord || row.recording;
    row.note.textContent = notes[row.key] ?? '';
  }
}

/** Hands the settings to the main process, which is the one that acts on them. */
async function saveSettings(next: Settings): Promise<void> {
  const previous = settings;
  settings = next;
  renderSettings();
  try {
    const stored = await window.notesApi.setSettings(next);
    settings = { closeToTray: stored.closeToTray, hotkey: stored.hotkey, captureHotkey: stored.captureHotkey, reminders: stored.reminders };
    const notes: Partial<Record<HotkeyRow['key'], string>> = {};
    for (const row of hotkeyRows) if (stored[row.failed]) notes[row.key] = 'Another program already uses that combination.';
    renderSettings(notes);
  } catch (err) {
    console.error('[notes] could not save settings', err);
    settings = previous;
    renderSettings({ hotkey: 'Could not save that setting.' });
  }
}

el.closeTray.addEventListener('change', () => {
  void saveSettings({ ...settings, closeToTray: el.closeTray.checked });
});
el.remindersOn.addEventListener('change', () => {
  void saveSettings({ ...settings, reminders: el.remindersOn.checked });
});

for (const row of hotkeyRows) {
  const stop = (): void => {
    if (!row.recording) return;
    row.recording = false;
    renderSettings();
  };
  row.btn.addEventListener('click', () => {
    row.recording = !row.recording;
    renderSettings(row.recording ? { [row.key]: 'Esc cancels, Backspace clears.' } : {});
  });
  // The chord is read here, before the app's own keyboard map sees it, so
  // recording Ctrl+Shift+P does not also pin the note.
  row.btn.addEventListener('keydown', (e) => {
    if (!row.recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stop();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      row.recording = false;
      void saveSettings({ ...settings, [row.key]: null });
      return;
    }
    const chord = chordOf(e);
    if (!chord) return;
    if (!isCommandChord(chord)) {
      renderSettings({ [row.key]: 'Hold Ctrl or Alt as part of the combination.' });
      return;
    }
    row.recording = false;
    void saveSettings({ ...settings, [row.key]: chord });
  });
  row.btn.addEventListener('blur', stop);
  row.clear.addEventListener('click', () => void saveSettings({ ...settings, [row.key]: null }));
}

el.openFolder.addEventListener('click', () => {
  void window.notesApi.openNotesFolder().catch((err) => console.error('[notes] could not open the folder', err));
});

// The command line can change the settings while the sheet is not looking.
window.notesApi.onSettingsChanged((next) => {
  settings = next;
  renderSettings();
});

// --- the `notes` command's launcher, from the Layout sheet -------------------

function renderCliRow(status: CliStatus): void {
  el.cliInstall.hidden = !status.available;
  if (!status.available) {
    el.cliNote.textContent = 'Available in the installed app.';
    return;
  }
  el.cliInstall.textContent = status.installed && status.onPath ? 'Remove' : 'Install';
  el.cliNote.textContent =
    status.installed && status.onPath
      ? `Installed: ${status.binDir}${status.current ? '' : ' (pointing at an older version; Install again to refresh)'}. Open a new terminal and type notes --help.`
      : status.installed
        ? `The launcher is in ${status.binDir} but not on your PATH.`
        : '';
}

async function refreshCliRow(): Promise<void> {
  try {
    renderCliRow(await window.notesApi.cliStatus());
  } catch (err) {
    console.error('[notes] could not read the command-line status', err);
  }
}

el.cliInstall.addEventListener('click', () => {
  void (async () => {
    el.cliInstall.disabled = true;
    try {
      const status = await window.notesApi.cliStatus();
      const removing = status.installed && status.onPath;
      renderCliRow(removing ? await window.notesApi.cliUninstall() : await window.notesApi.cliInstall());
      showStatus(removing ? 'Removed the notes command' : 'Installed the notes command', 3000);
    } catch (err) {
      console.error('[notes] could not change the command-line launcher', err);
      el.cliNote.textContent = 'That did not work; try `notes cli install` from a terminal.';
    } finally {
      el.cliInstall.disabled = false;
    }
  })();
});

// --- search -----------------------------------------------------------------

/**
 * A line under the box while an operator is being typed: the operators,
 * or what the one just typed could not read. Plain words get nothing —
 * the line is help for the grammar, not a banner over every search.
 */
function renderSearchOps(): void {
  const focused = document.activeElement === el.search;
  const q = query.trim();
  const typingOne = /(^|\s)-?[a-z]+:\S*$/i.test(q) || /(^|\s)\/[^/]*$/.test(q);
  if (!focused || (!typingOne && !hasOperators(q))) {
    el.searchOps.hidden = true;
    return;
  }
  const { errors } = parseQuery(q);
  el.searchOps.hidden = false;
  el.searchOps.classList.toggle('is-error', errors.length > 0);
  el.searchOps.replaceChildren();
  if (errors.length > 0) {
    el.searchOps.textContent = errors[0];
    return;
  }
  OPERATORS.forEach((o, i) => {
    const b = document.createElement('b');
    b.textContent = o.op;
    b.title = o.means;
    if (i > 0) el.searchOps.append(' ');
    el.searchOps.append(b);
  });
}

el.search.addEventListener('focus', renderSearchOps);
el.search.addEventListener('blur', renderSearchOps);

el.search.addEventListener('input', () => {
  query = el.search.value;
  renderSearchOps();
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

// --- outline ----------------------------------------------------------------

/** The headings drawn in the outline, so an unchanged note is not redrawn while typing. */
let outlineKey = '';
let outlineHeadings: Heading[] = [];

/**
 * The note's headings, beside it. Only there when there are at least two:
 * one heading is a title, and a column for it would be a column for nothing.
 */
function renderOutline(): void {
  const n = selected();
  const headings = n && ui.outline ? headingsIn(n.body) : [];
  const show = headings.length >= 2 && !el.editorWrap.hidden;
  const key = show ? headings.map((h) => `${h.level}:${h.line}:${h.text}`).join('\n') : '';
  el.outline.hidden = !show;
  el.outline.closest('.page')?.classList.toggle('has-outline', show);
  if (key === outlineKey) return;
  outlineKey = key;
  outlineHeadings = headings;
  el.outline.replaceChildren();
  if (!show) return;
  const label = document.createElement('span');
  label.className = 'outline-label u';
  label.textContent = 'Outline';
  el.outline.append(label);
  headings.forEach((h, i) => {
    const row = document.createElement('button');
    row.className = `outline-item l${h.level}`;
    row.type = 'button';
    row.dataset.index = String(i);
    row.textContent = h.text;
    row.title = h.text;
    row.addEventListener('click', () => jumpToHeading(i));
    el.outline.append(row);
  });
}

/** Lights the heading the caret's line falls under. */
function markOutlineAt(line: number): void {
  const at = headingAt(outlineHeadings, line);
  el.outline.querySelectorAll<HTMLElement>('.outline-item').forEach((row, i) => row.classList.toggle('at', i === at));
}

/** Where a line of the editor should scroll to sit: a little below the top. */
const JUMP_AT = 0.18;

function jumpToHeading(index: number): void {
  const h = outlineHeadings[index];
  if (!h) return;
  if (ui.preview) {
    // The nth heading of ours is the nth heading marked rendered, except
    // where marked found one we do not look for; matching the words is safer.
    const found = Array.from(el.preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(
      (e) => (e.textContent ?? '').trim() === h.text,
    );
    found?.scrollIntoView({ block: 'start' });
    el.preview.focus();
    return;
  }
  caretToLineEnd(h.line);
  const rect = caretRect();
  if (rect) {
    const box = el.editor.getBoundingClientRect();
    el.editor.scrollTop += rect.top - (box.top + box.height * JUMP_AT);
  }
}

function toggleOutline(): void {
  ui.outline = !ui.outline;
  saveUi();
  el.outlineShow.checked = ui.outline;
  renderOutline();
  syncWriting();
  showStatus(ui.outline ? 'Outline on' : 'Outline off', 1500);
}

// --- find and replace -------------------------------------------------------

/** The names the match highlights are registered under; matched by ::highlight() in the CSS. */
const FIND_ALL = 'note-find';
const FIND_AT = 'note-find-at';

const findOpts: FindOptions = { caseSensitive: false, regex: false };
let findHits: FindMatch[] = [];
/** Which match is the current one, or -1. */
let findAt = -1;

/** Shows the bar, with the replace row when asked, and puts the caret in the field. */
function openFind(withReplace: boolean): void {
  if (!selected()) {
    // Nothing to search in: the search box is the nearest thing that helps.
    if (ui.sidebarHidden) toggleSidebar();
    el.search.focus();
    el.search.select();
    return;
  }
  if (ui.preview) {
    ui.preview = false;
    saveUi();
    renderEditor();
  }
  // Selected words become the query, the way every editor does it.
  const range = selectionRangeInEditor();
  const picked = range ? textOfRange(range) : '';
  if (picked && !picked.includes('\n')) el.findInput.value = picked;
  el.findBar.hidden = false;
  setReplaceRow(withReplace || !el.findReplaceRow.hidden);
  refreshFind();
  const field = withReplace && el.findInput.value ? el.replaceInput : el.findInput;
  field.focus();
  field.select();
}

function setReplaceRow(show: boolean): void {
  el.findReplaceRow.hidden = !show;
  el.findToggleReplace.setAttribute('aria-expanded', String(show));
}

/** Closes the bar. With `land`, the caret goes to the current match, so Esc means "take me there". */
function closeFind(land: boolean): void {
  if (el.findBar.hidden) return;
  el.findBar.hidden = true;
  const hit = findHits[findAt];
  findHits = [];
  findAt = -1;
  paintFind();
  el.editor.focus();
  if (land && hit) {
    const { segments } = readEditor(el.editor);
    const range = rangeBetween(el.editor, segments, hit.start, hit.end);
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }
  syncWriting();
}

/** Re-runs the search on the note as it now stands, keeping the current match where it can. */
function refreshFind(): void {
  const n = selected();
  const query = el.findInput.value;
  const previous = findHits[findAt]?.start ?? -1;
  findHits = n ? findMatches(n.body, query, findOpts) : [];
  el.findInput.classList.toggle('no-match', query !== '' && (findHits.length === 0 || !validQuery(query, findOpts)));
  if (findHits.length === 0) findAt = -1;
  else if (previous >= 0) findAt = matchFrom(findHits, previous);
  else findAt = matchFrom(findHits, caretOffset());
  paintFind();
}

/** How far into the note the caret is, or 0 when it is elsewhere. */
function caretOffset(): number {
  const pos = caretPos();
  return pos ? offsetOf(el.editor, pos) : 0;
}

/** Paints every match, the current one apart, and says how many there are. */
function paintFind(): void {
  const reg = highlights();
  if (findHits.length === 0 || el.findBar.hidden) {
    reg?.delete(FIND_ALL);
    reg?.delete(FIND_AT);
    el.findCount.textContent = el.findBar.hidden || !el.findInput.value ? '' : 'No matches';
    return;
  }
  const { segments } = readEditor(el.editor);
  const others: Range[] = [];
  let current: Range | null = null;
  findHits.forEach((hit, i) => {
    const range = rangeBetween(el.editor, segments, hit.start, hit.end);
    if (!range) return;
    if (i === findAt) current = range;
    else others.push(range);
  });
  if (reg) {
    if (others.length > 0) reg.set(FIND_ALL, new Highlight(...others));
    else reg.delete(FIND_ALL);
    if (current) {
      const at = new Highlight(current);
      at.priority = 2;
      reg.set(FIND_AT, at);
    } else reg.delete(FIND_AT);
  }
  el.findCount.textContent = `${findAt + 1} of ${findHits.length}`;
  if (current) scrollRangeIntoView(current);
}

function scrollRangeIntoView(range: Range): void {
  const rect = range.getBoundingClientRect();
  const box = el.editor.getBoundingClientRect();
  if (rect.height === 0) return;
  if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) {
    el.editor.scrollTop += rect.top - (box.top + box.height * 0.35);
  }
}

function stepFind(delta: 1 | -1): void {
  if (findHits.length === 0) return;
  findAt = (findAt + delta + findHits.length) % findHits.length;
  paintFind();
}

/** Replaces the current match, then moves on to the next. */
function replaceCurrent(): void {
  const n = selected();
  const hit = findHits[findAt];
  if (!n || !hit) return;
  const query = el.findInput.value;
  const next = replaceOne(n.body, hit, query, el.replaceInput.value, findOpts);
  const resume = hit.start;
  setBody(next);
  findHits = findMatches(next, query, findOpts);
  findAt = matchFrom(findHits, resume + 1);
  // The match just replaced may have been the last; wrap to the first.
  if (findAt < 0 && findHits.length > 0) findAt = 0;
  paintFind();
}

function replaceEvery(): void {
  const n = selected();
  if (!n) return;
  const { text, count } = replaceAll(n.body, el.findInput.value, el.replaceInput.value, findOpts);
  if (count === 0) return;
  setBody(text);
  refreshFind();
  showStatus(`Replaced ${count} ${count === 1 ? 'match' : 'matches'}`, 2500);
}

el.findInput.addEventListener('input', refreshFind);
el.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  }
});
el.replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) replaceEvery();
    else replaceCurrent();
  }
});
// Esc inside the bar closes it before the window's own Esc chain runs.
el.findBar.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeFind(true);
  }
});
el.findPrev.addEventListener('click', () => stepFind(-1));
el.findNext.addEventListener('click', () => stepFind(1));
el.findClose.addEventListener('click', () => closeFind(false));
el.findToggleReplace.addEventListener('click', () => {
  setReplaceRow(el.findReplaceRow.hidden);
  if (!el.findReplaceRow.hidden) el.replaceInput.focus();
});
el.replaceOne.addEventListener('click', replaceCurrent);
el.replaceAll.addEventListener('click', replaceEvery);
for (const [btn, key] of [
  [el.findCase, 'caseSensitive'],
  [el.findRegex, 'regex'],
] as const) {
  btn.addEventListener('click', () => {
    findOpts[key] = !findOpts[key];
    btn.setAttribute('aria-pressed', String(findOpts[key]));
    refreshFind();
    el.findInput.focus();
  });
}

// --- live formatting --------------------------------------------------------

/** The HTML each line was last drawn from, by line, so unchanged lines are not touched. */
let drawn: string[] = [];

/**
 * Where the chips sit on each line of a body, for the decorator to leave
 * alone. Only tokens the editor actually holds as chips count: a rule typed
 * as three dashes, or a link or image token pasted as text, is still text in
 * the DOM, and a placeholder for it would have no chip to swap back in — the
 * redraw would drop the characters. Those stay text until something makes
 * them chips, the way --- becomes a rule on Enter.
 */
function chipSpansByLine(text: string, lines: string[], segments: Segment[]): Protected[][] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const chips = new Set(segments.filter((s) => s.kind === 'block').map((s) => `${s.at}:${s.length}`));
  const out: Protected[][] = lines.map(() => []);
  for (const tok of bodyTokens(text)) {
    if (!chips.has(`${tok.start}:${tok.end - tok.start}`)) continue;
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= tok.start) line++;
    out[line].push({ start: tok.start - starts[line], end: tok.end - starts[line] });
  }
  return out;
}

const CHIP_SELECTOR = '.inline-img, .inline-rule, .inline-link';

/** The chip elements a range of the editor holds, in order. */
function chipsInRange(range: Range): Element[] {
  return Array.from(el.editor.querySelectorAll(CHIP_SELECTOR)).filter((c) => range.intersectsNode(c));
}

function rangeOverLines(from: LineSpan, to: LineSpan): Range {
  const range = document.createRange();
  range.setStart(from.start.node, from.start.offset);
  range.setEnd(to.end.node, to.end.offset);
  return range;
}

/**
 * A line's DOM as the HTML the decorator would have to produce to match it:
 * chips as placeholders, the one entity the browser writes that the decorator
 * does not, and no empty wrappers, so a line that already reads right is
 * left alone.
 */
function currentLineHtml(range: Range): string {
  const frag = range.cloneContents();
  for (const chip of Array.from(frag.querySelectorAll(CHIP_SELECTOR))) chip.replaceWith(document.createComment('chip'));
  for (const empty of Array.from(frag.querySelectorAll('[class^="md-"]'))) {
    if (!empty.textContent && !empty.querySelector(CHIP_SELECTOR) && !empty.querySelector('br')) empty.remove();
  }
  const holder = document.createElement('div');
  holder.append(frag);
  return holder.innerHTML.replace(/&nbsp;/g, ' ');
}

/** True when a DOM position sits inside one of the formatting wrappers. */
function insideWrapper(pos: { node: Node; offset: number }): boolean {
  const base = docOf(el.editor);
  let node: Node | null = pos.node.nodeType === Node.TEXT_NODE ? pos.node.parentNode : pos.node;
  while (node && node !== base && node !== el.editor) {
    if (node instanceof HTMLElement && Array.from(node.classList).some((c) => c.startsWith('md-'))) return true;
    node = node.parentNode;
  }
  return false;
}

/**
 * Redraws a run of lines from their HTML, straight into the DOM, keeping the
 * real chips: an image element is moved, never remade, so it stays loaded.
 * The browser's own undo history is not consulted for this — the app keeps
 * its own, in text, which is why a redraw need not be undoable.
 */
function patchBlock(lines: LineSpan[], from: number, to: number, html: string[]): void {
  const range = rangeOverLines(lines[from], lines[to]);
  const chips = chipsInRange(range);
  const tpl = document.createElement('template');
  tpl.innerHTML = html.slice(from, to + 1).join('<br>');
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_COMMENT);
  const slots: ChildNode[] = [];
  while (walker.nextNode()) slots.push(walker.currentNode as ChildNode);
  slots.forEach((slot, i) => {
    const chip = chips[i];
    if (chip) slot.replaceWith(chip);
    else slot.remove();
  });
  range.deleteContents();
  range.insertNode(tpl.content);
}

/** Draws the formatting over the whole editor. For a fresh render, where there is no caret to keep. */
function decorateAll(): void {
  drawn = [];
  el.editor.classList.toggle('live', ui.liveFormat);
  if (!ui.liveFormat) return;
  const { text, lines, segments } = readEditor(el.editor);
  const rows = text.split('\n');
  const html = decorateLines(rows, chipSpansByLine(text, rows, segments));
  // Bottom up, so redrawing a line cannot move the spans of the lines still to do.
  for (let i = Math.min(lines.length, html.length) - 1; i >= 0; i--) {
    if (isDecorated(html[i])) patchBlock(lines, i, i, html);
  }
  drawn = html;
}

/**
 * After a keystroke: works out what every line should look like, and redraws
 * only the lines that no longer do — usually none, since typing inside a
 * bold word lands in the bold span already there. Lines are redrawn in runs
 * that begin and end outside any wrapper, so a line break the browser put
 * inside a heading span cannot leave the next line trapped in it. The caret
 * is put back by its offset in the text, which the redraw does not change.
 */
function decorateAfterInput(): void {
  if (!ui.liveFormat || ui.preview) return;
  const { text, lines, segments } = readEditor(el.editor);
  const rows = text.split('\n');
  const html = decorateLines(rows, chipSpansByLine(text, rows, segments));
  const count = Math.min(lines.length, html.length);
  const stale: boolean[] = [];
  let any = false;
  for (let i = 0; i < count; i++) {
    stale[i] = html[i] !== drawn[i] && currentLineHtml(rangeOverLines(lines[i], lines[i])) !== html[i];
    any ||= stale[i];
  }
  drawn = html;
  if (!any) return;
  // Runs of stale lines, widened until both ends sit outside every wrapper.
  const blocks: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (!stale[i]) continue;
    let from = i;
    let to = i;
    while (to + 1 < count && stale[to + 1]) to++;
    while (from > 0 && insideWrapper(lines[from].start)) from--;
    while (to + 1 < count && insideWrapper(lines[to].end)) to++;
    const last = blocks[blocks.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else blocks.push([from, to]);
    i = to;
  }
  const sel = window.getSelection();
  const keep =
    sel && sel.rangeCount > 0 && sel.anchorNode && sel.focusNode && el.editor.contains(sel.anchorNode)
      ? {
          anchor: offsetOf(el.editor, { node: sel.anchorNode, offset: sel.anchorOffset }),
          focus: offsetOf(el.editor, { node: sel.focusNode, offset: sel.focusOffset }),
        }
      : null;
  for (let k = blocks.length - 1; k >= 0; k--) patchBlock(lines, blocks[k][0], blocks[k][1], html);
  // The marks on the caret line are new elements now; let them be found again.
  revealedLines = '';
  syncWriting();
  if (keep && sel) {
    const { segments } = readEditor(el.editor);
    const a = posAt(segments, keep.anchor);
    const f = posAt(segments, keep.focus);
    if (a && f) sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  }
}


/** The marks last revealed, so they can be hidden again without a search. */
let revealed: Element[] = [];
let revealedLines = '';

/** Shows the markers on the lines the caret is on, and hides them everywhere else. */
function revealMarks(lines: LineSpan[] | null, from: number, to: number): void {
  const key = lines ? `${from}-${to}-${lines.length}` : '';
  if (key === revealedLines && key !== '') return;
  revealedLines = key;
  for (const m of revealed) m.classList.remove('raw');
  revealed = [];
  if (!lines || from < 0) return;
  const range = document.createRange();
  const a = lines[Math.max(0, from)];
  const b = lines[Math.min(lines.length - 1, to)];
  if (!a || !b) return;
  range.setStart(a.start.node, a.start.offset);
  range.setEnd(b.end.node, b.end.offset);
  for (const m of Array.from(el.editor.querySelectorAll('.md-mark'))) {
    if (range.intersectsNode(m)) {
      m.classList.add('raw');
      revealed.push(m);
    }
  }
}

function toggleLiveFormat(): void {
  ui.liveFormat = !ui.liveFormat;
  saveUi();
  el.liveFormat.checked = ui.liveFormat;
  // The editor only re-renders on a note switch, so tell it this counts as one.
  editorNoteId = null;
  renderEditor();
  if (selected() && !ui.preview) caretToEnd();
  showStatus(ui.liveFormat ? 'Live formatting on' : 'Live formatting off', 1500);
}

// --- deleted notes ----------------------------------------------------------

let trashed: TrashedNote[] = [];
let trashAt: string | null = null;

function toggleTrash(force?: boolean): void {
  const open = force ?? el.trashSheet.hidden;
  el.trashSheet.hidden = !open;
  if (!open) {
    focusEditor();
    return;
  }
  el.trashSheet.querySelector<HTMLElement>('.sheet-card')?.focus();
  void loadTrash();
}

async function loadTrash(): Promise<void> {
  trashed = [];
  trashAt = null;
  el.trashList.replaceChildren();
  el.trashPreview.textContent = '';
  el.trashNote.textContent = 'Reading…';
  el.trashRestore.disabled = true;
  el.trashPurge.disabled = true;
  try {
    trashed = await window.notesApi.trashList();
  } catch (err) {
    console.error('[notes] could not read the trash', err);
    el.trashNote.textContent = 'Could not read the deleted notes.';
    return;
  }
  drawTrash();
  if (trashed.length > 0) void showTrashed(trashed[0].id);
}

function drawTrash(): void {
  el.trashList.replaceChildren();
  if (trashed.length === 0) {
    const none = document.createElement('div');
    none.className = 'history-none u';
    none.textContent = 'Nothing has been deleted.';
    el.trashList.append(none);
    el.trashNote.textContent = 'A deleted note waits here for a month, then goes for good.';
    return;
  }
  const now = Date.now();
  for (const t of trashed) {
    const row = document.createElement('button');
    row.className = `history-row${t.id === trashAt ? ' at' : ''}`;
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(t.id === trashAt));
    const when = document.createElement('span');
    when.className = 'history-when u';
    when.textContent = `Deleted ${relativeTime(t.deletedAt, now)}`;
    when.title = absoluteTime(t.deletedAt);
    const what = document.createElement('span');
    what.className = 'history-what';
    what.textContent = t.title === 'Untitled' && t.preview ? t.preview : t.title;
    row.append(when, what);
    row.addEventListener('click', () => void showTrashed(t.id));
    el.trashList.append(row);
  }
}

async function showTrashed(id: string): Promise<void> {
  trashAt = id;
  drawTrash();
  el.trashRestore.disabled = true;
  el.trashPurge.disabled = true;
  const note = await window.notesApi.trashGet(id).catch(() => null);
  if (!note || trashAt !== id) return;
  el.trashPreview.textContent = note.body || '(empty)';
  const t = trashed.find((x) => x.id === id);
  el.trashNote.textContent = `${titleOf(note)} · ${note.body.length} characters · last edited ${relativeTime(note.updatedAt)}`;
  el.trashRestore.disabled = false;
  el.trashPurge.disabled = !t;
}

async function restoreTrashed(): Promise<void> {
  if (!trashAt) return;
  const id = trashAt;
  const note = await window.notesApi.trashRestore(id).catch(() => null);
  if (!note) {
    showStatus('That note could not be put back', 3000);
    return;
  }
  notes = [note, ...notes.filter((n) => n.id !== note.id)];
  scheduleSave();
  clearFilters();
  toggleTrash(false);
  select(note.id);
  focusEditor();
  showStatus(`Put back “${titleOf(note)}”`, 3000);
}

async function purgeTrashed(): Promise<void> {
  if (!trashAt) return;
  const id = trashAt;
  const t = trashed.find((x) => x.id === id);
  const gone = await window.notesApi.trashPurge(id).catch(() => false);
  if (!gone) {
    showStatus('That note could not be removed', 3000);
    return;
  }
  showStatus(`Removed “${t?.title ?? 'the note'}” for good`, 3000);
  await loadTrash();
}

el.trashRestore.addEventListener('click', () => void restoreTrashed());
el.trashPurge.addEventListener('click', () => void purgeTrashed());
el.trashSheet.addEventListener('click', (e) => {
  if (e.target === el.trashSheet) toggleTrash(false);
});
el.historyTrash.addEventListener('click', () => {
  toggleHistory(false);
  toggleTrash(true);
});

// --- the inbox: quick notes from the capture box -----------------------------

const INBOX_TITLE = 'Inbox';

/** The Inbox note, started if there is none. */
function inboxNote(): Note {
  const hit = notes.find((n) => linkKey(titleOf(n)) === linkKey(INBOX_TITLE));
  if (hit) return hit;
  const made = createNote();
  made.title = INBOX_TITLE;
  notes = [made, ...notes];
  return made;
}

/** Whether the notes have been loaded; a quick note that arrives sooner waits. */
let loaded = false;
const captureQueue: string[] = [];

/** Files a quick note at the bottom of the Inbox, as its own paragraph. */
function captureToInbox(text: string): void {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return;
  if (!loaded) {
    captureQueue.push(clean);
    return;
  }
  const inbox = inboxNote();
  const body = inbox.body.trimEnd() ? `${inbox.body.trimEnd()}\n\n${clean}` : clean;
  // A step of its own when the Inbox is the note open, so undo takes the
  // quick note back out rather than the words typed before it arrived.
  if (ui.selectedId === inbox.id) rememberNow('capture');
  notes = updateBody(notes, inbox.id, body);
  scheduleSave();
  // If the Inbox is the note on screen, it must show the new line.
  if (ui.selectedId === inbox.id) editorNoteId = null;
  renderList();
  renderEditor();
  showStatus('Added to Inbox', 2500);
}

window.notesApi.onCapture(captureToInbox);

// --- changes made outside the app -------------------------------------------

/**
 * Files in the notes folder changed by something else — a sync tool, an
 * editor on another machine. They are taken as they are, except for the note
 * being written in this moment, whose unsaved words are not to be lost to a
 * file that arrived while they were typed.
 */
function applyExternal(changes: ExternalChanges): void {
  let touched = 0;
  const keep = dirty ? ui.selectedId : null;
  for (const id of changes.removed) {
    if (id === keep || !notes.some((n) => n.id === id)) continue;
    notes = removeNote(notes, id);
    touched++;
  }
  for (const note of changes.upserts) {
    if (note.id === keep) continue;
    const i = notes.findIndex((n) => n.id === note.id);
    if (i < 0) notes = [note, ...notes];
    else if (notes[i].body === note.body && (notes[i].title ?? '') === (note.title ?? '') && notes[i].pinned === note.pinned && notes[i].updatedAt === note.updatedAt) continue;
    else notes = notes.map((n) => (n.id === note.id ? note : n));
    touched++;
    if (note.id === ui.selectedId) editorNoteId = null;
  }
  if (touched === 0) return;
  if (ui.selectedId && !notes.some((n) => n.id === ui.selectedId)) ui.selectedId = sortByEdited(notes)[0]?.id ?? null;
  renderList();
  renderEditor();
  showStatus(touched === 1 ? 'A note changed on disk' : `${touched} notes changed on disk`, 3000);
}

window.notesApi.onExternalChange(applyExternal);

// --- a picker: the palette's shape, for choosing from a list ------------------

interface PickItem {
  label: string;
  hint?: string;
  run: () => void;
}

let pickItems: PickItem[] = [];
let pickShown: PickItem[] = [];
let pickAt = 0;
let pickReturn: (() => void) | null = null;

/** Opens the picker over some choices. `onClose` runs when it goes away without a choice. */
function openPicker(placeholder: string, items: PickItem[], onClose?: () => void): void {
  pickItems = items;
  pickReturn = onClose ?? null;
  el.pickInput.placeholder = placeholder;
  el.pickInput.setAttribute('aria-label', placeholder);
  el.pickInput.value = '';
  el.pickSheet.hidden = false;
  refreshPicker();
  el.pickInput.focus();
}

function closePicker(chosen = false): void {
  if (el.pickSheet.hidden) return;
  el.pickSheet.hidden = true;
  const back = pickReturn;
  pickReturn = null;
  if (!chosen) {
    back?.();
    focusEditor();
  }
}

function refreshPicker(): void {
  const q = el.pickInput.value.trim().toLowerCase();
  pickShown = pickItems.filter((it) => !q || it.label.toLowerCase().includes(q) || (it.hint ?? '').toLowerCase().includes(q));
  pickAt = 0;
  drawPicker();
}

function drawPicker(): void {
  el.pickList.replaceChildren();
  if (pickShown.length === 0) {
    const none = document.createElement('div');
    none.className = 'palette-none u';
    none.textContent = pickItems.length === 0 ? 'Nothing to choose from.' : 'Nothing matches that.';
    el.pickList.append(none);
    return;
  }
  pickShown.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = `palette-row${i === pickAt ? ' at' : ''}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === pickAt));
    const name = document.createElement('span');
    name.className = 'palette-name';
    name.textContent = it.label;
    row.append(name);
    if (it.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette-group u';
      hint.textContent = it.hint;
      row.append(hint);
    }
    row.addEventListener('mousemove', () => {
      if (pickAt !== i) {
        pickAt = i;
        drawPicker();
      }
    });
    row.addEventListener('click', () => runPick(i));
    el.pickList.append(row);
  });
  el.pickList.children[pickAt]?.scrollIntoView({ block: 'nearest' });
}

function runPick(i: number): void {
  const it = pickShown[i];
  if (!it) return;
  closePicker(true);
  it.run();
}

el.pickInput.addEventListener('input', refreshPicker);
el.pickInput.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      e.preventDefault();
      if (pickShown.length === 0) break;
      pickAt = (pickAt + (e.key === 'ArrowDown' ? 1 : pickShown.length - 1)) % pickShown.length;
      drawPicker();
      break;
    }
    case 'Enter':
      e.preventDefault();
      runPick(pickAt);
      break;
    case 'Tab':
      e.preventDefault();
      break;
  }
});
el.pickSheet.addEventListener('click', (e) => {
  if (e.target === el.pickSheet) closePicker();
});

// --- templates ----------------------------------------------------------------

/**
 * Puts text into the open note at the caret, as one undo step, and leaves
 * the caret after it. Done through the model and a re-render rather than
 * an insert command: a template is several lines, and the editor's live
 * formatting is only certain of a redraw it made itself.
 */
function insertAtCaret(text: string): void {
  ensureEditable();
  const n = selected();
  if (!n) return;
  if (!selectionInEditor()) caretToEnd();
  const at = caretOffsetOrStart();
  const before = n.body.slice(0, at);
  const after = n.body.slice(at);
  // On its own line when it is a block, unless it is being typed mid-line.
  const pad = text.includes('\n') && before && !before.endsWith('\n') ? '\n' : '';
  const body = `${before}${pad}${text}${after}`;
  setBody(body);
  placeCaretAt(at + pad.length + text.length);
}

/** The choice of templates, for inserting into this note or starting a new one. */
function pickTemplate(mode: 'insert' | 'new'): void {
  const templates = templatesOf(notes);
  if (templates.length === 0) {
    showStatus('No templates yet: tag a note #template to make it one', 4000);
    return;
  }
  const items: PickItem[] = templates.map((t) => ({
    label: titleOf(t),
    hint: snippetOf(t, 40),
    run: () => {
      if (mode === 'insert') {
        const n = selected();
        if (!n) return;
        insertAtCaret(expandTemplate(t, { title: titleOf(n) }));
        showStatus(`Inserted “${titleOf(t)}”`, 2000);
        return;
      }
      // A new note: titled with the search, if there is one, else named afterwards.
      const title = query.trim();
      const made = createNote(Date.now(), expandTemplate(t, { title: title || 'Untitled' }));
      if (title) made.title = title;
      notes = [made, ...notes];
      scheduleSave();
      clearFilters();
      if (ui.preview) ui.preview = false;
      select(made.id);
      if (title) focusEditor();
      else focusTitle();
      showStatus(`Started from “${titleOf(t)}”`, 2500);
    },
  }));
  openPicker(mode === 'insert' ? 'Insert which template?' : 'Start from which template?', items);
}

/** Today's date at the caret; with Shift, the time as well. */
function insertDate(): void {
  const shift = lastChord.includes('shift');
  const now = new Date();
  insertAtCaret(shift ? formatDate(now, `${DATE_FORMAT} ${TIME_FORMAT}`) : formatDate(now, DATE_FORMAT));
}

/** The chord that ran the current command, for commands that read a modifier. */
let lastChord = '';

// --- scheduled tasks -------------------------------------------------------------

function toggleDue(force?: boolean): void {
  const open = force ?? el.dueSheet.hidden;
  el.dueSheet.hidden = !open;
  if (!open) {
    focusEditor();
    return;
  }
  drawDue();
  (el.dueList.querySelector<HTMLElement>('.due-row') ?? el.dueSheet.querySelector<HTMLElement>('.sheet-card'))?.focus();
}

/** Opens a note at one of its lines, with the caret there. */
function openAtLine(id: string, line: number): void {
  if (query || tagFilter) clearFilters();
  if (ui.preview) ui.preview = false;
  select(id);
  const n = selected();
  if (!n) return;
  const offset = n.body.split('\n').slice(0, line).reduce((sum, l) => sum + l.length + 1, 0);
  placeCaretAt(offset);
}

function drawDue(): void {
  const now = Date.now();
  const all = dueTasks(notes, { includeDone: true }).filter((t) => !t.done || t.due > now - 24 * 3600 * 1000);
  el.dueList.replaceChildren();
  if (all.length === 0) {
    const none = document.createElement('div');
    none.className = 'due-empty';
    none.textContent = 'Nothing scheduled. Put @2026-09-10 on a checklist line to see it here.';
    el.dueList.append(none);
    return;
  }
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = endOfToday.getTime() + 6 * 24 * 3600 * 1000;
  const groups: Array<[string, (t: DueTask) => boolean]> = [
    ['Overdue', (t) => !t.done && t.due < now && t.due < new Date(now).setHours(0, 0, 0, 0)],
    ['Today', (t) => t.due >= new Date(now).setHours(0, 0, 0, 0) && t.due <= endOfToday.getTime()],
    ['This week', (t) => t.due > endOfToday.getTime() && t.due <= endOfWeek],
    ['Later', (t) => t.due > endOfWeek],
    ['Done', (t) => t.done && t.due < new Date(now).setHours(0, 0, 0, 0)],
  ];
  const placed = new Set<DueTask>();
  for (const [name, test] of groups) {
    const rows = all.filter((t) => !placed.has(t) && test(t));
    if (rows.length === 0) continue;
    const head = document.createElement('div');
    head.className = 'due-group';
    head.textContent = name;
    el.dueList.append(head);
    for (const t of rows) {
      placed.add(t);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `due-row${t.done ? ' is-done' : ''}${!t.done && t.due < now ? ' is-overdue' : ''}`;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = t.done;
      box.setAttribute('aria-label', t.done ? 'Done' : 'Not done');
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        tickDue(t);
      });
      const text = document.createElement('span');
      text.className = 'due-text';
      text.textContent = t.text || '(no words)';
      const note = document.createElement('span');
      note.className = 'due-note';
      note.textContent = t.noteTitle;
      text.append(note);
      const when = document.createElement('span');
      when.className = 'due-when u';
      when.textContent = dueLabel(t.due, t.hasTime, now);
      when.title = absoluteTime(t.due);
      row.append(box, text, when);
      row.addEventListener('click', () => {
        toggleDue(false);
        openAtLine(t.noteId, t.line);
      });
      el.dueList.append(row);
    }
  }
}

/** Ticks a task from the sheet, in whichever note it lives. */
function tickDue(t: DueTask): void {
  const n = notes.find((x) => x.id === t.noteId);
  if (!n) return;
  const body = toggleTaskLine(n.body, t.line);
  if (n.id === ui.selectedId) setBody(body);
  else {
    notes = updateBody(notes, n.id, body);
    scheduleSave();
    renderList();
  }
  drawDue();
}

el.dueSheet.addEventListener('click', (e) => {
  if (e.target === el.dueSheet) toggleDue(false);
});

// --- the graph -----------------------------------------------------------------------

let graphAround = false;
let graphPoints: LaidOut[] = [];
let graphShown: Graph = { nodes: [], edges: [] };
let graphRadii = new Map<string, number>();
let graphHover: string | null = null;

function toggleGraph(force?: boolean): void {
  const open = force ?? el.graphSheet.hidden;
  el.graphSheet.hidden = !open;
  if (!open) {
    focusEditor();
    return;
  }
  drawGraph();
  el.graphSheet.querySelector<HTMLElement>('.sheet-card')?.focus();
}

/** Lays the graph out and paints it. Cheap enough to redo on every open. */
function drawGraph(): void {
  const current = selected();
  const whole = graphOf(notes);
  graphShown = graphAround && current ? neighbourhood(whole, current.id, 2) : whole;
  el.graphScope.setAttribute('aria-pressed', String(graphAround));
  el.graphScope.disabled = !current;
  el.graphNote.textContent = `${graphShown.nodes.length} ${graphShown.nodes.length === 1 ? 'note' : 'notes'} · ${graphShown.edges.length} ${graphShown.edges.length === 1 ? 'link' : 'links'}`;
  const canvas = el.graphCanvas;
  const width = canvas.width;
  const height = canvas.height;
  graphPoints = layoutGraph(graphShown, { width, height, iterations: graphShown.nodes.length > 200 ? 150 : 300 });
  graphRadii = new Map(graphShown.nodes.map((n) => [n.id, 4 + Math.min(10, Math.sqrt(n.in + n.out) * 3)]));
  paintGraph();
}

function paintGraph(): void {
  const canvas = el.graphCanvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const style = getComputedStyle(document.documentElement);
  const colour = (name: string): string => style.getPropertyValue(name).trim();
  const at = new Map(graphPoints.map((p) => [p.id, p]));
  const current = ui.selectedId;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = colour('--ink');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (graphShown.nodes.length === 0) {
    ctx.fillStyle = colour('--paper-faint');
    ctx.font = 'italic 15px ' + colour('--serif');
    ctx.textAlign = 'center';
    ctx.fillText('No notes to draw yet.', canvas.width / 2, canvas.height / 2);
    return;
  }
  // Links first, under the dots.
  ctx.lineWidth = 1;
  for (const e of graphShown.edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) continue;
    const lit = graphHover === e.from || graphHover === e.to || current === e.from || current === e.to;
    ctx.strokeStyle = lit ? colour('--blue') : colour('--line');
    ctx.globalAlpha = lit ? 0.9 : 0.8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = '11px ' + colour('--utility');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const linked = new Set(graphShown.edges.flatMap((e) => [e.from, e.to]));
  for (const n of graphShown.nodes) {
    const p = at.get(n.id);
    if (!p) continue;
    const r = graphRadii.get(n.id) ?? 5;
    const isCurrent = n.id === current;
    const isHover = n.id === graphHover;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isCurrent ? colour('--margin') : isHover ? colour('--blue') : linked.has(n.id) ? colour('--paper-dim') : colour('--paper-faint');
    ctx.fill();
    if (isCurrent || isHover) {
      ctx.strokeStyle = colour('--paper');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Labels for the notes that matter: linked ones, the current one, the hovered one; the rest on hover only.
    if (isCurrent || isHover || linked.has(n.id) || graphShown.nodes.length <= 40) {
      ctx.fillStyle = isCurrent || isHover ? colour('--paper') : colour('--paper-dim');
      const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
      ctx.fillText(label, p.x, p.y + r + 3);
    }
  }
}

/** Canvas coordinates of a pointer event, whatever size the canvas is drawn at. */
function graphPoint(e: MouseEvent): { x: number; y: number } {
  const rect = el.graphCanvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) / rect.width) * el.graphCanvas.width, y: ((e.clientY - rect.top) / rect.height) * el.graphCanvas.height };
}

el.graphCanvas.addEventListener('mousemove', (e) => {
  const { x, y } = graphPoint(e);
  const hit = nodeAt(graphPoints, graphRadii, x, y);
  if (hit === graphHover) return;
  graphHover = hit;
  el.graphCanvas.classList.toggle('has-hover', hit !== null);
  el.graphCanvas.title = hit ? (graphShown.nodes.find((n) => n.id === hit)?.title ?? '') : '';
  paintGraph();
});
el.graphCanvas.addEventListener('mouseleave', () => {
  if (graphHover === null) return;
  graphHover = null;
  el.graphCanvas.classList.remove('has-hover');
  paintGraph();
});
el.graphCanvas.addEventListener('click', (e) => {
  const { x, y } = graphPoint(e);
  const hit = nodeAt(graphPoints, graphRadii, x, y);
  if (!hit) return;
  toggleGraph(false);
  if (query || tagFilter) clearFilters();
  select(hit);
  focusEditor();
});
el.graphScope.addEventListener('click', () => {
  graphAround = !graphAround;
  drawGraph();
});
el.graphSheet.addEventListener('click', (e) => {
  if (e.target === el.graphSheet) toggleGraph(false);
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
    terms: 'search filter',
    run: () => {
      if (ui.sidebarHidden) toggleSidebar();
      el.search.focus();
      el.search.select();
    },
  },
  {
    id: 'trash',
    label: 'Deleted notes…',
    hint: 'What was deleted in the last month, to look at or put back',
    group: 'Notes',
    chord: 'ctrl+shift+backspace',
    terms: 'trash bin undelete restore recover',
    run: () => toggleTrash(),
  },
  {
    id: 'folder',
    label: 'Open the notes folder',
    hint: 'One markdown file per note; put the folder in OneDrive or git to keep them elsewhere too',
    group: 'Notes',
    terms: 'files explorer markdown sync backup',
    run: () => void window.notesApi.openNotesFolder().catch((err) => console.error('[notes] could not open the folder', err)),
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
    id: 'history',
    label: 'Note history…',
    hint: 'Earlier versions of this note, kept as you write, to look at or put back',
    group: 'Notes',
    chord: 'ctrl+shift+r',
    enabled: hasNote,
    terms: 'versions restore snapshots undo recover',
    run: () => toggleHistory(),
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
    id: 'code',
    label: 'Code block around this',
    hint: 'Fences the selection, or the paragraph you are in, so nothing in it is reflowed',
    group: 'Writing',
    chord: 'ctrl+shift+c',
    terms: 'fence monospace preformatted highlight',
    run: toggleCodeBlock,
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
    id: 'undo',
    label: 'Undo',
    hint: 'A run of typing is one step; a replace or a restore is one too',
    group: 'Writing',
    chord: 'ctrl+z',
    enabled: () => document.activeElement === el.editor,
    run: undoEdit,
  },
  {
    id: 'redo',
    label: 'Redo',
    group: 'Writing',
    chord: 'ctrl+y',
    also: ['ctrl+shift+z'],
    enabled: () => document.activeElement === el.editor,
    run: redoEdit,
  },
  {
    id: 'find-in-note',
    label: 'Find in this note',
    hint: 'Enter and Shift+Enter step through the matches; Esc lands on the current one',
    group: 'Writing',
    chord: 'ctrl+f',
    terms: 'search within match',
    run: () => openFind(false),
  },
  {
    id: 'replace-in-note',
    label: 'Replace in this note',
    hint: 'Find with a replace field; Enter replaces one match, Ctrl+Enter every one',
    group: 'Writing',
    chord: 'ctrl+h',
    terms: 'substitute rename all regex',
    run: () => openFind(true),
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
    id: 'live',
    label: 'Live formatting',
    hint: 'Headings, bold, code and lists take their shape as you write them',
    group: 'View',
    chord: 'ctrl+shift+m',
    terms: 'markdown render inline wysiwyg markers',
    on: () => ui.liveFormat,
    run: toggleLiveFormat,
  },
  {
    id: 'outline',
    label: 'Outline',
    hint: 'The note’s headings beside it, to jump by; shown once a note has two',
    group: 'View',
    chord: 'ctrl+shift+l',
    terms: 'headings contents toc navigate',
    on: () => ui.outline,
    run: toggleOutline,
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

  {
    id: 'template-insert',
    label: 'Insert a template…',
    hint: 'A note tagged #template, its {{date}}, {{time}} and {{title}} filled in, at the caret',
    group: 'Writing',
    chord: 'ctrl+shift+e',
    terms: 'snippet boilerplate expand',
    enabled: hasNote,
    run: () => pickTemplate('insert'),
  },
  {
    id: 'template-new',
    label: 'New note from a template…',
    hint: 'Titled with whatever is in the search box, or named afterwards',
    group: 'Notes',
    chord: 'ctrl+shift+n',
    terms: 'template start',
    run: () => pickTemplate('new'),
  },
  {
    id: 'date',
    label: 'Insert the date',
    hint: 'Today, as 2026-09-03; with Shift held, the time as well',
    group: 'Writing',
    chord: 'ctrl+;',
    also: ['ctrl+shift+;'],
    terms: 'today time now timestamp',
    enabled: hasNote,
    run: insertDate,
  },
  {
    id: 'due',
    label: 'Scheduled tasks…',
    hint: 'Every checklist line with an @date, across the notes, overdue first',
    group: 'Notes',
    chord: 'ctrl+shift+u',
    terms: 'due reminders deadline agenda today',
    run: () => toggleDue(),
  },
  {
    id: 'graph',
    label: 'Graph of the notes…',
    hint: 'Every note as a dot, every [[link]] as a line; click a dot to go there',
    group: 'View',
    chord: 'ctrl+shift+g',
    terms: 'map links network related',
    run: () => toggleGraph(),
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
  } else if (!el.pickSheet.hidden) {
    closePicker();
  } else if (!el.dueSheet.hidden) {
    toggleDue(false);
  } else if (!el.graphSheet.hidden) {
    toggleGraph(false);
  } else if (!el.findBar.hidden) {
    closeFind(true);
  } else if (!el.trashSheet.hidden) {
    toggleTrash(false);
  } else if (!el.historySheet.hidden) {
    toggleHistory(false);
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
  lastChord = chord;
  action.run();
  lastChord = '';
});

// Losing the window is a good moment to make sure everything is on disk.
window.addEventListener('blur', () => void flush());
window.addEventListener('beforeunload', () => void flush());

// Relative timestamps drift; refresh them once a minute.
window.setInterval(() => {
  renderList();
  renderMeta();
}, 60_000);

// --- the command line -------------------------------------------------------

/**
 * While the app runs it is the single writer, so the `notes` command asks
 * the window for what only the window knows — the notes as they stand this
 * moment, unsaved words included — and hands it every change. A note being
 * typed in right now is refused rather than overwritten, unless the command
 * insists; a change to the note on screen is drawn in place, with the caret
 * left where it was, so an append from a terminal never throws the writer
 * out of their sentence.
 */

/** An answer the command line turns straight into an exit code. */
class CliRefusal extends Error {
  readonly exit: number;
  constructor(message: string, exit: number) {
    super(message);
    this.exit = exit;
  }
}

const CLI_NOT_FOUND = 3;
const CLI_BUSY = 4;
const CLI_APP_ERROR = 6;

function noteById(id: string): Note {
  const n = notes.find((x) => x.id === id);
  if (!n) throw new CliRefusal(`No note with id ${id}`, CLI_NOT_FOUND);
  return n;
}

/** Whether the note is the one on screen, with words not yet saved. */
const beingTyped = (id: string): boolean => dirty && ui.selectedId === id;

function refuseIfTyping(id: string, force: boolean | undefined): void {
  if (beingTyped(id) && !force) throw new CliRefusal('That note is being typed in the window right now; pass --force to change it anyway', CLI_BUSY);
}

/** Puts the caret at a text offset of the note on screen, or at the end when the offset is past it. */
function placeCaretAt(offset: number): void {
  el.editor.focus();
  const { segments } = readEditor(el.editor);
  const pos = posAt(segments, offset);
  if (!pos) {
    caretToEnd();
    return;
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.collapse(true);
  sel?.addRange(range);
  keepCaretInView();
}

/** Takes a note from the command line into the list, redrawing it in place if it is on screen. */
function takeIn(note: Note): void {
  const i = notes.findIndex((n) => n.id === note.id);
  notes = i < 0 ? [note, ...notes] : notes.map((n) => (n.id === note.id ? note : n));
  if (ui.selectedId === note.id) {
    // A step of its own, so undo takes the command's change back out.
    rememberNow('cli');
    const caret = document.activeElement === el.editor ? caretOffsetOrStart() : null;
    editorNoteId = null;
    el.title.value = note.title ?? '';
    renderList();
    renderEditor();
    if (caret !== null) placeCaretAt(caret);
  } else {
    renderList();
    renderEditor();
  }
  scheduleSave();
}

type CliHandler = (params: never) => Promise<unknown> | unknown;

const UI_TOGGLES: Record<string, () => void> = {
  preview: togglePreview,
  liveFormat: toggleLiveFormat,
  outline: toggleOutline,
  focusMode: toggleFocusMode,
  typewriter: toggleTypewriter,
  sidebarHidden: toggleSidebar,
};

const cliHandlers: Record<string, CliHandler> = {
  'note.list': () => notes,
  'note.get': ({ id }: { id: string }) => notes.find((n) => n.id === id) ?? null,
  'note.status': ({ id }: { id: string }) => ({ open: ui.selectedId === id, dirty: beingTyped(id) }),
  'note.put': async ({ note, force }: { note: Note; force?: boolean }) => {
    if (notes.some((n) => n.id === note.id)) refuseIfTyping(note.id, force);
    takeIn(note);
    await flush();
    return note;
  },
  'note.remove': async ({ id, force }: { id: string; force?: boolean }) => {
    if (!notes.some((n) => n.id === id)) return { removed: false };
    refuseIfTyping(id, force);
    const wasSelected = ui.selectedId === id;
    const next = wasSelected ? neighborOf(visibleNotes(), id) : ui.selectedId;
    notes = removeNote(notes, id);
    scheduleSave();
    if (wasSelected) select(next);
    else renderList();
    await flush();
    return { removed: true };
  },
  inbox: async ({ text }: { text: string }) => {
    captureToInbox(text);
    await flush();
    return { id: inboxNote().id };
  },
  'trash.restore': async ({ id }: { id: string }) => {
    const note = await window.notesApi.trashRestore(id);
    if (!note) return null;
    notes = [note, ...notes.filter((n) => n.id !== note.id)];
    scheduleSave();
    renderList();
    await flush();
    return note;
  },
  'history.keep': async ({ id }: { id: string }) => {
    await window.notesApi.historyKeep(noteById(id));
    return { kept: true };
  },
  'history.restore': async ({ id, at, force }: { id: string; at: number; force?: boolean }) => {
    const n = noteById(id);
    refuseIfTyping(id, force);
    const snap = await window.notesApi.historyGet(id, at);
    if (!snap) throw new CliRefusal('No version of the note from that moment', CLI_NOT_FOUND);
    await window.notesApi.historyKeep(n);
    const { title: _old, ...rest } = n;
    const restored: Note = snap.title ? { ...rest, title: snap.title, body: snap.body, updatedAt: Date.now() } : { ...rest, body: snap.body, updatedAt: Date.now() };
    takeIn(restored);
    await flush();
    return restored;
  },
  open: ({ id, search }: { id?: string; search?: string }) => {
    if (id) {
      noteById(id);
      if (query || tagFilter) clearFilters();
      if (ui.preview) ui.preview = false;
      select(id);
      focusEditor();
    }
    if (search !== undefined) {
      el.search.value = search;
      query = search;
      renderList();
      el.search.focus();
    }
    return { opened: true };
  },
  'ui.get': () => ({ ...ui }),
  'ui.set': ({ key, value }: { key: string; value: boolean | number | string | null }) => {
    if (key in UI_TOGGLES) {
      if (typeof value !== 'boolean') throw new CliRefusal(`${key} is on or off`, 2);
      if ((ui as unknown as Record<string, unknown>)[key] !== value) UI_TOGGLES[key]();
    } else if (key === 'marginHidden') {
      ui.marginHidden = value === true;
      applyLayout();
      saveUi();
    } else if (key === 'textW' || key === 'marginW') {
      if (typeof value !== 'number') throw new CliRefusal(`${key} is a number of pixels`, 2);
      ui[key] = key === 'textW' ? clamp(value, TEXT_MIN, TEXT_MAX, TEXT_DEFAULT) : clamp(value, MARGIN_MIN, MARGIN_MAX, MARGIN_DEFAULT);
      applyLayout();
      saveUi();
    } else {
      throw new CliRefusal(`No layout setting "${key}"`, 2);
    }
    return { ...ui };
  },
  commands: () =>
    ACTIONS.map((a) => ({
      id: a.id,
      label: a.label,
      group: a.group,
      chord: a.chord,
      also: a.also,
      hint: a.hint,
      on: a.on?.(),
      enabled: a.enabled?.() !== false,
    })),
  run: ({ id }: { id: string }) => {
    const action = ACTIONS.find((a) => a.id === id);
    if (!action || action.enabled?.() === false) return { ran: false };
    action.run();
    return { ran: true };
  },
  'export.render': async ({ id, path, kind }: { id: string; path: string; kind: 'png' | 'pdf' | 'html' }) => {
    const n = noteById(id);
    const request: ExportRequest = { kind, ...(await renderedExport(n, kind === 'pdf' ? 'paper' : 'ink')) };
    await window.notesApi.exportNoteTo(path, request);
    return { path };
  },
  'render.html': async ({ body }: { body: string }) => {
    let html = renderMarkdown(body);
    if (hasDiagrams(html)) {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      await renderDiagrams(holder);
      html = holder.innerHTML;
    }
    return { html };
  },
};

window.notesApi.onCliRequest(async (method, params) => {
  try {
    const handler = cliHandlers[method];
    if (!handler) throw new CliRefusal(`The window cannot do ${method}`, CLI_APP_ERROR);
    if (!loaded) throw new CliRefusal('The notes are still loading; try again in a moment', CLI_APP_ERROR);
    return { ok: true, result: await handler(params as never) };
  } catch (err) {
    // A plain object, because an Error loses its extra fields at the context bridge.
    if (err instanceof CliRefusal) return { ok: false, error: { message: err.message, exit: err.exit } };
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err), exit: CLI_APP_ERROR } };
  }
});

// --- boot -------------------------------------------------------------------

async function init(): Promise<void> {
  const file = await window.notesApi.load();
  notes = file.notes;
  loaded = true;
  if (ui.selectedId && !notes.some((n) => n.id === ui.selectedId)) ui.selectedId = null;
  if (!ui.selectedId) ui.selectedId = sortByEdited(notes)[0]?.id ?? null;
  renderKeyGroups();
  applySidebar();
  applyLayout();
  applyWriting();
  el.outlineShow.checked = ui.outline;
  el.liveFormat.checked = ui.liveFormat;
  renderList();
  renderEditor();
  if (selected()) focusEditor();
  else el.search.focus();
  // Quick notes taken before the notes were read are filed now.
  for (const text of captureQueue.splice(0)) captureToInbox(text);
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
