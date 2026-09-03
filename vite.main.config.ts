import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // The packaged app ships no node_modules, so only Electron and Node
      // builtins stay external; everything else is bundled.
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
