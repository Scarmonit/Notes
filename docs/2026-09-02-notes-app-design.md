# Notes app design (2026-09-02)

Approved design for the initial release of Notes, a minimal keyboard-first markdown notes desktop app.

## Goal

A single-window Windows app for writing markdown notes: a sidebar list, an editor, instant search, create/delete, last-edited timestamps, a preview toggle, and keyboard-only navigation. Focused writing UI, dark, no chrome beyond what the work needs.

## Delivery

Electron Forge + Vite + TypeScript, mirroring Screen Recorder's toolchain (Squirrel installer + ZIP, fuses). Vanilla renderer, no framework: one screen with three regions is easier to reason about as explicit DOM and keyboard code.

## Architecture

- `src/main`: BrowserWindow with `titleBarStyle: hidden` and a native caption overlay; IPC handlers for load/save; a close hook that asks the renderer for unsaved edits before destroying the window (1.5 s timeout). External links go to `shell.openExternal`.
- `src/preload`: exposes `window.notesApi = { load, save, onFlushRequest }`.
- `src/renderer/notes.ts`: pure list operations (create, title/snippet derivation, sort, search, update, remove, neighbour selection). Tested.
- `src/renderer/markdown.ts`: `marked` (GFM, breaks) + DOMPurify; links forced to `target=_blank`. Tested.
- `src/renderer/time.ts`: relative and absolute timestamp formatting. Tested.
- `src/renderer/main.ts`: DOM wiring, keyboard handling, debounced autosave, UI state in localStorage.
- `src/shared/notes-file.ts`: strict parser for notes.json; drops malformed entries, throws on a non-notes document. Tested.

## Data

`Note { id, body, createdAt, updatedAt }`. The title is the first non-empty line with markdown markers stripped. Notes live in `%APPDATA%\Notes\notes.json` as `{ version: 1, notes: [] }`, written atomically (tmp + rename), serialised so writes never interleave. A corrupt file is set aside as `notes.json.corrupt-<ts>` and the app starts empty. localStorage holds only selected note id, preview mode and sidebar visibility.

## Behaviour

- Autosave 300 ms after the last keystroke; also on window blur, Ctrl+S, and close.
- Search filters on every keystroke; all whitespace-separated terms must match, case-insensitive. Selection stays on the current note if it still matches, otherwise jumps to the first hit.
- Delete is a two-press action within 3 s with focus moved to the button so Enter confirms; Escape cancels. After deleting, the note below is selected, else the one above, else the empty state.
- New note clears the search and preview so the editor is visible, and focuses it.
- Preview replaces the textarea with the rendered article; the article is focusable so Escape and shortcuts still work.

## Testing

Vitest with jsdom for the pure modules. Manual verification: `npm run make`, launch the packaged exe, create/edit/search/delete, restart and confirm persistence.

## Shipping

Git repo `Scarmonit/Notes`, release v0.1.0 with `Notes Setup.exe` and the ZIP. The local install goes through the Squirrel installer (which creates the Desktop shortcut); the bare `Notes.exe` from `out/` is not standalone, it needs its sibling resources folder.
