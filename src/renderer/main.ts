import { assetNameFromUrl } from '../shared/assets';
import { cleanAliases } from '../shared/notes-folder';
import { chordOf, isCommandChord, keyLabel } from '../shared/keys';
import { DEFAULT_SETTINGS, viewNamed, withView, type Settings } from '../shared/settings';
import {
  folderKey,
  folderLabel,
  folderMatches,
  folderName,
  folderTree,
  normalizeFolder,
  parentFolder,
  parseFolder,
  ROOT_FOLDER,
  ROOT_LABEL,
  type FolderNode,
} from '../shared/folders';
import type { CliStatus, ExportKind, ExportRequest, FolderResult, ImportedFile, Note, NotesFile } from '../shared/types';
import { keyMap, matchActions, menuModel, pillActions, slashActions, type Action, type Match } from './actions';
import { toggleFence } from './fences';
import { findMatches, matchFrom, replaceAll, replaceOne, validQuery, type FindMatch, type FindOptions } from './find';
import { isTextFile, noteFromFile } from './importer';
import { decorateLines, isDecorated, type Protected } from './inline';
import { renderGlance, renderMarkdown } from './markdown';
import { headingAt, headingsIn, type Heading } from './outline';
import { addColumn, addRow, newTable, removeRow, stepCell, tidyTable, type TableEdit } from './tables';
import { cycleTaskLine, toggleTaskAt, toggleTaskLine } from './tasks';
import {
  backlinksOf,
  createNote,
  newId,
  exportBody,
  linkKey,
  parseLinkAddress,
  type LinkAddress,
  neighborOf,
  noteForLink,
  qualifiedLink,
  removeNote,
  resolveLink,
  searchNotes,
  snippetOf,
  sortByEdited,
  tagMatches,
  tagTree,
  titleOf,
  togglePin,
  updateAliases,
  updateBody,
  updateTitle,
  wordCount,
  type TagNode,
} from './notes';
import { markdownToText } from './plaintext';
import { embedsFrom } from '../core/embeds';
import { rewriteLinks } from '../core/refactor';
import { unlinkedMentions, type Mention } from '../core/mentions';
import { addTab, keepTabs, nthTab, showTab, shutTab, stepTab as stepTabStrip, type TabStrip } from './tabs';
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
  makeEmbed,
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
import { applyPlan, groupOf, redoGroup, undoGroup, type RefactorHost } from './apply-refactor';
import { caretUsable, emptyJourney, forget, goBack, goForward, hashOf, leave, parseRecent, pruneRecent, visited, type Journey, type Place, type Visit } from './journey';
import { createRefactorUi, type PickOptions } from './refactor-ui';
import { planLinkMention, type Plan } from '../core/refactor';
import type { SnapshotSummary } from '../shared/history';
import type { ExternalChanges, RenderedExport, TrashedNote } from '../shared/types';
// 0.13: templates, scheduled tasks, search operators, math and diagrams, related notes and the graph.
import { dueLabel, dueTasks, type DueTask } from '../core/due';
import { applyFilter, hasOperators, OPERATORS, parseQuery } from '../core/query';
import { graphOf, neighbourhood, relatedNotes, type Graph } from '../core/related';
import { DATE_FORMAT, expandTemplate, formatDate, templatesOf, TIME_FORMAT, usesTitle } from '../core/templates';
import { hasDiagrams, hasMath } from '../shared/markdown-core';
import { renderDiagrams } from './diagrams';
import { layoutGraph, nodeAt, type LaidOut } from './graph';
import { blockOf } from '../core/blocks';
import { createPeek } from './peek';
import { createSlash } from './slash';
import { place } from './anchored';
import { GOES_THERE, noteMenuRows } from './notemenu';
import { createWorkspacesUi } from './workspaces-ui';
import { nameKey, parseWorkspaces, resolveWorkspace, withWorkspace, type Workspace } from './workspaces';
import { dateOf, DEFAULT_JOURNAL_PATH, isoDate, journalNoteAt, journalPathError, journalPlace, momentOf, parseJournalDate, type JournalDate } from '../core/journal';
import { createPropertiesUi } from './properties-ui';
import { createBlocksUi } from './blocks-ui';
import type { NoteProperty } from '../shared/properties';
import './generated/katex.css';
import katexText from './generated/katex.css?inline';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

/**
 * The parts of one pane. A pane is cloned from a template, so these are found
 * by `data-el` inside the pane's own root rather than by an id: an id would
 * name three editors once the window is split.
 */
function paneEls(root: HTMLElement) {
  const q = <T extends HTMLElement>(name: string): T => {
    const node = root.querySelector<T>(`[data-el="${name}"]`);
    if (!node) throw new Error(`missing pane element ${name}`);
    return node;
  };
  return {
    toggleSidebar: q<HTMLButtonElement>('toggleSidebar'),
    status: q('status'),
    where: q<HTMLButtonElement>('where'),
    controls: q('controls'),
    tabs: q('tabs'),
    editorWrap: q('editorWrap'),
    text: q('text'),
    title: q<HTMLInputElement>('title'),
    edited: q('edited'),
    words: q('words'),
    editor: q<HTMLDivElement>('editor'),
    preview: q('preview'),
    backlinks: q('backlinks'),
    related: q('related'),
    mentions: q('mentions'),
    imgHandle: q('imgHandle'),
    imgSize: q('imgSize'),
    dropLine: q('dropLine'),
    outline: q('outline'),
    empty: q('empty'),
    findBar: q('findBar'),
    findInput: q<HTMLInputElement>('findInput'),
    findCount: q('findCount'),
    findCase: q<HTMLButtonElement>('findCase'),
    findRegex: q<HTMLButtonElement>('findRegex'),
    findPrev: q<HTMLButtonElement>('findPrev'),
    findNext: q<HTMLButtonElement>('findNext'),
    findToggleReplace: q<HTMLButtonElement>('findToggleReplace'),
    findClose: q<HTMLButtonElement>('findClose'),
    findReplaceRow: q('findReplaceRow'),
    replaceInput: q<HTMLInputElement>('replaceInput'),
    replaceOne: q<HTMLButtonElement>('replaceOne'),
    replaceAll: q<HTMLButtonElement>('replaceAll'),
  };
}

type PaneEls = ReturnType<typeof paneEls>;

/**
 * The window's parts. Everything outside a pane is one element and is found
 * once; everything inside a pane is read from whichever pane has the focus,
 * so the four thousand lines below can go on saying `el.editor` and mean the
 * editor the writer is in.
 */
const el = {
  app: $('app'),
  panes: $('panes'),
  paneTpl: $<HTMLTemplateElement>('pane-tpl'),
  search: $<HTMLInputElement>('search'),
  newBtn: $<HTMLButtonElement>('new'),
  tags: $('tags'),
  tagRail: $('tag-rail'),
  tagsFold: $<HTMLButtonElement>('tags-fold'),
  folderTree: $('folder-tree'),
  folderAdd: $<HTMLButtonElement>('folder-add'),
  views: $('views'),
  list: $('list'),
  count: $('count'),
  helpBtn: $<HTMLButtonElement>('help'),
  layoutBtn: $<HTMLButtonElement>('layout'),
  layoutSheet: $('layout-sheet'),
  uiScale: $<HTMLInputElement>('ui-scale'),
  uiScaleOut: $<HTMLOutputElement>('ui-scale-out'),
  readingScale: $<HTMLInputElement>('reading-scale'),
  readingScaleOut: $<HTMLOutputElement>('reading-scale-out'),
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
  historySheet: $('history-sheet'),
  historyList: $('history-list'),
  historyPreview: $('history-preview'),
  historyRestore: $<HTMLButtonElement>('history-restore'),
  historyNote: $('history-note'),
  helpSheet: $('help-sheet'),
  outlineShow: $<HTMLInputElement>('outline-show'),
  liveFormat: $<HTMLInputElement>('live-format'),
  controlsShow: $<HTMLInputElement>('controls-show'),
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
  clipperCopy: $<HTMLButtonElement>('clipper-copy'),
  clipperNote: $<HTMLParagraphElement>('clipper-note'),
  folderChange: $<HTMLButtonElement>('folder-change'),
  folderPath: $<HTMLSpanElement>('folder-path'),
  folderNote: $<HTMLParagraphElement>('folder-note'),
  cliText: $<HTMLSpanElement>('cli-text'),
  cliInstall: $<HTMLButtonElement>('cli-install'),
  cliNote: $<HTMLParagraphElement>('cli-note'),
  searchOps: $<HTMLParagraphElement>('search-ops'),
  remindersOn: $<HTMLInputElement>('reminders-on'),
  peekOn: $<HTMLInputElement>('peek-on'),
  journalPath: $<HTMLInputElement>('journal-path'),
  journalTemplate: $<HTMLButtonElement>('journal-template'),
  journalNote: $('journal-note'),
  pickSheet: $('pick-sheet'),
  pickInput: $<HTMLInputElement>('pick-input'),
  pickList: $('pick-list'),
  dueSheet: $('due-sheet'),
  dueList: $('due-list'),
  graphSheet: $('graph-sheet'),
  graphCanvas: $<HTMLCanvasElement>('graph-canvas'),
  graphScope: $<HTMLButtonElement>('graph-scope'),
  graphNote: $('graph-note'),

  // The pane with the focus, part by part.
  get pane(): HTMLElement {
    return here().root;
  },
  get toggleSidebar(): HTMLButtonElement {
    return here().els.toggleSidebar;
  },
  get status(): HTMLElement {
    return here().els.status;
  },
  get where(): HTMLButtonElement {
    return here().els.where;
  },
  get controls(): HTMLElement {
    return here().els.controls;
  },
  get tabs(): HTMLElement {
    return here().els.tabs;
  },
  get editorWrap(): HTMLElement {
    return here().els.editorWrap;
  },
  get text(): HTMLElement {
    return here().els.text;
  },
  get title(): HTMLInputElement {
    return here().els.title;
  },
  get edited(): HTMLElement {
    return here().els.edited;
  },
  get words(): HTMLElement {
    return here().els.words;
  },
  get editor(): HTMLDivElement {
    return here().els.editor;
  },
  get preview(): HTMLElement {
    return here().els.preview;
  },
  get backlinks(): HTMLElement {
    return here().els.backlinks;
  },
  get related(): HTMLElement {
    return here().els.related;
  },
  get mentions(): HTMLElement {
    return here().els.mentions;
  },
  get imgHandle(): HTMLElement {
    return here().els.imgHandle;
  },
  get imgSize(): HTMLElement {
    return here().els.imgSize;
  },
  get dropLine(): HTMLElement {
    return here().els.dropLine;
  },
  get outline(): HTMLElement {
    return here().els.outline;
  },
  get empty(): HTMLElement {
    return here().els.empty;
  },
  get findBar(): HTMLElement {
    return here().els.findBar;
  },
  get findInput(): HTMLInputElement {
    return here().els.findInput;
  },
  get findCount(): HTMLElement {
    return here().els.findCount;
  },
  get findCase(): HTMLButtonElement {
    return here().els.findCase;
  },
  get findRegex(): HTMLButtonElement {
    return here().els.findRegex;
  },
  get findPrev(): HTMLButtonElement {
    return here().els.findPrev;
  },
  get findNext(): HTMLButtonElement {
    return here().els.findNext;
  },
  get findToggleReplace(): HTMLButtonElement {
    return here().els.findToggleReplace;
  },
  get findClose(): HTMLButtonElement {
    return here().els.findClose;
  },
  get findReplaceRow(): HTMLElement {
    return here().els.findReplaceRow;
  },
  get replaceInput(): HTMLInputElement {
    return here().els.replaceInput;
  },
  get replaceOne(): HTMLButtonElement {
    return here().els.replaceOne;
  },
  get replaceAll(): HTMLButtonElement {
    return here().els.replaceAll;
  },
};

// --- UI state (per-machine conveniences, kept in localStorage) --------------

interface UiState {
  selectedId: string | null;
  preview: boolean;
  sidebarHidden: boolean;
  /** Multiplier on everything that is not the note: 1 is the designed size, 1.4 the largest. */
  uiScale: number;
  /** Multiplier on the note's own type — the words, their headings, the title. */
  readingScale: number;
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
  /** The commands, and their shortcuts, in the pane's header. */
  controls: boolean;
  /** The notes last opened, newest first, for the Recent notes picker. */
  recent: Visit[];
  /** The panes the window had, left to right, and which one held the focus. */
  panes: PaneShape[];
  paneAt: number;
  /**
   * The folder being browsed. One sidebar, so this belongs to the window
   * rather than to a pane, whatever a pane happens to be showing.
   */
  folder: string;
  /** Whether the tag rail is unfolded. */
  tags: boolean;
  /** Hovering a link shows what it points at. The command works either way. */
  linkPeek: boolean;
  /**
   * Named arrangements of panes and tabs. Window state, kept beside the panes
   * they are snapshots of — nothing outside the window can act on one.
   */
  workspaces: Workspace[];
}

/** What there is to remember about a pane: the notes open in it, and which of them is showing. */
interface PaneShape extends TabStrip {
  preview: boolean;
}

/** A remembered pane, from a store that may hold anything. */
function parsePane(raw: unknown): PaneShape | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Partial<PaneShape>;
  const tabs = Array.isArray(p.tabs) ? p.tabs.filter((id): id is string => typeof id === 'string') : [];
  const activeId = typeof p.activeId === 'string' ? p.activeId : null;
  return { tabs, activeId, preview: p.preview === true };
}

const MARGIN_DEFAULT = 176;
const MARGIN_MIN = 90;
const MARGIN_MAX = 280;

const TEXT_DEFAULT = 960;
const TEXT_MIN = 520;
const TEXT_MAX = 1800;

// The interface never goes below its designed size: the scale's smallest step
// is already the floor the chrome was redrawn to. The note may go smaller,
// because a long note read on a large monitor is a different task from a menu.
const UI_SCALE_DEFAULT = 1;
const UI_SCALE_MIN = 1;
const UI_SCALE_MAX = 1.4;
const READING_SCALE_DEFAULT = 1;
const READING_SCALE_MIN = 0.85;
const READING_SCALE_MAX = 1.6;

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, Number(value) || fallback));

/** A multiplier, clamped and kept to two decimals so 1.05 never comes back as 1.0500000000000003. */
const clampScale = (value: unknown, min: number, max: number, fallback: number): number => Math.round(clamp(value, min, max, fallback) * 100) / 100;

/** How a multiplier reads on its slider: a percentage of the designed size. */
const percent = (scale: number): string => `${Math.round(scale * 100)} %`;

const UI_KEY = 'notes.ui';

function loadUi(): UiState {
  const fallback: UiState = {
    selectedId: null,
    preview: false,
    sidebarHidden: false,
    uiScale: UI_SCALE_DEFAULT,
    readingScale: READING_SCALE_DEFAULT,
    textW: TEXT_DEFAULT,
    marginW: MARGIN_DEFAULT,
    marginHidden: false,
    focusMode: false,
    typewriter: false,
    outline: true,
    liveFormat: true,
    controls: true,
    recent: [],
    panes: [],
    paneAt: 0,
    folder: ROOT_FOLDER,
    tags: false,
    linkPeek: true,
    workspaces: [],
  };
  try {
    const raw = localStorage.getItem(UI_KEY);
    const state = raw ? { ...fallback, ...(JSON.parse(raw) as Partial<UiState>) } : fallback;
    state.marginW = clamp(state.marginW, MARGIN_MIN, MARGIN_MAX, MARGIN_DEFAULT);
    state.textW = clamp(state.textW, TEXT_MIN, TEXT_MAX, TEXT_DEFAULT);
    state.uiScale = clampScale(state.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT);
    state.readingScale = clampScale(state.readingScale, READING_SCALE_MIN, READING_SCALE_MAX, READING_SCALE_DEFAULT);
    state.recent = parseRecent(state.recent);
    state.panes = (Array.isArray(state.panes) ? state.panes : []).map(parsePane).filter((p): p is PaneShape => p !== null);
    state.paneAt = Number.isInteger(state.paneAt) ? Math.max(0, state.paneAt) : 0;
    state.folder = typeof state.folder === 'string' ? normalizeFolder(state.folder) : ROOT_FOLDER;
    state.tags = state.tags === true;
    // Missing means on: hover preview is the promised feature, and a 450ms
    // dwell is what stops ordinary pointer travel opening it constantly.
    state.linkPeek = state.linkPeek !== false;
    state.workspaces = parseWorkspaces(state.workspaces);
    return state;
  } catch {
    return fallback;
  }
}

function saveUi(): void {
  try {
    syncPanes();
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // Nothing to do: the app works fine without remembered UI state.
  }
}

const ui = loadUi();

// --- panes and tabs ---------------------------------------------------------

/**
 * A pane is one note on screen. It holds a strip of open notes — its tabs —
 * and shows one of them; the window can hold up to three panes side by side,
 * each scrolled and written in on its own.
 *
 * Everything below this line was written when there was one editor, and says
 * `el.editor` several hundred times. Rather than thread a pane through all of
 * it, `el` reads the parts of whichever pane has the focus, and the handful of
 * variables that describe an editor's own state — what it has drawn, where its
 * caret was, what it is finding — move with it. `withPane` lends that context
 * to another pane for the length of one call, which is how all three are drawn.
 */
interface Pane extends PaneShape {
  root: HTMLElement;
  els: PaneEls;
  editorNoteId: string | null;
  drawn: string[];
  revealed: Element[];
  revealedLines: string;
  outlineKey: string;
  outlineHeadings: Heading[];
  findHits: FindMatch[];
  findAt: number;
  caretBefore: { id: string; at: number } | null;
  pendingTitle: string | null;
  titleAtFocus: { id: string; title: string | undefined } | null;
}

const MAX_PANES = 3;

let panes: Pane[] = [];
/** The pane with the focus. */
let paneAt = 0;
/** The pane `el` currently reads: the focused one, except inside `withPane`. */
let paneCtx = 0;

const here = (): Pane => panes[paneCtx];
const onlyPane = (): boolean => panes.length < 2;
/** Whether the pane being drawn is the one the writer is in. */
const inFocusedPane = (): boolean => paneCtx === paneAt;

/** The note a pane shows. The focused pane's is `ui.selectedId`, which is where the rest of the app looks. */
const activeIn = (p: Pane): string | null => (p === here() ? ui.selectedId : p.activeId);

/** Moves the editor state the focused pane owns onto its record. */
function stash(p: Pane): void {
  p.activeId = ui.selectedId;
  p.preview = ui.preview;
  p.editorNoteId = editorNoteId;
  p.drawn = drawn;
  p.revealed = revealed;
  p.revealedLines = revealedLines;
  p.outlineKey = outlineKey;
  p.outlineHeadings = outlineHeadings;
  p.findHits = findHits;
  p.findAt = findAt;
  p.caretBefore = caretBefore;
  p.pendingTitle = pendingTitle;
  p.titleAtFocus = titleAtFocus;
}

/** And back: from here on, the window's one editor is this pane's. */
function unstash(p: Pane): void {
  ui.selectedId = p.activeId;
  ui.preview = p.preview;
  editorNoteId = p.editorNoteId;
  drawn = p.drawn;
  revealed = p.revealed;
  revealedLines = p.revealedLines;
  outlineKey = p.outlineKey;
  outlineHeadings = p.outlineHeadings;
  findHits = p.findHits;
  findAt = p.findAt;
  caretBefore = p.caretBefore;
  pendingTitle = p.pendingTitle;
  titleAtFocus = p.titleAtFocus;
}

/** Runs something as though `p` were the pane in front. Nothing about the focus moves. */
function withPane<T>(p: Pane, fn: () => T): T {
  if (p === here()) return fn();
  const back = here();
  stash(back);
  paneCtx = panes.indexOf(p);
  unstash(p);
  try {
    return fn();
  } finally {
    stash(p);
    paneCtx = panes.indexOf(back);
    unstash(back);
  }
}

/** Which pane a node is in, if any. */
function paneOf(node: Node | null): Pane | null {
  for (let n = node; n; n = n.parentNode) {
    const found = panes.find((p) => p.root === n);
    if (found) return found;
  }
  return null;
}

function markFocused(): void {
  el.app.classList.toggle('split', panes.length > 1);
  panes.forEach((p, i) => p.root.classList.toggle('pane-focused', panes.length > 1 && i === paneAt));
}

/**
 * The focus moves to another pane: what `el` reads, what the sidebar shows as
 * open, and what a command acts on all move with it.
 */
