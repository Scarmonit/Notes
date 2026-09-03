import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels';
import type { NotesApi } from '../shared/types';

const api: NotesApi = {
  load: () => ipcRenderer.invoke(IPC.notesLoad),
  save: (file) => ipcRenderer.invoke(IPC.notesSave, file),
  onFlushRequest: (fn) => {
    ipcRenderer.on(IPC.flushRequest, () => ipcRenderer.send(IPC.flushReply, fn()));
  },
  attach: (bytes, name) => ipcRenderer.invoke(IPC.attach, bytes, name),
  pickAttachments: () => ipcRenderer.invoke(IPC.pickAttachments),
  exportNote: (request) => ipcRenderer.invoke(IPC.exportNote, request),
};

contextBridge.exposeInMainWorld('notesApi', api);
