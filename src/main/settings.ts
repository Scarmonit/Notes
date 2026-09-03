import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../shared/settings';

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let current: Settings = { ...DEFAULT_SETTINGS };

/** The settings as last read or written. Available synchronously once loaded. */
export function settings(): Settings {
  return current;
}

/** Reads settings.json once at startup. A missing or broken file means defaults. */
export async function loadSettings(): Promise<Settings> {
  try {
    current = parseSettings(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  return current;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  current = { closeToTray: next.closeToTray === true, hotkey: next.hotkey ?? null };
  const target = settingsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(current, null, 2), 'utf8');
  return current;
}