function focusPane(at: number): void {
  const next = panes[Math.max(0, Math.min(panes.length - 1, at))];
  if (!next) return;
  if (next === panes[paneAt]) {
    markFocused();
    return;
  }
  // Find is about one note in one pane; it does not follow you across.
  if (!el.findBar.hidden) closeFind(false);
  const old = panes[paneAt];
  stash(old);
  paneAt = panes.indexOf(next);
  paneCtx = paneAt;
  unstash(next);
  saveUi();
  markFocused();
  renderList();
  syncWriting();
}

/** Wiring registered once and replayed onto every pane made afterwards. */
interface PaneWire {
  name: keyof PaneEls;
  type: string;
  fn: (this: HTMLElement, e: Event) => void;
  opts?: AddEventListenerOptions;
}
const paneWiring: PaneWire[] = [];

/**
 * A listener on one part of every pane, now and in future. The handler runs
 * with `el` already reading the pane the event came from, because touching a
 * pane focuses it.
 */
function onPane<K extends keyof PaneEls, T extends keyof HTMLElementEventMap>(
  name: K,
  type: T,
  fn: (e: HTMLElementEventMap[T]) => void,
  opts?: AddEventListenerOptions,
): void {
  const wire: PaneWire = { name, type, fn: fn as (e: Event) => void, opts };
  paneWiring.push(wire);
  for (const p of panes) p.els[name].addEventListener(wire.type, wire.fn, wire.opts);
}

function makePane(shape: PaneShape): Pane {
  const root = el.paneTpl.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!root) throw new Error('missing pane template');
  const p: Pane = {
    ...shape,
    root,
    els: paneEls(root),
    editorNoteId: null,
    drawn: [],
    revealed: [],
    revealedLines: '',
    outlineKey: '',
    outlineHeadings: [],
    findHits: [],
    findAt: -1,
    caretBefore: null,
    pendingTitle: null,
    titleAtFocus: null,
  };
  // Anything done in a pane makes it the pane in front, whether the pointer
  // arrives first or the focus does.
  root.addEventListener('pointerdown', () => focusPane(panes.indexOf(p)), true);
  root.addEventListener('focusin', () => focusPane(panes.indexOf(p)));
  for (const wire of paneWiring) p.els[wire.name].addEventListener(wire.type, wire.fn, wire.opts);
  // The header's commands are written out of the registry, once per pane.
  buildControls(p);
  return p;
}

/** Opens another pane beside this one, showing the same note. */
function splitPane(): void {
  if (panes.length >= MAX_PANES) {
    showStatus(`${MAX_PANES} panes is as many as fit`, 2000);
    return;
  }
  const from = panes[paneAt];
  stash(from);
  const p = makePane({ tabs: from.activeId ? [from.activeId] : [], activeId: from.activeId, preview: from.preview });
  el.panes.insertBefore(p.root, from.root.nextSibling);
  panes.splice(panes.indexOf(from) + 1, 0, p);
  focusPane(panes.indexOf(p));
  renderEditor();
  focusEditor();
  showStatus('Pane split · Ctrl+Alt+← and → move between panes', 3000);
}

/**
 * Puts a whole arrangement on screen, in place of whatever is there.
 *
 * `openPanes` builds the first one at startup and appends; this replaces, so
 * switching workspaces does not leave the panes it came from behind.
 */
function setPanes(shapes: readonly PaneShape[], at: number): void {
  for (const p of panes) p.root.remove();
  panes.length = 0;
  const wanted = shapes.length > 0 ? shapes : [{ tabs: [], activeId: null, preview: false }];
  for (const shape of wanted.slice(0, MAX_PANES)) {
    const p = makePane({ ...keepTabs(shape, (id) => notes.some((n) => n.id === id)), preview: shape.preview });
    panes.push(p);
    el.panes.append(p.root);
  }
  paneAt = Math.max(0, Math.min(panes.length - 1, at));
  paneCtx = paneAt;
  unstash(panes[paneAt]);
  ui.selectedId = panes[paneAt].activeId;
  ui.preview = panes[paneAt].preview;
  markFocused();
  renderList();
  renderEditor();
  focusEditor();
}

/** Closes a pane. The last one stays: a window with no pane has nowhere to write. */
function closePane(p: Pane): void {
  if (panes.length < 2) return;
  const at = panes.indexOf(p);
  if (at < 0) return;
  if (at === paneAt) focusPane(at === 0 ? 1 : at - 1);
  const keeping = panes[paneAt];
  panes.splice(at, 1);
  p.root.remove();
  paneAt = Math.max(0, panes.indexOf(keeping));
  paneCtx = paneAt;
  saveUi();
  markFocused();
  renderEditor();
}

/** Moves the focus one pane along, wrapping round. */
function stepPane(delta: 1 | -1): void {
  if (onlyPane()) return;
  focusPane((paneAt + delta + panes.length) % panes.length);
  focusEditor();
}

// --- tabs -------------------------------------------------------------------

/** Opens a note in a tab of its own beside the one open now. */
function openInTab(id: string): void {
  const p = panes[paneAt];
  stash(p);
  p.tabs = addTab(p, id).tabs;
  if (query || tagFilter) clearFilters();
  select(id);
  focusEditor();
}

/** Takes a note out of a pane. Closing the last tab of a split pane closes the pane. */
function closeTab(p: Pane, id: string): void {
  if (!p.tabs.includes(id)) return;
  const shut = shutTab({ tabs: p.tabs, activeId: activeIn(p) }, id);
  p.tabs = shut.tabs;
  if (shut.tabs.length === 0 && panes.length > 1) {
    closePane(p);
    return;
  }
  if (p === panes[paneAt]) select(shut.activeId);
  else {
    p.activeId = shut.activeId;
    renderEditor();
  }
  saveUi();
}

/** Moves along the open notes of the focused pane, wrapping round. */
function stepTab(delta: 1 | -1): void {
  const p = panes[paneAt];
  stash(p);
  const next = stepTabStrip(p, delta).activeId;
  if (next === null || next === p.activeId) return;
  select(next);
  focusEditor();
}

/** The nth open note of the focused pane, for Ctrl+1 to Ctrl+9. */
function goToTab(n: number): void {
  const p = panes[paneAt];
  stash(p);
  const id = nthTab(p, n);
  if (!id) return;
  select(id);
  focusEditor();
}

/** Notes that have gone leave the tabs they were open in. */
function pruneTabs(): void {
  const alive = (id: string): boolean => notes.some((n) => n.id === id);
  for (const p of panes) {
    const kept = keepTabs({ tabs: p.tabs, activeId: activeIn(p) }, alive);
    p.tabs = kept.tabs;
    if (p === panes[paneCtx]) ui.selectedId = kept.activeId;
    else p.activeId = kept.activeId;
  }
}

/**
 * The strip of open notes. Only there once a pane holds two: one note needs
 * no tab to tell it from the others, and the app is still a page of writing.
 */
function renderTabs(p: Pane): void {
  const strip = p.els.tabs;
  const show = p.tabs.length > 1;
  strip.hidden = !show;
  strip.replaceChildren();
  if (!show) return;
  const active = activeIn(p);
  for (const id of p.tabs) {
    const n = notes.find((x) => x.id === id);
    if (!n) continue;
    const name = shownTitle(n);
    const tab = document.createElement('div');
    tab.className = `tab${id === active ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === active));
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tab-name';
    open.textContent = name;
    open.title = name;
    open.addEventListener('click', () => {
      focusPane(panes.indexOf(p));
      select(id);
      focusEditor();
    });
    // The middle button closes a tab, as it does everywhere else.
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(p, id);
      }
    });
    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'tab-close';
    shut.title = `Close ${name}`;
    shut.setAttribute('aria-label', `Close ${name}`);
    shut.innerHTML = '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>';
    shut.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(p, id);
    });
    tab.append(open, shut);
    strip.append(tab);
  }
}

/** The panes as they should be remembered, ready for `saveUi`. */
function syncPanes(): void {
  if (panes.length === 0) return;
  stash(panes[paneCtx]);
  ui.panes = panes.map((p) => ({ tabs: [...p.tabs], activeId: p.activeId, preview: p.preview }));
  ui.paneAt = paneAt;
}

/** Builds the panes the window last had, or the one pane a new window starts with. */
function openPanes(): void {
  const saved = ui.panes.length > 0 ? ui.panes : [{ tabs: ui.selectedId ? [ui.selectedId] : [], activeId: ui.selectedId, preview: ui.preview }];
  for (const shape of saved.slice(0, MAX_PANES)) {
    const kept = keepTabs(shape, (id) => notes.some((n) => n.id === id));
    const p = makePane({ ...kept, preview: shape.preview });
    panes.push(p);
    el.panes.append(p.root);
  }
  paneAt = Math.max(0, Math.min(panes.length - 1, ui.paneAt));
  paneCtx = paneAt;
  unstash(panes[paneAt]);
  // A window whose remembered notes have all gone opens on the newest one.
  if (!ui.selectedId) {
    const first = sortByEdited(notes)[0]?.id ?? null;
    if (first) {
      panes[paneAt].tabs = [first];
      ui.selectedId = first;
    }
  }
  markFocused();
}

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
/** Whether the tag rail below the list is unfolded. */
let tagsOpen = false;
/** Every folder in the notebook, empty ones included: the tree, as it is on disk. */
let folders: string[] = [];
/**
 * The folder being browsed. The root — "All notes" — is the whole notebook,
 * and any other folder is itself and everything beneath it, the way a tag
 * stands for the tags nested inside it.
 *
 * This is state of its own rather than words typed into the search box: you
 * browse from branch to branch while a query stands, and choosing a folder
 * must not throw the question away.
 */
let folderScope = ROOT_FOLDER;
/** Which note the textarea currently holds, so re-renders never clobber the caret. */
let editorNoteId: string | null = null;

/**
 * The notes the sidebar shows. Plain words go through the search box's own
 * matching, as always; a query with an operator in it — `todo:`,
 * `due:today`, `links:Plan`, `/regex/` — is read by the same grammar the
 * command line uses, so the two never disagree about what a query means.
 */
/** The notes in the folder being browsed, and in the folders inside it. */
const inScope = (list: Note[]): Note[] => (folderScope ? list.filter((n) => folderMatches(n.folder ?? ROOT_FOLDER, folderScope)) : list);
const visibleNotes = (): Note[] => {
  const here = inScope(sortByEdited(notes));
  if (!hasOperators(query)) return searchNotes(here, query, tagFilter);
  const filter = parseQuery(query);
  if (tagFilter) filter.tags.push(tagFilter);
  return applyFilter(here, filter);
};
const filtering = (): boolean => query.trim() !== '' || tagFilter !== null || folderScope !== ROOT_FOLDER;
const selected = (): Note | null => notes.find((n) => n.id === ui.selectedId) ?? null;

/**
 * The note a right-click named, while a command it opened is running.
 *
 * Null the rest of the time, which is every other way a command is reached.
 */
let noteTarget: string | null = null;

/**
 * The note a command is *about*: the one a menu named, or failing that the one
 * on screen.
 *
 * Only commands read this. Rendering goes on reading `selected()`, so a target
 * can never draw the wrong note into a pane — it can only decide what a
 * command acts on, which is the whole of what the right-click menu changes.
 */
const targeted = (): Note | null => (noteTarget === null ? selected() : (notes.find((n) => n.id === noteTarget) ?? null));

/**
 * Runs something with a note named, and puts the target back afterwards.
 *
 * Every command that reads `targeted()` does so once, synchronously, before it
 * awaits anything or opens a chooser, and then closes over the note it found.
 * That is what makes a target this short-lived enough: by the time the folder
 * picker or the export is answered, the note it is answering about was decided
 * long ago. Delete is the one command that spans time, and it captures the id
 * itself rather than relying on this.
 */
function onNote<T>(id: string, run: () => T): T {
  const before = noteTarget;
  noteTarget = id;
  try {
    return run();
  } finally {
    noteTarget = before;
  }
}

// --- persistence ------------------------------------------------------------

const SAVE_DELAY = 300;
let dirty = false;
/** The note with words typed into it since the last save, if any: the one a file arriving from outside must not replace. */
let typedId: string | null = null;
let saveTimer: number | null = null;
let statusTimer: number | null = null;

/** The last change from outside taken in, quoted with every save: a note found after it is not deleted by a list made before it. */
let seenSeq = 0;

const toFile = (): NotesFile => ({ version: 1, notes, seen: seenSeq });

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
  typedId = null;
  try {
    await window.notesApi.save(toFile());
    // A failure left on the line stays until a save goes through: this one did.
    if (statusUntil === Infinity && el.status.textContent === 'Save failed') clearStatus();
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
  settlePendingTitle();
  if (!dirty) return null;
  dirty = false;
  typedId = null;
  return toFile();
});

// --- rendering --------------------------------------------------------------

const PIN_SVG =
  '<svg class="pin-mark" viewBox="0 0 12 12" aria-label="Pinned" role="img"><path d="M7.5 1.5 10.5 4.5 8.6 5.2 6.9 8.4 5.4 6.9 2 10.5 1.5 10 5.1 6.6 3.6 5.1 6.8 3.4Z" fill="currentColor"/></svg>';

/**
 * The folder rail: the notebook's own tree, above the list, because the list
 * is what is in the folder that is chosen.
 *
 * It always has a root row — "All notes" — and it is drawn even when there is
 * nothing else, so a notebook with no folders yet still says that folders are
 * a thing it has. A branch is unfolded while it is on the way to the folder
 * being browsed, exactly as the tag rail unfolds, so the rail needs no
 * control of its own.
 */
function renderFolders(): void {
  const tree = folderTree(
    folders,
    notes.map((n) => n.folder ?? ROOT_FOLDER),
  );
  const known = new Set<string>();
  const gather = (nodes: FolderNode[]): void => {
    for (const node of nodes) {
      known.add(node.folder);
      gather(node.children);
    }
  };
  gather(tree);
  // The folder being browsed has gone — deleted here, or in Explorer. Back to
  // the whole notebook rather than to a view of nothing.
  if (folderScope && !known.has(folderScope)) folderScope = ROOT_FOLDER;
  el.folderTree.replaceChildren();
  el.folderTree.append(folderRow({ folder: ROOT_FOLDER, label: ROOT_LABEL, count: notes.length, own: 0, children: [] }, 0));
  drawFolders(tree, 0);
}

function drawFolders(nodes: FolderNode[], depth: number): void {
  for (const node of nodes) {
    el.folderTree.append(folderRow(node, depth + 1));
    // Unfolded while it is on the way to the folder being browsed, and when it
    // is the one being browsed: choosing a folder is how you open it.
    if (folderMatches(folderScope, node.folder)) drawFolders(node.children, depth + 1);
  }
}

function folderRow(node: FolderNode, depth: number): HTMLButtonElement {
  const on = node.folder === folderScope;
  const row = document.createElement('button');
  row.className = 'folder';
  row.type = 'button';
  row.dataset.folder = node.folder;
  row.setAttribute('aria-pressed', String(on));
  row.style.paddingLeft = `${6 + depth * 11}px`;
  const name = document.createElement('span');
  name.className = 'folder-name';
  name.textContent = node.label;
  const count = document.createElement('span');
  count.className = 'folder-count u';
  count.textContent = String(node.count);
  row.append(name, count);
  row.title = node.folder ? `${folderLabel(node.folder)} — ${node.count} ${node.count === 1 ? 'note' : 'notes'}` : 'Every note in the notebook';
  row.addEventListener('click', () => browseFolder(node.folder));
  return row;
}

/** Browses a folder: the list narrows to it, and the query and the tag stand. */
function browseFolder(folder: string): void {
  folderScope = folder;
  ui.folder = folder;
  saveUi();
  renderList();
}

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
  el.tagRail.hidden = tree.length === 0;
  // Open while a tag is being filtered by, whatever was last chosen: the rail
  // may not say it is showing everything while it is not.
  const open = tagsOpen || tagFilter !== null;
  el.tagsFold.setAttribute('aria-expanded', String(open));
  el.tags.hidden = !open;
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

/**
 * The searches worth keeping, above the tags. A view is a name for a
 * question the search box can already answer — `due:week todo:` — so
 * clicking one simply types it, and everything downstream of the box
 * (the list, the count, the operator legend) needs to know nothing new.
 */
function renderViews(): void {
  const views = settings.views;
  el.views.hidden = views.length === 0;
  el.views.replaceChildren();
  if (views.length === 0) return;
  for (const view of views) {
    const on = query.trim() === view.query;
    const chip = document.createElement('button');
    chip.className = `view${on ? ' on' : ''}`;
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(on));
    chip.title = on ? 'Showing everything, again' : view.query;
    const name = document.createElement('span');
    name.className = 'view-name';
    name.textContent = view.name;
    chip.append(name);
    chip.addEventListener('click', () => runView(on ? null : view.name));
    el.views.append(chip);
  }
}

/** Puts a saved view's query in the search box, or clears the box when the name is null. */
function runView(name: string | null): void {
  const view = name === null ? null : viewNamed(settings.views, name);
  if (name !== null && !view) {
    showStatus(`No saved search called “${name}”`, 3000);
    return;
  }
  query = view?.query ?? '';
  el.search.value = query;
  tagFilter = null;
  renderSearchOps();
  const vis = visibleNotes();
  if (vis.length > 0 && !vis.some((n) => n.id === ui.selectedId)) {
    incidental = true;
    select(vis[0].id);
    incidental = false;
  } else renderList();
  if (view) showStatus(`${view.name}: ${view.query}`, 2500);
}

/** Saves the search in the box under a name, so one click asks it again. */
async function saveView(): Promise<void> {
  const q = query.trim();
  if (!q) {
    showStatus('Type a search first, then save it', 3000);
    return;
  }
  const existing = settings.views.find((v) => v.query === q);
  const name = await refactorUi.prompt('Name this search', existing?.name ?? q.slice(0, 24));
  if (name === null || !name.trim()) return;
  await saveSettings({ ...settings, views: withView(settings.views, name, q) });
  renderList();
  showStatus(`Saved as “${name.trim()}”`, 2500);
}

/** Takes a saved search off the rail. */
function forgetView(): void {
  if (settings.views.length === 0) {
    showStatus('No saved searches yet', 2500);
    return;
  }
  const items: PickItem[] = settings.views.map((v) => ({
    label: v.name,
    hint: v.query,
    run: () => {
      void saveSettings({ ...settings, views: settings.views.filter((o) => o.name !== v.name) }).then(() => {
        renderList();
        showStatus(`Forgot “${v.name}”`, 2500);
      });
    },
  }));
  openPicker('Which saved search to forget?', items);
}

function setTagFilter(tag: string | null): void {
  tagFilter = tag;
  const vis = visibleNotes();
  // Keep the current note when it still shows; otherwise land on the first.
  if (vis.length > 0 && !vis.some((n) => n.id === ui.selectedId)) {
    incidental = true;
    select(vis[0].id);
    incidental = false;
  }
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
      hint.textContent = 'Operators: todo: done: due:today tag: folder: pinned: created:>7d links: sort:title /regex/';
    } else {
      hint.innerHTML = 'Press <kbd>Enter</kbd> to start a note titled ';
      const title = document.createElement('b');
      title.className = 'as-typed';
      title.textContent = `“${q}”`;
      hint.append(title);
    }
    msg.append(hint);
  } else if (tagFilter) {
    msg.textContent = `No notes tagged #${tagFilter}.`;
  } else {
    // An empty folder is a place waiting to be filled, not a search that
    // found nothing, so it says how to put something in it.
    msg.textContent = `Nothing in ${folderLabel(folderScope)} yet.`;
    const hint = document.createElement('span');
    hint.className = 'u';
    hint.innerHTML = 'Press <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>M</kbd> to file a note here';
    msg.append(hint);
  }
  return msg;
}

