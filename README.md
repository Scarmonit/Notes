# Notes

A keyboard-first markdown notes app for Windows: a sidebar of notes and a page to write on. When one page is not enough, notes open in tabs and the window splits into panes, each scrolled and written in on its own.

- Sidebar list sorted by last edit, with title, relative timestamp and a snippet
- Tabs: `Ctrl+T` opens a note in a tab of its own beside the one you are on, `Ctrl+Tab` moves between them, `Ctrl+W` closes one and `Ctrl+1`…`Ctrl+9` goes straight to the nth. Choosing a note in the sidebar still turns the page rather than piling tabs up — a tab is something you ask for, and the strip only appears once a pane holds two
- Split panes: `Ctrl+Shift+\` opens a second pane beside the first (three at most), each with its own tabs, its own scroll and its own preview, so a note can be written on one side and read on the other, or two notes held open at once. Typing in one pane reaches the other a moment later, because it is the same note. `Ctrl+Alt+←` / `Ctrl+Alt+→` move between panes and `Ctrl+Shift+W` closes one; the window opens again with the panes it had
- Instant search across every note as you type; pressing `Enter` on a search that matches nothing starts a note with that title
- Pin the notes you keep coming back to, and write `#tags` anywhere to filter the list by them; nest them as `#wow/commands` and the parent gathers everything filed under it
- Link notes together with `[[Another note]]` — click a link to go there, or to start it; every note lists what points at it
- Other names for a note (`Ctrl+Shift+A`): a note can answer to `Doggo` as well as `Dog`. A `[[link]]` naming one finds it, so does a search, and writing `[[Doggo]]` settles into `[[Dog|Doggo]]` — the file says which note, the page says what you typed. They are kept as `aliases:` in the note's own front matter, where [Obsidian keeps them](https://obsidian.md/help/aliases) too, so a notebook opened in either app agrees
- Embed one note in another: `![[Note]]` on a line of its own shows that note here, `![[Note#Heading]]` shows just that section, and what is shown is what the source says now rather than a copy of it (as [Obsidian's embeds](https://obsidian.md/help/embeds)). A note that embeds itself is refused rather than followed
- Unlinked mentions, under the backlinks: the notes that say this one's name in plain words and have not linked it. **Link** on any of them joins the two up in place, spelling and capitals kept, undone with `Ctrl+Z` like any other change
- Saved searches: name the search in the box (`Save this search…`) and it sits above the tags, one click away. A view is a name for a question the box can already ask — `due:week todo:` — so nothing new had to be learnt to write one. `Ctrl+Shift+Y` picks one by name, and `notes list --view Due` asks the same question from a terminal
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
- Export any note as Markdown (with its images alongside), plain text, a self-contained HTML page (images and math fonts inside it), a PDF on paper-white A4, or a PNG rendered like the preview
- Templates: tag any note `#template` and it is one. `Ctrl+Shift+N` starts a note from a template, `Ctrl+Shift+E` inserts one at the caret, and `{{title}}`, `{{date}}`, `{{time}}` and `{{date:DDD D MMM YYYY}}` are filled in (as [Obsidian's templates](https://obsidian.md/help/plugins/templates)); `Ctrl+;` inserts today's date
- Scheduled tasks: a checklist line with `@2026-09-10` (or `@2026-09-10 14:30`) is due then. `Ctrl+Shift+U` lists what is overdue, due today, this week and later across every note, and while Notes runs — in the tray counts — a Windows notification arrives at the time, or at nine that morning; clicking it opens the note (as [Joplin's alarms](https://joplinapp.org/help/apps/notifications/), with [Logseq's scheduled dates](https://coderberry.com/blog/logseq_fix_scheduled_todos/) written in the line)
- Search operators in the same box: `todo:` `done:` `due:today` `tag:wow` `pinned:` `untitled:` `created:>7d` `updated:<2026-01-01` `links:Plan` `orphan:` `sort:title-` `limit:5` and `/regex/`, on top of words, `-word`, `"a phrase"` and `#tag` (as [Obsidian's search](https://obsidian.md/help/plugins/search)); the command line reads the same grammar, so `notes list "due:week todo:"` is the same query
- Math and diagrams in the preview and every export: `$x^2$` inline, `$$ … $$` on its own lines (KaTeX, bundled, with MathML beside it) and ```` ```mermaid ```` fences drawn by Mermaid, loaded only when a note has one (as [Notable](https://notable.app/))
- Related notes under the backlinks — the notes sharing this one's tags, or two links away — and a graph of every note and `[[link]]` on `Ctrl+Shift+G`, drawn on a canvas with a small force layout; click a dot to go there, or narrow it to two hops around the open note (as [Zettlr's](https://www.zettlr.com/) related files and graph)
- Move lines to another note: `Ctrl+Shift+V` takes the selected lines, or the line the caret is on, and asks which note and which heading (or the top, the end, or a heading it makes on the spot); the text arrives exactly as it was, Enter, Enter repeats the last destination, and `Ctrl+Z` in either note takes the whole move back. "Move this section" does the same for a heading and everything under it, levels untouched
- Rename a note and its links follow: when other notes point at it with `[[Old name]]`, the rename asks whether to update them, and `Ctrl+Z` undoes the lot. "Rename a tag everywhere" rewrites `#old` and every `#old/nested` across the notebook, and "Merge this note into another" appends it under a heading of its title, points the links at the survivor and puts it in Deleted notes. Each shows what it will touch before it does
- Back and forward through the notes you followed links from, `Alt+←` / `Alt+→` (or the mouse's thumb buttons), caret and scroll restored while the text is as it was; `Ctrl+Shift+B` lists the last twenty notes you had open
- Stays in the tray and comes back on a shortcut of your choosing (Layout, `Ctrl+,`)
- Adjustable line width, so the words fill as much of the window as you want (Layout, `Ctrl+,`)
- Right-click a word the spellchecker underlines to correct it, or add it to the dictionary for good
- Tables help themselves while you type: `Ctrl+Shift+J` makes one or lines the one you are in back up, `Tab` and `Shift+Tab` move between cells and the last cell makes a row, `Ctrl+Enter` adds a row, `Ctrl+Shift+→` a column, `Ctrl+Shift+←` takes a row out. Alignment written as `:--` or `--:` is kept as you wrote it
- **Where the notes live is yours to choose** (Layout, `Ctrl+,` → Notes folder → Change…). Point Notes at a folder in OneDrive, Dropbox or a git checkout: an empty folder takes the notes you have, pictures and all, and a folder that already holds notes becomes the notebook as it is. `notes folder <path>` does the same from a terminal
- A **web clipper**: copy the bookmarklet from Layout, paste it as a bookmark's address, and one click saves the page you are reading — or the words you have selected — as a note. It goes to a receiver Notes opens on localhost while it runs, so a whole article fits, and only a bookmarklet carrying this launch's token can write
- An **MCP server**, so Claude Code and other assistants can read and write these notes: `notes mcp` speaks the Model Context Protocol on stdin and stdout, with nine tools — `notes_search`, `notes_read`, `notes_create`, `notes_update`, `notes_delete`, `notes_add_to_inbox`, `notes_list_links`, `notes_list_tags`, `notes_list_tasks` — and every note as a resource at `notes://{id}`. Each answers in words and again as data against a declared output schema, and searching pages rather than dumping the notebook. Add it with `claude mcp add notes -- notes mcp`. It goes through the same path the command line does, so while the app runs the window is still the single writer and a note being typed in is refused
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
| `Ctrl+R` / `F2` | Rename the note |
| `Ctrl+T` | Open a note in a new tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+W` | Close this tab |
| `Ctrl+1` … `Ctrl+9` | The nth tab of this pane (`Ctrl+9` is the last) |
| `Ctrl+Shift+A` | Other names for this note |
| `Ctrl+Shift+Y` | Saved searches |
| `Ctrl+Shift+P` | Pin or unpin |
| `Ctrl+E` | Toggle markdown preview |
| `Ctrl+Shift+F` | Focus mode |
| `Ctrl+Shift+T` | Typewriter scrolling |
| `Ctrl+Shift+M` | Live formatting |
| `Ctrl+Shift+L` | Outline |
| `Ctrl+Shift+X` | Checklist item on this line |
| `Ctrl+Shift+C` | Code block around the selection, or the paragraph you are in |
| `Ctrl+Shift+J` | Table: a new one, or line up the one you are in |
| `Tab` / `Shift+Tab` (in a table) | The next cell; the last one makes a row |
| `Ctrl+Enter` / `Ctrl+Shift+→` | Add a table row / column |
| `Ctrl+Shift+←` | Take this table row out |
| `Ctrl+Shift+R` | Note history: the versions kept as you wrote, with restore |
| `Ctrl+Shift+H` | Insert a section divider |
| `Ctrl+Shift+I` | Attach an image (or paste / drop one onto the editor) |
| `Ctrl+Shift+O` | Import markdown or text files |
| `Ctrl+Shift+S` | Export menu: `M` Markdown, `T` plain text, `H` HTML page, `D` PDF, `P` PNG |
| `Ctrl+Shift+N` / `Ctrl+Shift+E` | New note from a template / insert a template at the caret |
| `Ctrl+;` | Insert today's date (with Shift, the time as well) |
| `Ctrl+Shift+U` | Scheduled tasks: every `@date` checklist line, overdue first |
| `Ctrl+Shift+G` | Graph of the notes and their `[[links]]` |
| `Ctrl+Shift+V` | Move the selected lines (or this line) to another note, under a heading |
| `Alt+←` / `Alt+→` | Back / forward through the notes you came from |
| `Ctrl+Shift+B` | Recent notes |
| `Ctrl+S` | Save now (autosave is always on) |
| `Ctrl+Shift+D` | Delete note, press again within 3 s to confirm |
| `Ctrl+Shift+Backspace` | Deleted notes: look at or put back anything deleted in the last month |
| `Ctrl+\` | Toggle sidebar |
| `Ctrl+Shift+\` | Split the pane |
| `Ctrl+Shift+W` | Close this pane |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | Move between panes |
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
notes refile inbox project --match "sqlite backup" --under Ideas
notes rename "Old plan" "Roadmap"        # every [[Old plan]] follows
notes tag rename wow games --dry-run     # shows what would change, changes nothing
notes merge "Plan (copy)" Plan
```

A note can be named by its id (or a unique prefix), its exact title, a unique title prefix, its filename, or the words of its title; an ambiguous name lists the candidates and exits 3, or offers a picker at a terminal. `-` in place of a note name reads it from stdin, so `notes list --plain | fzf | notes show -` works. Every command that takes a set of notes shares one filter grammar: bare words (all must match), `-word`, `"a phrase"`, `#tag` (nested tags count), `--tag`, `--pinned`, `--created-after 7d`, `--updated-before 2026-01-01`, `--links-to`, `--linked-from`, `--orphan`, `--has-tasks`, `--sort title-`, `--limit`. Output is a readable table at a terminal, tab-separated when piped, and JSON with `--json` (narrow it with `--fields id,title`). Text for `new`, `append` and `replace-body` comes from the arguments, `--content`, `--file`, stdin, or `$EDITOR`.

Exit codes: 0 ok, 1 failure, 2 usage, 3 not found or ambiguous, 4 the note is being typed in the window (add `--force`), 5 the window was needed and could not be reached, 6 the app returned an error, 130 interrupted. `notes completion powershell` (or `bash`, `zsh`, `fish`) prints a completion script; `notes cli install|uninstall|status` manages the launcher and the PATH entry by hand, as does the row in Layout (`Ctrl+,`). Launchers can use `notes://open?id=…`, `notes://new?text=…` and `notes://inbox?text=…`.

<!-- cli:start -->
| Command | What it does |
| --- | --- |
| `notes new [title] [text...]` (add) | start a note |
| `notes list [words...]` (ls) | list notes, newest first, pinned on top |
| `notes templates` | the templates: notes tagged #template, whose {{title}}, {{date}} and {{time}} are filled in by `new --template` |
| `notes search <words...>` | find notes by their words, with the line that matched |
| `notes show <note>` (cat) | print a note |
| `notes edit [note]` | open a note in $EDITOR; saves only if the text changed |
| `notes append <note> [text...]` | add text to the end of a note (or under a heading, or at the top) |
| `notes replace-body <note> [text...]` | replace the whole text of a note |
| `notes inbox [text...]` | file a quick note in the Inbox note (made if missing), as the quick-note box does |
| `notes capture` | show the quick-note box (needs the window) |
| `notes rename <note> [title]` | give a note an explicit title (pointing every [[link]] at it), or clear it so the first line is the title |
| `notes pin <note...>` | pin a note to the top of the list |
| `notes unpin <note...>` | unpin a note |
| `notes delete [note...]` (rm) | move notes to the trash (they wait a month there) |
| `notes open [note]` | bring up the window at a note (starts Notes if it is not running) |
| `notes show-window` | bring the Notes window to the front (starts it if needed) |
| `notes stats [note]` | words, characters, tasks and links, for one note or all of them |
| `notes tags` | every tag in use, with how many notes carry it |
| `notes tag add <note> <tags...>` | write #tag at the end of the note |
| `notes tag remove <note> <tags...>` (rm) | take #tag out of the note |
| `notes tag rename <old> <new>` | rename a tag in every note that carries it, nested tags included |
| `notes links <note>` | the notes a note links to with [[...]] |
| `notes backlinks <note>` | the notes that link to a note |
| `notes alias <note> [names...]` | the other names a note answers to: a [[link]] naming one finds the note, and so does a search |
| `notes mentions <note>` | the notes that say this one's name in plain words without linking to it (what the window lists under Related) |
| `notes views` | the saved searches: a name for a query the search box can ask |
| `notes view save <name> <query...>` | name a search and keep it |
| `notes view rm <name>` (forget) | take a saved search off the list |
| `notes related <note>` | the notes near a note: sharing its tags, or two links away (what the window lists under the backlinks) |
| `notes graph` | the notes as a graph of [[links]]: edges as from/to lines, --json for nodes and edges, --dot for Graphviz |
| `notes refile <from> <to>` | move lines from one note into another, under a heading if you say which |
| `notes section move <from> <heading> <to>` | move a section (its heading through the next heading of the same level) into another note |
| `notes merge <source> <into>` | append one note to another, point its links at the survivor, and move it to the trash |
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
| `notes export [note...]` | write a note out as Markdown (images alongside), plain text, a self-contained HTML page, a PDF, or a PNG like the preview |
| `notes tasks <note>` | the checklist items in a note |
| `notes due [when]` | every dated task across the notes, soonest first: the due sheet from a terminal |
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
| `notes folder [path]` | where the markdown files are kept, and where to keep them |
| `notes mcp` | speak the Model Context Protocol on stdin and stdout, so an assistant can read and write these notes |
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
