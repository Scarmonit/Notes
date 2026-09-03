# Notes

A minimal, keyboard-first markdown notes app for Windows. One window, a sidebar of notes, an editor, and nothing else.

- Sidebar list sorted by last edit, with title, relative timestamp and a snippet
- Instant search across every note as you type; pressing `Enter` on a search that matches nothing starts a note with that title
- Pin the notes you keep coming back to, and write `#tags` anywhere to filter the list by them; nest them as `#wow/commands` and the parent gathers everything filed under it
- Link notes together with `[[Another note]]` — click a link to go there, or to start it; every note lists what points at it
- Live formatting: headings, bold, italics, code, lists and links take their shape as you write them, while the text stays exactly the markdown you typed; the markers fade rather than vanish (`Ctrl+Shift+M` turns it off)
- An outline of the note's headings beside it once it has two, to jump by (`Ctrl+Shift+L`)
- Find and replace inside a note (`Ctrl+F`, `Ctrl+H`), with match case and regular expressions; matches are painted over the words without touching them
- A quick-note box on `Ctrl+Alt+J` from anywhere in Windows: one line, Enter, and it is filed in the Inbox note
- Version history: snapshots are kept as you write, for a week, and any of them can be read and put back (`Ctrl+Shift+R`)
- Deleted notes wait in a trash for a month and can be put back whole (`Ctrl+Shift+Backspace`), history included
- Markdown editor with a rendered preview toggle (GitHub-flavoured, sanitised)
- Code blocks are syntax-highlighted in the preview and have a copy button; `Ctrl+Shift+C` fences the selection, so hand-aligned columns stop reflowing
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
- Notes are a folder of markdown files, `%APPDATA%\Notes\notes\<title>.md`, each with a small front-matter block (id, dates, pinned). Put the folder in OneDrive, Dropbox or git and they are backed up and readable anywhere; files changed or added by anything else show up in the app while it runs. Autosaved (atomic writes, flushed on close), with the snapshots beside them in `history` and deleted notes in `trash`. The first launch after 0.11 moves the old `notes.json` into the folder and keeps it as `notes.json.migrated`

## Shortcuts

The full list lives in the app on `Ctrl+/`, and every command is also reachable from the palette on `Ctrl+Shift+K`.

| Keys | Action |
| --- | --- |
| `Ctrl+Shift+K` / `Ctrl+P` | Command palette |
| `Ctrl+N` | New note |
| `Ctrl+K` | Search across notes |
| `Ctrl+F` / `Ctrl+H` | Find, or find and replace, in this note |
| `↑` `↓` | Move through notes (in the list or the search box) |
| `Enter` | Open the selected note, or start one titled with the search |
| `Ctrl+↑` / `Ctrl+↓` | Previous / next note from anywhere |
| `Ctrl+T` | Rename the note |
| `Ctrl+Shift+P` | Pin or unpin |
| `Ctrl+E` | Toggle markdown preview |
| `Ctrl+Shift+F` | Focus mode |
| `Ctrl+Shift+T` | Typewriter scrolling |
| `Ctrl+Shift+M` | Live formatting |
| `Ctrl+Shift+L` | Outline |
| `Ctrl+Shift+X` | Checklist item on this line |
| `Ctrl+Shift+C` | Code block around the selection, or the paragraph you are in |
| `Ctrl+Shift+R` | Note history: the versions kept as you wrote, with restore |
| `Ctrl+Shift+H` | Insert a section divider |
| `Ctrl+Shift+I` | Attach an image (or paste / drop one onto the editor) |
| `Ctrl+Shift+O` | Import markdown or text files |
| `Ctrl+Shift+S` | Export menu: `M` Markdown, `T` plain text, `P` PNG |
| `Ctrl+S` | Save now (autosave is always on) |
| `Ctrl+Shift+D` | Delete note, press again within 3 s to confirm |
| `Ctrl+Shift+Backspace` | Deleted notes: look at or put back anything deleted in the last month |
| `Ctrl+\` | Toggle sidebar |
| `Ctrl+,` | Layout and window settings (both global shortcuts, the notes folder) |
| `Ctrl+Alt+N` / `Ctrl+Alt+J` | From anywhere in Windows: summon Notes / the quick-note box |
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

Built with Electron Forge, Vite and TypeScript. Markdown is rendered by `marked` and sanitised by DOMPurify; code is highlighted by `highlight.js`, registered a language at a time because the page's script may only come from itself. Links open in the system browser.

## Layout

```
src/main/       Electron main process: window, tray, IPC, the notes folder (notes-store.ts: load,
                save, trash, watch), history, settings.json, the quick-note box (capture.ts)
src/preload/    contextBridge API (window.notesApi)
src/renderer/   UI: notes.ts, tasks.ts, fences.ts, find.ts, outline.ts and inline.ts (pure),
                richeditor.ts (markdown <-> DOM), actions.ts (the command registry the keys, sheet
                and palette all read), markdown.ts and highlight.ts, importer.ts,
                time.ts, main.ts (DOM + keys)
src/shared/     Types, IPC channel names, key chords, and the rules for settings,
                the note file format (notes-folder.ts), notes.json and the snapshot ring
```

Every command in the app is one entry in `ACTIONS` in `src/renderer/main.ts`. The keyboard map, the shortcut sheet and the command palette are all generated from that list, so adding a command adds its key and both of its listings at once.
