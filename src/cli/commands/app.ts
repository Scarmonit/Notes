import { DEFAULT_JOURNAL_PATH, journalPathError } from '../../core/journal';
import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { acceleratorOf, keyLabel } from '../../shared/keys';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { type Ctx } from '../context';

/** Settings, hotkeys, the window's layout, and the window's own commands. */

const SETTING_KEYS = ['closeToTray', 'hotkey', 'captureHotkey', 'reminders', 'journalPath', 'journalTemplateId'] as const;

/** A setting's value from the words someone typed. */
export function parseSettingValue(key: string, text: string): boolean | string | null {
  if (key === 'closeToTray' || key === 'reminders') {
    if (/^(true|on|yes|1)$/i.test(text)) return true;
    if (/^(false|off|no|0)$/i.test(text)) return false;
    throw new CliError(`${key} wants true or false`, EXIT.usage);
  }
  if (key === 'journalPath') {
    const said = text.trim() || DEFAULT_JOURNAL_PATH;
    const wrong = journalPathError(said);
    if (wrong) throw new CliError(wrong, EXIT.usage);
    return said;
  }
  if (key === 'journalTemplateId') {
    // A note id, not a name: renaming or moving the template must not break it.
    return /^(none|null|off|-|)$/i.test(text) ? null : text.trim();
  }
  if (key === 'hotkey' || key === 'captureHotkey') {
    if (/^(none|null|off|-|)$/i.test(text)) return null;
    const chord = text.toLowerCase().replace(/\s+/g, '');
    if (!acceleratorOf(chord)) throw new CliError(`"${text}" is not a chord Windows can register; try ctrl+alt+n`, EXIT.usage);
    return chord;
  }
  throw new CliError(`Unknown setting "${key}"; one of ${SETTING_KEYS.join(', ')}`, EXIT.usage);
}

