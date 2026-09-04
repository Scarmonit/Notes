import type { Command } from 'commander';
import { blocksIn } from '../../core/blocks';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { DEFAULT_JOURNAL_PATH, isoDate, journalNoteAt, journalPlace, momentOf, parseJournalDate } from '../../core/journal';
import { expandTemplate } from '../../core/templates';
import { joinFolder, ROOT_FOLDER } from '../../shared/folders';
import { RESERVED } from '../../shared/notes-folder';
import { typeOfValue, writeScalar, type NoteProperty, type PropertyScalar, type PropertyValue } from '../../shared/properties';
import { createNote, titleOf } from '../../renderer/notes';
import { describe, type Ctx } from '../context';

/**
 * The journal and the properties, on the command line.
 *
 * Both are concepts that live on disk, so the command line has to see them:
 * a notebook where `status: draft` is invisible to `notes list` would be one
 * where the app and the files disagree about what a note carries.
 *
 * What is deliberately *not* here is minting a block address. Reading one is
 * fine — `notes show --block` — but making one from a shell would need some
 * fragile new way of saying which paragraph was meant, and the caret is what
 * makes the window's command safely explicit.
 */

/** A property as it is reported: the same shape in every output and in MCP. */
export function propertyRecord(prop: NoteProperty): Record<string, unknown> {
  const row: Record<string, unknown> = {
    key: prop.key,
    occurrence: prop.occurrence,
    type: typeOfValue(prop.value, prop.complex),
    value: prop.complex ? null : prop.value,
  };
  return row;
}

/** How a value reads on one line of plain output. */
const plainValue = (prop: NoteProperty): string => (prop.complex ? '<complex>' : Array.isArray(prop.value) ? prop.value.map(writeScalar).join('\t') : writeScalar(prop.value));