function renderList(): void {
  renderViews();
  renderFolders();
  renderTags();
  const vis = visibleNotes();
  // Rebuilding the rows removes the one that has focus, and focus would fall
  // to the body: the list must be redrawn, and then be the list again.
  const hadFocus = el.list.contains(document.activeElement);
  el.list.replaceChildren();
  if (vis.length === 0) el.list.append(emptyListMessage());

  const now = Date.now();
  // Whether the folder being browsed has folders inside it: only then is a
  // note's own folder worth printing on its row.
  const nested = vis.some((n) => (n.folder ?? ROOT_FOLDER) !== folderScope);
  for (const n of vis) {
    const isSelected = n.id === ui.selectedId;
    const title = shownTitle(n);
    const item = document.createElement('div');
    // A note open in another pane carries the same margin rule, fainter: the
    // list says what is on screen, and more than one thing can be.
    const elsewhere = !isSelected && panes.some((p) => activeIn(p) === n.id);
    item.className = `item${isSelected ? ' selected' : ''}${elsewhere ? ' open' : ''}${title === 'Untitled' ? ' untitled' : ''}`;
    item.dataset.id = n.id;
    item.dataset.peek = qualifiedLink(notes, n);
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
    // Where it sits, but only when the scope has folders inside it and the
    // note is in one of them: in a folder with nothing under it the answer
    // would be the same on every row, and two notes called Plan need telling
    // apart without the title having to shrink to make room.
    const where = n.folder ?? ROOT_FOLDER;
    if (nested && where !== folderScope) {
      const at = document.createElement('span');
      // Sentence case, not the uppercase of a label: a folder is something
      // somebody named, and shouting it would crowd out the title.
      at.className = 'item-where';
      at.textContent = folderLabel(folderScope && where.startsWith(`${folderScope}/`) ? where.slice(folderScope.length + 1) : where);
      meta.append(at);
    }

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

/**
 * Where the note in this pane lives, said quietly in the header. It is a
 * statement, not a control: clicking it goes to that folder in the rail, and
 * filing the note anywhere is a command of its own, so an idle click on a
 * label can never move a note.
 */
function renderWhere(n: Note | null): void {
  const where = n?.folder ?? ROOT_FOLDER;
  el.where.hidden = n === null;
  if (!n) return;
  el.where.textContent = folderLabel(where);
  el.where.title = `${folderLabel(where)} — show this folder`;
}

function renderMeta(): void {
  const n = selected();
  if (!n) {
    el.edited.textContent = '';
    el.edited.title = '';
    el.words.textContent = '';
    return;
  }
  el.edited.textContent = relativeTime(n.updatedAt);
  el.edited.title = `Last edited ${absoluteTime(n.updatedAt)}`;
  const count = wordCount(n.body);
  el.words.textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
}

/**
 * Draws every pane. Each is drawn as though it were the pane in front, so the
 * one editor the rest of this file knows about is, in turn, each of them.
 */
function renderEditor(): void {
  pruneTabs();
  for (const p of panes) {
    withPane(p, () => {
      renderPane();
      renderTabs(p);
    });
  }
  const n = selected();
  document.title = n ? `${shownTitle(n)} – Notes` : 'Notes';
}

function renderPane(): void {
  const n = selected();
  const has = n !== null;
  el.editorWrap.hidden = !has;
  el.empty.hidden = has;
  syncControls();
  renderWhere(n);
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

  el.editor.hidden = ui.preview;
  el.preview.hidden = !ui.preview;
  if (ui.preview) {
    // The preview keeps its place when a checkbox is ticked, since ticking one
    // re-renders the whole article.
    const scroll = el.preview.scrollTop;
    el.preview.innerHTML = n.body.trim()
      ? renderMarkdown(n.body, embedsFrom(notes))
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
  renderMentions();
  renderOutline();
  syncChipUi();
  // The caret is in one pane only; the others have nothing to follow.
  if (inFocusedPane()) syncWriting();
}

/**
 * The panes showing a note must draw it again: what is on their screens is no
 * longer what the note says. The pane in front is left to its caller, which
 * usually has a caret to put back.
 */
function forgetDrawn(id: string): void {
  for (const p of panes) {
    if (p !== panes[paneAt] && p.activeId === id) p.editorNoteId = null;
  }
}

/** Every pane redraws: the way a body is drawn has changed, not the body. */
function forgetAllDrawn(): void {
  for (const p of panes) p.editorNoteId = null;
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
    // What a click opens is what a hover shows: the one rule for peeking.
    chip.dataset.peek = qualifiedLink(notes, other);
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
    chip.dataset.peek = qualifiedLink(notes, r.note);
    chip.title = r.reasons.join(' · ');
    chip.addEventListener('click', () => {
      select(r.note.id);
      focusEditor();
    });
    el.related.append(chip);
  }
}

/**
 * Notes that say this one's name — its title, or a name it answers to — in
 * plain words, without linking to it. A third strip under the other two,
 * because it answers the same question again: what belongs with this, that
 * nobody has joined up yet. Each chip goes to the note; the mark beside it
 * makes the link, as one undoable change.
 */
function renderMentions(): void {
  const n = selected();
  const found = n ? unlinkedMentions(notes, n.id, 8) : [];
  el.mentions.hidden = found.length === 0 || el.editorWrap.hidden;
  el.mentions.replaceChildren();
  if (!n || found.length === 0) return;
  const label = document.createElement('span');
  label.className = 'backlinks-label u';
  label.textContent = 'Mentioned in';
  el.mentions.append(label);
  for (const m of found) {
    const chip = document.createElement('span');
    chip.className = 'backlink mention';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mention-name';
    open.textContent = titleOf(m.note);
    open.dataset.peek = qualifiedLink(notes, m.note);
    open.title = m.text;
    open.addEventListener('click', () => {
      select(m.note.id);
      openAtLine(m.note.id, m.line);
    });
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'mention-link u';
    join.textContent = 'Link';
    join.title = `Turn “${m.name}” in “${titleOf(m.note)}” into a link to this note`;
    join.addEventListener('click', () => void linkMentionHere(m));
    chip.append(open, join);
    el.mentions.append(chip);
  }
}

/** Joins one mentioning note up to this one, as a Plan: previewed by its sentence, undone in one step. */
async function linkMentionHere(m: Mention): Promise<void> {
  const n = selected();
  if (!n) return;
  const planned = planLinkMention(notes, m.note.id, n.id, m);
  if (!planned.ok) {
    showStatus(planned.message, 3000);
    return;
  }
  const done = await applyPlanHere(planned.plan);
  if (!done.ok) {
    showStatus(done.message, 3000);
    return;
  }
  afterPlan(planned.plan);
  showStatus(`Linked from “${titleOf(m.note)}” · Ctrl+Z undoes it`, 3500);
}

/**
 * Follows a [[link]]: to the note whose title it names, or to a new note with
 * that title. Writing the link is how a note gets started, the way it works
 * in every app that has them.
 */
function openLink(target: string): void {
  // A whole title may itself contain a #, so the plain name is tried first;
  // only when nothing answers to it is the address read apart.
  const whole = target.trim();
  const address = noteForLink(notes, whole) ? { target: whole } : parseLinkAddress(whole);
  const here = selected();
  // An empty name means this note: `[[#^k3n9dq]]` and `[[#Heading]]`.
  const name = address.target.trim() || (here ? titleOf(here) : '');
  if (!name) return;
  const hit = resolveLink(notes, name);
  if (hit.kind === 'one') {
    goToAddress(hit.note, address);
    return;
  }
  // Folders make two notes called Plan legal, so the link can no longer say
  // which. The app will not guess: it asks, and then writes the answer into
  // the link, so the question is asked once.
  if (hit.kind === 'many') {
    askWhichNote(name, hit.notes);
    return;
  }
  newNote(name);
  showStatus(`Started “${name}”`, 2500);
}

/** Opens a note a link landed on, past whatever the sidebar was narrowed to. */
function goToLinked(id: string): void {
  if (filtering()) clearFilters();
  select(id);
  focusEditor();
}

/**
 * Follows a link all the way to what it named: the note, and then the heading
 * or the block inside it.
 *
 * A block that is missing or written twice is said out loud and goes nowhere.
 * It never falls back to the note, and never offers to make one — the note is
 * right there; it is the paragraph that has gone.
 */
function goToAddress(note: Note, address: LinkAddress): void {
  if (address.block) {
    const hit = blockOf(note.body, address.block);
    if (hit.kind === 'none') {
      showStatus(`Block \u005e${address.block} was not found in “${titleOf(note)}”`, 4000);
      return;
    }
    if (hit.kind === 'many') {
      showStatus(`Block \u005e${address.block} is written more than once in “${titleOf(note)}”`, 4000);
      return;
    }
    if (filtering()) clearFilters();
    openAtLine(note.id, hit.block.start);
    return;
  }
  if (address.heading) {
    const found = headingsIn(note.body).find((h) => h.text.toLowerCase() === address.heading?.toLowerCase());
    if (found) {
      if (filtering()) clearFilters();
      openAtLine(note.id, found.line);
      return;
    }
  }
  goToLinked(note.id);
}

/**
 * Which of the notes a name answers to was meant. Choosing one settles the
 * link as well as following it: the link is rewritten to `[[Work/Plan]]`, the
 * spelling that means that note and no other, so the same question is not
 * asked again. The same move the app already makes when a typed name turns
 * out to be some note's alias and it writes `[[Dog|Doggo]]`.
 */
function askWhichNote(name: string, found: Note[]): void {
  const rows: PickItem[] = found.map((n) => ({
    label: shownTitle(n),
    hint: folderLabel(n.folder ?? ROOT_FOLDER),
    run: () => {
      settleLink(name, qualifiedLink(notes, n));
      goToLinked(n.id);
    },
  }));
  openPicker(`Which “${name}”?`, rows);
}

/** Rewrites every `[[was]]` in the note on screen to `[[now]]`, aliases kept. */
function settleLink(was: string, now: string): void {
  const n = selected();
  if (!n || was === now) return;
  const { body, count } = rewriteLinks(n.body, was, now);
  if (count === 0) return;
  notes = updateBody(notes, n.id, body);
  editorNoteId = null;
  scheduleSave();
  showStatus(`The link now reads [[${now}]]`, 4000);
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
  // A bang in front makes it an embed: the note itself, here, in the preview.
  const bang = before.endsWith(`!${m[0]}`);
  const range = document.createRange();
  range.setStart(pos.node, pos.offset - m[0].length - (bang ? 1 : 0));
  range.setEnd(pos.node, pos.offset);
  range.deleteContents();
  const typed = parseLinkAddress(m[1]);
  // A name that is only some note's alias is written the way it will be read:
  // `[[Dog|Doggo]]`, so the file says which note it means and the page still
  // says what the writer typed — as Obsidian writes an alias reference.
  const named = !bang && !typed.alias ? noteForLink(notes, typed.target) : null;
  const settled = named && linkKey(titleOf(named)) !== linkKey(typed.target) ? { target: titleOf(named), alias: typed.target } : typed;
  const chip = bang ? makeEmbed(typed.target) : makeLink(settled.target, settled.alias);
  range.insertNode(chip);
  caretAfter(chip);
}

/**
 * Peeks whatever the keyboard is on: a link chip at the caret, or a focused
 * row that opens a note. Pinned, because a card asked for by name should not
 * vanish the moment the pointer moves.
 */
function peekHere(): void {
  if (peek.isOpen()) {
    peek.hide();
    return;
  }
  const found = peekableAtFocus();
  if (!found) {
    showStatus('Put the caret in a link, or choose a backlink, to peek it', 3500);
    return;
  }
  peek.show({ address: found.address, fromId: selected()?.id }, found.box, true);
}

/** The link the keyboard is on: a chip beside the caret, or a focused row. */
function peekableAtFocus(): { address: string; box: DOMRect } | null {
  const active = document.activeElement as HTMLElement | null;
  const row = active?.closest<HTMLElement>('[data-peek]');
  if (row) return { address: row.dataset.peek ?? '', box: row.getBoundingClientRect() };
  const chip = selectedChip() ?? chipBesideCaret();
  if (chip && isLink(chip)) return { address: chip.dataset.link ?? '', box: chip.getBoundingClientRect() };
  return null;
}

/** A link chip immediately before or after the caret. */
function chipBesideCaret(): HTMLElement | null {
  const pos = caretPos();
  if (!pos) return null;
  const near: Array<Node | null> = [];
  if (pos.node.nodeType === Node.TEXT_NODE) near.push(pos.node.previousSibling, pos.node.nextSibling, pos.node.parentElement);
  else near.push(pos.node.childNodes[pos.offset] ?? null, pos.node.childNodes[pos.offset - 1] ?? null);
  for (const node of near) {
    if (node && isLink(node)) return node;
    const el = node instanceof Element ? node.querySelector<HTMLElement>('.inline-link') : null;
    if (el) return el;
  }
  return null;
}

/**
 * Anything a pointer can peek: the rule is that a stable element whose click
 * opens a specific note or address may show what it points at. Everything
 * that qualifies is delegated from one listener rather than wired per row —
 * a hover must not cost anything while nothing is being hovered.
 */
const PEEKABLE = '.inline-link, [data-link], [data-peek]';

document.addEventListener(
  'pointerover',
  (e) => {
    if (!ui.linkPeek) return;
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(PEEKABLE);
    if (!target) return;
    // A palette row, a picker row, an outline heading and a folder row are
    // not peekable: a sheet must not spawn a second floating surface.
    if (target.closest('#palette, #pick-sheet, .sheet, #outline, #folder-tree')) return;
    const address = target.dataset.peek ?? target.dataset.link ?? '';
    if (!address) return;
    peek.hover({ address, fromId: selected()?.id }, () => {
      const box = target.getBoundingClientRect();
      return box.width === 0 && box.height === 0 ? null : box;
    });
  },
  true,
);

document.addEventListener(
  'pointerout',
  (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(PEEKABLE);
    // No pinned check here: `unhover` cancels the pending open before it
    // looks at the card, and skipping it left that timer to fire and replace
    // a pinned card with one for a link the pointer had already left --
    // which then had nothing to close it.
    if (target) peek.unhover();
  },
  true,
);

// Scrolling moves what a card is anchored to, so the card goes — but not the
// one that was asked for by name, and never because the card scrolled itself
// or took the focus and brought itself into view.
document.addEventListener(
  'scroll',
  (e) => {
    if (peek.isPinned()) return;
    const from = e.target;
    if (from instanceof Node && document.querySelector('.peek')?.contains(from)) return;
    peek.hide();
  },
  true,
);
window.addEventListener('blur', () => peek.hide());

/** Clears the search box and any tag filter, so a note can always be shown. */
function clearFilters(): void {
  query = '';
  el.search.value = '';
  tagFilter = null;
  folderScope = ROOT_FOLDER;
  // `ui.folder` is the one that is written down and read back at the next
  // launch, so leaving it behind reopened the window in a folder the reader
  // had left -- with the note they were reading not in the list.
  ui.folder = ROOT_FOLDER;
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
  let i = 0;
  el.preview.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
    // The nth box is the nth task line tasksIn counts, which is a list item's; a checkbox written as HTML is not one.
    if (!box.closest('li')) {
      box.disabled = true;
      return;
    }
    box.disabled = false;
    box.dataset.task = String(i++);
    box.setAttribute('aria-label', box.checked ? 'Done' : 'Not done');
  });
}

function applySidebar(): void {
  el.app.classList.toggle('sidebar-hidden', ui.sidebarHidden);
}

