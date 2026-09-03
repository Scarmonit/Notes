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
  pickImports: () => ipcRenderer.invoke(IPC.pickImports),
  exportNote: (request) => ipcRenderer.invoke(IPC.exportNote, request),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (next) => ipcRenderer.invoke(IPC.settingsSet, next),
  onNewNote: (fn) => {
    ipcRenderer.on(IPC.newNote, () => fn());
  },
  historyList: (noteId) => ipcRenderer.invoke(IPC.historyList, noteId),
  historyGet: (noteId, at) => ipcRenderer.invoke(IPC.historyGet, noteId, at),
  historyKeep: (note) => ipcRenderer.invoke(IPC.historyKeep, note),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
};

contextBridge.exposeInMainWorld('notesApi', api);
