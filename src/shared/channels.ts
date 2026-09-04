export const IPC = {
  notesLoad: 'notes:load',
  notesSave: 'notes:save',
  flushRequest: 'notes:flush-request',
  flushReply: 'notes:flush-reply',
  externalChange: 'notes:external-change',
  openFolder: 'notes:open-folder',
  /** Explorer, with one note's own file picked out. */
  showNoteFile: 'notes:show-note-file',
  /** The folders notes are filed in, and the five ways of changing them. */
  foldersList: 'notes:folders-list',
  folderCreate: 'notes:folder-create',
  folderRename: 'notes:folder-rename',
  folderMove: 'notes:folder-move',
  folderDelete: 'notes:folder-delete',
  noteMove: 'notes:note-move',
  /** The web clipper's bookmarklet, with this launch's port and token in it. */
  clipperBookmarklet: 'notes:clipper-bookmarklet',
  /** Choose where the markdown files live, and where they are now. */
  pickNotesFolder: 'notes:pick-notes-folder',
  notesFolder: 'notes:notes-folder',
  attach: 'notes:attach',
  pickAttachments: 'notes:pick-attachments',
  pickImports: 'notes:pick-imports',
  exportNote: 'notes:export',
  /** Export to a path already chosen (by the command line), no dialog. */
  exportNoteTo: 'notes:export-to',
  settingsGet: 'notes:settings-get',
  settingsSet: 'notes:settings-set',
  /** Main → notes window: the settings changed behind its back (the command line). */
  settingsChanged: 'notes:settings-changed',
  newNote: 'notes:new-note',
  historyList: 'notes:history-list',
  historyGet: 'notes:history-get',
  historyKeep: 'notes:history-keep',
  trashList: 'notes:trash-list',
  trashGet: 'notes:trash-get',
  trashRestore: 'notes:trash-restore',
  trashPurge: 'notes:trash-purge',
  copyText: 'notes:copy-text',
  /** The `notes` command's launcher: is it installed, install it, remove it. */
  cliStatus: 'notes:cli-status',
  cliInstall: 'notes:cli-install',
  cliUninstall: 'notes:cli-uninstall',
  /** Main → notes window: a request from the command line, answered on cliReply. */
  cliRequest: 'notes:cli-request',
  cliReply: 'notes:cli-reply',
  /** Notes window → main: the note on screen changed (for `notes open --wait`). */
  noteClosed: 'notes:note-closed',
  /** Capture box → main: the text to file, or nothing. */
  captureSend: 'capture:send',
  captureDismiss: 'capture:dismiss',
  /** Main → capture box: it has just been shown. */
  captureShown: 'capture:shown',
  /** Main → notes window: a quick note to append to the inbox. */
  captured: 'notes:captured',
} as const;
