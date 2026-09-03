import { app } from 'electron';
import { createSettings } from '../core/settings';

/** The app's settings.json, read once at startup. The rules live in core/settings.ts. */
export const settingsStore = createSettings(app.getPath('userData'));

export const { settings, loadSettings, saveSettings } = settingsStore;
