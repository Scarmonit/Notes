import { blockAtLine, blocksIn, newBlockId, summarize, type BlockSlice } from '../core/blocks';
import { planBlockId, type Plan } from '../core/refactor';
import type { Note } from '../shared/types';
import { formatLinkAddress, qualifiedLink, sortByEdited, titleOf } from './notes';
import type { PickChoice, PickOptions } from './refactor-ui';

/**
 * The two ways a block reference gets made.
 *
 * Both mint an id, and both do it **only because somebody asked** — that is
 * the whole rule the feature rests on. Nothing here runs on load, on save, on
 * render or on hover; a note that is never asked for a block link never grows
 * a marker.
 *
 * "Link to a block…" can mint an id in a note you are not looking at, which is
 * a write to somebody else's page, so it is ordered carefully: the target is
 * written first, and only a target that was written gets a link pointing at
 * it. A failure leaves both notes as they were.
 */

export interface BlocksHost {
  notes(): Note[];
  selected(): Note | null;
  /** The line the caret is on in the open note, counted from 0, or null. */
  caretLine(): number | null;
  /**
   * Applies a Plan as one undoable step on every note it touches, so an id
   * minted in another note can be taken back from that note.
   */
  apply(plan: Plan): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Writes text at the caret, as one undoable step. */
  insertAtCaret(text: string): void;
  pick(placeholder: string, items: PickChoice[], options?: PickOptions, onClose?: () => void): void;
  copy(text: string): Promise<void>;
  status(text: string, ms: number): void;
  focusEditor(): void;
}

export interface BlocksUi {
  /** Copies a link to the block the caret is in, minting an id if it has none. */
  copyLink(): void;
  /** Chooses a note, then a block in it, and writes the link here. */
  insertLink(): void;
  /** Whether the caret is in something a link can point at. */
  canAddress(): boolean;
}

/** How a block's row reads in the picker: what kind it is, then its first words. */
export const blockRowHint = (block: BlockSlice): string => `${KIND_WORDS[block.kind]}${block.id ? ` · ^${block.id}` : ''} · line ${block.start + 1}`;

const KIND_WORDS: Record<BlockSlice['kind'], string> = {
  paragraph: 'paragraph',
  'list-item': 'list item',
  heading: 'heading',
  blockquote: 'quote',
  table: 'table',
  code: 'code block',
};

/** Nothing at the caret worth addressing: said the same way wherever it happens. */
const NOTHING_HERE = 'Place the caret in a paragraph, list item, heading, quote, table or code block';

export function createBlocksUi(host: BlocksHost): BlocksUi {
  /**
   * The block a note's line is in, with an id — minting one and writing it
   * back when it has none. Resolves to the id, or null when the write failed
   * or there was nothing there to address.
   */
  async function addressed(note: Note, block: BlockSlice): Promise<string | null> {
    if (block.id) return block.id;
    const id = newBlockId(note.body);
    const planned = planBlockId(host.notes(), { id: note.id, line: block.start, blockId: id });
    if (!planned.ok) {
      host.status(planned.message, 4000);
      return null;
    }
    const written = await host.apply(planned.plan);
    if (!written.ok) {
      host.status(written.message, 4000);
      return null;
    }
    return id;
  }

  function canAddress(): boolean {
    const note = host.selected();
    const line = host.caretLine();
    return note !== null && line !== null && blockAtLine(note.body, line) !== null;
  }

  function copyLink(): void {
    const note = host.selected();
    const line = host.caretLine();
    if (!note || line === null) return;
    const block = blockAtLine(note.body, line);
    if (!block) {
      host.status(NOTHING_HERE, 4000);
      return;
    }
    void (async () => {
      const id = await addressed(note, block);
      if (!id) return;
      // Qualified, so the link means this note wherever it is pasted — never
      // the local shorthand, which would mean something else in another note.
      const link = `[[${formatLinkAddress({ target: qualifiedLink(host.notes(), note), block: id })}]]`;
      await host.copy(link);
      host.status(`Copied ${link}`, 3500);
    })();
  }

  function insertLink(): void {
    const here = host.selected();
    const notes = sortByEdited(host.notes());
    const items: PickChoice[] = notes.map((n) => ({
      label: titleOf(n),
      hint: n.folder ? n.folder : n.id === here?.id ? 'this note' : 'the root',
      run: () => pickBlock(n.id),
    }));
    host.pick('Which note holds the block?', items);
  }

  function pickBlock(noteId: string): void {
    const note = host.notes().find((n) => n.id === noteId);
    if (!note) return;
    const blocks = blocksIn(note.body);
    if (blocks.length === 0) {
      host.status(`“${titleOf(note)}” has nothing a link can point at yet`, 4000);
      host.focusEditor();
      return;
    }
    const items: PickChoice[] = blocks.map((block) => ({
      label: summarize(block, 70),
      hint: blockRowHint(block),
      run: () => void writeLink(note, block),
    }));
    host.pick(`Which block of “${titleOf(note)}”?`, items);
  }

  async function writeLink(note: Note, block: BlockSlice): Promise<void> {
    // The target is written first: a link is only ever inserted once there is
    // something for it to point at.
    const id = await addressed(note, block);
    if (!id) return;
    const link = `[[${formatLinkAddress({ target: qualifiedLink(host.notes(), note), block: id })}]]`;
    host.insertAtCaret(link);
    host.status(`Linked to ${blockRowHint({ ...block, id })} of “${titleOf(note)}”`, 3500);
  }

  return { copyLink, insertLink, canAddress };
}
