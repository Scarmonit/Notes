import { cleanName, nameKey, sameArrangement, type PaneSnapshot, type Workspace } from './workspaces';

/**
 * The one sheet workspaces live in.
 *
 * One registry command opens it and everything else happens inside: saving,
 * switching, renaming, deleting. Four global commands for four operations on
 * an infrequent thing would be exactly the crowding 0.21.0 was about.
 */

export interface WorkspacesHost {
  held(): Workspace[];
  /** The arrangement on screen right now. */
  current(): { panes: PaneSnapshot[]; paneAt: number };
  /** The workspace most recently loaded, for the "update this one" row. */
  loadedId(): string | null;
  save(name: string): void;
  update(id: string): void;
  load(id: string): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  status(text: string, ms: number): void;
  focusEditor(): void;
  /** How a note reads in a row, or null when it is not in the notebook now. */
  titleOf(id: string): string | null;
  root: HTMLElement;
}

export interface WorkspacesUi {
  open(): void;
  close(): boolean;
  isOpen(): boolean;
  refresh(): void;
}

export function createWorkspacesUi(host: WorkspacesHost): WorkspacesUi {
  let sheet: HTMLElement | null = null;
  /** The row being renamed, or the one armed for deletion. */
  let renaming: string | null = null;
  /** The workspace whose Delete button is asking to be clicked again. */
  let arming: string | null = null;
  /**
   * The workspace the save box is offering to replace.
   *
   * Its own state, not `arming`: one variable for both meant that offering to
   * replace a snapshot silently armed that row's Delete button -- which still
   * read "Delete", because the offer does not redraw -- so the next click on
   * it deleted the workspace outright, with no confirmation ever shown.
   */
  let replacing: string | null = null;

  function close(): boolean {
    if (!sheet) return false;
    sheet.remove();
    sheet = null;
    renaming = null;
    arming = null;
    replacing = null;
    host.focusEditor();
    return true;
  }

  function open(): void {
    sheet?.remove();
    const el = document.createElement('div');
    el.className = 'sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Workspaces');
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) close();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      // Esc backs out of a rename or an arming before it closes the sheet.
      if (renaming || arming || replacing) {
        renaming = null;
        arming = null;
        replacing = null;
        draw();
        return;
      }
      close();
    });
    const card = document.createElement('div');
    card.className = 'sheet-card ws-card';
    card.tabIndex = -1;
    el.append(card);
    host.root.append(el);
    sheet = el;
    draw();
    card.focus();
  }

  function draw(): void {
    const card = sheet?.querySelector<HTMLElement>('.sheet-card');
    if (!card) return;
    card.replaceChildren();
    const h2 = document.createElement('h2');
    h2.textContent = 'Workspaces';
    const said = document.createElement('p');
    said.className = 'ws-note';
    said.textContent = 'A named arrangement of which notes are open in which panes.';
    card.append(h2, said);

    const held = host.held();
    const list = document.createElement('div');
    list.className = 'ws-list';
    if (held.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'props-empty';
      empty.textContent = 'None saved yet.';
      list.append(empty);
    }
    for (const w of held) list.append(row(w));
    card.append(list);

    card.append(saveRow());

    const foot = document.createElement('p');
    foot.className = 'sheet-foot u';
    foot.innerHTML = 'Switching keeps everything a workspace does not hold — the folder, the search, how you read · <kbd>Esc</kbd> closes';
    card.append(foot);
  }

  function row(w: Workspace): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ws-row';

    if (renaming === w.id) {
      const box = document.createElement('input');
      box.type = 'text';
      box.className = 'props-value ws-rename';
      box.value = w.name;
      box.setAttribute('aria-label', `Rename ${w.name}`);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const next = cleanName(box.value);
          if (!next) return;
          if (host.held().some((other) => other.id !== w.id && nameKey(other.name) === nameKey(next))) {
            host.status(`There is already a workspace called “${next}”`, 4000);
            return;
          }
          renaming = null;
          host.rename(w.id, next);
          draw();
        }
      });
      el.append(box);
      queueMicrotask(() => box.focus());
      return el;
    }

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'ws-name';
    open.textContent = w.name;
    open.addEventListener('click', () => {
      host.load(w.id);
      close();
    });

    const what = document.createElement('span');
    what.className = 'ws-what u';
    const notes = w.panes.flatMap((p) => p.tabs);
    const named = notes
      .map((id) => host.titleOf(id))
      .filter((t): t is string => t !== null)
      .slice(0, 3);
    what.textContent = `${w.panes.length} ${w.panes.length === 1 ? 'pane' : 'panes'} · ${named.join(', ')}${notes.length > named.length ? '…' : ''}`;

    const actions = document.createElement('span');
    actions.className = 'ws-actions';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'ws-act u';
    rename.textContent = 'Rename';
    rename.addEventListener('click', () => {
      renaming = w.id;
      arming = null;
      draw();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = `ws-act u${arming === w.id ? ' armed' : ''}`;
    // Deleting a snapshot cannot be undone — though it touches neither the
    // notes nor the arrangement on screen — so it asks once, in place.
    remove.textContent = arming === w.id ? 'Delete — click again' : 'Delete';
    remove.addEventListener('click', () => {
      if (arming === w.id) {
        arming = null;
        host.remove(w.id);
        draw();
        return;
      }
      arming = w.id;
      draw();
    });
    actions.append(rename, remove);
    el.append(open, what, actions);

    if (host.loadedId() === w.id && !sameArrangement(host.current().panes, w.panes)) {
      const update = document.createElement('button');
      update.type = 'button';
      update.className = 'ws-update u';
      update.textContent = `Update “${w.name}” from what is open now`;
      update.addEventListener('click', () => {
        host.update(w.id);
        draw();
        host.status(`Updated “${w.name}”`, 2500);
      });
      el.append(update);
    }
    return el;
  }

  /** The row that remembers what is open now under a name. */
  function saveRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ws-save';
    const box = document.createElement('input');
    box.type = 'text';
    box.className = 'props-value ws-new';
    box.placeholder = 'Save this arrangement as…';
    box.setAttribute('aria-label', 'Save this arrangement as');
    box.maxLength = 80;
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = cleanName(box.value);
      if (!name) return;
      const clash = host.held().find((w) => nameKey(w.name) === nameKey(name));
      if (clash && replacing !== clash.id) {
        // An existing name is offered as a replacement, never taken silently.
        replacing = clash.id;
        host.status(`“${clash.name}” already exists — press Enter again to replace its snapshot`, 5000);
        return;
      }
      replacing = null;
      host.save(name);
      draw();
      host.status(`Saved “${name}”`, 2500);
    });
    wrap.append(box);
    return wrap;
  }

  return { open, close, isOpen: () => sheet !== null, refresh: draw };
}
