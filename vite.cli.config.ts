import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The `notes` command: one plain Node bundle, everything it uses inside it
 * (commander, marked, the prompts), only Node's own modules left external.
 * It runs on the app's Electron as Node, where `electron` cannot be
 * required, so it is a build error for anything here to import it.
 */
export default defineConfig({
  define: {
    __NOTES_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'node22',
    lib: {
      entry: 'src/cli/index.ts',
      formats: ['cjs'],
      fileName: () => 'cli.js',
    },
    outDir: '.vite/build',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { inlineDynamicImports: true },
    },
  },
  resolve: {
    // Node-flavoured entry points, not the browser ones.
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext', 'main'],
  },
});
