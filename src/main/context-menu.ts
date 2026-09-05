import { BrowserWindow, Menu, MenuItem, clipboard } from 'electron';
import { assetNameFromUrl, canOpenAsset } from '../shared/assets';
import { openAttachment } from './attachments';

/**
 * The attachment the pointer was over as the right-click began, told by the
 * renderer just before this menu opens: in the editor an attachment is plain
 * markdown text, which the native menu's own `linkURL` knows nothing of.
 */
let contextAttachment: string | null = null;
export function setContextAttachment(name: string | null): void {
  contextAttachment = name;
}


/**
 * The right-click menu. There is no application menu (its accelerators would
 * shadow the app's own), so this is the only native menu in the app, and the
 * only way to teach the spellchecker a word.
 *
 * Words added here are remembered in the app's own dictionary in userData, so
 * a name the app does not know — a game's, a person's, a command's — stops
 * being underlined for good.
 */
export function installContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    const { editFlags } = params;
    const editable = params.isEditable;

    // Corrections first, then the way to say the word was right all along.
    if (editable && params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menu.append(new MenuItem({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) }));
      }
      if (params.dictionarySuggestions.length === 0) {
        menu.append(new MenuItem({ label: 'No suggestions', enabled: false }));
      }
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(
        new MenuItem({
          label: `Add “${params.misspelledWord}” to dictionary`,
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // An attachment, in the preview (a real link) or in the editor (the
    // renderer said which one the pointer was on): offered, greyed for a kind
    // the app does not launch.
    const attachment = assetNameFromUrl(params.linkURL) ?? contextAttachment;
    contextAttachment = null;
    if (attachment) {
      menu.append(
        new MenuItem({
          label: 'Open attachment',
          enabled: canOpenAsset(attachment),
          click: () => void openAttachment(attachment),
        }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
    } else if (params.linkURL) {
      menu.append(new MenuItem({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: editable && editFlags.canCut }));
    menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: editFlags.canCopy }));
    menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: editable && editFlags.canPaste }));
    // Pasting formatted text into the editor would bring HTML the serializer
    // has no meaning for; this is the escape hatch that always behaves.
    menu.append(
      new MenuItem({
        label: 'Paste as plain text',
        role: 'pasteAndMatchStyle',
        enabled: editable && editFlags.canPaste,
      }),
    );
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Select all', role: 'selectAll', enabled: editFlags.canSelectAll }));

    menu.popup({ window: win });
  });
}
