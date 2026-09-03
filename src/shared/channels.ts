export const IPC = {
  notesLoad: 'notes:load',
  notesSave: 'notes:save',
  flushRequest: 'notes:flush-request',
  flushReply: 'notes:flush-reply',
  attach: 'notes:attach',
  pickAttachments: 'notes:pick-attachments',
  pickImports: 'notes:pick-imports',
  exportNote: 'notes:export',
  settingsGet: 'notes:settings-get',
  settingsSet: 'notes:settings-set',
  newNote: 'notes:new-note',
} as const;
