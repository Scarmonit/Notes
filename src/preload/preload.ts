import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels';
import type { Settings } from '../shared/settings';
import type { ExternalChanges, NotesApi } from '../shared/types';

interface CliRequest {
  id: number;
  method: string;
  params: unknown;
}

const api: NotesApi = {
  load: () => ipcRenderer.invoke(IPC.notesLoad),
  save: (file) => ipcRenderer.invoke(IPC.notesSave, file),
  onFlushRequest: (fn) => {
    ipcRenderer.on(IPC.flushRequest, () => ipcRenderer.send(IPC.flushReply, fn()));
  },
  onExternalChange: (fn) => {
    ipcRenderer.on(IPC.externalChange, (_event, changes: ExternalChanges) => fn(changes));
  },
  openNotesFolder: () => ipcRenderer.invoke(IPC.openFolder),
  attach: (bytes, name) => ipcRenderer.invoke(IPC.attach, bytes, name),
  pickAttachments: () => ipcRenderer.invoke(IPC.pickAttachments),
  pickImports: () => ipcRenderer.invoke(IPC.pickImports),
  exportNote: (request) => ipcRenderer.invoke(IPC.exportNote, request),
  exportNoteTo: (path, request) => ipcRenderer.invoke(IPC.exportNoteTo, path, request),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (next) => ipcRenderer.invoke(IPC.settingsSet, next),
  onSettingsChanged: (fn) => {
    ipcRenderer.on(IPC.settingsChanged, (_event, settings: Settings) => fn(settings));
  },
  onNewNote: (fn) => {
    ipcRenderer.on(IPC.newNote, () => fn());
  },
  onCapture: (fn) => {
    ipcRenderer.on(IPC.captured, (_event, text: string) => fn(text));
  },
  historyList: (noteId) => ipcRenderer.invoke(IPC.historyList, noteId),
  historyGet: (noteId, at) => ipcRenderer.invoke(IPC.historyGet, noteId, at),
  historyKeep: (note) => ipcRenderer.invoke(IPC.historyKeep, note),
  trashList: () => ipcRenderer.invoke(IPC.trashList),
  trashGet: (id) => ipcRenderer.invoke(IPC.trashGet, id),
  trashRestore: (id) => ipcRenderer.invoke(IPC.trashRestore, id),
  trashPurge: (id) => ipcRenderer.invoke(IPC.trashPurge, id),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  cliStatus: () => ipcRenderer.invoke(IPC.cliStatus),
  cliInstall: () => ipcRenderer.invoke(IPC.cliInstall),
  cliUninstall: () => ipcRenderer.invoke(IPC.cliUninstall),
  onCliRequest: (fn) => {
    ipcRenderer.on(IPC.cliRequest, (_event, request: CliRequest) => {
      fn(request.method, request.params).then(
        (envelope) => {
          if (envelope.ok) ipcRenderer.send(IPC.cliReply, { id: request.id, result: envelope.result });
          else ipcRenderer.send(IPC.cliReply, { id: request.id, error: envelope.error });
        },
        (err: unknown) => ipcRenderer.send(IPC.cliReply, { id: request.id, error: { message: err instanceof Error ? err.message : String(err) } }),
      );
    });
  },
  noteClosed: (id) => ipcRenderer.send(IPC.noteClosed, id),
};

contextBridge.exposeInMainWorld('notesApi', api);
