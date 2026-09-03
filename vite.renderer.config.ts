import { defineConfig } from 'vite';

// Two pages in one renderer build: the app, and the quick-note box the
// global hotkey opens. Both are served by the same dev server.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { index: 'index.html', capture: 'capture.html' },
    },
  },
});