export function parseUiValue(text: string): boolean | number | string | null {
  if (/^(true|on|yes)$/i.test(text)) return true;
  if (/^(false|off|no)$/i.test(text)) return false;
  if (/^(null|none)$/i.test(text)) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

const chordText = (chord: string | null): string => (chord ? keyLabel(chord).join('+') : 'none');

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  const settings = program.command('settings').description(`the settings the app keeps in settings.json: ${SETTING_KEYS.join(', ')}`);
  settings
    .command('get', { isDefault: true })
    .description('show the settings, or one of them')
    .argument('[key]', SETTING_KEYS.join(', '))
    .action(async (key: string | undefined) => {
      const c = ctx();
      const s = await (await c.backend()).settingsGet();
      if (key) {
        if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new CliError(`Unknown setting "${key}"; one of ${SETTING_KEYS.join(', ')}`, EXIT.usage);
        const v = s[key as keyof Settings];
        c.out.value(v, () => (v === null ? 'none' : String(v)));
        return;
      }
      c.out.value(s, () => SETTING_KEYS.map((k) => `${k}\t${s[k] === null ? 'none' : String(s[k])}`).join('\n'));
    });
  settings
    .command('set')
    .description('change a setting (applied at once when the app is running)')
    .argument('<key>', SETTING_KEYS.join(', '))
    .argument('<value>', 'true/false, a chord such as ctrl+alt+n, or none')
    .action(async (key: string, value: string) => {
      const c = ctx();
      const backend = await c.backend();
      const current = await backend.settingsGet();
      const next: Settings = { ...current, [key]: parseSettingValue(key, value) };
      const stored = await backend.settingsSet(next);
      const failed = (key === 'hotkey' && stored.hotkeyFailed) || (key === 'captureHotkey' && stored.captureHotkeyFailed);
      c.out.value(stored, () => `${key} = ${stored[key as keyof Settings] === null ? 'none' : String(stored[key as keyof Settings])}${failed ? ' (another program already uses that combination)' : ''}`);
      if (failed) c.exitCode = EXIT.appError;
    });
  settings
    .command('reset')
    .description('back to the defaults')
    .action(async () => {
      const c = ctx();
      const stored = await (await c.backend()).settingsSet({ ...DEFAULT_SETTINGS });
      c.out.value(stored, () => 'Settings reset');
    });

  const hotkeys = program.command('hotkeys').description('the two system-wide shortcuts: summon (the window) and capture (the quick-note box)');
  hotkeys
    .command('show', { isDefault: true })
    .description('both chords, and whether the running app could register them')
    .action(async () => {
      const c = ctx();
      const backend = await c.backend();
      const s = await backend.settingsGet();
      // Re-applying is the only way to learn whether the chords registered.
      const applied = backend.mode === 'app' ? await backend.settingsSet(s) : null;
      const rows = [
        { slot: 'summon', chord: s.hotkey, label: chordText(s.hotkey), registered: applied ? !applied.hotkeyFailed : null },
        { slot: 'capture', chord: s.captureHotkey, label: chordText(s.captureHotkey), registered: applied ? !applied.captureHotkeyFailed : null },
      ];
      c.out.rows(rows, [
        { key: 'slot', label: 'shortcut' },
        { key: 'label', label: 'keys' },
        { key: 'registered', label: 'registered', format: (v) => (v === null ? '(app not running)' : v ? 'yes' : 'no: another program has it') },
      ]);
    });
  hotkeys
    .command('set')
    .description('change one chord')
    .argument('<slot>', 'summon or capture')
    .argument('<chord>', 'such as ctrl+alt+n, or none')
    .action(async (slot: string, chord: string) => {
      const c = ctx();
      const key = slot === 'summon' ? 'hotkey' : slot === 'capture' ? 'captureHotkey' : null;
      if (!key) throw new CliError('The slot is summon or capture', EXIT.usage);
      const backend = await c.backend();
      const stored = await backend.settingsSet({ ...(await backend.settingsGet()), [key]: parseSettingValue(key, chord) });
      const failed = key === 'hotkey' ? stored.hotkeyFailed : stored.captureHotkeyFailed;
      c.out.value(stored, () => `${slot}: ${chordText(stored[key])}${failed ? ' (another program already uses that combination)' : ''}`);
      if (failed) c.exitCode = EXIT.appError;
    });

  const ui = program.command('ui').description('the window layout and view toggles (the window keeps these, so it must be running)');
  ui.command('get', { isDefault: true })
    .description('every toggle, or one')
    .argument('[key]', 'preview, liveFormat, outline, focusMode, typewriter, sidebarHidden, marginHidden, textW, marginW')
    .action(async (key: string | undefined) => {
      const c = ctx();
      const state = await (await c.backend(true)).uiGet();
      if (key) {
        if (!(key in state)) throw new CliError(`No layout setting "${key}"; one of ${Object.keys(state).join(', ')}`, EXIT.usage);
        c.out.value(state[key], () => String(state[key]));
        return;
      }
      c.out.value(state, () => Object.entries(state).map(([k, v]) => `${k}\t${String(v)}`).join('\n'));
    });
  ui.command('set')
    .description('change one toggle or width')
    .argument('<key>', 'preview, liveFormat, outline, focusMode, typewriter, sidebarHidden, marginHidden, textW, marginW')
    .argument('<value>', 'on/off, or a number of pixels')
    .action(async (key: string, value: string) => {
      const c = ctx();
      const state = await (await c.backend(true)).uiSet(key, parseUiValue(value));
      c.out.value(state, () => `${key} = ${String(state[key])}`);
    });

  program
    .command('commands')
    .description('every command in the window, with its keys (from the app\'s own registry)')
    .action(async () => {
      const c = ctx();
      const list = await (await c.backend(true)).commands();
      c.out.rows(list as unknown as Array<Record<string, unknown>>, [
        { key: 'id', label: 'id' },
        { key: 'label', label: 'command', style: 'bold' },
        { key: 'chord', label: 'keys', format: (v, r) => [v, ...((r.also as string[] | undefined) ?? [])].filter(Boolean).map((ch) => keyLabel(String(ch)).join('+')).join(', ') },
        { key: 'group', label: 'group', style: 'dim' },
        { key: 'on', label: 'on', format: (v) => (v === undefined || v === null ? '' : v ? 'on' : 'off'), style: 'dim' },
      ]);
    });

  program
    .command('run')
    .description('run one of the window\'s commands by id (see `notes commands`)')
    .argument('<command>', 'the id: new, preview, palette, focus…')
    .action(async (id: string) => {
      const c = ctx();
      const ran = await (await c.backend(true)).run(id);
      if (!ran) throw new CliError(`No window command "${id}", or it is disabled right now; see \`notes commands\``, EXIT.notFound);
      c.out.value({ id, ran: true }, () => `Ran ${id}`);
    });
}
