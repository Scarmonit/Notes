export const IPC = {
  notesLoad: 'notes:load',
  notesSave: 'notes:save',
  flushRequest: 'notes:flush-request',
  flushReply: 'notes:flush-reply',
  attach: 'notes:attach',
  pickAttachments: 'notes:pick-attachments',
  exportNote: 'notes:export',
} as const;
