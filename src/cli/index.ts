import { buildProgram } from './program';
import { installCompletion } from './completion';

/**
 * The entry point of the `notes` command. The launcher runs the app's own
 * binary as Node with this file as the script; from here on it is an
 * ordinary Node program.
 */

async function main(): Promise<void> {
  const built = buildProgram();
  await installCompletion(built.program);
  const code = await built.run(process.argv.slice(2));
  // Stdout may still be draining into a pipe; exiting through exitCode lets it finish.
  process.exitCode = code;
}

process.on('SIGINT', () => {
  // A command that handles Ctrl+C itself (`notes watch`) stops and exits on its own.
  if (process.listenerCount('SIGINT') > 1) return;
  process.exit(130);
});

// `notes list | head` closes the pipe before the list is done; that is the
// reader's business, not a failure of ours.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw err;
  });
}

void main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