/** What was typed for a value, read the same conservative way the file is read. */
function typedValue(typed: string): PropertyScalar {
  const text = typed.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  const n = Number(text);
  if (text !== '' && Number.isFinite(n) && String(n) === text) return n;
  return typed;
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  // --- the journal -----------------------------------------------------------

  program
    .command('journal')
    .description("open or make the dated note for a day; today's when no day is given")
    .argument('[date]', 'today, yesterday, tomorrow, a weekday, +3d, or 2026-09-01')
    .option('--no-create', 'only an entry that is already written')
    .action(async (said: string | undefined, opts: { create?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const date = parseJournalDate(said ?? 'today');
      if (!date) throw new CliError(`'${said ?? ''}' is not a day: try today, yesterday, friday, +3d or 2026-09-01`, EXIT.usage);
      const settings = await backend.settingsGet();
      const format = settings.journalPath || DEFAULT_JOURNAL_PATH;
      const place = journalPlace(date, format);
      const notes = await backend.notes();
      const already = journalNoteAt(notes, place);
      if (already) {
        // Occupancy wins, and an entry that is already there is never written to.
        c.out.value({ ...describe(already, notes), journalDate: isoDate(date), createdNow: false }, () =>
          c.out.mode === 'plain' ? pathOf(already.folder, already.file, place) : `Journal for ${isoDate(date)}\n${pathOf(already.folder, already.file, place)}\nAlready written`,
        );
        return;
      }
      if (opts.create === false) throw new CliError(`No journal entry for ${isoDate(date)} yet`, EXIT.notFound);
      const template = settings.journalTemplateId ? notes.find((n) => n.id === settings.journalTemplateId) : null;
      const made = createNote();
      made.title = place.title;
      // The entry's own day at local noon, so a back-filled note is not
      // stamped with the moment somebody happened to type it.
      if (template) made.body = expandTemplate(template, { title: place.title, now: momentOf(date) });
      const saved = await backend.put(made);
      if (place.folder) {
        // The one place the command line makes a folder while filing, and only
        // because a command asked for a dated note in it.
        await backend.folderCreate(place.folder);
        await backend.noteMove(saved.id, place.folder);
      }
      const now = (await backend.notes()).find((n) => n.id === saved.id) ?? saved;
      c.out.value({ ...describe(now, notes), journalDate: isoDate(date), createdNow: true }, () =>
        c.out.mode === 'plain' ? pathOf(now.folder, now.file, place) : `Journal for ${isoDate(date)}\n${pathOf(now.folder, now.file, place)}\nStarted`,
      );
    });

  // --- properties ------------------------------------------------------------

  const props = program.command('props').description("the front-matter keys a note carries, and the ones the notebook uses");

  props
    .argument('[note]', 'id, title, title prefix, filename, path, or - for stdin')
    .argument('[key]', 'one key, rather than all of them')
    .option('--all', 'every key in the notebook, and how much each is used')
    .action(async (selector: string | undefined, key: string | undefined, opts: { all?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      // `--all` with no note asks for the notebook's vocabulary; with one it
      // is the flag `props remove` means, which commander parses up here.
      if (opts.all && !selector) {
        const { propertyVocabulary } = await import('../../core/vocabulary');
        const uses = propertyVocabulary(await backend.notes());
        c.out.value(
          uses,
          () =>
            c.out.mode === 'plain'
              ? uses.map((u) => `${u.key}\t${u.noteCount}\t${u.types.join(',')}`).join('\n')
              : uses.map((u) => `${u.key.padEnd(20)} ${String(u.noteCount).padStart(4)}  ${u.types.join(' · ')}${u.casingVariants.length > 0 ? `  also ${u.casingVariants.join(', ')}` : ''}`).join('\n'),
        );
        return;
      }
      if (!selector) throw new CliError('Say which note, or pass --all for the whole notebook', EXIT.usage);
      const note = await c.note(selector);
      const held = note.properties ?? [];
      if (key) {
        const found = held.filter((p) => p.key === key);
        if (found.length === 0) throw new CliError(`"${titleOf(note)}" has no '${key}'`, EXIT.notFound);
        // Always a list, because a key written twice is legal and both answer.
        c.out.value(found.map(propertyRecord), () =>
          found.map((p) => (c.out.mode === 'plain' ? plainValue(p).split('\t').join('\n') : `${found.length > 1 ? `${p.occurrence}. ` : ''}${plainValue(p)}`)).join('\n'),
        );
        return;
      }
      const twice = new Set(held.filter((p) => p.occurrence > 1).map((p) => p.key));
      c.out.value(held.map(propertyRecord), () =>
        c.out.mode === 'plain'
          ? held.map((p) => `${p.key}\t${typeOfValue(p.value, p.complex)}\t${plainValue(p)}`).join('\n')
          : held.length === 0
            ? 'No properties'
            : held.map((p) => `${p.key.padEnd(18)} ${typeOfValue(p.value, p.complex).padEnd(8)} ${plainValue(p).split('\t').join(', ')}${twice.has(p.key) ? `   (${p.occurrence})` : ''}`).join('\n'),
      );
    });

  props
    .command('set')
    .description('set one property, or replace it')
    .argument('<note>', 'id, title, title prefix, filename, path, or - for stdin')
    .argument('<key>', 'the front-matter key')
    .argument('[value]', 'a scalar; true, false, null and a plain number are those, everything else is text')
    .option('--value <item...>', 'a list, one --value per item')
    .option('--occurrence <n>', 'which one, when the key is written more than once', Number)
    .action(async (selector: string, key: string, value: string | undefined, opts: { value?: string[]; occurrence?: number }) => {
      const c = ctx();
      if (value !== undefined && opts.value) throw new CliError('Give a value or --value, not both', EXIT.usage);
      if (value === undefined && !opts.value) throw new CliError('Say what to set it to', EXIT.usage);
      if (RESERVED.has(key)) throw new CliError(`'${key}' is one of the note's own fields; it has a command of its own`, EXIT.usage);
      const note = await c.note(selector);
      const next: PropertyValue = opts.value ? opts.value.map(typedValue) : typedValue(value as string);
      const props = await written(c, note.id, { key, value: next, occurrence: opts.occurrence });
      const path = joinFolder(note.folder ?? ROOT_FOLDER, note.file ?? '');
      c.out.value({ id: note.id, path, properties: props.filter((p) => p.key === key).map(propertyRecord) }, () => (c.out.mode === 'plain' ? path : `Set ${key} on ${path}`));
    });

  props
    .command('remove')
    .alias('rm')
    .description('take one property off a note')
    .argument('<note>', 'id, title, title prefix, filename, path, or - for stdin')
    .argument('<key>', 'the front-matter key')
    .option('--occurrence <n>', 'which one, when the key is written more than once', Number)
    .option('--all', 'every occurrence of it')
    .action(async (selector: string, key: string, opts: { occurrence?: number; all?: boolean }, command: Command) => {
      const c = ctx();
      if (RESERVED.has(key)) throw new CliError(`'${key}' is one of the note's own fields; it has a command of its own`, EXIT.usage);
      const note = await c.note(selector);
      // `props` itself declares `--all` for the notebook's vocabulary, and
      // commander parses a repeated flag onto the outer command; the answer
      // is here either way rather than a second spelling for the same thing.
      const all = opts.all === true || command.parent?.opts().all === true;
      const props = await written(c, note.id, { key, occurrence: opts.occurrence, all });
      const path = joinFolder(note.folder ?? ROOT_FOLDER, note.file ?? '');
      c.out.value({ id: note.id, path, properties: props.filter((p) => p.key === key).map(propertyRecord) }, () => (c.out.mode === 'plain' ? path : `Removed ${key} from ${path}`));
    });
}

/** Writes a property, turning "which occurrence?" into exit code 7. */
async function written(c: Ctx, id: string, change: { key: string; value?: PropertyValue; occurrence?: number; all?: boolean }): Promise<NoteProperty[]> {
  try {
    return await (await c.backend()).noteProperty(id, change);
  } catch (err) {
    const said = err instanceof Error ? err.message : String(err);
    // A key written twice, with nothing saying which: the same ambiguity the
    // app refuses to resolve for a link, and the same exit code.
    if (/written \d+ times/.test(said)) throw new CliError(said, EXIT.ambiguous);
    throw err;
  }
}

/** Where a note's file is, falling back to the place the format asked for. */
const pathOf = (folder: string | undefined, file: string | undefined, place: { path: string }): string => (file ? joinFolder(folder ?? ROOT_FOLDER, file) : `${place.path}.md`);

/** Every addressable block in a note, for `--json` and `--block`. */
export const blockRecords = (body: string): Array<Record<string, unknown>> =>
  blocksIn(body)
    .filter((b) => b.id)
    .map((b) => ({ id: b.id, kind: b.kind, line: b.start + 1 }));