function applyLayout(): void {
  // On <html>, not the app root: the size tokens are defined in :root and a
  // custom property resolves its var() where it is defined, so a multiplier
  // set any lower down would never reach them.
  document.documentElement.style.setProperty('--ui-scale', String(ui.uiScale));
  document.documentElement.style.setProperty('--reading-scale', String(ui.readingScale));
  el.uiScale.value = String(ui.uiScale);
  el.uiScaleOut.value = percent(ui.uiScale);
  el.readingScale.value = String(ui.readingScale);
  el.readingScaleOut.value = percent(ui.readingScale);
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

/**
 * Shows a note in the pane with the focus. The pane's open tab becomes that
 * note — choosing from the list turns the page rather than piling up tabs —
 * unless the note is already open in a tab of its own, which is then the one
 * brought forward.
 */
function select(id: string | null): void {
  const p = panes[paneCtx];
  if (p) p.tabs = showTab({ tabs: p.tabs, activeId: ui.selectedId }, id).tabs;
  if (ui.selectedId !== id) {
    disarmDelete();
    // The history sheet and the find bar are about one note; they do not
    // follow you to another.
    if (!el.historySheet.hidden) toggleHistory(false);
    if (!el.findBar.hidden) closeFind(false);
    // A command waiting on `notes open --wait` learns the note left the screen —
    // unless another pane still has it, in which case it never left.
    const going = ui.selectedId;
    if (going && !panes.some((p) => p !== panes[paneCtx] && p.activeId === going)) window.notesApi.noteClosed(going);
    // Where this note is being left from, for Back — unless Back itself is
    // doing the leaving, or this note was only where the search had landed
    // on the way: the reader's departure is from the note before that.
    if (!travelling && !arrivedIncidentally) {
      const from = placeHere();
      if (from) journey = leave(journey, from);
    }
    // A title still being typed goes onto the note being left, not away with it.
    settlePendingTitle();
    if (id && !incidental) ui.recent = visited(ui.recent, id, Date.now());
  }
  // Choosing the note the search had landed on makes the arrival deliberate.
  arrivedIncidentally = incidental;
  ui.selectedId = id;
  saveUi();
  renderList();
  renderEditor();
  // The title box may keep the focus across a chord: what it types next is this note's.
  if (document.activeElement === el.title) {
    const n = selected();
    titleAtFocus = n ? { id: n.id, title: n.title } : null;
  }
}

function focusEditor(): void {
  if (!selected()) return;
  if (ui.preview) {
    el.preview.focus();
    return;
  }
  returnToEditor();
}

/**
 * Where the caret stood in the editor when a sheet took the focus. Chromium
 * puts the caret at the very start of a contenteditable it focuses from
 * elsewhere, so a command chosen from the picker or the palette would act
 * on the first line: the offset is kept here and put back.
 */
let caretBefore: { id: string; at: number } | null = null;

function keepCaret(): void {
  const n = selected();
  caretBefore = n && document.activeElement === el.editor && editorNoteId === n.id ? { id: n.id, at: caretOffsetOrStart() } : null;
}

/** Focus back in the editor: the caret where it was before a sheet took it, else at the end, ready to write. */
function returnToEditor(): void {
  const alreadyHere = document.activeElement === el.editor;
  el.editor.focus();
  if (!alreadyHere) {
    const n = selected();
    if (caretBefore && n && caretBefore.id === n.id && editorNoteId === n.id) placeCaretAt(Math.min(caretBefore.at, n.body.length));
    else caretToEnd();
  }
  caretBefore = null;
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

/**
 * Opens the note for a date, making it if there is none.
 *
 * Occupancy is the whole of a journal entry's identity: whatever note is at
 * the path the format produces *is* that date's note. One that is already
 * there is opened and **nothing is written to it** — no template reapplied,
 * no title repaired, no front matter touched because somebody looked at it.
 */
async function openJournal(date: JournalDate): Promise<void> {
  const place = journalPlace(date, settings.journalPath);
  const already = journalNoteAt(notes, place);
  if (already) {
    clearFilters();
    select(already.id);
    focusEditor();
    showStatus(`Journal for ${isoDate(date)}`, 2000);
    return;
  }
  const template = settings.journalTemplateId ? notes.find((n) => n.id === settings.journalTemplateId) : null;
  if (settings.journalTemplateId && !template) showStatus('The journal template is gone; starting an empty entry', 4000);
  const n = createNote();
  n.title = place.title;
  // The entry's own day, not the moment it is being written: a back-filled
  // note stamped with today would say the wrong date in its own heading.
  if (template) n.body = expandTemplate(template, { title: place.title, now: momentOf(date) });
  notes = [n, ...notes];
  scheduleSave();
  clearFilters();
  if (ui.preview) ui.preview = false;
  select(n.id);
  focusEditor();
  caretToEnd();
  if (place.folder) {
    // Today's note is the one thing allowed to make a folder while filing,
    // and only because a command asked it to.
    await flush();
    if (tookFolders(await window.notesApi.createFolder(place.folder))) {
      if (tookFolders(await window.notesApi.moveNote(n.id, place.folder))) {
        renderList();
        renderEditor();
      }
    }
  }
  showStatus(`Started the journal for ${isoDate(date)}`, 3000);
}

/** Asks which day, in the words the app already reads for a date. */
function pickJournalDate(): void {
  const now = new Date();
  const offer = ['today', 'yesterday', 'tomorrow', '-2d', '-7d', '+7d'];
  const rowFor = (said: string): PickItem | null => {
    const date = parseJournalDate(said, now);
    if (!date) return null;
    const place = journalPlace(date, settings.journalPath);
    return {
      label: isoDate(date),
      hint: `${said} · ${journalNoteAt(notes, place) ? 'written' : 'new'} · ${place.path}`,
      run: () => void openJournal(date),
    };
  };
  const items = offer.map(rowFor).filter((row): row is PickItem => row !== null);
  openPicker('Journal for which day?', items, focusEditor, {
    typed: (raw) => {
      const date = parseJournalDate(raw, now);
      if (!date) return null;
      const place = journalPlace(date, settings.journalPath);
      return { label: isoDate(date), hint: `${journalNoteAt(notes, place) ? 'written' : 'new'} · ${place.path}`, run: () => void openJournal(date) };
    },
  });
}

/** A note whose title is what was typed into the search box. */
function createFromSearch(): void {
  const title = query.trim();
  if (!title) return;
  newNote(title);
  showStatus(`Started “${title}”`, 2000);
}

function togglePinSelected(): void {
  const n = targeted();
  if (!n) return;
  notes = togglePin(notes, n.id);
  scheduleSave();
  renderList();
  renderEditor();
  selectedItemIntoView();
  // The note that was pinned, not the one on screen: a right-click pins a row
  // without going to it, and the word has to be about the row.
  showStatus(notes.find((x) => x.id === n.id)?.pinned ? 'Pinned' : 'Unpinned', 1500);
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
/** The menu row that is armed, when the delete came from a menu rather than a chord. */
let armedRow: HTMLElement | null = null;
/**
 * The note the arming was about. Delete is the one command that spans time, so
 * it remembers its own note rather than trusting the target to still be set
 * three seconds later — or the selection not to have moved under it.
 */
let armedId: string | null = null;

/**
 * Deleting takes two presses within three seconds. From a menu the row itself
 * arms, and the menu stays open under it: a confirmation you have to go and
 * find again is not a confirmation.
 */
function armDelete(row?: HTMLElement): void {
  const n = targeted();
  if (!n) return;
  // The second press deletes what the first one asked about. Asking about a
  // different note is a fresh question, not an answer to the old one.
  if (armed && armedId === n.id) {
    deleteNote(n.id);
    return;
  }
  if (armed) disarmDelete();
  armed = true;
  armedId = n.id;
  armReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  armedRow = row ?? null;
  if (armedRow) {
    armedRow.classList.add('armed');
    const label = armedRow.querySelector('.menu-label');
    if (label) label.textContent = 'Delete this note — click again';
    armedRow.focus();
    showStatus('Click again to delete this note', ARM_MS);
  } else {
    showStatus('Press Ctrl+Shift+D again to delete this note', ARM_MS);
  }
  armTimer = window.setTimeout(() => disarmDelete(true), ARM_MS);
}

function disarmDelete(restoreFocus = false): void {
  if (!armed) return;
  armed = false;
  armedId = null;
  if (armTimer !== null) clearTimeout(armTimer);
  armTimer = null;
  if (armedRow) {
    armedRow.classList.remove('armed');
    const label = armedRow.querySelector('.menu-label');
    if (label) label.textContent = 'Delete this note';
    if (restoreFocus && document.activeElement === armedRow) armReturnFocus?.focus();
  }
  armedRow = null;
  armReturnFocus = null;
}

/**
 * Deletes one note by name, whether or not it is the one being read.
 *
 * Deleting the note on screen has to put something else there, and that is
 * most of what this does. Deleting one you only right-clicked must do the
 * opposite and leave the screen alone: you asked about a row, not about where
 * you were.
 */
function deleteNote(id: string): void {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  const onScreen = ui.selectedId === id;
  const next = onScreen ? neighborOf(visibleNotes(), id) : null;
  const title = titleOf(n);
  // Words typed since the last save go to the file first, so the trash holds them.
  void flush();
  notes = removeNote(notes, id);
  editLogs.delete(id);
  scheduleSave();
  disarmDelete();
  if (onScreen) {
    select(next);
    if (next) focusList();
    else el.search.focus();
  } else {
    renderList();
  }
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
  returnToEditor();
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
  typedId = n.id;
  scheduleSave();
  renderList();
  renderMeta();
  renderOutline();
  if (!el.findBar.hidden) refreshFind();
  mirrorSoon(n.id);
}

/**
 * A note open in two panes is one note. The other pane catches up shortly
 * after the typing stops rather than on every keystroke: redrawing a long
 * note twice per character is work nobody asked for, and the pane being
 * written in is the one that has to stay quick.
 */
const MIRROR_DELAY = 150;
let mirrorTimer: number | null = null;

function mirrorSoon(id: string): void {
  if (onlyPane()) return;
  if (mirrorTimer !== null) clearTimeout(mirrorTimer);
  mirrorTimer = window.setTimeout(() => {
    mirrorTimer = null;
    for (const p of panes) {
      if (p === panes[paneAt] || p.activeId !== id) continue;
      withPane(p, () => {
        const top = el.editor.scrollTop;
        const previewTop = el.preview.scrollTop;
        editorNoteId = null;
        renderPane();
        el.editor.scrollTop = top;
        el.preview.scrollTop = previewTop;
      });
    }
  }, MIRROR_DELAY);
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
  const target = ui.selectedId;
  let attached = 0;
  for (const file of images) {
    try {
      const url = await window.notesApi.attach(new Uint8Array(await file.arrayBuffer()), file.name || 'image.png');
      if (ui.selectedId !== target) {
        // The picture was written, but the note it was for is no longer on screen; it is not put into this one.
        showStatus('The note changed while attaching; nothing was inserted', 4000);
        return;
      }
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
  let urls: string[];
  try {
    urls = await window.notesApi.pickAttachments();
  } catch (err) {
    console.error('[notes] attach failed', err);
    showStatus(err instanceof Error ? err.message.replace(/^.*Error: /, '') : 'Could not attach that image', 4000);
    return;
  }
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
  // Whichever pane the file is over is the pane it lands in.
  const over = paneOf(e.target as Node);
  if (over) focusPane(panes.indexOf(over));
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
    for (const p of panes) p.root.classList.remove('dropping');
  }
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  for (const p of panes) p.root.classList.remove('dropping');
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

onPane('imgHandle', 'pointerdown', (e) => {
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

onPane('imgHandle', 'pointermove', (e) => {
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
onPane('imgHandle', 'pointerup', endResize);
onPane('imgHandle', 'pointercancel', endResize);

onPane('editor', 'click', (e) => {
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
  peek.forget(n.id);
  notes = updateBody(notes, n.id, body);
  scheduleSave();
  // The editor only re-renders on a note switch, so tell it this counts as one.
  editorNoteId = null;
  forgetDrawn(n.id);
  renderList();
  renderEditor();
  // The find bar's hits were offsets into the old text.
  if (!el.findBar.hidden) refreshFind();
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
  /** Set on a step that is one of a Plan's across several notes: undo takes the whole Plan back. */
  group?: string;
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

/**
 * Remembers the state of a note that is not on screen before the app changes
 * it — a task ticked from the due sheet, a quick note into the Inbox — so
 * that undo there takes the change out, and a redo left over cannot put an
 * older text back over it.
 */
function rememberFor(id: string): void {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  const log = editLogFor(id);
  log.undo.push({ text: n.body, caret: 0 });
  if (log.undo.length > UNDO_LIMIT) log.undo.shift();
  log.redo = [];
  log.lastKind = '';
}

/** Keeps the state before an edit of `kind`, folding a run of typing into one step. */
/**
 * While this holds a note's id, the next edit remembered for that note joins
 * the step already on the log rather than pushing one of its own.
 *
 * The `/` menu needs it: taking the query out and putting the command's own
 * words in are two calls, and one Ctrl+Z has to undo both. The command may
 * open a chooser first, so a time window would not do — the latch is cleared
 * by the edit it was armed for, whenever that comes.
 */
let joinNextEdit: string | null = null;

function rememberEdit(before: EditState, kind: string): void {
  const n = selected();
  if (!n) return;
  const log = editLogFor(n.id);
  if (joinNextEdit === n.id) {
    joinNextEdit = null;
    log.lastAt = Date.now();
    log.lastKind = kind;
    log.redo = [];
    return;
  }
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
  // A step that was a change across notes goes back across all of them.
  const group = groupOf(log.undo[log.undo.length - 1]);
  if (group) {
    void runGroup(group, 'undo');
    return;
  }
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
  const group = groupOf(log.redo[log.redo.length - 1]);
  if (group) {
    void runGroup(group, 'redo');
    return;
  }
  const after = log.redo.pop();
  if (!after) return;
  log.undo.push({ text: n.body, caret: caretOffsetOrStart() });
  log.lastKind = '';
  restoreEdit(after);
}

// Links in the preview are the same links, and go to the same place.
onPane('preview', 'click', (e) => {
  if (isLink(e.target)) {
    e.preventDefault();
    openLink(linkTargetOf(e.target));
  }
});

// Ticking a box in the preview writes the change back into the markdown.
onPane('preview', 'click', (e) => {
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
onPane('editor', 'dblclick', (e) => {
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
onPane('editor', 'scroll', () => positionHandle(selectedChip()));
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

onPane('editor', 'dragstart', (e) => {
  if (!isChip(e.target) || !e.dataTransfer) return;
  dragChip = e.target;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-notes-image', e.target.dataset.asset ?? '');
  e.target.classList.add('dragging');
  positionHandle(null);
});

onPane('editor', 'dragend', () => {
  dragChip?.classList.remove('dragging');
  dragChip = null;
  showDropLine(null);
  syncChipUi();
});

// --- export -----------------------------------------------------------------

/** The formats a note can leave in, in the order the menu offers them. */
const EXPORT_KINDS: { kind: ExportKind; label: string; ext: string }[] = [
  { kind: 'md', label: 'Markdown', ext: '.md' },
  { kind: 'txt', label: 'Plain text', ext: '.txt' },
  { kind: 'html', label: 'Web page', ext: '.html' },
  { kind: 'pdf', label: 'Document', ext: '.pdf' },
  { kind: 'png', label: 'Image', ext: '.png' },
];

const fileNameOf = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/**
 * The note as the preview shows it, ready to be laid on a page: math
 * rendered, diagrams drawn (in the theme the page will have), and the
 * stylesheets the page needs. The PNG, the PDF and the HTML export all
 * start from this, as does `notes render --html` through the window.
 */
async function renderedExport(n: Note, look: 'ink' | 'paper' = 'ink'): Promise<RenderedExport> {
  const body = exportBody(n);
  let html = renderMarkdown(body, embedsFrom(notes));
  if (hasDiagrams(html)) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    await renderDiagrams(holder, look === 'paper' ? 'neutral' : 'dark');
    html = holder.innerHTML;
  }
  return { title: titleOf(n), html, css: stylesText, mathCss: hasMath(html) ? katexText : undefined, edited: `Edited ${absoluteTime(n.updatedAt)}` };
}

async function runExport(kind: ExportKind): Promise<void> {
  const n = targeted();
  if (!n) return;
  closeMenu(false);
  focusEditor();
  const title = titleOf(n);
  const body = exportBody(n);
  showStatus('Exporting…', 0);
  try {
    let request: ExportRequest;
    if (kind === 'md') request = { kind, title, body };
    else if (kind === 'txt') request = { kind, title, text: markdownToText(body) };
    else request = { kind, ...(await renderedExport(n, kind === 'pdf' ? 'paper' : 'ink')) };
    const savedTo = await window.notesApi.exportNote(request);
    if (savedTo) showStatus(`Exported to ${fileNameOf(savedTo)}`, 4000);
    else clearStatus();
  } catch (err) {
    console.error('[notes] export failed', err);
    showStatus('Export failed', 4000);
  }
}

// --- tables -----------------------------------------------------------------

/**
 * A change to the table the caret is in, written back with the caret put in
 * the cell the change chose. Returns false when the caret is not in a table,
 * so the key that asked keeps its usual meaning.
 */
function applyTableEdit<A extends unknown[]>(edit: (body: string, offset: number, ...args: A) => TableEdit | null, ...args: A): boolean {
  const n = selected();
  if (!n || ui.preview || document.activeElement !== el.editor) return false;
  const { text } = readEditor(el.editor);
  const next = edit(text, caretOffset(), ...args);
  if (!next) return false;
  // A table that is already laid out is left exactly as it is -- but the caret
  // still has to move, or Tab in a tidy table does nothing at all while still
  // swallowing the key. A fresh table is laid out from the start, so this was
  // every table until the first edit untidied it.
  if (next.body === text) {
    placeCaretAt(next.caret);
    return true;
  }
  // One undo step: setBody remembers the text before it changed.
  setBody(next.body);
  placeCaretAt(next.caret);
  return true;
}

/**
 * A table where the caret is, or the one it is in laid out again. Tables are
 * the one common block the editor did not help with, and a hand-typed one
 * drifts out of line the moment a cell grows.
 */
function tableHere(): void {
  ensureEditable();
  if (applyTableEdit(tidyTable)) {
    showStatus('Table lined up · Tab moves between cells', 2500);
    return;
  }
  if (!selectionInEditor()) caretToEnd();
  const made = newTable();
  insertAtCaret(`\n${made}\n`);
  // The caret goes into the first cell rather than after the block.
  const n = selected();
  if (n) {
    const at = n.body.indexOf(made);
    if (at >= 0) placeCaretAt(at + 2);
  }
  showStatus('Tab moves between cells; the last one makes a row', 3500);
}

// --- editor input -----------------------------------------------------------

/** True between compositionstart and compositionend: an IME owns the text then. */
let composing = false;
onPane('editor', 'compositionstart', () => {
  composing = true;
});
// Moving the caret out of the query, or leaving the editor, closes the menu
// and leaves what was typed: it is the note's own text either way.
onPane('editor', 'keyup', (e) => {
  if (slash.isOpen() && e instanceof KeyboardEvent && e.key.startsWith('Arrow')) slash.sync();
});
onPane('editor', 'pointerup', () => {
  if (slash.isOpen()) slash.sync();
});
onPane('editor', 'blur', () => slash.close());
onPane('editor', 'compositionend', () => {
  composing = false;
  decorateAfterInput();
});

onPane('editor', 'input', (e) => {
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
  // The menu is read from the caret's own line every time, so it opens,
  // filters and closes without holding any state of its own about the text.
  if (!composing) slash.sync();
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
onPane('editor', 'copy', (e) => {
  const range = selectionRangeInEditor();
  if (!range || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', textOfRange(range));
});
onPane('editor', 'cut', (e) => {
  const range = selectionRangeInEditor();
  if (!range || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', textOfRange(range));
  document.execCommand('delete');
});
// What comes in is text: pasted HTML would bring its own tags, which the
// serializer would drop and the formatting would then fight.
onPane('editor', 'paste', (e) => {
  if (!e.clipboardData || e.clipboardData.files.length > 0) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  markEdit();
  document.execCommand('insertText', false, text.replace(/\r\n/g, '\n'));
});

// Enter inserts a plain line break rather than a new paragraph block, so the
// content stays a flat run of text, breaks and image chips.
onPane('editor', 'beforeinput', (e) => {
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

onPane('editor', 'keydown', (e) => {
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
    // A selected picture or rule is not text to indent: the spaces would take its place.
    if (chip) return;
    // In a table, Tab is the next cell instead — and the last cell makes a row.
    if (applyTableEdit(stepCell, e.shiftKey ? -1 : 1)) return;
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

/**
 * What the title box shows while it has the focus. The note keeps its title
 * until Enter or blur commits the new one, so that a rename can be planned
 * — the links in other notes updated with it — against the title as it was.
 */
let pendingTitle: string | null = null;
let titleAtFocus: { id: string; title: string | undefined } | null = null;

onPane('title', 'focus', () => {
  const n = selected();
  titleAtFocus = n ? { id: n.id, title: n.title } : null;
});
onPane('title', 'input', () => {
  if (!selected()) return;
  pendingTitle = el.title.value;
  renderList();
  renderMeta();
});

/** The title as the list and the window bar show it: the one being typed, if any. */
function shownTitle(n: Note): string {
  return pendingTitle !== null && n.id === ui.selectedId ? titleOf({ body: n.body, title: pendingTitle }) : titleOf(n);
}

/** True while a rename waits on its question, so the blur that the question causes does not start another. */
let committingTitle = false;

/**
 * Puts a title still being typed onto its note, without the question about
 * links: for leaving the note by a chord, or the window closing, when there
 * is no blur to commit it and no moment for a question.
 */
function settlePendingTitle(): void {
  const n = selected();
  const pending = pendingTitle;
  pendingTitle = null;
  if (pending === null || !n || committingTitle) return;
  const next = pending.trim();
  if (next === (n.title ?? '').trim()) return;
  notes = updateTitle(notes, n.id, next);
  scheduleSave();
}

/** Puts the title in the box onto the note; when links pointed at the old one, offers to update them. */
async function commitTitle(): Promise<void> {
  if (committingTitle) return;
  const n = selected();
  const pending = pendingTitle;
  const was = titleAtFocus;
  if (!n || pending === null || !was || was.id !== n.id) {
    pendingTitle = null;
    renderList();
    renderMeta();
    return;
  }
  const next = pending.trim();
  if (next === (n.title ?? '').trim()) {
    pendingTitle = null;
    renderList();
    renderMeta();
    return;
  }
  if (!next) {
    pendingTitle = null;
    notes = updateTitle(notes, n.id, '');
    scheduleSave();
    renderList();
    renderMeta();
    return;
  }
  // The typed title stays on show while the question about the links is open.
  committingTitle = true;
  try {
    const how = await refactorUi.commitRename(n.id, was.title, next);
    if (how === 'none' || how === 'failed') el.title.value = selected()?.title ?? '';
  } finally {
    committingTitle = false;
    pendingTitle = null;
  }
  renderList();
  renderMeta();
}

/** The note started from a template whose {{title}} is waiting for the title to be typed. */
let titleFill: string | null = null;

/** Puts the title into the {{title}} placeholders of a note made from a template, once it has one. */
function fillTitlePlaceholder(): void {
  const n = selected();
  if (!n || n.id !== titleFill) return;
  const title = n.title?.trim();
  if (!title) return;
  titleFill = null;
  if (!usesTitle(n.body)) return;
  notes = updateBody(notes, n.id, n.body.replace(/\{\{\s*title\s*\}\}/gi, title));
  editorNoteId = null;
  forgetDrawn(n.id);
  renderEditor();
  scheduleSave();
}

onPane('title', 'blur', () => void commitTitle().then(fillTitlePlaceholder));
onPane('title', 'keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    // The title is committed first — a rename that asks about links holds the
    // focus meanwhile — and then the editor gets it, at the start of the text.
    void commitTitle()
      .then(fillTitlePlaceholder)
      .then(() => {
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
      });
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
    el.uiScale.focus();
    void refreshCliRow();
  } else focusEditor();
}

el.uiScale.addEventListener('input', () => {
  ui.uiScale = clampScale(el.uiScale.value, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT);
  saveUi();
  applyLayout();
});
el.readingScale.addEventListener('input', () => {
  ui.readingScale = clampScale(el.readingScale.value, READING_SCALE_MIN, READING_SCALE_MAX, READING_SCALE_DEFAULT);
  saveUi();
  applyLayout();
});
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
el.controlsShow.addEventListener('change', () => {
  if (el.controlsShow.checked !== ui.controls) toggleControls();
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
    // Closed from inside, the focus goes back to the editor; closed because
    // another note was chosen from the search box, the box keeps it.
    if (el.historySheet.contains(document.activeElement)) focusEditor();
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
  // Another note may have been chosen while the files were written: the snapshot is this note's alone.
  if (selected()?.id !== n.id) return;
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

function renderSettings(warnings: Partial<Record<HotkeyRow['key'], string>> = {}): void {
  el.closeTray.checked = settings.closeToTray;
  el.peekOn.checked = ui.linkPeek;
  el.remindersOn.checked = settings.reminders;
  if (document.activeElement !== el.journalPath) el.journalPath.value = settings.journalPath;
  const template = settings.journalTemplateId ? notes.find((n) => n.id === settings.journalTemplateId) : null;
  el.journalTemplate.textContent = template ? `Template: ${titleOf(template)}` : 'Template…';
  // Today's path, worked out from the format as it stands, so the setting can
  // be read rather than imagined.
  const place = journalPlace(dateOf(new Date()), settings.journalPath);
  el.journalNote.textContent = `Today would be ${place.path}.md. A slash makes a folder; YYYY, MM, DD, MMM and DDD become the date, and anything else is the word it is. Changing this affects the days you open from now on — notes already written are not moved.`;
  for (const row of hotkeyRows) {
    const chord = settings[row.key];
    row.btn.classList.toggle('recording', row.recording);
    row.btn.replaceChildren();
    if (row.recording) {
      row.btn.append('Press a combination…');
    } else if (chord) {
      row.btn.append(chordKeys(chord));
    } else {
      row.btn.append('None');
    }
    row.clear.hidden = !chord || row.recording;
    row.note.textContent = warnings[row.key] ?? '';
  }
}

/** Hands the settings to the main process, which is the one that acts on them. */
async function saveSettings(next: Settings): Promise<void> {
  const previous = settings;
  settings = next;
  renderSettings();
  try {
    const stored = await window.notesApi.setSettings(next);
    settings = { closeToTray: stored.closeToTray, hotkey: stored.hotkey, captureHotkey: stored.captureHotkey, reminders: stored.reminders, views: stored.views, notesFolder: stored.notesFolder, journalPath: stored.journalPath, journalTemplateId: stored.journalTemplateId };
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
el.journalPath.addEventListener('change', () => {
  const said = el.journalPath.value.trim() || DEFAULT_JOURNAL_PATH;
  const wrong = journalPathError(said);
  if (wrong) {
    showStatus(wrong, 4000);
    el.journalPath.value = settings.journalPath;
    return;
  }
  void saveSettings({ ...settings, journalPath: said });
});

el.journalTemplate.addEventListener('click', () => {
  const templates = templatesOf(notes);
  if (templates.length === 0) {
    showStatus('No templates yet: tag a note #template to make it one', 4000);
    return;
  }
  const items: PickItem[] = [
    { label: 'No template', hint: 'A journal entry starts empty', run: () => void saveSettings({ ...settings, journalTemplateId: null }) },
    ...templates.map((t) => ({
      label: titleOf(t),
      hint: t.id === settings.journalTemplateId ? 'the one in use' : snippetOf(t, 40),
      // The id, not the name: renaming or moving the template must not quietly break this.
      run: () => void saveSettings({ ...settings, journalTemplateId: t.id }),
    })),
  ];
  openPicker('Which template does a journal entry start from?', items);
});

el.peekOn.addEventListener('change', () => {
  ui.linkPeek = el.peekOn.checked;
  // Turning it off means now, not next time: any card the pointer opened goes.
  if (!ui.linkPeek) peek.hide();
  saveUi();
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

/** Shows where the markdown actually is, so "the notes folder" is never a guess. */
async function refreshFolderRow(): Promise<void> {
  try {
    el.folderPath.textContent = await window.notesApi.notesFolder();
  } catch (err) {
    console.error('[notes] could not read the notes folder', err);
  }
}

el.clipperCopy.addEventListener('click', () => {
  void window.notesApi
    .clipperBookmarklet()
    .then(async (link) => {
      if (!link) {
        el.clipperNote.textContent = 'The clipper is not listening; restart Notes.';
        return;
      }
      await window.notesApi.copyText(link);
      el.clipperCopy.textContent = 'Copied';
      el.clipperNote.textContent = 'Make a new bookmark in your browser and paste this as its address.';
      window.setTimeout(() => {
        el.clipperCopy.textContent = 'Copy';
      }, 1600);
    })
    .catch((err) => {
      console.error('[notes] could not copy the bookmarklet', err);
      el.clipperNote.textContent = 'That could not be copied.';
    });
});

el.folderChange.addEventListener('click', () => {
  el.folderChange.disabled = true;
  void window.notesApi
    .pickNotesFolder()
    .then(async (change) => {
      if (!change) return;
      el.folderNote.textContent = change.message;
      await refreshFolderRow();
      // The app restarts itself a moment later, so the sentence can be read.
      if (!change.restart) el.folderChange.disabled = false;
    })
    .catch((err) => {
      console.error('[notes] could not change the notes folder', err);
      el.folderNote.textContent = 'That folder could not be used.';
      el.folderChange.disabled = false;
    });
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
    incidental = true;
    select(vis[0].id);
    incidental = false;
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
    // Not for a query of operators: `due:tomorrow` is a question, not a title.
    if (query.trim() && !hasOperators(query) && (e.shiftKey || visibleNotes().length === 0)) createFromSearch();
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
onPane('toggleSidebar', 'click', toggleSidebar);
el.folderAdd.addEventListener('click', () => void newFolder());
el.tagsFold.addEventListener('click', () => {
  tagsOpen = !tagsOpen;
  ui.tags = tagsOpen;
  saveUi();
  renderTags();
});
// The breadcrumb goes to the folder; it never files the note there.
onPane('where', 'click', () => {
  const n = selected();
  if (!n) return;
  browseFolder(n.folder ?? ROOT_FOLDER);
  focusFolders();
});
// The tree, with the arrow keys: up and down walk the rows that are showing,
// and left goes to the folder above without having to find it.
el.folderTree.addEventListener('keydown', (e) => {
  const key = (e as KeyboardEvent).key;
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'ArrowLeft') return;
  const rows = Array.from(el.folderTree.querySelectorAll<HTMLButtonElement>('.folder'));
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  if (key === 'ArrowLeft') {
    const up = parentFolder(rows[at].dataset.folder ?? ROOT_FOLDER);
    browseFolder(up);
    focusFolders();
    return;
  }
  rows[Math.min(rows.length - 1, Math.max(0, at + (key === 'ArrowDown' ? 1 : -1)))]?.focus();
});
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
  // Only a close from the bar itself hands the focus to the editor: closed
  // because another note was chosen from the search box, the keystrokes
  // being typed there must not land in the note.
  const back = el.findBar.contains(document.activeElement);
  el.findBar.hidden = true;
  const hit = findHits[findAt];
  findHits = [];
  findAt = -1;
  paintFind();
  if (back) el.editor.focus();
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

onPane('findInput', 'input', refreshFind);
onPane('findInput', 'keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  }
});
onPane('replaceInput', 'keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) replaceEvery();
    else replaceCurrent();
  }
});
// Esc inside the bar closes it before the window's own Esc chain runs.
onPane('findBar', 'keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeFind(true);
  }
});
onPane('findPrev', 'click', () => stepFind(-1));
onPane('findNext', 'click', () => stepFind(1));
onPane('findClose', 'click', () => closeFind(false));
onPane('findToggleReplace', 'click', () => {
  setReplaceRow(el.findReplaceRow.hidden);
  if (!el.findReplaceRow.hidden) el.replaceInput.focus();
});
onPane('replaceOne', 'click', replaceCurrent);
onPane('replaceAll', 'click', replaceEvery);
for (const [name, key] of [
  ['findCase', 'caseSensitive'],
  ['findRegex', 'regex'],
] as const) {
  onPane(name, 'click', () => {
    findOpts[key] = !findOpts[key];
    // Case and regex are how this window searches, not how one pane does, so
    // every pane's buttons say the same thing.
    for (const p of panes) p.els[name].setAttribute('aria-pressed', String(findOpts[key]));
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
  forgetAllDrawn();
  renderEditor();
  if (selected() && !ui.preview) caretToEnd();
  showStatus(ui.liveFormat ? 'Live formatting on' : 'Live formatting off', 1500);
}

/**
 * Puts the header's commands away, or brings them back. It only ever hides the
 * buttons: every command, every chord and the palette go on working.
 */
function toggleControls(): void {
  ui.controls = !ui.controls;
  saveUi();
  el.controlsShow.checked = ui.controls;
  if (!ui.controls) closeMenu(false);
  syncAllControls();
  showStatus(ui.controls ? 'Editor controls on' : 'Editor controls off · the shortcuts still work', 2500);
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
  else rememberFor(inbox.id);
  notes = updateBody(notes, inbox.id, body);
  scheduleSave();
  // If the Inbox is the note on screen, it must show the new line, with the
  // caret left where the writer had it rather than at the top of the note.
  const caret = ui.selectedId === inbox.id && document.activeElement === el.editor ? caretOffsetOrStart() : null;
  if (ui.selectedId === inbox.id) editorNoteId = null;
  forgetDrawn(inbox.id);
  renderList();
  renderEditor();
  if (caret !== null) placeCaretAt(caret);
  showStatus('Added to Inbox', 2500);
}

window.notesApi.onCapture(captureToInbox);

// --- changes made outside the app -------------------------------------------

/**
 * Files in the notes folder changed by something else — a sync tool, an
 * editor on another machine. They are taken as they are, except for the note
 * being written in this moment, whose unsaved words are not to be lost to a
 * file that arrived while they were typed. That is the note typed in, not
 * whichever is open: a save pending for some other note (a quick note filed
 * in the Inbox, say) must not hold a file for the open note off for good.
 */
/** Whether two notes carry the same front-matter properties, in the same order. */
function samePropertyList(a: NoteProperty[] | undefined, b: NoteProperty[] | undefined): boolean {
  const one = a ?? [];
  const two = b ?? [];
  if (one.length !== two.length) return false;
  return one.every((p, i) => p.key === two[i].key && p.occurrence === two[i].occurrence && p.complex === two[i].complex && JSON.stringify(p.value) === JSON.stringify(two[i].value));
}

function applyExternal(changes: ExternalChanges): void {
  seenSeq = Math.max(seenSeq, changes.seq);
  let touched = 0;
  const keep = dirty ? typedId : null;
  for (const id of changes.removed) {
    if (id === keep || !notes.some((n) => n.id === id)) continue;
    notes = removeNote(notes, id);
    touched++;
  }
  for (const note of changes.upserts) {
    if (note.id === keep) continue;
    const i = notes.findIndex((n) => n.id === note.id);
    if (i < 0) notes = [note, ...notes];
    else if (
      notes[i].body === note.body &&
      (notes[i].title ?? '') === (note.title ?? '') &&
      notes[i].pinned === note.pinned &&
      notes[i].updatedAt === note.updatedAt &&
      (notes[i].folder ?? ROOT_FOLDER) === (note.folder ?? ROOT_FOLDER) &&
      // A property changed from the command line moves no other byte of the
      // note: without this the window would never hear about it.
      samePropertyList(notes[i].properties, note.properties)
    )
      continue;
    else notes = notes.map((n) => (n.id === note.id ? note : n));
    touched++;
    if (note.id === ui.selectedId) editorNoteId = null;
    forgetDrawn(note.id);
  }
  // A sheet showing what a note carries must show what it carries now.
  if (touched > 0 && propertiesUi.isOpen()) propertiesUi.refresh();
  for (const note of changes.upserts) peek.forget(note.id);
  for (const id of changes.removed) peek.forget(id);
  if (touched === 0) return;
  // A note may have arrived in a folder nobody here has heard of, or left the
  // last one in another; the tree is the disk's to say, so ask it again.
  void window.notesApi
    .listFolders()
    .then((now) => {
      folders = now;
      renderList();
    })
    .catch((err) => console.error('[notes] could not read the folders', err));
  // Through select(), so the note taken away is left the way any other is:
  // `notes open --wait` told, the provisional title and the Back stack settled.
  if (ui.selectedId && !notes.some((n) => n.id === ui.selectedId)) select(sortByEdited(notes)[0]?.id ?? null);
  renderList();
  renderEditor();
  showStatus(touched === 1 ? 'A note changed on disk' : `${touched} notes changed on disk`, 3000);
}

window.notesApi.onExternalChange(applyExternal);

// --- folders: the commands ---------------------------------------------------

/**
 * Every folder there is, as choices, deepest path spelt out in full so the
 * picker's fuzzy match can be typed at: "wo/cl" finds Work / Clients. The root
 * is a choice like any other, because filing a note at the root is filing it.
 */
function folderChoices(run: (folder: string) => void, skip: (folder: string) => boolean = () => false): PickItem[] {
  const rows: PickItem[] = [{ label: `${ROOT_LABEL} (root)`, run: () => run(ROOT_FOLDER) }];
  for (const folder of folders) {
    if (skip(folder)) continue;
    const here = notes.filter((n) => folderMatches(n.folder ?? ROOT_FOLDER, folder)).length;
    rows.push({ label: folderLabel(folder), hint: `${here} ${here === 1 ? 'note' : 'notes'}`, run: () => run(folder) });
  }
  return rows;
}

/** What a folder command said, and the tree as it now stands. */
function tookFolders(result: FolderResult): boolean {
  folders = result.folders;
  if (!result.ok) {
    showStatus(result.message, 5000);
    renderList();
    return false;
  }
  showStatus(result.message, 3000);
  return true;
}

/** Types a folder path; refuses one Windows will not keep, and says why. */
async function askFolderPath(label: string, initial: string): Promise<string | null> {
  const typed = await refactorUi.prompt(label, initial);
  if (typed === null) return null;
  const parsed = parseFolder(typed);
  if ('error' in parsed) {
    showStatus(parsed.error, 5000);
    return null;
  }
  return parsed.folder;
}

async function newFolder(): Promise<void> {
  keepCaret();
  // Beneath the folder being browsed, which is where "new folder" means here.
  const under = folderScope ? `${folderScope}/` : '';
  const folder = await askFolderPath('New folder, as a path from the notebook: Work/Clients', under);
  returnToEditor();
  if (folder === null || !folder) return;
  if (!tookFolders(await window.notesApi.createFolder(folder))) return;
  browseFolder(folder);
}

function moveNoteToFolder(): void {
  const n = targeted();
  if (!n) return;
  const at = n.folder ?? ROOT_FOLDER;
  const file = async (folder: string, make = false): Promise<void> => {
    if (folder === at) return;
    if (make && !tookFolders(await window.notesApi.createFolder(folder))) return;
    if (!tookFolders(await window.notesApi.moveNote(n.id, folder))) return;
    renderList();
    renderEditor();
  };
  const rows = folderChoices((folder) => void file(folder)).map((row) =>
    row.label === folderLabel(at) || (at === ROOT_FOLDER && row.label.startsWith(ROOT_LABEL)) ? { ...row, hint: 'where it is now', disabled: true } : row,
  );
  openPicker(`Where does “${shownTitle(n)}” live?`, rows, undefined, {
    // A path nobody has made yet is a choice too: filing a note somewhere new
    // is the commonest reason to want a folder at all.
    typed: (raw) => {
      const parsed = parseFolder(raw);
      if ('error' in parsed || !parsed.folder) return null;
      if (folders.some((f) => folderKey(f) === folderKey(parsed.folder))) return null;
      return { label: `Make ${folderLabel(parsed.folder)} and move it there`, run: () => void file(parsed.folder, true) };
    },
  });
}

/**
 * Puts a note back at the top level.
 *
 * The one move with no question to ask, which is the whole reason it is its
 * own command rather than a row in the folder picker: taking a note out of a
 * folder is a thing you already know you want, and picking "All notes" out of
 * a list of folders is a worse way to say it.
 */
async function unfileNote(): Promise<void> {
  const n = targeted();
  if (!n || (n.folder ?? ROOT_FOLDER) === ROOT_FOLDER) return;
  if (!tookFolders(await window.notesApi.moveNote(n.id, ROOT_FOLDER))) return;
  renderList();
  renderEditor();
  showStatus(`“${shownTitle(n)}” is now at the top level`, 2500);
}

async function showNoteFile(): Promise<void> {
  const n = targeted();
  if (!n) return;
  const shown = await window.notesApi.showNoteFile(n.id);
  if (!shown) showStatus('That note has not been written to disk yet', 3000);
}

async function renameThisFolder(): Promise<void> {
  const folder = folderScope;
  if (!folder) return;
  keepCaret();
  const typed = await refactorUi.prompt(`Rename ${folderLabel(folder)} to`, folderName(folder));
  returnToEditor();
  if (typed === null || !typed.trim()) return;
  const result = await window.notesApi.renameFolder(folder, typed.trim());
  if (!tookFolders(result)) return;
  browseFolder(result.folder);
}

function moveThisFolder(): void {
  const folder = folderScope;
  if (!folder) return;
  const into = async (parent: string): Promise<void> => {
    const result = await window.notesApi.moveFolder(folder, parent);
    if (!tookFolders(result)) return;
    browseFolder(result.folder);
    renderEditor();
  };
  // Not into itself, not into anything it holds, and not back where it is.
  openPicker(
    `Where does ${folderLabel(folder)} go?`,
    folderChoices((parent) => void into(parent), (f) => folderMatches(f, folder) || folderKey(f) === folderKey(parentFolder(folder))),
  );
}

async function deleteThisFolder(): Promise<void> {
  const folder = folderScope;
  if (!folder) return;
  const result = await window.notesApi.deleteFolder(folder);
  if (!tookFolders(result)) return;
  browseFolder(result.folder);
}

/** The folder rail, with the keyboard: the row being browsed, or the root. */
function focusFolders(): void {
  const rows = Array.from(el.folderTree.querySelectorAll<HTMLButtonElement>('.folder'));
  const at = rows.find((r) => r.getAttribute('aria-pressed') === 'true') ?? rows[0];
  at?.focus();
}

// --- a picker: the palette's shape, for choosing from a list ------------------

interface PickItem {
  label: string;
  hint?: string;
  /** Shown for what it says, but not choosable. */
  disabled?: boolean;
  run: () => void;
}

let pickItems: PickItem[] = [];
let pickShown: PickItem[] = [];
let pickAt = 0;
let pickReturn: (() => void) | null = null;
let pickOptions: PickOptions = {};

/** Opens the picker over some choices. `onClose` runs when it goes away without a choice. */
function openPicker(placeholder: string, items: PickItem[], onClose?: () => void, options: PickOptions = {}): void {
  pickItems = items;
  pickOptions = options;
  pickReturn = onClose ?? null;
  el.pickInput.placeholder = placeholder;
  el.pickInput.setAttribute('aria-label', placeholder);
  el.pickInput.value = '';
  keepCaret();
  el.pickSheet.hidden = false;
  refreshPicker();
  if (options.at !== undefined && pickShown[options.at] && !pickShown[options.at].disabled) {
    pickAt = options.at;
    drawPicker();
  }
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
  const raw = el.pickInput.value.trim();
  const q = raw.toLowerCase();
  pickShown = pickItems.filter((it) => !q || it.label.toLowerCase().includes(q) || (it.hint ?? '').toLowerCase().includes(q));
  // What was typed can be a choice of its own — a heading to make — when no row is exactly that.
  if (q && pickOptions.typed && !pickItems.some((it) => it.label.trim().toLowerCase() === q)) {
    const extra = pickOptions.typed(raw);
    if (extra) pickShown = [...pickShown, extra];
  }
  pickAt = Math.max(0, pickShown.findIndex((it) => !it.disabled));
  drawPicker();
}

/** Moves the highlight, skipping rows that cannot be chosen. */
function stepPick(delta: 1 | -1): void {
  if (pickShown.length === 0) return;
  let i = pickAt;
  for (let k = 0; k < pickShown.length; k++) {
    i = (i + delta + pickShown.length) % pickShown.length;
    if (!pickShown[i].disabled) {
      pickAt = i;
      break;
    }
  }
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
    row.className = `palette-row${i === pickAt ? ' at' : ''}${it.disabled ? ' disabled' : ''}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === pickAt));
    if (it.disabled) row.setAttribute('aria-disabled', 'true');
    const name = document.createElement('span');
    name.className = 'palette-name';
    name.textContent = it.label;
    row.append(name);
    if (it.hint) {
      // A snippet of the thing itself, so it keeps its own case.
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.textContent = it.hint;
      row.append(hint);
    }
    row.addEventListener('mousemove', () => {
      if (pickAt !== i && !it.disabled) {
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
  if (!it || it.disabled) return;
  closePicker(true);
  it.run();
}

el.pickInput.addEventListener('input', refreshPicker);
el.pickInput.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      e.preventDefault();
      stepPick(e.key === 'ArrowDown' ? 1 : -1);
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
      // A new note: titled with the search, if there is one, else named
      // afterwards — and then {{title}} waits for that name rather than
      // being filled with "Untitled" for good.
      const title = query.trim();
      const made = createNote(Date.now(), expandTemplate(t, { title: title || '{{title}}' }));
      if (title) made.title = title;
      titleFill = !title && usesTitle(t.body) ? made.id : null;
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
  // With Shift held, the key reads as ':' on a US keyboard, so the chord ends in it.
  const shift = lastChord.includes('shift') || lastChord.endsWith(':');
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
    rememberFor(n.id);
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
// --- moving between notes, and moving text between them ------------------------

/** The back/forward stack: where the reader has been, and where Back went from. */
let journey: Journey = emptyJourney();
/** True while Back or Forward is the one changing the note, so the step is not recorded again. */
let travelling = false;
/** True while the search box or a tag filter lands on its first hit: not a step the reader took. */
let incidental = false;
/** Whether the open note was reached that way, so leaving it is not a departure either. */
let arrivedIncidentally = false;

/** Where the reader is right now, for the stack. */
function placeHere(): Place | null {
  const n = selected();
  if (!n) return null;
  const inEditor = editorNoteId === n.id && document.activeElement === el.editor;
  const caret = inEditor ? caretOffsetOrStart() : caretBefore?.id === n.id ? caretBefore.at : 0;
  return { id: n.id, caret, scroll: el.editor.scrollTop, hash: hashOf(n.body) };
}

/** Back (-1) or Forward (1): the note, its scroll, and its caret if the text is as it was. */
function travel(dir: -1 | 1): void {
  const here = placeHere() ?? { id: '', caret: 0, scroll: 0, hash: 0 };
  let step = dir < 0 ? goBack(journey, here) : goForward(journey, here);
  // A note deleted meanwhile is nowhere to go; skip past it.
  while (step && !notes.some((n) => n.id === step?.to.id)) {
    // Forgotten from the journey as it was, not from the step's: the step
    // already put `here` on the other stack, and the next try puts it again.
    journey = forget(journey, step.to.id);
    step = dir < 0 ? goBack(journey, here) : goForward(journey, here);
  }
  if (!step) return;
  journey = step.journey;
  const to = step.to;
  travelling = true;
  try {
    if (query || tagFilter) clearFilters();
    if (ui.preview) ui.preview = false;
    select(to.id);
  } finally {
    travelling = false;
  }
  const n = selected();
  if (!n) return;
  if (caretUsable(to, n.body)) placeCaretAt(to.caret);
  else focusEditor();
  el.editor.scrollTop = to.scroll;
}

/** One of the saved searches, chosen by name. */
function pickView(): void {
  const items: PickItem[] = settings.views.map((v) => ({ label: v.name, hint: v.query, run: () => runView(v.name) }));
  openPicker('Which saved search?', items);
}


/** A note to open beside this one, most recently edited first. */
function pickForTab(): void {
  const open = new Set(panes[paneAt]?.tabs ?? []);
  const items: PickItem[] = sortByEdited(notes).map((n) => ({
    label: shownTitle(n),
    hint: open.has(n.id) ? 'already open here' : relativeTime(n.updatedAt),
    run: () => openInTab(n.id),
  }));
  openPicker('Which note, in a tab of its own?', items);
}

/** The last notes opened, most recent first, to jump to one of them. */
function pickRecent(): void {
  ui.recent = pruneRecent(ui.recent, (id) => notes.some((n) => n.id === id));
  saveUi();
  const items: PickItem[] = ui.recent
    .filter((v) => v.id !== ui.selectedId)
    .map((v) => {
      const n = notes.find((x) => x.id === v.id);
      return {
        label: n ? titleOf(n) : '',
        hint: relativeTime(v.at),
        run: () => {
          if (query || tagFilter) clearFilters();
          if (ui.preview) ui.preview = false;
          select(v.id);
          focusEditor();
        },
      };
    });
  openPicker('Which recent note?', items);
}

// The thumb buttons go back and forward, as they do in a browser. One event,
// so a button cannot fire twice.
document.addEventListener('mouseup', (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  const action = ACTIONS.find((a) => a.id === (e.button === 3 ? 'back' : 'forward'));
  if (action && action.enabled?.() !== false) action.run();
});

/** The lines the editor's selection covers, or the caret's line, counted from 0. */
function editorLines(): { first: number; last: number } | null {
  const n = selected();
  if (!n || ui.preview) return null;
  const sel = window.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (range && editorNoteId === n.id && el.editor.contains(range.commonAncestorContainer)) {
    const { lines } = readEditor(el.editor);
    const first = lineIndexIn(lines, { node: range.startContainer, offset: range.startOffset });
    const last = range.collapsed ? first : lineIndexIn(lines, { node: range.endContainer, offset: range.endOffset });
    return { first: Math.min(first, last), last: Math.max(first, last) };
  }
  // From the palette: the caret was kept when the palette took the focus.
  if (caretBefore && caretBefore.id === n.id) {
    const line = n.body.slice(0, caretBefore.at).split('\n').length - 1;
    return { first: line, last: line };
  }
  return null;
}

/** How a Plan changes the notes here: one mutation per note, the editor redrawn if it is on screen. */
const refactorHost: RefactorHost = {
  notes: () => notes,
  update: (id, state) => {
    const i = notes.findIndex((n) => n.id === id);
    if (i < 0) return;
    const { title: _old, ...rest } = notes[i];
    const next: Note = state.title !== undefined ? { ...rest, title: state.title, body: state.body, updatedAt: Date.now() } : { ...rest, body: state.body, updatedAt: Date.now() };
    notes = notes.map((n) => (n.id === id ? next : n));
    if (ui.selectedId === id) {
      editorNoteId = null;
      el.title.value = next.title ?? '';
    }
    forgetDrawn(id);
  },
  trash: (id) => {
    // The trash copy is taken from the file: what was typed since the last save goes there first.
    void flush();
    notes = removeNote(notes, id);
  },
  restore: async (id) => {
    const note = await window.notesApi.trashRestore(id);
    if (note) notes = [note, ...notes.filter((n) => n.id !== note.id)];
    return note;
  },
  log: editLogFor,
  caret: (id) => (ui.selectedId === id && document.activeElement === el.editor ? caretOffsetOrStart() : caretBefore?.id === id ? caretBefore.at : 0),
};

/** After a Plan ran, was undone or redone: the screen and the files catch up. */
function afterPlan(plan: Plan): void {
  if (plan.select && notes.some((n) => n.id === plan.select) && ui.selectedId !== plan.select) select(plan.select);
  if (ui.selectedId && !notes.some((n) => n.id === ui.selectedId)) select(sortByEdited(notes)[0]?.id ?? null);
  scheduleSave();
  renderList();
  renderEditor();
}

/** Applies a Plan from the window's own commands, keeping the caret where it was in the open note. */
async function applyPlanHere(plan: Plan): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = ui.selectedId;
  const caret = id && plan.writes.some((w) => w.id === id) ? refactorHost.caret(id) : null;
  const r = await applyPlan(plan, refactorHost);
  if (!r.ok) return { ok: false, message: r.message };
  afterPlan(plan);
  const n = selected();
  if (caret !== null && n && n.id === id) caretBefore = { id, at: Math.min(caret, n.body.length) };
  return { ok: true };
}

/** Undo or redo of a step that was a Plan: every note it touched, together. */
async function runGroup(group: string, dir: 'undo' | 'redo'): Promise<void> {
  const caret = ui.selectedId ? refactorHost.caret(ui.selectedId) : 0;
  const r = await (dir === 'undo' ? undoGroup(group, refactorHost) : redoGroup(group, refactorHost));
  if (!r.ok) {
    showStatus(r.message, 4000);
    return;
  }
  afterPlan(r.plan);
  const n = selected();
  if (n) placeCaretAt(Math.min(caret, n.body.length));
  showStatus(dir === 'undo' ? `Undone: ${r.plan.sentence.replace(/^Undo: /, '')}` : `Redone: ${r.plan.sentence}`, 3000);
}

const refactorUi = createRefactorUi({
  notes: () => notes,
  selected,
  selection: editorLines,
  pick: (placeholder, items, options, onClose) => openPicker(placeholder, items, onClose, options),
  apply: applyPlanHere,
  status: showStatus,
  focusEditor,
  root: document.body,
});

/** The line the caret is on in the open note, for anything that works on a block. */
function caretLine(): number | null {
  const sel = editorLines();
  return sel ? sel.first : null;
}

const propertiesUi = createPropertiesUi({
  notes: () => notes,
  selected,
  write: async (id, change) => {
    try {
      const props = await window.notesApi.setProperty(id, change);
      // The store is the one that writes; the window catches up from what it says.
      notes = notes.map((n) => (n.id === id ? withProperties(n, props) : n));
      renderList();
      renderEditor();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'That property could not be written';
    }
  },
  writeAliases: (id, names) => {
    notes = updateAliases(notes, id, cleanAliases(names));
    scheduleSave();
    renderList();
    renderEditor();
  },
  search: (q) => {
    query = q;
    el.search.value = q;
    renderList();
    renderSearchOps();
    el.search.focus();
  },
  status: showStatus,
  focusEditor,
  root: document.body,
});

const blocksUi = createBlocksUi({
  notes: () => notes,
  selected,
  caretLine,
  apply: applyPlanHere,
  insertAtCaret,
  pick: (placeholder, items, options, onClose) => openPicker(placeholder, items, onClose, options),
  copy: (text) => navigator.clipboard.writeText(text),
  status: showStatus,
  focusEditor,
});

/** A note with the properties the store just reported, or none at all. */
function withProperties(note: Note, props: NoteProperty[]): Note {
  const next = { ...note };
  if (props.length > 0) next.properties = props;
  else delete next.properties;
  return next;
}

const peek = createPeek({
  notes: () => notes,
  render: renderGlance,
  open: (id, address) => {
    const n = notes.find((x) => x.id === id);
    if (n && address) goToAddress(n, address);
    else goToLinked(id);
  },
  hoverAllowed: () => ui.linkPeek,
  root: document.body,
});

const slash = createSlash({
  items: () =>
    slashActions(ACTIONS).map((a) => ({
      id: a.id,
      label: a.label,
      hint: a.hint,
      terms: a.terms,
      chord: a.chord,
      run: a.run,
    })),
  caret: () => {
    const n = selected();
    if (!n || ui.preview) return null;
    const at = caretOffsetOrStart();
    const before = n.body.slice(0, at);
    const start = before.lastIndexOf('\n') + 1;
    const end = n.body.indexOf('\n', at);
    return { line: n.body.slice(start, end < 0 ? n.body.length : end), column: at - start };
  },
  caretBox: () => {
    const rect = caretRect();
    return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
  },
  runWith: (typed, run) => {
    // Taking the query out is the step; whatever the command puts here joins
    // it, so one Ctrl+Z restores exactly what was typed. A command that opens
    // a chooser first inserts later, and the latch is still waiting for it.
    const n = selected();
    if (!n) return;
    const at = caretOffsetOrStart();
    setBody(`${n.body.slice(0, at - typed)}${n.body.slice(at)}`);
    placeCaretAt(at - typed);
    joinNextEdit = n.id;
    run();
  },
  root: document.body,
});

const workspacesUi = createWorkspacesUi({
  held: () => ui.workspaces,
  current: () => {
    syncPanes();
    return { panes: ui.panes.map((p) => ({ ...p })), paneAt: ui.paneAt };
  },
  loadedId: () => loadedWorkspace,
  save: (name) => {
    syncPanes();
    const now = new Date().toISOString();
    const made: Workspace = { id: newId(), name, panes: ui.panes.map((p) => ({ ...p })), paneAt: ui.paneAt, createdAt: now, updatedAt: now };
    ui.workspaces = withWorkspace(ui.workspaces, made);
    loadedWorkspace = ui.workspaces.find((w) => nameKey(w.name) === nameKey(name))?.id ?? null;
    saveUi();
  },
  update: (id) => {
    syncPanes();
    ui.workspaces = ui.workspaces.map((w) => (w.id === id ? { ...w, panes: ui.panes.map((p) => ({ ...p })), paneAt: ui.paneAt, updatedAt: new Date().toISOString() } : w));
    saveUi();
  },
  load: (id) => void loadWorkspace(id),
  rename: (id, name) => {
    ui.workspaces = ui.workspaces.map((w) => (w.id === id ? { ...w, name, updatedAt: new Date().toISOString() } : w));
    saveUi();
  },
  remove: (id) => {
    ui.workspaces = ui.workspaces.filter((w) => w.id !== id);
    if (loadedWorkspace === id) loadedWorkspace = null;
    saveUi();
  },
  status: showStatus,
  focusEditor,
  titleOf: (id) => {
    const n = notes.find((x) => x.id === id);
    return n ? shownTitle(n) : null;
  },
  root: document.body,
});

/** The workspace most recently loaded or saved, for the sheet's update row. */
let loadedWorkspace: string | null = null;

/**
 * Switches to a saved arrangement.
 *
 * Everything on screen goes to disk first and the switch is abandoned if that
 * fails: an arrangement is not worth a lost sentence. Notes that are gone are
 * left out rather than refusing the whole thing, and the snapshot itself is
 * not rewritten — a file that is missing today may be back tomorrow.
 */
async function loadWorkspace(id: string): Promise<void> {
  const workspace = ui.workspaces.find((w) => w.id === id);
  if (!workspace) return;
  try {
    await flush();
  } catch (err) {
    console.error('[notes] could not save before switching workspace', err);
    showStatus('Could not save what is open; the workspace was not opened', 5000);
    return;
  }
  const resolved = resolveWorkspace(workspace, (noteId) => notes.some((n) => n.id === noteId));
  setPanes(resolved.panes, resolved.paneAt);
  loadedWorkspace = id;
  saveUi();
  showStatus(resolved.missing > 0 ? `Opened “${workspace.name}”. ${resolved.missing} unavailable ${resolved.missing === 1 ? 'note was' : 'notes were'} omitted.` : `Opened “${workspace.name}”`, 4000);
}

const hasNote = (): boolean => targeted() !== null;

const ACTIONS: Action[] = [
  { id: 'new', label: 'New note', group: 'Notes', menuSection: 'Create', chord: 'ctrl+n', run: () => newNote() },
  {
    id: 'template-new',
    label: 'New note from a template…',
    hint: 'Titled with whatever is in the search box, or named afterwards',
    group: 'Notes',
    menuSection: 'Create',
    chord: 'ctrl+shift+n',
    terms: 'template start',
    run: () => pickTemplate('new'),
  },
  {
    id: 'import',
    label: 'Import markdown or text files…',
    hint: 'One note per file; dropping files on the window does the same',
    group: 'Notes',
    menuSection: 'Create',
    chord: 'ctrl+shift+o',
    terms: 'open md txt',
    run: () => void pickImports(),
  },
  {
    id: 'journal-today',
    label: "Today's note",
    hint: 'The dated note for today, made if it is not written yet',
    group: 'Notes',
    menuSection: 'Create',
    // Ctrl+Shift+D is Delete. Ctrl+Alt+D joins Ctrl+Alt+F and Ctrl+Alt+M,
    // which is already the family that means "go to a place in the notebook".
    chord: 'ctrl+alt+d',
    terms: 'journal daily diary log today date',
    run: () => void openJournal(dateOf(new Date())),
  },
  {
    id: 'journal-date',
    label: 'Journal for a day…',
    hint: 'today, yesterday, friday, +3d, or a date like 2026-09-01',
    group: 'Notes',
    menuSection: 'Create',
    terms: 'journal daily diary log yesterday tomorrow date',
    run: pickJournalDate,
  },
  {
    id: 'folder-new',
    label: 'New folder…',
    hint: 'A real folder on disk; type a path like Work/Clients to make the whole way down',
    group: 'Notes',
    menuSection: 'Create',
    terms: 'directory make create place file filing',
    run: () => void newFolder(),
  },
  {
    id: 'find',
    label: 'Find a note',
    group: 'Notes',
    menuSection: 'Find and navigate',
    chord: 'ctrl+k',
    terms: 'search filter',
    run: () => {
      if (ui.sidebarHidden) toggleSidebar();
      el.search.focus();
      el.search.select();
    },
  },
  {
    id: 'recent',
    label: 'Recent notes…',
    hint: 'The last twenty notes you had open',
    group: 'Notes',
    menuSection: 'Find and navigate',
    chord: 'ctrl+shift+b',
    terms: 'history visited last',
    run: pickRecent,
  },
  { id: 'prev', label: 'Previous note', group: 'Notes', menuSection: 'Find and navigate', chord: 'ctrl+arrowup', run: () => step(-1) },
  { id: 'next', label: 'Next note', group: 'Notes', menuSection: 'Find and navigate', chord: 'ctrl+arrowdown', run: () => step(1) },
  {
    id: 'back',
    label: 'Back',
    hint: 'The note you came from, caret and scroll restored; the thumb button does the same',
    group: 'Notes',
    menuSection: 'Find and navigate',
    chord: 'alt+arrowleft',
    terms: 'previous history',
    enabled: () => journey.back.length > 0,
    run: () => travel(-1),
  },
  {
    id: 'forward',
    label: 'Forward',
    group: 'Notes',
    menuSection: 'Find and navigate',
    chord: 'alt+arrowright',
    terms: 'history',
    enabled: () => journey.forward.length > 0,
    run: () => travel(1),
  },
  {
    id: 'title',
    label: 'Rename this note',
    hint: 'When other notes link to it by name, the links can follow',
    group: 'Notes',
    menuSection: 'This note',
    chord: 'ctrl+r',
    also: ['f2'],
    terms: 'title',
    run: focusTitle,
  },
  {
    id: 'aliases',
    label: 'Other names for this note…',
    hint: 'A [[link]] naming one of them finds this note, and so does a search',
    group: 'Notes',
    menuSection: 'This note',
    chord: 'ctrl+shift+a',
    terms: 'alias aka also known as nickname property',
    enabled: () => hasNote(),
    // The same sheet, opened at the aliases row: there is one property editor
    // in this app, not one for aliases and another for everything else.
    run: () => propertiesUi.open('aliases'),
  },
  {
    id: 'properties',
    label: 'Properties…',
    hint: "The keys in this note's own front matter — status, and anything else it carries",
    group: 'Notes',
    menuSection: 'This note',
    terms: 'front matter yaml metadata field property key value',
    enabled: () => hasNote(),
    run: () => propertiesUi.open(),
  },
  {
    id: 'pin',
    label: 'Pin or unpin this note',
    hint: 'Pinned notes sort above the rest, whatever their edit time',
    group: 'Notes',
    menuSection: 'This note',
    chord: 'ctrl+shift+p',
    enabled: hasNote,
    on: () => targeted()?.pinned === true,
    run: togglePinSelected,
  },
  {
    id: 'history',
    label: 'Note history…',
    hint: 'Earlier versions of this note, kept as you write, to look at or put back',
    group: 'Notes',
    menuSection: 'This note',
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
    menuSection: 'This note',
    chord: 'ctrl+s',
    run: () =>
      void flush().then(() => {
        if (!dirty) showStatus('Saved', 1200);
      }),
  },
  {
    id: 'export',
    label: 'Export this note…',
    hint: 'As Markdown, plain text or an image',
    group: 'Notes',
    menuSection: 'This note',
    chord: 'ctrl+shift+s',
    enabled: hasNote,
    terms: 'save as md txt png',
    // The formats are a drill-in inside the Note menu, so the chord opens the
    // menu at that page: one list of formats, wherever the command came from.
    run: () => openMenu('Notes', 'export'),
  },
  {
    id: 'merge-into',
    label: 'Merge this note into another…',
    hint: 'Its text goes under a heading there, links follow, and this note goes to Deleted notes',
    group: 'Notes',
    menuSection: 'This note',
    terms: 'merge combine duplicate join',
    enabled: hasNote,
    run: () => refactorUi.mergeInto(targeted()),
  },
  {
    id: 'delete',
    label: 'Delete this note',
    hint: 'Press again within three seconds to confirm',
    group: 'Notes',
    menuSection: 'This note',
    chord: 'ctrl+shift+d',
    enabled: hasNote,
    run: armDelete,
  },
  {
    id: 'note-move',
    label: 'Move this note…',
    hint: 'Files it in another folder, keeping its name, its links and its history',
    group: 'Notes',
    menuSection: 'This note',
    chord: 'ctrl+alt+m',
    terms: 'file filing folder put away refile relocate',
    enabled: () => hasNote(),
    run: () => void moveNoteToFolder(),
  },
  {
    id: 'note-unfile',
    label: 'Take out of folder',
    hint: 'Back to the top level, keeping its name, its links and its history',
    group: 'Notes',
    menuSection: 'This note',
    terms: 'unfile root top level remove out of folder',
    // Greyed, not gone, on a note already at the top level: the row keeps its
    // place in the menu so you learn where it is.
    enabled: () => (targeted()?.folder ?? ROOT_FOLDER) !== ROOT_FOLDER,
    run: () => void unfileNote(),
  },
  {
    id: 'note-show',
    label: 'Show this note in Explorer',
    hint: 'Opens the folder it lives in with its own file picked out',
    group: 'Notes',
    menuSection: 'This note',
    terms: 'reveal file explorer where disk path',
    enabled: () => hasNote(),
    run: () => void showNoteFile(),
  },
  {
    id: 'tab-new',
    label: 'Open a note in a new tab…',
    hint: 'Keeps this one open beside it; Ctrl and a number goes to the nth tab',
    group: 'Notes',
    menuSection: 'Tabs',
    chord: 'ctrl+t',
    terms: 'tab open beside second',
    enabled: () => notes.length > 0,
    run: pickForTab,
  },
  {
    id: 'tab-close',
    label: 'Close this tab',
    hint: 'The note stays; only the tab goes',
    group: 'Notes',
    menuSection: 'Tabs',
    chord: 'ctrl+w',
    terms: 'tab shut',
    enabled: () => hasNote(),
    run: () => {
      const p = panes[paneAt];
      if (ui.selectedId) closeTab(p, ui.selectedId);
    },
  },
  {
    id: 'tab-next',
    label: 'Next tab',
    group: 'Notes',
    menuSection: 'Tabs',
    chord: 'ctrl+tab',
    terms: 'tab switch',
    enabled: () => panes[paneAt]?.tabs.length > 1,
    run: () => stepTab(1),
  },
  {
    id: 'tab-prev',
    label: 'Previous tab',
    group: 'Notes',
    menuSection: 'Tabs',
    chord: 'ctrl+shift+tab',
    terms: 'tab switch',
    enabled: () => panes[paneAt]?.tabs.length > 1,
    run: () => stepTab(-1),
  },
  {
    id: 'view-save',
    label: 'Save this search…',
    hint: 'Names the search in the box and keeps it above the tags',
    group: 'Notes',
    menuSection: 'Saved searches',
    terms: 'view saved search filter keep',
    run: () => void saveView(),
  },
  {
    id: 'view-open',
    label: 'Saved searches…',
    group: 'Notes',
    menuSection: 'Saved searches',
    chord: 'ctrl+shift+y',
    terms: 'view saved search filter',
    enabled: () => settings.views.length > 0,
    run: pickView,
  },
  {
    id: 'view-forget',
    label: 'Forget a saved search…',
    group: 'Notes',
    menuSection: 'Saved searches',
    terms: 'view saved search remove delete',
    enabled: () => settings.views.length > 0,
    run: forgetView,
  },
  {
    id: 'folder-rename',
    label: 'Rename this folder…',
    hint: 'Changes the name of the folder being browsed, leaving it where it is',
    group: 'Notes',
    menuSection: 'Folders',
    terms: 'directory name',
    enabled: () => folderScope !== ROOT_FOLDER,
    run: () => void renameThisFolder(),
  },
  {
    id: 'folder-move',
    label: 'Move this folder…',
    hint: 'Puts the folder being browsed, and everything in it, inside another',
    group: 'Notes',
    menuSection: 'Folders',
    terms: 'directory reparent nest',
    enabled: () => folderScope !== ROOT_FOLDER,
    run: () => void moveThisFolder(),
  },
  {
    id: 'folder-delete',
    label: 'Delete this folder',
    hint: 'Only an empty one: no folder command ever takes a note with it',
    group: 'Notes',
    menuSection: 'Folders',
    terms: 'directory remove',
    enabled: () => folderScope !== ROOT_FOLDER,
    run: () => void deleteThisFolder(),
  },
  {
    id: 'due',
    label: 'Scheduled tasks…',
    hint: 'Every checklist line with an @date, across the notes, overdue first',
    group: 'Notes',
    menuSection: 'Library',
    chord: 'ctrl+shift+u',
    terms: 'due reminders deadline agenda today',
    run: () => toggleDue(),
  },
  {
    id: 'tag-rename',
    label: 'Rename a tag everywhere…',
    hint: 'Every #tag, and every #tag/nested under it, in every note',
    group: 'Notes',
    menuSection: 'Library',
    terms: 'tag rename retag',
    enabled: () => notes.length > 0,
    run: () => refactorUi.renameTag(),
  },
  {
    id: 'properties-all',
    label: 'All properties…',
    hint: 'Every front-matter key the notebook uses, and what it says',
    group: 'Notes',
    menuSection: 'Library',
    terms: 'front matter yaml metadata vocabulary keys fields',
    run: () => propertiesUi.openVocabulary(),
  },
  {
    id: 'trash',
    label: 'Deleted notes…',
    hint: 'What was deleted in the last month, to look at or put back',
    group: 'Notes',
    menuSection: 'Library',
    chord: 'ctrl+shift+backspace',
    terms: 'trash bin undelete restore recover',
    run: () => toggleTrash(),
  },
  {
    id: 'folder',
    label: 'Open the notes folder',
    hint: 'One markdown file per note; put the folder in OneDrive or git to keep them elsewhere too',
    group: 'Notes',
    menuSection: 'Library',
    terms: 'files explorer markdown sync backup',
    run: () => void window.notesApi.openNotesFolder().catch((err) => console.error('[notes] could not open the folder', err)),
  },

  {
    id: 'undo',
    label: 'Undo',
    hint: 'A run of typing is one step; a replace or a restore is one too',
    group: 'Writing',
    menuSection: 'Edit',
    chord: 'ctrl+z',
    enabled: () => document.activeElement === el.editor,
    run: undoEdit,
  },
  {
    id: 'redo',
    label: 'Redo',
    group: 'Writing',
    menuSection: 'Edit',
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
    menuSection: 'Edit',
    chord: 'ctrl+f',
    terms: 'search within match',
    run: () => openFind(false),
  },
  {
    id: 'replace-in-note',
    label: 'Replace in this note',
    hint: 'Find with a replace field; Enter replaces one match, Ctrl+Enter every one',
    group: 'Writing',
    menuSection: 'Edit',
    chord: 'ctrl+h',
    terms: 'substitute rename all regex',
    run: () => openFind(true),
  },
  {
    id: 'attach',
    slash: true,
    label: 'Attach an image…',
    hint: 'Pasting or dropping a picture does the same',
    group: 'Writing',
    menuSection: 'Insert',
    pill: { label: 'Attach', priority: 1 },
    chord: 'ctrl+shift+i',
    terms: 'picture photo insert',
    run: () => void pickImages(),
  },
  {
    id: 'divider',
    slash: true,
    label: 'Insert a section divider',
    hint: 'Or type --- on its own line and press Enter',
    group: 'Writing',
    menuSection: 'Insert',
    pill: { label: 'Divider', priority: 2 },
    chord: 'ctrl+shift+h',
    terms: 'rule horizontal line break',
    run: insertDivider,
  },
  {
    id: 'code',
    label: 'Code block around this',
    hint: 'Fences the selection, or the paragraph you are in, so nothing in it is reflowed',
    group: 'Writing',
    menuSection: 'Insert',
    chord: 'ctrl+shift+c',
    terms: 'fence monospace preformatted highlight',
    run: toggleCodeBlock,
  },
  {
    id: 'task',
    slash: true,
    label: 'Checklist item on this line',
    hint: 'Cycles the line: plain text, then to do, then done',
    group: 'Writing',
    menuSection: 'Insert',
    pill: { label: 'Task', priority: 4 },
    chord: 'ctrl+shift+x',
    terms: 'todo checkbox tick',
    run: toggleTaskHere,
  },
  {
    id: 'template-insert',
    slash: true,
    label: 'Insert a template…',
    hint: 'A note tagged #template, its {{date}}, {{time}} and {{title}} filled in, at the caret',
    group: 'Writing',
    menuSection: 'Insert',
    chord: 'ctrl+shift+e',
    terms: 'snippet boilerplate expand',
    enabled: hasNote,
    run: () => pickTemplate('insert'),
  },
  {
    id: 'block-copy',
    label: 'Copy a link to this block',
    hint: 'Gives the paragraph or list item at the caret an address, and copies a link to it',
    group: 'Writing',
    menuSection: 'Insert',
    terms: 'block reference address anchor paragraph copy link',
    enabled: () => hasNote() && blocksUi.canAddress(),
    run: () => blocksUi.copyLink(),
  },
  {
    id: 'block-link',
    slash: true,
    label: 'Link to a block…',
    hint: 'Choose a note, then the paragraph or list item in it to point at',
    group: 'Writing',
    menuSection: 'Insert',
    terms: 'block reference address anchor paragraph link',
    enabled: hasNote,
    run: () => blocksUi.insertLink(),
  },
  {
    id: 'date',
    slash: true,
    label: 'Insert the date',
    hint: 'Today, as 2026-09-03; with Shift held, the time as well',
    group: 'Writing',
    menuSection: 'Insert',
    pill: { label: 'Date', priority: 3 },
    chord: 'ctrl+;',
    also: ['ctrl+shift+;', 'ctrl+shift+:'],
    terms: 'today time now timestamp',
    enabled: hasNote,
    run: insertDate,
  },
  {
    id: 'table',
    slash: true,
    label: 'Table',
    hint: 'A table where the caret is, or the one it is in lined up again. Tab moves between cells and the last one makes a row',
    group: 'Writing',
    menuSection: 'Table',
    chord: 'ctrl+shift+j',
    terms: 'grid columns rows tidy align',
    enabled: () => hasNote(),
    run: tableHere,
  },
  {
    id: 'table-row',
    label: 'Add a table row',
    group: 'Writing',
    menuSection: 'Table',
    chord: 'ctrl+enter',
    terms: 'table line',
    enabled: () => hasNote(),
    run: () => {
      if (!applyTableEdit(addRow)) showStatus('Put the caret in a table first', 2500);
    },
  },
  {
    id: 'table-column',
    label: 'Add a table column',
    group: 'Writing',
    menuSection: 'Table',
    chord: 'ctrl+shift+arrowright',
    terms: 'table',
    enabled: () => hasNote(),
    run: () => {
      if (!applyTableEdit(addColumn)) showStatus('Put the caret in a table first', 2500);
    },
  },
  {
    id: 'table-remove-row',
    label: 'Remove this table row',
    group: 'Writing',
    menuSection: 'Table',
    chord: 'ctrl+shift+arrowleft',
    terms: 'table delete',
    enabled: () => hasNote(),
    run: () => {
      if (!applyTableEdit(removeRow)) showStatus('That row is the header, or the only one left', 2500);
    },
  },
  {
    id: 'move-lines',
    label: 'Move lines to another note…',
    hint: 'The selected lines, or the line the caret is on, under a heading there',
    group: 'Writing',
    menuSection: 'Move',
    chord: 'ctrl+shift+v',
    terms: 'refile file send transfer',
    enabled: hasNote,
    run: () => refactorUi.moveLines(),
  },
  {
    id: 'move-section',
    label: 'Move this section to another note…',
    hint: 'The heading the caret is under and everything beneath it, levels untouched',
    group: 'Writing',
    menuSection: 'Move',
    terms: 'refile heading section',
    enabled: hasNote,
    run: () => refactorUi.moveSection(),
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
    hint: 'Markdown takes shape as you type: # for headings, ** for bold, - for lists',
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
    id: 'peek',
    label: 'Peek the linked note',
    hint: 'Shows what a link points at, without going there',
    group: 'View',
    chord: 'alt+p',
    terms: 'preview hover glance link look',
    enabled: () => hasNote(),
    run: peekHere,
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

  { id: 'sidebar', label: 'Toggle the sidebar', group: 'Window', menuSection: 'Workspace', chord: 'ctrl+\\', run: toggleSidebar },
  {
    id: 'split',
    label: 'Split the pane',
    hint: 'The same note in a second pane beside this one, scrolled on its own',
    group: 'Window',
    menuSection: 'Workspace',
    // Shift and backslash is what the fingers do, but `chordOf` reads
    // `event.key`, which reports the character the key produces -- so this
    // has to be written the way it actually arrives or it can never fire.
    chord: 'ctrl+shift+|',
    terms: 'pane side by side compare two',
    enabled: () => panes.length < MAX_PANES,
    run: splitPane,
  },
  {
    id: 'pane-close',
    label: 'Close this pane',
    group: 'Window',
    menuSection: 'Workspace',
    chord: 'ctrl+shift+w',
    terms: 'pane unsplit',
    enabled: () => panes.length > 1,
    run: () => closePane(panes[paneAt]),
  },
  {
    id: 'pane-next',
    label: 'Focus the next pane',
    group: 'Window',
    menuSection: 'Workspace',
    chord: 'ctrl+alt+arrowright',
    terms: 'pane move focus right',
    enabled: () => panes.length > 1,
    run: () => stepPane(1),
  },
  {
    id: 'pane-prev',
    label: 'Focus the previous pane',
    group: 'Window',
    menuSection: 'Workspace',
    chord: 'ctrl+alt+arrowleft',
    terms: 'pane move focus left',
    enabled: () => panes.length > 1,
    run: () => stepPane(-1),
  },
  {
    id: 'folders-go',
    label: 'Go to folders',
    hint: 'Puts the focus in the folder rail, where the arrow keys walk the tree',
    group: 'Window',
    menuSection: 'Workspace',
    chord: 'ctrl+alt+f',
    terms: 'tree rail sidebar browse where',
    run: focusFolders,
  },
  {
    id: 'workspaces',
    label: 'Workspaces…',
    hint: 'Named arrangements of which notes are open in which panes',
    group: 'Window',
    menuSection: 'Workspace',
    terms: 'layout arrangement session panes save switch',
    run: () => workspacesUi.open(),
  },
  {
    id: 'layout',
    label: 'Layout and window settings',
    hint: 'Line width, margin, focus, the tray and the summon shortcut',
    group: 'Window',
    menuSection: 'Application',
    chord: 'ctrl+,',
    terms: 'preferences options tray hotkey margin width',
    run: () => toggleLayout(),
  },
  {
    id: 'palette',
    label: 'Command palette',
    group: 'Window',
    menuSection: 'Application',
    chord: 'ctrl+shift+k',
    also: ['ctrl+p'],
    terms: 'commands run',
    run: () => togglePalette(true),
  },
  {
    id: 'help',
    label: 'Keyboard shortcuts',
    group: 'Window',
    menuSection: 'Application',
    chord: 'ctrl+/',
    terms: 'keys help',
    run: () => toggleHelp(),
  },
];

const CHORDS = keyMap(ACTIONS);

/**
 * One <kbd> for the whole chord — "Ctrl+Shift+K" — the way the pane menus
 * already print it. A chip per key read as three separate keys to learn.
 */
function chordKeys(chord: string): HTMLElement {
  const k = document.createElement('kbd');
  k.textContent = keyLabel(chord).join('+');
  return k;
}

// --- the pane's controls, written from the registry -------------------------

/**
 * A few buttons and four menus in the pane's header, all of them read out of
 * the same registry as the keyboard map, the sheet and the palette.
 *
 * The point is not to save a keystroke. It is that a command you cannot bring
 * to mind is a command you do not use, so every menu row carries the chord
 * that runs it: use the menu twice and you stop needing it.
 */
const MENUS = menuModel(ACTIONS);
const PILLS = pillActions(ACTIONS);

/** The chord as the sheet spells it, joined for a title attribute: `Ctrl+Shift+X`. */
const chordText = (chord: string): string => keyLabel(chord).join('+');

/** What a button says about itself when the pointer rests on it. */
function controlTitle(action: Action): string {
  return action.chord ? `${action.label} (${chordText(action.chord)})` : action.label;
}

/** The button that has a menu open, or null while none has. Only one is ever open. */
let openMenuButton: HTMLButtonElement | null = null;
/** Which command's drill-in the open panel is showing, when it is showing one. */
let menuDrill: string | null = null;

const controlsOf = (p: Pane): HTMLElement => p.els.controls;
const panelOf = (button: HTMLElement): HTMLElement | null => button.parentElement?.querySelector<HTMLElement>('.menu') ?? null;

/** Every row a panel currently offers, in the order the arrow keys walk them. */
const rowsIn = (panel: HTMLElement): HTMLButtonElement[] => Array.from(panel.querySelectorAll<HTMLButtonElement>('.menu-item:not([disabled])'));

/**
 * The keys a panel of rows answers wherever it happens to be drawn: the
 * arrows, Home and End, and typing the first letter of what you are after, as
 * menus have always done. True when it took the key.
 *
 * Shared so that the menu a right-click opens walks exactly as the pane's own
 * menus do. What is left to each caller is what only it can mean — moving
 * between the buttons of a menu bar there is no bar for, and what Escape
 * closes.
 */
function panelKey(panel: HTMLElement, e: KeyboardEvent): boolean {
  const rows = rowsIn(panel);
  if (rows.length === 0) return false;
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      rows[(at + 1) % rows.length]?.focus();
      return true;
    case 'ArrowUp':
      e.preventDefault();
      rows[(at - 1 + rows.length) % rows.length]?.focus();
      return true;
    case 'Home':
      e.preventDefault();
      rows[0]?.focus();
      return true;
    case 'End':
      e.preventDefault();
      rows[rows.length - 1]?.focus();
      return true;
  }
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return false;
  const want = e.key.toLowerCase();
  const order = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
  const hit = order.find((r) => (r.querySelector('.menu-label')?.textContent ?? '').trim().toLowerCase().startsWith(want));
  if (!hit) return false;
  e.preventDefault();
  hit.focus();
  return true;
}

/**
 * Builds one pane's controls. Called once per pane, from `makePane`, because
 * the header belongs to a pane and there may be three of them.
 */
function buildControls(p: Pane): void {
  const box = controlsOf(p);
  box.replaceChildren();

  for (const action of PILLS) {
    const button = document.createElement('button');
    button.className = 'pill u ctl-pill';
    button.type = 'button';
    button.dataset.action = action.id;
    button.textContent = action.pill?.label ?? action.label;
    box.append(button);
  }

  const rule = document.createElement('span');
  rule.className = 'ctl-rule';
  rule.setAttribute('aria-hidden', 'true');
  box.append(rule);

  const bar = document.createElement('div');
  bar.className = 'menu-bar';
  bar.setAttribute('role', 'menubar');
  bar.setAttribute('aria-label', 'Commands');
  for (const menu of MENUS) bar.append(menuWrap(menu.name, menu.group));
  // The one button a pane too narrow for four falls back to. It holds all of
  // them, so narrowing a pane never takes a command away.
  bar.append(menuWrap('Commands', 'all'));
  box.append(bar);
}

/** A menu button and the empty panel it fills when it opens. */
function menuWrap(name: string, which: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = which === 'all' ? 'menu-wrap menu-all' : 'menu-wrap';
  const button = document.createElement('button');
  button.className = 'pill u menu-btn';
  button.type = 'button';
  button.dataset.menu = which;
  button.setAttribute('role', 'menuitem');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = name;
  const panel = document.createElement('div');
  panel.className = 'menu';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', name);
  panel.hidden = true;
  wrap.append(button, panel);
  return wrap;
}

/** One row: the tick gutter, the command's own words, and the chord that runs it. */
function menuRow(action: Action): HTMLButtonElement {
  const row = document.createElement('button');
  row.className = 'menu-item';
  row.type = 'button';
  row.setAttribute('role', 'menuitem');
  row.dataset.action = action.id;
  row.title = controlTitle(action);
  const tick = document.createElement('span');
  tick.className = 'menu-tick';
  tick.setAttribute('aria-hidden', 'true');
  const on = action.on?.() === true;
  tick.textContent = on ? '✓' : '';
  if (action.on) row.setAttribute('aria-checked', String(on));
  const label = document.createElement('span');
  label.className = 'menu-label';
  label.textContent = action.label;
  row.append(tick, label);
  if (action.chord) {
    const kbd = document.createElement('kbd');
    kbd.textContent = chordText(action.chord);
    row.append(kbd);
  }
  // Greyed rather than gone: a menu is a map, and a map that redraws itself
  // teaches nothing. The palette goes on hiding what cannot run.
  if (action.enabled?.() === false) row.disabled = true;
  return row;
}

function menuHeading(name: string): HTMLElement {
  const head = document.createElement('p');
  head.className = 'menu-head u';
  head.setAttribute('role', 'presentation');
  head.textContent = name;
  return head;
}

/** The export formats without a header to drill into, for when it is hidden. */
function pickExportKind(): void {
  openPicker(
    'Export this note as…',
    EXPORT_KINDS.map(({ kind, label, ext }) => ({ label, hint: ext, run: () => void runExport(kind) })),
  );
}

/** The export formats, as the page you land on after choosing Export. */
function exportPage(panel: HTMLElement): void {
  const back = document.createElement('button');
  back.className = 'menu-item menu-back';
  back.type = 'button';
  back.setAttribute('role', 'menuitem');
  back.dataset.back = 'yes';
  const arrow = document.createElement('span');
  arrow.className = 'menu-tick';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '‹';
  const label = document.createElement('span');
  label.className = 'menu-label';
  label.textContent = 'Export this note…';
  back.append(arrow, label);
  panel.append(back);
  for (const { kind, label: name, ext } of EXPORT_KINDS) {
    const row = document.createElement('button');
    row.className = 'menu-item';
    row.type = 'button';
    row.setAttribute('role', 'menuitem');
    row.dataset.kind = kind;
    const tick = document.createElement('span');
    tick.className = 'menu-tick';
    tick.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'menu-label';
    text.textContent = name;
    const dim = document.createElement('span');
    dim.className = 'menu-ext';
    dim.textContent = ext;
    text.append(' ', dim);
    row.append(tick, text);
    panel.append(row);
  }
}

/**
 * Fills a panel for the state it is in. Built on every open rather than once,
 * so what is ticked and what is greyed is true at the moment it is read.
 */
function fillPanel(panel: HTMLElement, which: string): void {
  panel.replaceChildren();
  if (menuDrill === 'export') {
    exportPage(panel);
    return;
  }
  const all = which === 'all';
  const menus = all ? MENUS : MENUS.filter((menu) => menu.group === which);
  for (const menu of menus) {
    // Collapsed into one button, the groups are the headings: their own
    // sections would make a list too deep to scan in a pane this narrow.
    if (all) panel.append(menuHeading(menu.name));
    for (const section of menu.sections) {
      if (section.name && !all) panel.append(menuHeading(section.name));
      for (const action of section.items) panel.append(menuRow(action));
    }
  }
}

/** Opens a menu in the pane in front, optionally at one command's drill-in. */
function openMenu(which: string, drill: string | null = null): void {
  const box = el.controls;
  const wanted = box.querySelector<HTMLButtonElement>(`.menu-btn[data-menu="${which}"]`);
  // A pane narrow enough to have collapsed its menus answers on Commands.
  const button = wanted && wanted.offsetParent !== null ? wanted : box.querySelector<HTMLButtonElement>('.menu-all .menu-btn');
  // With the header hidden there is no button to hang a menu on. Hanging one
  // on a hidden button opened nothing a reader could see while still claiming
  // the next Escape -- and hiding the controls is only meant to hide the
  // buttons, so a command that stands behind one has to go on working.
  if (!button || button.offsetParent === null) {
    if (drill === 'export') pickExportKind();
    return;
  }
  if (openMenuButton && openMenuButton !== button) closeMenu(false);
  const panel = panelOf(button);
  if (!panel) return;
  menuDrill = drill;
  fillPanel(panel, button.dataset.menu ?? which);
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  openMenuButton = button;
  rowsIn(panel)[drill === 'export' ? 1 : 0]?.focus();
}

function closeMenu(restoreFocus: boolean): void {
  const button = openMenuButton;
  if (!button) return;
  const panel = panelOf(button);
  disarmDelete();
  if (panel) {
    panel.hidden = true;
    panel.replaceChildren();
  }
  button.setAttribute('aria-expanded', 'false');
  openMenuButton = null;
  menuDrill = null;
  if (restoreFocus) button.focus();
}

/** Runs a command from a button, in the pane whose button it was. */
function runFromControls(id: string, row?: HTMLElement): void {
  const action = ACTIONS.find((a) => a.id === id);
  if (!action || action.enabled?.() === false) return;
  // Delete asks twice, and from a menu the row itself does the asking: the
  // panel stays open under it, because a confirmation you have to go and find
  // again is not a confirmation.
  if (action.id === 'delete' && row) {
    const second = armed;
    armDelete(row);
    if (second) closeMenu(false);
    return;
  }
  closeMenu(false);
  action.run();
}

/**
 * A control belongs to the pane it sits above, so using one makes that pane
 * the pane in front before it runs anything. The pointer already does this on
 * its way down; saying it here as well means a command can never act on a
 * note other than the one its own button is over.
 */
function focusPaneOf(node: Node | null): void {
  const p = paneOf(node);
  if (p && p !== panes[paneAt]) focusPane(panes.indexOf(p));
}

onPane('controls', 'click', (e) => {
  focusPaneOf(e.target as Node);
  const target = e.target as HTMLElement | null;
  const row = target?.closest<HTMLButtonElement>('.menu-item');
  if (row) {
    if (row.dataset.back) {
      const button = openMenuButton;
      const panel = button ? panelOf(button) : null;
      menuDrill = null;
      if (button && panel) {
        fillPanel(panel, button.dataset.menu ?? 'Notes');
        rowsIn(panel)[0]?.focus();
      }
      return;
    }
    if (row.dataset.kind) {
      void runExport(row.dataset.kind as ExportKind);
      return;
    }
    if (row.dataset.action) runFromControls(row.dataset.action, row);
    return;
  }
  const button = target?.closest<HTMLButtonElement>('.menu-btn');
  if (button) {
    if (openMenuButton === button) closeMenu(true);
    else openMenu(button.dataset.menu ?? 'Notes');
    return;
  }
  const pill = target?.closest<HTMLButtonElement>('.ctl-pill');
  if (pill?.dataset.action) runFromControls(pill.dataset.action);
});

onPane('controls', 'keydown', (e) => {
  focusPaneOf(e.target as Node);
  const target = e.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('.menu-btn');
  const bar = el.controls.querySelector<HTMLElement>('.menu-bar');
  const buttons = bar ? Array.from(bar.querySelectorAll<HTMLButtonElement>('.menu-btn')).filter((b) => b.offsetParent !== null) : [];

  if (button && !target?.closest('.menu')) {
    const at = buttons.indexOf(button);
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        buttons[(at + 1) % buttons.length]?.focus();
        return;
      case 'ArrowLeft':
        e.preventDefault();
        buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
        return;
      case 'ArrowDown':
        e.preventDefault();
        openMenu(button.dataset.menu ?? 'Notes');
        return;
      case 'Escape':
        // Esc on the bar means the bar, and nothing further up.
        e.preventDefault();
        e.stopPropagation();
        focusEditor();
        return;
    }
  }

  const panel = target?.closest<HTMLElement>('.menu');
  if (!panel) return;
  if (panelKey(panel, e)) return;
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault();
      const from = openMenuButton ? buttons.indexOf(openMenuButton) : 0;
      const to = buttons[(from + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
      if (to) openMenu(to.dataset.menu ?? 'Notes');
      break;
    }
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      break;
    case 'Tab':
      closeMenu(false);
      break;
  }
});

document.addEventListener('pointerdown', (e) => {
  // Every pane's menu, not just this one's: clicking into another pane is
  // exactly the click that should put an open menu away.
  if (openMenuButton && !openMenuButton.parentElement?.contains(e.target as Node)) closeMenu(false);
});

// --- the note's own menu, on a right-click in the list ----------------------

/**
 * A right-click on a note opens the commands that are about *that* note.
 *
 * It is the same panel the pane header draws, reading the same section of the
 * same registry — what changes is only which note the rows are about. That is
 * the whole feature: everywhere else in the app "this note" means the one on
 * screen, and here it means the one under the pointer, so a note can be filed,
 * exported or deleted without first having to go and read it.
 *
 * The native menu is left alone everywhere else in the window. Right-clicking
 * a word in the editor still offers the spelling suggestions, which are the
 * only way to teach the dictionary a name it does not know.
 */
let noteMenu: HTMLElement | null = null;
/** The note the open menu is about. */
let noteMenuId: string | null = null;
/** Where it was asked for, so a drill-in can be re-placed at its new size. */
let noteMenuAt = { x: 0, y: 0 };
/** What had the focus before it opened, to give back when Escape closes it. */
let noteMenuReturn: HTMLElement | null = null;
/** The row it was opened on, marked for as long as it is open. */
let noteMenuRow: HTMLElement | null = null;

/** A rule between two groups of rows. */
function menuRule(): HTMLElement {
  const rule = document.createElement('div');
  rule.className = 'menu-rule';
  rule.setAttribute('role', 'separator');
  return rule;
}

function closeNoteMenu(restoreFocus = false): void {
  const panel = noteMenu;
  if (!panel) return;
  disarmDelete();
  panel.remove();
  noteMenu = null;
  noteMenuId = null;
  noteMenuRow?.classList.remove('menued');
  noteMenuRow = null;
  const back = noteMenuReturn;
  noteMenuReturn = null;
  // The row it was opened on has been redrawn by now in the cases that matter,
  // so the list itself is where the focus goes when what held it is gone.
  if (!restoreFocus) return;
  if (back?.isConnected) back.focus();
  else focusList();
}

/**
 * The rows, read with the clicked note in view.
 *
 * `menuRow` asks each command whether it can run and whether it is on, and
 * both of those answers are about a note — so they are read here, under the
 * target, and what is greyed or ticked is true of the row you clicked.
 */
function fillNoteMenu(panel: HTMLElement, id: string): void {
  panel.replaceChildren();
  onNote(id, () => {
    for (const row of noteMenuRows(ACTIONS)) panel.append(row.kind === 'rule' ? menuRule() : menuRow(row.action));
  });
}

/** Puts the panel where it fits beside the pointer. */
function placeNoteMenu(panel: HTMLElement): void {
  const size = { width: panel.offsetWidth, height: panel.offsetHeight };
  const view = { width: window.innerWidth, height: window.innerHeight };
  // A pointer is a point, so the anchor has no width of its own: down and to
  // the right where there is room, which is where a menu has always gone.
  const spot = place({ left: noteMenuAt.x, top: noteMenuAt.y, right: noteMenuAt.x, bottom: noteMenuAt.y }, size, view, { gap: 2, margin: 6 });
  panel.style.left = `${spot.left}px`;
  panel.style.top = `${spot.top}px`;
}

function openNoteMenu(id: string, x: number, y: number): void {
  // One menu at a time, wherever it came from.
  closeMenu(false);
  closeNoteMenu();
  noteMenuReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const panel = document.createElement('div');
  panel.className = 'menu menu-at';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', 'This note');
  panel.addEventListener('click', onNoteMenuClick);
  panel.addEventListener('keydown', onNoteMenuKey);
  noteMenu = panel;
  noteMenuId = id;
  noteMenuAt = { x, y };
  // The pointer will move off the row, and the menu goes on being about it.
  noteMenuRow = el.list.querySelector<HTMLElement>(`.item[data-id="${id}"]`);
  noteMenuRow?.classList.add('menued');
  fillNoteMenu(panel, id);
  document.body.append(panel);
  placeNoteMenu(panel);
  rowsIn(panel)[0]?.focus();
}

/**
 * Runs a command from the menu, on the note the menu is about.
 *
 * Three commands need more than that. Export shows its formats inside this
 * menu rather than the pane's, because the pane's is about another note.
 * Delete arms the row in place, as it does in every menu. And the two that
 * drive the pane's own editor go to the note first, because editing a title
 * in a field that is not showing it is not a thing that can be done.
 */
function runFromNoteMenu(actionId: string, row: HTMLElement): void {
  const id = noteMenuId;
  const panel = noteMenu;
  if (!id || !panel) return;
  const action = ACTIONS.find((a) => a.id === actionId);
  if (!action) return;
  if (onNote(id, () => action.enabled?.() === false)) return;
  if (action.id === 'export') {
    panel.replaceChildren();
    exportPage(panel);
    placeNoteMenu(panel);
    rowsIn(panel)[1]?.focus();
    return;
  }
  if (GOES_THERE.has(action.id)) {
    closeNoteMenu();
    if (ui.selectedId !== id) select(id);
    action.run();
    return;
  }
  if (action.id === 'delete') {
    // The second click is an answer; the first is the question, and the menu
    // stays open under it holding the question.
    const answering = armed && armedId === id;
    onNote(id, () => armDelete(row));
    if (answering) closeNoteMenu();
    return;
  }
  closeNoteMenu();
  onNote(id, () => action.run());
}

function onNoteMenuClick(e: MouseEvent): void {
  const panel = noteMenu;
  const row = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.menu-item');
  if (!panel || !row) return;
  if (row.dataset.back) {
    const id = noteMenuId;
    if (id) fillNoteMenu(panel, id);
    placeNoteMenu(panel);
    rowsIn(panel)[0]?.focus();
    return;
  }
  if (row.dataset.kind) {
    const id = noteMenuId;
    const kind = row.dataset.kind as ExportKind;
    closeNoteMenu();
    if (id) onNote(id, () => void runExport(kind));
    return;
  }
  if (row.dataset.action) runFromNoteMenu(row.dataset.action, row);
}

function onNoteMenuKey(e: KeyboardEvent): void {
  const panel = noteMenu;
  if (!panel) return;
  if (panelKey(panel, e)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeNoteMenu(true);
    return;
  }
  if (e.key === 'Tab') closeNoteMenu();
}

el.list.addEventListener('contextmenu', (e) => {
  const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.item');
  const id = row?.dataset.id;
  // Only on a note. Anywhere else in the window the native menu answers, and
  // it must: the editor's spelling suggestions live on it.
  if (!id) return;
  e.preventDefault();
  openNoteMenu(id, e.clientX, e.clientY);
});

document.addEventListener('pointerdown', (e) => {
  if (noteMenu && !noteMenu.contains(e.target as Node)) closeNoteMenu();
});

/**
 * The pane header, kept true: whether the controls are shown at all, which
 * pills the pane is wide enough for, and what an open menu should now say.
 */
function syncControls(): void {
  el.controls.hidden = !ui.controls;
  for (const pill of Array.from(el.controls.querySelectorAll<HTMLButtonElement>('.ctl-pill'))) {
    const action = ACTIONS.find((a) => a.id === pill.dataset.action);
    if (!action) continue;
    pill.disabled = action.enabled?.() === false;
    pill.title = controlTitle(action);
    if (action.on) pill.setAttribute('aria-pressed', String(action.on() === true));
  }
  const button = openMenuButton;
  const panel = button ? panelOf(button) : null;
  // An armed Delete row owns the panel until it is answered: redrawing under a
  // confirmation would take the confirmation away.
  if (button && panel && !armed && el.controls.contains(button)) {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.action : undefined;
    fillPanel(panel, button.dataset.menu ?? 'Notes');
    if (focused) panel.querySelector<HTMLButtonElement>(`.menu-item[data-action="${focused}"]`)?.focus();
  }
}

/** Every pane's header, after something that changed them all. */
function syncAllControls(): void {
  for (const p of panes) withPane(p, syncControls);
}

/** F10, or Alt on its own: the first menu of the pane in front takes the focus. */
function focusMenuBar(): void {
  if (!ui.controls) return;
  const first = Array.from(el.controls.querySelectorAll<HTMLButtonElement>('.menu-btn')).find((b) => b.offsetParent !== null);
  first?.focus();
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
      // What the key does, in the command's own name; the hint, when there is
      // one, goes under it in the quieter register.
      const dd = document.createElement('dd');
      const name = document.createElement('span');
      name.className = 'key-name';
      name.textContent = action.label;
      dd.append(name);
      if (action.hint) {
        const hint = document.createElement('span');
        hint.className = 'key-hint';
        hint.textContent = action.hint;
        dd.append(hint);
      }
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
  keepCaret();
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
  if (refactorUi.isOpen()) {
    refactorUi.dismiss();
    return;
  }
  const chip = selectedChip();
  // A chip stays selected while a sheet is open; Esc then means the sheet.
  if (chip && document.activeElement === el.editor) {
    caretAfter(chip);
    return;
  }
  if (slash.isOpen()) {
    slash.close();
  } else if (peek.isOpen()) {
    peek.hide();
  } else if (workspacesUi.isOpen()) {
    workspacesUi.close();
  } else if (!el.palette.hidden) {
    togglePalette(false);
  } else if (openMenuButton) {
    closeMenu(true);
  } else if (!el.pickSheet.hidden) {
    closePicker();
  } else if (propertiesUi.isOpen()) {
    propertiesUi.close();
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
      renderSearchOps();
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

/**
 * Alt on its own is the menu bar, the way it is everywhere else in Windows.
 * Alt with anything else is a chord, so the bar only opens when Alt goes down
 * and comes back up with nothing in between.
 */
let altAlone = false;

document.addEventListener('keydown', (e) => {
  altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat;
  // Arrows, Enter, Tab and Esc belong to the slash menu while it is open —
  // and only those, so every other key goes on typing into the note.
  if (slash.isOpen() && slash.key(e)) return;
  if (e.key === 'F10' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    focusMenuBar();
    return;
  }
  if (e.key === 'Escape') {
    onEscape();
    return;
  }
  const chord = chordOf(e);
  if (!isCommandChord(chord)) return;
  // Ctrl and a number goes to the nth open note of this pane, Ctrl+9 to the
  // last of them — the tab keys every window with tabs has. They are not in
  // the registry: nine near-identical rows would crowd the palette out.
  const digit = /^ctrl\+([1-9])$/.exec(chord);
  if (digit) {
    e.preventDefault();
    goToTab(Number(digit[1]));
    return;
  }
  const action = CHORDS.get(chord);
  if (!action || action.enabled?.() === false) return;
  e.preventDefault();
  lastChord = chord;
  action.run();
  lastChord = '';
});

document.addEventListener('keyup', (e) => {
  if (e.key !== 'Alt') return;
  if (altAlone) focusMenuBar();
  altAlone = false;
});

// Losing the window is a good moment to make sure everything is on disk.
window.addEventListener('blur', () => void flush());
window.addEventListener('beforeunload', () => void flush());

// Relative timestamps drift; refresh them once a minute.
window.setInterval(() => {
  renderList();
  for (const p of panes) withPane(p, renderMeta);
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

/** The layout state as the command line sees it: the settings alone, the same shape from `ui get` and `ui set`. */
function uiState(): Omit<UiState, 'recent' | 'panes' | 'paneAt'> {
  const { recent: _recent, panes: _panes, paneAt: _paneAt, ...rest } = ui;
  return rest;
}

function noteById(id: string): Note {
  const n = notes.find((x) => x.id === id);
  if (!n) throw new CliRefusal(`No note with id ${id}`, CLI_NOT_FOUND);
  return n;
}

/** Whether the note has words in it that are not on disk yet. */
const beingTyped = (id: string): boolean => dirty && typedId === id;

/** Whether the note is on screen in any pane. */
const isOpen = (id: string): boolean => panes.some((p) => activeIn(p) === id);

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
  // A step of its own, so undo takes the command's change back out: taken
  // from the model before it changes, or the step would hold the new text.
  if (ui.selectedId === note.id) rememberNow('cli');
  else if (i >= 0) rememberFor(note.id);
  notes = i < 0 ? [note, ...notes] : notes.map((n) => (n.id === note.id ? note : n));
  forgetDrawn(note.id);
  if (ui.selectedId === note.id) {
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
  'note.status': ({ id }: { id: string }) => ({ open: isOpen(id), dirty: beingTyped(id) }),
  'note.put': async ({ note, force, expectUpdatedAt }: { note: Note; force?: boolean; expectUpdatedAt?: number }) => {
    const current = notes.find((n) => n.id === note.id);
    if (current) refuseIfTyping(note.id, force);
    // Words typed here while a command's editor was open are not to be replaced by what it read before them.
    if (current && expectUpdatedAt !== undefined && current.updatedAt !== expectUpdatedAt && !force) {
      throw new CliRefusal('That note changed in the window since it was read; pass --force to replace it anyway', CLI_BUSY);
    }
    takeIn(note);
    await flush();
    return note;
  },
  'note.remove': async ({ id, force }: { id: string; force?: boolean }) => {
    if (!notes.some((n) => n.id === id)) return { removed: false };
    refuseIfTyping(id, force);
    const wasSelected = ui.selectedId === id;
    const next = wasSelected ? neighborOf(visibleNotes(), id) : ui.selectedId;
    void flush();
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
  'refactor.apply': async ({ plan, force }: { plan: Plan; force?: boolean }) => {
    const touched = [...plan.writes.map((w) => w.id), ...plan.trash.map((t) => t.id)];
    for (const id of touched) refuseIfTyping(id, force);
    if (plan.restore.length > 0) throw new CliRefusal('Putting a note back as part of a change is for the window alone', CLI_APP_ERROR);
    const caret = document.activeElement === el.editor ? caretOffsetOrStart() : null;
    const r = await applyPlan(plan, refactorHost);
    if (!r.ok) throw new CliRefusal(r.message, r.code === 'stale' ? 1 : CLI_APP_ERROR);
    afterPlan(plan);
    const n = selected();
    if (caret !== null && n) placeCaretAt(Math.min(caret, n.body.length));
    await flush();
    return { applied: touched };
  },
  'ui.get': () => uiState(),
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
    } else if (key === 'uiScale' || key === 'readingScale') {
      if (typeof value !== 'number') throw new CliRefusal(`${key} is a multiplier, 1 being the designed size`, 2);
      ui[key] =
        key === 'uiScale'
          ? clampScale(value, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT)
          : clampScale(value, READING_SCALE_MIN, READING_SCALE_MAX, READING_SCALE_DEFAULT);
      applyLayout();
      saveUi();
    } else {
      throw new CliRefusal(`No layout setting "${key}"`, 2);
    }
    return uiState();
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
    let html = renderMarkdown(body, embedsFrom(notes));
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
  folders = file.folders ?? [];
  // The folder that was being browsed, unless it has gone since.
  folderScope = folders.some((f) => folderKey(f) === folderKey(ui.folder)) ? ui.folder : ROOT_FOLDER;
  tagsOpen = ui.tags;
  loaded = true;
  if (ui.selectedId && !notes.some((n) => n.id === ui.selectedId)) ui.selectedId = null;
  if (!ui.selectedId) ui.selectedId = sortByEdited(notes)[0]?.id ?? null;
  // The panes come next: everything after this point is drawn into one.
  openPanes();
  renderKeyGroups();
  applySidebar();
  applyLayout();
  applyWriting();
  el.outlineShow.checked = ui.outline;
  el.liveFormat.checked = ui.liveFormat;
  el.controlsShow.checked = ui.controls;
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
  // The list was drawn before the settings arrived, so the saved-search rail
  // was drawn from none at all. Nothing else redraws it until the reader
  // touches something, so it is drawn again here.
  renderList();
  void refreshFolderRow();
}

void init();
