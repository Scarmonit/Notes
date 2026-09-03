import { editAsync } from '@inquirer/external-editor';
import { CliError } from '../core/backend';
import { EXIT } from '../core/ipc-protocol';

/**
 * A round trip through $VISUAL or $EDITOR: the text goes into a temporary
 * .md file, the editor opens it, and whatever is there when the editor
 * closes comes back. Without either variable set, Windows gets notepad,
 * which is what everyone has.
 */
export async function editText(text: string): Promise<string> {
  if (!process.env.VISUAL && !process.env.EDITOR && process.platform === 'win32') process.env.EDITOR = 'notepad';
  try {
    const edited = await editAsync(text, { postfix: '.md' });
    return edited.replace(/\r\n/g, '\n');
  } catch (err) {
    throw new CliError(`Could not open an editor (${(err as Error).message}); set $EDITOR or pass --content`, EXIT.failure);
  }
}
