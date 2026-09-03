import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels';
import type { CaptureApi } from '../shared/types';

/** The quick-note box needs three things of the main process, and gets exactly those. */
const api: CaptureApi = {
  send: (text) => ipcRenderer.invoke(IPC.captureSend, text),
  dismiss: () => ipcRenderer.invoke(IPC.captureDismiss),
  onShow: (fn) => {
    ipcRenderer.on(IPC.captureShown, () => fn());
  },
};

contextBridge.exposeInMainWorld('captureApi', api);
