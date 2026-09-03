import { describePlan, planMerge, planMoveSection, planRefile, planRename, planTagRename, sectionAround, type Plan, type PlanResult, type Target } from '../core/refactor';
import type { Note } from '../shared/types';
import { allTags, snippetOf, sortByEdited, titleOf } from './notes';
import { headingsIn } from './outline';

/**
 * The window's side of the structural changes: the pickers that choose a
 * destination, the sheet that shows a Plan before it is applied, and the
 * one-line prompt. Everything here works through a host the window
 * supplies — the notes, the picker, how to apply a Plan — so the flows can
 * be driven in a test without the rest of the window.
 */

export interface PickChoice {
  label: string;
  hint?: string;
  /** Shown but not choosable: a heading inside the lines being moved, or a caption. */
  disabled?: boolean;
  run: () => void;
}

export interface PickOptions {
  /** The row to start on. */
  at?: number;
  /** A row made from whatever is typed, offered when no label is exactly that. */
  typed?: (text: string) => PickChoice | null;
}

export interface RefactorHostUi {
  notes(): Note[];
  selected(): Note | null;
  /** The lines selected in the editor, or the line the caret is on, counted from 0. */
  selection(): { first: number; last: number } | null;
  pick(placeholder: string, items: PickChoice[], options?: PickOptions, onClose?: () => void): void;
  /** Applies a Plan as one undoable step; the message is for the status line when it fails. */
  apply(plan: Plan): Promise<{ ok: true } | { ok: false; message: string }>;
  status(text: string, ms: number): void;
  focusEditor(): void;
  /** Where the sheets go. */
  root: HTMLElement;
}

/** The destination a move last went to, so Enter, Enter repeats it. Forgotten when the app exits. */
interface LastMove {
  noteId: string;
  target: Target;
  createHeading?: string;
}

export interface ConfirmOptions {
  /** What Esc does, for the foot line; the default is "cancels". */
  escape?: string;
  /** The foot line's word for Enter; the default is "applies". */
  enter?: string;
}

