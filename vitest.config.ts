import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __NOTES_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // The command line and the stores are Node code: their test files carry
    // a `@vitest-environment node` docblock, since jsdom has no `net`.
    testTimeout: 30000,
  },
});
