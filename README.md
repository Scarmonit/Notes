# Notes

A minimal, keyboard-first markdown notes app for Windows. One window, a sidebar of notes, an editor, and nothing else.

- Sidebar list sorted by last edit, with title, relative timestamp and a snippet
- Instant search across every note as you type; pressing `Enter` on a search that matches nothing starts a note with that title
- Pin the notes you keep coming back to, and write `#tags` anywhere to filter the list by them
- Markdown editor with a rendered preview toggle (GitHub-flavoured, sanitised)
- Checklists: `- [ ]` lines are real checkboxes in the preview, tickable in place, and `Ctrl+Shift+X` turns the line you are on into one
- Attach images by pasting, dropping a file anywhere on the window, or `Ctrl+Shift+I`; they render as pictures inline, resize by their corner handle, and live in `%APPDATA%\Notes\attachments`
- Section dividers, either from `Ctrl+Shift+H` or by typing `---` and pressing Enter
- Focus mode dims everything but the paragraph you are in; typewriter scrolling keeps that line in the middle of the page
- Command palette on `Ctrl+Shift+K`: every command in the app, fuzzy-searchable
- Import `.md` and `.txt` files by dropping them on the window or with `Ctrl+Shift+O`
- Export any note as Markdown (with its images alongside), plain text, or a PNG rendered like the preview
- Stays in the tray and comes back on a shortcut of your choosing (Layout, `Ctrl+,`)
- Adjustable line width, so the words fill as much of the window as you want (Layout, `Ctrl+,`)
- Right-click a word the spellchecker underlines to correct it, or add it to the dictionary for good
- Autosave to `%APPDATA%\Notes\notes.json` (atomic writes, flushed on close)

## Shortcuts

The full list lives in the app on `Ctrl+/`, and every command is also reachable from the palette on `Ctrl+Shift+K`.

| Keys | Action |
| --- | --- |
| `Ctrl+Shift+K` / `Ctrl+P` | Command palette |
| `Ctrl+N` | New note |
| `Ctrl+K` / `Ctrl+F` | Search |
| `↑` `↓` | Move through notes (in the list or the search box) |
| `Enter` | Open the selected note, or start one titled with the search |
| `Ctrl+↑` / `Ctrl+↓` | Previous / next note from anywhere |
| `Ctrl+T` | Rename the note |
| `Ctrl+Shift+P` | Pin or unpin |
| `Ctrl+E` | Toggle markdown preview |
| `Ctrl+Shift+F` | Focus mode |
| `Ctrl+Shift+T` | Typewriter scrolling |
| `Ctrl+Shift+X` | Checklist item on this line |
| `Ctrl+Shift+H` | Insert a section divider |
| `Ctrl+Shift+I` | Attach an image (or paste / drop one onto the editor) |
| `Ctrl+Shift+O` | Import markdown or text files |
| `Ctrl+Shift+S` | Export menu: `M` Markdown, `T` plain text, `P` PNG |
| `Ctrl+S` | Save now (autosave is always on) |
| `Ctrl+Shift+D` | Delete note, press again within 3 s to confirm |
| `Ctrl+\` | Toggle sidebar |
| `Ctrl+,` | Layout and window settings |
| `Esc` | Back to the list, clear search, or cancel |
| `Ctrl+/` | Shortcut sheet |
| `Alt+↑` / `Alt+↓` | Move the selected image up or down a line |
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
src/main/       Electron main process: window, tray, IPC, notes.json and settings.json stores
src/preload/    contextBridge API (window.notesApi)
src/renderer/   UI: notes.ts and tasks.ts (pure store ops), richeditor.ts (markdown <-> DOM),
                actions.ts (the command registry the keys, sheet and palette all read),
                markdown.ts, importer.ts, time.ts, main.ts (DOM + keys)
src/shared/     Types, IPC channel names, key chords, settings and notes.json parsers
```

Every command in the app is one entry in `ACTIONS` in `src/renderer/main.ts`. The keyboard map, the shortcut sheet and the command palette are all generated from that list, so adding a command adds its key and both of its listings at once.
