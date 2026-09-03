import { Command, CommanderError } from 'commander';
import { CliError } from '../core/backend';
import { EXIT, IpcError, type ExitCode } from '../core/ipc-protocol';
import { register as registerApp } from './commands/app';
import { register as registerFiles } from './commands/files';
import { register as registerHistory } from './commands/history';
import { register as registerNotes } from './commands/notes';
import { register as registerSystem } from './commands/system';
import { register as registerTagsLinks } from './commands/tags-links';
import { register as registerText } from './commands/text';
import { register as registerTrash } from './commands/trash';
import { Ctx, VERSION, type GlobalOpts } from './context';

/**
 * The `notes` program: every command, the flags they all share, and the
 * one place errors turn into exit codes. Built by a function so tests can
 * make one, run it in-process with commander's exitOverride, and read what
 * it printed.
 */

export interface ProgramOptions {
  /** Where output goes; the real streams by default. */
  writeOut?: (text: string) => void;
  writeErr?: (text: string) => void;
  /** Don't call process.exit; throw instead. Tests. */
  exitOverride?: boolean;
  /** How a Ctx is made, for tests that stub the backend. */
  makeCtx?: (opts: GlobalOpts) => Ctx;
}

export interface BuiltProgram {
  program: Command;
  /** Runs argv (without node and script) and resolves to the exit code. */
  run(argv: string[]): Promise<ExitCode | number>;
  /** The context of the last run, once made. */
  ctx(): Ctx | null;
}

/** Every visible command, one row each, subcommands as `noun verb`. */
export function commandReference(root: Command): string {
  const rows: string[] = [];
  const walk = (cmd: Command, prefix: string): void => {
    for (const sub of cmd.commands) {
      if ((sub as unknown as { _hidden?: boolean })._hidden) continue;
      const name = `${prefix}${sub.name()}`;
      if (sub.commands.length > 0) {
        walk(sub, `${name} `);
        continue;
      }
      const args = sub.registeredArguments.map((a) => (a.required ? `<${a.name()}${a.variadic ? '...' : ''}>` : `[${a.name()}${a.variadic ? '...' : ''}]`)).join(' ');
      const alias = sub.aliases().length > 0 ? ` (${sub.aliases().join(', ')})` : '';
      rows.push(`| \`notes ${name}${args ? ` ${args}` : ''}\`${alias} | ${sub.description().replace(/\|/g, '\|')} |`);
    }
  };
  walk(root, '');
  const globals = root.options
    .filter((o) => !o.hidden)
    .map((o) => `| \`${o.flags}\` | ${o.description} |`)
    .join('\n');
  return ['| Command | What it does |', '| --- | --- |', ...rows, '', '| Global flag | Meaning |', '| --- | --- |', globals, ''].join('\n');
}

export function buildProgram(options: ProgramOptions = {}): BuiltProgram {
  let current: Ctx | null = null;
  const use = (): Ctx => {
    if (!current) throw new Error('no command is running');
    return current;
  };

  const program = new Command('notes')
    .description('Notes from the command line: every feature of the app, from cmd, PowerShell or any shell.')
    .configureHelp({ sortSubcommands: false, showGlobalOptions: true })
    .showHelpAfterError('(add --help for usage)')
    .showSuggestionAfterError(true)
    .option('--json', 'JSON output')
    .option('--plain', 'tab-separated output without colour or headers (the default when piped)')
    .option('--fields <a,b>', 'only these fields, in --json and --plain output')
    .option('--no-color', 'no colour (NO_COLOR does the same)')
    .option('-q, --quiet', 'no messages on stderr')
    .option('-y, --yes', 'answer yes to every confirmation')
    .option('--no-input', 'never prompt, never open an editor, never read a terminal')
    .option('--app', 'insist on the running app (start it if needed)')
    .option('--no-app', 'never talk to the app: work on the files, even while it runs')
    .option('--user-data-dir <dir>', 'the data folder (default: %APPDATA%\\Notes)')
    .option('-V, --version', 'print the version')
    .action((opts: GlobalOpts & { version?: boolean }) => {
      if (opts.version) {
        program.configureOutput().writeOut?.(`${VERSION}\n`);
        return;
      }
      program.outputHelp();
    });

  if (options.writeOut || options.writeErr) {
    program.configureOutput({
      writeOut: options.writeOut ?? ((s) => process.stdout.write(s)),
      writeErr: options.writeErr ?? ((s) => process.stderr.write(s)),
    });
  }

  program.hook('preAction', (_this, actionCommand) => {
    const opts = actionCommand.optsWithGlobals<GlobalOpts>();
    current = options.makeCtx ? options.makeCtx(opts) : new Ctx(opts);
  });

  // Hidden: prints the command reference as markdown, for the README.
  program
    .command('__docs', { hidden: true })
    .description('the command reference as markdown')
    .action(() => {
      const writeOut = program.configureOutput().writeOut ?? ((s: string) => process.stdout.write(s));
      writeOut(commandReference(program));
    });

  registerNotes(program, use);
  registerTagsLinks(program, use);
  registerTrash(program, use);
  registerHistory(program, use);
  registerFiles(program, use);
  registerText(program, use);
  registerApp(program, use);
  registerSystem(program, use);

  // Commander's own exits (help, version, usage errors) go through here too,
  // so every command in the tree gets the same behaviour.
  const applyExitOverride = (cmd: Command): void => {
    cmd.exitOverride();
    for (const sub of cmd.commands) applyExitOverride(sub);
  };
  applyExitOverride(program);

  const run = async (argv: string[]): Promise<number> => {
    current = null;
    const writeErr = program.configureOutput().writeErr ?? ((s: string) => process.stderr.write(s));
    try {
      await program.parseAsync(argv, { from: 'user' });
      const made = current as Ctx | null;
      return made && made.exitCode ? made.exitCode : EXIT.ok;
    } catch (err) {
      if (err instanceof CommanderError) {
        // Help and version are not failures; commander reports usage errors itself.
        if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') return EXIT.ok;
        return err.exitCode === 0 ? EXIT.ok : EXIT.usage;
      }
      if (err instanceof CliError) {
        writeErr(`error: ${err.message}\n`);
        if (err.candidates) for (const c of err.candidates) writeErr(`  ${c.id.slice(0, 8)}  ${c.title}\n`);
        return err.exit;
      }
      if (err instanceof IpcError) {
        writeErr(`error: ${err.message}\n`);
        return err.exit;
      }
      if (err instanceof Error && (err.name === 'ExitPromptError' || /force closed the prompt/i.test(err.message))) {
        return EXIT.interrupted;
      }
      writeErr(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      return EXIT.failure;
    } finally {
      const made = current as Ctx | null;
      if (made) await made.close();
    }
  };

  return { program, run, ctx: () => current };
}
