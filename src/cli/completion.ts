import type { Command } from 'commander';
import type { Complete } from '@bomb.sh/tab';
import tab from '@bomb.sh/tab/commander';
import { createStore } from '../core/store';
import { defaultUserData } from '../core/paths';
import { allTags, titleOf } from '../renderer/notes';

/**
 * Shell completion for PowerShell, bash, zsh and fish, through @bomb.sh/tab:
 * `notes completion powershell` prints the script to source, and the shell
 * then asks `notes complete -- …` for suggestions. Note names and tags are
 * completed from the notes themselves, read straight from the folder, so
 * the suggestions are live.
 */
export async function installCompletion(program: Command): Promise<void> {
  const completion = tab(program, { completionCommandName: 'completion' });

  // Only the completion request itself needs the notes; loading them for
  // every ordinary command would cost every command the read.
  const asking = process.argv[2] === 'complete';
  if (!asking) return;
  const notesFor = async (): Promise<{ titles: string[]; tags: string[] }> => {
    try {
      const store = createStore(defaultUserData(process.argv, process.env));
      const { notes } = await store.loadNotes();
      return { titles: notes.map((n) => titleOf(n)), tags: allTags(notes).map((t) => t.tag) };
    } catch {
      return { titles: [], tags: [] };
    }
  };
  const { titles, tags } = await notesFor();
  const noteArg = (complete: Complete): void => {
    for (const t of titles) complete(t, '');
  };
  const tagOption = (complete: Complete): void => {
    for (const t of tags) complete(t, '');
  };
  for (const [, cmd] of completion.commands) {
    for (const [name, arg] of cmd.arguments) {
      if (/note/i.test(name)) arg.handler = noteArg;
    }
    const tagOpt = cmd.options.get('tag');
    if (tagOpt) tagOpt.handler = tagOption;
    const linksTo = cmd.options.get('links-to');
    if (linksTo) linksTo.handler = noteArg;
    const linkedFrom = cmd.options.get('linked-from');
    if (linkedFrom) linkedFrom.handler = noteArg;
  }
}
