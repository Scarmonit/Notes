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
- A `notes` command for cmd, PowerShell and Windows Terminal, installed with the app: every feature above from a terminal, with JSON output, real exit codes and stdin (see [Command line](#command-line))
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

## Command line

Installing Notes puts a `notes` command on your PATH (open a new terminal after installing). It runs the app's own binary as Node, the way VS Code's `code` does, so nothing else needs to be installed. When Notes is running the command talks to the window over a named pipe, so it sees the words being typed this moment and the app stays the only writer of the files; when it is not running the command reads and writes the same markdown files itself, in about a tenth of a second. Anything that needs the window (`open`, `export --png`, `ui`, `commands`, `run`, `capture`) starts Notes if it has to; `--no-app` keeps a script away from the window altogether.

```
notes new "Shopping" --content "- [ ] milk" --tags home
echo call the bank | notes inbox
notes list --tag wow --json | jq ".[].title"
notes show "WOW PRIVATE SERVER - COMMANDS" | more
notes append shopping "- [ ] eggs"
notes edit shopping                      # $EDITOR (notepad if unset)
notes export shopping --png -o shopping.png
notes trash restore 3f2a
notes open shopping                      # the window, at the note
```

A note can be named by its id (or a unique prefix), its exact title, a unique title prefix, its filename, or the words of its title; an ambiguous name lists the candidates and exits 3, or offers a picker at a terminal. `-` in place of a note name reads it from stdin, so `notes list --plain | fzf | notes show -` works. Every command that takes a set of notes shares one filter grammar: bare words (all must match), `-word`, `"a phrase"`, `#tag` (nested tags count), `--tag`, `--pinned`, `--created-after 7d`, `--updated-before 2026-01-01`, `--links-to`, `--linked-from`, `--orphan`, `--has-tasks`, `--sort title-`, `--limit`. Output is a readable table at a terminal, tab-separated when piped, and JSON with `--json` (narrow it with `--fields id,title`). Text for `new`, `append` and `replace-body` comes from the arguments, `--content`, `--file`, stdin, or `$EDITOR`.

Exit codes: 0 ok, 1 failure, 2 usage, 3 not found or ambiguous, 4 the note is being typed in the window (add `--force`), 5 the window was needed and could not be reached, 6 the app returned an error, 130 interrupted. `notes completion powershell` (or `bash`, `zsh`, `fish`) prints a completion script; `notes cli install|uninstall|status` manages the launcher and the PATH entry by hand, as does the row in Layout (`Ctrl+,`). Launchers can use `notes://open?id=…`, `notes://new?text=…` and `notes://inbox?text=…`.

<!-- cli:start -->
| Command | What it does |
| --- | --- |
| `notes new [title] [text...]` (add) | start a note |
| `notes list [words...]` (ls) | list notes, newest first, pinned on top |
| `notes search <words...>` | find notes by their words, with the line that matched |
| `notes show <note>` (cat) | print a note |
| `notes edit [note]` | open a note in $EDITOR; saves only if the text changed |
| `notes append <note> [text...]` | add text to the end of a note (or under a heading, or at the top) |
| `notes replace-body <note> [text...]` | replace the whole text of a note |
| `notes inbox [text...]` | file a quick note in the Inbox note (made if missing), as the quick-note box does |
| `notes capture` | show the quick-note box (needs the window) |
| `notes rename <note> [title]` | give a note an explicit title, or clear it so the first line is the title |
| `notes pin <note...>` | pin a note to the top of the list |
| `notes unpin <note...>` | unpin a note |
| `notes delete [note...]` (rm) | move notes to the trash (they wait a month there) |
| `notes open [note]` | bring up the window at a note (starts Notes if it is not running) |
| `notes show-window` | bring the Notes window to the front (starts it if needed) |
| `notes stats [note]` | words, characters, tasks and links, for one note or all of them |
| `notes tags` | every tag in use, with how many notes carry it |
| `notes tag add <note> <tags...>` | write #tag at the end of the note |
| `notes tag remove <note> <tags...>` (rm) | take #tag out of the note |
| `notes links <note>` | the notes a note links to with [[...]] |
| `notes backlinks <note>` | the notes that link to a note |
| `notes trash list` (ls) | what is in the trash, most recently deleted first |
| `notes trash show <note>` | print a deleted note |
| `notes trash restore <note...>` | put a deleted note back, history and all |
| `notes trash purge [note...]` | remove deleted notes for good |
| `notes history list <note>` (ls) | every kept version, newest first |
| `notes history show <note>` | print one kept version |
| `notes history restore <note>` | put a kept version back (the current text is kept first) |
| `notes history keep <note>` | keep the note as it stands now, whatever the usual gap would say |
| `notes history diff <note>` | what changed between two versions (or a version and now) |
| `notes attach <note> <files...>` | attach images to a note (PNG, JPEG, GIF, WebP, BMP; checked by their bytes) |
| `notes attachments <note>` | the images a note holds, with their files |
| `notes import <files...>` | make notes from markdown and text files (a leading # heading becomes the title) |
| `notes export [note...]` | write a note out as Markdown (images alongside), plain text, or a PNG like the preview |
| `notes tasks <note>` | the checklist items in a note |
| `notes task <note> <which>` | tick, untick or toggle a checklist item; or turn a line into one |
| `notes fence <note>` | put a code block around lines (or take one away when they are already fenced) |
| `notes find <note> <query>` | find text in a note; each hit as line:col |
| `notes replace <note> <query> <replacement>` | replace text in a note (the first match, or every one with --all) |
| `notes outline <note>` | the headings of a note |
| `notes render <note>` | a note as HTML (as the preview shows it) or as readable plain text |
| `notes settings get [key]` | show the settings, or one of them |
| `notes settings set <key> <value>` | change a setting (applied at once when the app is running) |
| `notes settings reset` | back to the defaults |
| `notes hotkeys show` | both chords, and whether the running app could register them |
| `notes hotkeys set <slot> <chord>` | change one chord |
| `notes ui get [key]` | every toggle, or one |
| `notes ui set <key> <value>` | change one toggle or width |
| `notes commands` | every command in the window, with its keys (from the app's own registry) |
| `notes run <command>` | run one of the window's commands by id (see `notes commands`) |
| `notes path [which]` | where the notes live (or the trash, history, attachments, settings) |
| `notes folder` | open the notes folder in Explorer |
| `notes watch` | print changes to the notes as they happen, until Ctrl+C |
| `notes cli status` | where the launcher is, what it points at, and whether PATH has it |
| `notes cli install` | write the launcher beside the app and add it to your PATH |
| `notes cli uninstall` | remove the launcher and take it off your PATH |
| `notes version` | the versions of this command, the app it belongs to, and whether the app is running |
| `notes completion <shell>` | Generate shell completion scripts |

| Global flag | Meaning |
| --- | --- |
| `--json` | JSON output |
| `--plain` | tab-separated output without colour or headers (the default when piped) |
| `--fields <a,b>` | only these fields, in --json and --plain output |
| `--no-color` | no colour (NO_COLOR does the same) |
| `-q, --quiet` | no messages on stderr |
| `-y, --yes` | answer yes to every confirmation |
| `--no-input` | never prompt, never open an editor, never read a terminal |
| `--app` | insist on the running app (start it if needed) |
| `--no-app` | never talk to the app: work on the files, even while it runs |
| `--user-data-dir <dir>` | the data folder (default: %APPDATA%\Notes) |
| `-V, --version` | print the version |
<!-- cli:end -->

## Development

```
npm install
npm start          # dev build with hot reload
npm test           # vitest unit tests
npm run typecheck
npm run make       # Squirrel installer + zip in out/make/
npm run icon       # regenerate assets/icon.ico from scripts/generate-icon.mjs
npm run cli:readme # regenerate the command table above from the CLI's definitions
```

Built with Electron Forge, Vite and TypeScript. The `RunAsNode` fuse is on, deliberately: the `notes` command is the app's binary run as Node with `ELECTRON_RUN_AS_NODE=1`, as VS Code, Slack and Obsidian ship theirs; `NODE_OPTIONS` and `--inspect` stay fused off, so the environment cannot make that runtime load foreign code. Markdown is rendered by `marked` and sanitised by DOMPurify; code is highlighted by `highlight.js`, registered a language at a time because the page's script may only come from itself. Links open in the system browser.

## Layout

```
src/core/       Pure Node, no Electron, no DOM, shared by the main process and the command line:
                the notes folder (store.ts: load, save, trash, watch), history, settings, attachments,
                the filter grammar (query.ts), note names (resolve.ts), the pipe protocol
                (ipc-protocol.ts), the launcher and PATH (shim.ts), file mode (file-backend.ts)
src/cli/        The `notes` command: commander program, one file per noun in commands/, the pipe
                client (client.ts), output modes (output.ts), $EDITOR, completion
src/main/       Electron main process: window, tray, IPC, the stores bound to userData, the pipe
                server (ipc-server.ts), Squirrel hooks (squirrel.ts), the quick-note box (capture.ts)
src/preload/    contextBridge API (window.notesApi)
src/renderer/   UI: notes.ts, tasks.ts, fences.ts, find.ts, outline.ts and inline.ts (pure),
                richeditor.ts (markdown <-> DOM), actions.ts (the command registry the keys, sheet
                and palette all read), markdown.ts and highlight.ts, importer.ts,
                time.ts, main.ts (DOM + keys)
src/shared/     Types, IPC channel names, key chords, and the rules for settings,
                the note file format (notes-folder.ts), notes.json and the snapshot ring
```

Every command in the app is one entry in `ACTIONS` in `src/renderer/main.ts`. The keyboard map, the shortcut sheet and the command palette are all generated from that list, so adding a command adds its key and both of its listings at once.
