# Notes

A minimal, keyboard-first markdown notes app for Windows. One window, a sidebar of notes, an editor, and nothing else.

- Sidebar list sorted by last edit, with title, relative timestamp and a snippet
- Instant search across every note as you type
- Markdown editor with a rendered preview toggle (GitHub-flavoured, sanitised)
- Create and delete notes without leaving the keyboard, no dialogs
- Attach images by pasting, dropping a file on the editor, or `Ctrl+Shift+I`; they live in `%APPDATA%\Notes\attachments`
- Export any note as Markdown (with its images alongside), plain text, or a PNG rendered like the preview
- Autosave to `%APPDATA%\Notes\notes.json` (atomic writes, flushed on close)
- Focus mode: hide the sidebar and write in a reading-width column

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+N` | New note |
| `Ctrl+K` / `Ctrl+F` | Search |
| `↑` `↓` | Move through notes (in the list or the search box) |
| `Enter` | Open the selected note in the editor |
| `Ctrl+↑` / `Ctrl+↓` | Previous / next note from anywhere |
| `Ctrl+E` | Toggle markdown preview |
| `Ctrl+Shift+I` | Attach an image (or paste / drop one onto the editor) |
| `Ctrl+Shift+S` | Export menu: `M` Markdown, `T` plain text, `P` PNG |
| `Ctrl+S` | Save now (autosave is always on) |
| `Ctrl+Shift+D` | Delete note, press again within 3 s to confirm |
| `Ctrl+\` | Toggle sidebar |
| `Esc` | Back to the list, clear search, or cancel |
| `Ctrl+/` | Shortcut sheet |
| `Tab` / `Shift+Tab` | Indent / outdent in the editor |

## Development

```
npm install
npm start          # dev build with hot reload
npm test           # vitest unit tests
npm run typecheck
npm run make       # Squirrel installer + zip in out/make/
npm run icon       # regenerate assets/icon.ico from scripts/generate-icon.mjs
```

Built with Electron Forge, Vite and TypeScript. Markdown is rendered by `marked` and sanitised by DOMPurify; links open in the system browser.

## Layout

```
src/main/       Electron main process: window, IPC, notes.json store
src/preload/    contextBridge API (window.notesApi)
src/renderer/   UI: notes.ts (pure store ops), markdown.ts, time.ts, main.ts (DOM + keys)
src/shared/     Types, IPC channel names, notes.json parser
```
