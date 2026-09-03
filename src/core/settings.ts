import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS, cleanSettings, parseSettings, type Settings } from '../shared/settings';
import { pathsFor } from './paths';

export interface SettingsStore {
  readonly file: string;
  /** The settings as last read or written. Available synchronously once loaded. */
  settings(): Settings;
  /** Reads settings.json. A missing or broken file means defaults. */
  loadSettings(): Promise<Settings>;
  saveSettings(next: Settings): Promise<Settings>;
}

export function createSettings(root: string): SettingsStore {
  const file = pathsFor(root).settings;
  let current: Settings = { ...DEFAULT_SETTINGS };

  async function loadSettings(): Promise<Settings> {
    try {
      current = parseSettings(await fs.readFile(file, 'utf8'));
    } catch {
      current = { ...DEFAULT_SETTINGS };
    }
    return current;
  }

  async function saveSettings(next: Settings): Promise<Settings> {
    current = cleanSettings(next);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(current, null, 2), 'utf8');
    return current;
  }

  return { file, settings: () => current, loadSettings, saveSettings };
}