export interface RefactorUi {
  moveLines(): void;
  moveSection(): void;
  renameTag(): void;
  mergeInto(): void;
  /**
   * A title just committed in the title box (`oldTitle` is the explicit title
   * the note had when the box took focus, or undefined when its first line
   * stood in): if links point at the old name, asks whether to update them. Resolves once the change is made,
   * with or without the links, or not at all when there was nothing to do.
   */
  commitRename(id: string, oldTitle: string | undefined, newTitle: string): Promise<'links' | 'title' | 'none' | 'failed'>;
  /** Shows a Plan and waits for Enter (true) or Esc (false). */
  confirm(plan: Plan, options?: ConfirmOptions): Promise<boolean>;
  /** One line of input under a label; null when dismissed. */
  prompt(label: string, initial: string): Promise<string | null>;
  /** Whether one of the sheets is open, for the window's Escape handling. */
  isOpen(): boolean;
  /** Closes whichever sheet is open as a cancel. */
  dismiss(): void;
  /** For tests: the remembered destination. */
  lastMove(): LastMove | null;
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createRefactorUi(host: RefactorHostUi): RefactorUi {
  let last: LastMove | null = null;

  // --- the confirm sheet ----------------------------------------------------------

  const confirmSheet = el('div', 'sheet confirm-sheet');
  confirmSheet.hidden = true;
  confirmSheet.setAttribute('role', 'dialog');
  confirmSheet.setAttribute('aria-modal', 'true');
  confirmSheet.setAttribute('aria-label', 'Confirm');
  const confirmCard = el('div', 'sheet-card confirm-card');
  confirmCard.tabIndex = -1;
  const confirmText = el('p', 'confirm-text');
  const confirmCount = el('button', 'confirm-count link-btn u');
  confirmCount.type = 'button';
  confirmCount.setAttribute('aria-expanded', 'false');
  const confirmList = el('ul', 'confirm-list');
  confirmList.hidden = true;
  const confirmFoot = el('p', 'sheet-foot u');
  confirmCard.append(confirmText, confirmCount, confirmList, confirmFoot);
  confirmSheet.append(confirmCard);
  host.root.append(confirmSheet);

  let confirmResolve: ((yes: boolean) => void) | null = null;

  function settleConfirm(yes: boolean): void {
    if (confirmSheet.hidden) return;
    confirmSheet.hidden = true;
    const done = confirmResolve;
    confirmResolve = null;
    done?.(yes);
  }

  function toggleList(): void {
    const open = confirmList.hidden;
    confirmList.hidden = !open;
    confirmCount.setAttribute('aria-expanded', String(open));
  }

  confirmCount.addEventListener('click', toggleList);
  confirmSheet.addEventListener('click', (e) => {
    if (e.target === confirmSheet) settleConfirm(false);
  });
  confirmCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      settleConfirm(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      settleConfirm(false);
    } else if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      toggleList();
    }
  });

  function confirm(plan: Plan, options: ConfirmOptions = {}): Promise<boolean> {
    confirmText.textContent = `${describePlan(plan)}?`;
    confirmCount.textContent = `${plural(plan.touched.length, 'note')} ›`;
    confirmList.replaceChildren(
      ...plan.touched.map((t) => {
        const row = el('li', 'confirm-row');
        row.append(el('span', 'confirm-title', t.title), el('span', 'confirm-changes u', t.changes.join(', ')));
        return row;
      }),
    );
    confirmList.hidden = true;
    confirmCount.setAttribute('aria-expanded', 'false');
    confirmFoot.textContent = `Enter ${options.enter ?? 'applies'} · Space shows the notes · Esc ${options.escape ?? 'cancels'}`;
    confirmSheet.hidden = false;
    confirmCard.focus();
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  // --- the prompt sheet -----------------------------------------------------------

  const promptSheet = el('div', 'sheet prompt-sheet');
  promptSheet.hidden = true;
  promptSheet.setAttribute('role', 'dialog');
  promptSheet.setAttribute('aria-modal', 'true');
  const promptCard = el('div', 'sheet-card prompt-card');
  const promptLabel = el('label', 'prompt-label');
  promptLabel.htmlFor = 'prompt-input';
  const promptInput = el('input', 'prompt-input');
  promptInput.id = 'prompt-input';
  promptInput.type = 'text';
  promptInput.autocomplete = 'off';
  promptInput.spellcheck = false;
  const promptFoot = el('p', 'sheet-foot u', 'Enter confirms · Esc cancels');
  promptCard.append(promptLabel, promptInput, promptFoot);
  promptSheet.append(promptCard);
  host.root.append(promptSheet);

  let promptResolve: ((value: string | null) => void) | null = null;

  function settlePrompt(value: string | null): void {
    if (promptSheet.hidden) return;
    promptSheet.hidden = true;
    const done = promptResolve;
    promptResolve = null;
    done?.(value);
  }

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      settlePrompt(promptInput.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      settlePrompt(null);
    }
  });
  promptSheet.addEventListener('click', (e) => {
    if (e.target === promptSheet) settlePrompt(null);
  });

  function prompt(label: string, initial: string): Promise<string | null> {
    promptLabel.textContent = label;
    promptSheet.setAttribute('aria-label', label);
    promptInput.value = initial;
    promptSheet.hidden = false;
    promptInput.focus();
    promptInput.select();
    return new Promise((resolve) => {
      promptResolve = resolve;
    });
  }

  // --- applying, with the status line -------------------------------------------

  async function runPlan(result: PlanResult, done: (plan: Plan) => string): Promise<boolean> {
    if (!result.ok) {
      host.status(result.message, 4000);
      return false;
    }
    const applied = await host.apply(result.plan);
    if (!applied.ok) {
      host.status(applied.message, 5000);
      return false;
    }
    host.status(done(result.plan), 3000);
    return true;
  }

  // --- moving lines and sections ----------------------------------------------------

  const targetText = (to: Note, target: Target, createHeading?: string): string => {
    if (target === 'top') return `the top of '${titleOf(to)}'`;
    if (target === 'end') return createHeading ? `'${titleOf(to)}' › '${createHeading}'` : `the end of '${titleOf(to)}'`;
    const heading = headingsIn(to.body).find((h) => h.line === target.line);
    return `'${titleOf(to)}' › '${heading?.text ?? ''}'`;
  };

  interface Move {
    what: string;
    plan: (to: Note, target: Target, createHeading?: string) => PlanResult;
    /** In the same note, headings on these lines cannot be the target. */
    within: { noteId: string; first: number; last: number };
  }

  function pickDestination(move: Move): void {
    const from = host.selected();
    if (!from) return;
    const notes = sortByEdited(host.notes());
    const items: PickChoice[] = notes.map((n) => ({
      label: titleOf(n),
      hint: snippetOf(n, 40),
      run: () => pickHeading(move, n),
    }));
    const at = last ? notes.findIndex((n) => n.id === last?.noteId) : -1;
    host.pick(`Move ${move.what} to which note?`, items, { at: at >= 0 ? at : 0 }, host.focusEditor);
  }

  function pickHeading(move: Move, to: Note): void {
    const finish = async (target: Target, createHeading?: string): Promise<void> => {
      const ok = await runPlan(move.plan(to, target, createHeading), () => `Moved ${move.what} to ${targetText(to, target, createHeading)}`);
      if (ok) last = createHeading ? { noteId: to.id, target: 'end', createHeading } : { noteId: to.id, target };
      host.focusEditor();
    };
    const headings = headingsIn(to.body);
    const inRange = (line: number): boolean => to.id === move.within.noteId && line >= move.within.first && line <= move.within.last;
    const items: PickChoice[] = [
      { label: `In '${titleOf(to)}'`, hint: 'the destination', disabled: true, run: () => undefined },
      { label: 'Top of the note', run: () => void finish('top') },
      { label: 'End of the note', run: () => void finish('end') },
      ...headings.map((h) => ({
        // Em spaces, since ordinary ones collapse in the row.
        label: `${'\u2003'.repeat(h.level - 1)}${h.text}`,
        hint: `line ${h.line + 1}`,
        disabled: inRange(h.line),
        run: () => void finish({ line: h.line }),
      })),
    ];
    let at = 1;
    if (last && last.noteId === to.id) {
      const t = last.target;
      if (t === 'top') at = 1;
      else if (t === 'end' && !last.createHeading) at = 2;
      else if (typeof t === 'object') {
        const i = headings.findIndex((h) => h.line === t.line);
        if (i >= 0 && !items[3 + i].disabled) at = 3 + i;
      }
    }
    host.pick(
      `Move ${move.what} under which heading?`,
      items,
      {
        at,
        typed: (text) => ({ label: `Create '${text}' at the end`, hint: 'a new ## heading', run: () => void finish('end', text) }),
      },
      host.focusEditor,
    );
  }

  function moveLines(): void {
    const from = host.selected();
    const sel = host.selection();
    if (!from || !sel) {
      host.status('Put the caret on the line to move, or select some lines', 3000);
      return;
    }
    const lines = from.body.split('\n').slice(sel.first, sel.last + 1);
    if (!lines.some((l) => l.trim())) {
      host.status('Nothing to move: the line is blank', 3000);
      return;
    }
    const count = sel.last - sel.first + 1;
    pickDestination({
      what: plural(count, 'line'),
      within: { noteId: from.id, first: sel.first, last: sel.last },
      plan: (to, target, createHeading) => planRefile(host.notes(), { from: from.id, first: sel.first, last: sel.last, to: to.id, target, createHeading }),
    });
  }

  function moveSection(): void {
    const from = host.selected();
    const sel = host.selection();
    const section = from && sel ? sectionAround(from.body, sel.first) : null;
    if (!from || !sel || !section) {
      host.status('Put the caret in a section first', 3000);
      return;
    }
    pickDestination({
      what: `the section '${section.text}'`,
      within: { noteId: from.id, first: section.first, last: section.last },
      plan: (to, target, createHeading) => planMoveSection(host.notes(), { from: from.id, line: sel.first, to: to.id, target, createHeading }),
    });
  }

  // --- tags and merging -----------------------------------------------------------

  function renameTag(): void {
    const tags = allTags(host.notes());
    if (tags.length === 0) {
      host.status('No tags yet: write #something in a note to make one', 3000);
      return;
    }
    const items: PickChoice[] = tags.map((t) => ({
      label: `#${t.tag}`,
      hint: plural(t.count, 'note'),
      run: () => {
        void (async () => {
          const next = await prompt(`Rename #${t.tag} to`, t.tag);
          if (next === null || !next.trim()) {
            host.focusEditor();
            return;
          }
          const result = planTagRename(host.notes(), { from: t.tag, to: next });
          if (!result.ok) {
            host.status(result.message, 4000);
            host.focusEditor();
            return;
          }
          if (await confirm(result.plan)) await runPlan(result, (p) => `Renamed #${t.tag} to #${next.trim().replace(/^#/, '').toLowerCase()} in ${plural(p.summary.notes, 'note')}`);
          host.focusEditor();
        })();
      },
    }));
    host.pick('Rename which tag?', items, {}, host.focusEditor);
  }

  function mergeInto(): void {
    const source = host.selected();
    if (!source) return;
    const others = sortByEdited(host.notes()).filter((n) => n.id !== source.id);
    if (others.length === 0) {
      host.status('There is no other note to merge into', 3000);
      return;
    }
    const items: PickChoice[] = others.map((n) => ({
      label: titleOf(n),
      hint: snippetOf(n, 40),
      run: () => {
        void (async () => {
          const result = planMerge(host.notes(), { source: source.id, into: n.id });
          if (!result.ok) {
            host.status(result.message, 4000);
            host.focusEditor();
            return;
          }
          if (await confirm(result.plan)) await runPlan(result, () => `Merged '${titleOf(source)}' into '${titleOf(n)}' · the old note is in Deleted notes`);
          host.focusEditor();
        })();
      },
    }));
    host.pick(`Merge '${titleOf(source)}' into which note?`, items, {}, host.focusEditor);
  }

  // --- renaming with links ----------------------------------------------------------

  async function commitRename(id: string, oldTitle: string | undefined, newTitle: string): Promise<'links' | 'title' | 'none' | 'failed'> {
    // Planned against the note as it was when the box took focus, whatever the box shows now.
    const notes = host.notes().map((n) => {
      if (n.id !== id) return n;
      const { title: _now, ...rest } = n;
      return oldTitle === undefined ? rest : { ...rest, title: oldTitle };
    });
    const withLinks = planRename(notes, { id, title: newTitle, links: true });
    if (!withLinks.ok) return 'none';
    const titleOnly = planRename(notes, { id, title: newTitle, links: false });
    if (!titleOnly.ok) return 'none';
    let chosen: PlanResult = titleOnly;
    let how: 'links' | 'title' = 'title';
    if ((withLinks.plan.summary.links ?? 0) > 0) {
      const yes = await confirm(withLinks.plan, { enter: 'updates the links', escape: 'keeps them as they are' });
      if (yes) {
        chosen = withLinks;
        how = 'links';
      }
    }
    const applied = await host.apply(chosen.plan);
    if (!applied.ok) {
      host.status(applied.message, 5000);
      return 'failed';
    }
    if (how === 'links') host.status(`Renamed and updated ${plural(withLinks.plan.summary.links ?? 0, 'link')}`, 3000);
    return how;
  }

  return {
    moveLines,
    moveSection,
    renameTag,
    mergeInto,
    commitRename,
    confirm,
    prompt,
    isOpen: () => !confirmSheet.hidden || !promptSheet.hidden,
    dismiss: () => {
      settleConfirm(false);
      settlePrompt(null);
    },
    lastMove: () => last,
  };
}
