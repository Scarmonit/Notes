# Six features brainstorm for 0.23.0 and 0.24.0 (2026-09-06)

The `brainstorming` skill was run with **Codex CLI as the answering partner** (the user delegated the
product-owner role to Codex for this round, as they did for 0.15.0, 0.21.0 and 0.22.0). Every question
below went to Codex through `codex exec` — one session, resumed per question, read-only sandbox, cwd =
this repo — and the answers are verbatim. The last line of each entry is Claude's one-line reading of
the answer.

Path: Architectural. Between them these six features touch the on-disk note file format (block ids and
properties written into the markdown), `parseNoteFile`/`formatNoteFile`, the `ACTIONS` registry, the
editor, the pane/tab machinery, the search grammar, the command line and the MCP server.

The user's request, in their own words:

> "implement these features"

— the six things a `/compare` pass against Obsidian, Logseq, Joplin, Zettlr and Bear found missing: a
dated journal, peeking a link, block references, a front-matter properties editor, slash commands and
named workspaces.

**Codex's first ruling was to split them into two releases**, along the boundary between the three that
change what is written to disk and the three that only change how the window exposes working context.
Nothing was cut. Both releases are being built.

- **0.23.0 — Addressable Notes**: today's note, block references, the properties editor.
  Settled design in `2026-09-06-addressable-spec.md`.
- **0.24.0 — Working Context**: link peek, slash commands, named workspaces.
  Settled design in `2026-09-06-working-context-spec.md`.

---

## Q1

**Question (Claude):**

You are the product owner for **Notes**, a keyboard-first markdown notes app for Windows (Electron + TypeScript, at this repo). The user has delegated the product-owner role to you for this design round, exactly as they did for the 0.15.0, 0.21.0 and 0.22.0 rounds (see `docs/2026-09-03-feature-brainstorm.md`, `docs/2026-09-04-toolbar-brainstorm.md` and `docs/2026-09-05-folders-brainstorm.md` — you answered all three). I am Claude Code, running the `brainstorming` skill. I will ask you seven questions, one at a time, and then implement whatever we settle on. Answer decisively and concretely. Do not ask me to decide — you are the one deciding.

## The user's actual request

A `/compare` pass against Obsidian, Logseq, Joplin, Zettlr and Bear turned up six things this app does not have. The user picked all six and said: **"implement these features."** They are, as the comparison named them:

1. **Today's note — a dated journal.** A command that opens/creates the note for today, named by a date format, optionally from a template. (Obsidian's *Daily notes* core plugin; Logseq's whole organising principle.)
2. **Peek a link without leaving the page.** Hovering a `[[link]]`, a backlink or a search result shows that note's contents in a small panel. (Obsidian's *Page preview*.)
3. **Link to a block, not just a heading.** `[[Note#^abc123]]` addressing a paragraph or list item, for links and embeds. (Logseq is built on this.)
4. **A front-matter properties editor.** See/add/edit/remove the YAML keys on the current note; list every property in use across the notebook. (Obsidian's *Properties view*.)
5. **Slash commands in the editor.** Typing `/` mid-line opens a filtered list of commands and runs one at the caret. (Obsidian ships this as a core plugin.)
6. **Named workspaces.** Save a pane-and-tab arrangement under a name and switch between arrangements. (Obsidian's *Workspaces*.)

This is **architectural**: between them these six touch the on-disk note file format (block ids and properties written into the markdown), `parseNoteFile`/`formatNoteFile`, the `ACTIONS` registry, the editor, the pane/tab machinery, the search grammar, the CLI and the MCP server.

## Where the app is today, precisely

**Storage.** Notes are `.md` files in a real nested folder tree (0.22.0), one file per note, each with a front-matter block. A note's folder **is** its relative path and is not duplicated into front matter. `pathsFor(root, notesFolder)` decides where the tree lives; it can be moved into OneDrive or a git checkout.

**Front matter.** `splitFrontMatter` in `src/shared/notes-folder.ts` reads `---` … `---` at the top of the file into three buckets:

- `KNOWN = {id, title, created, updated, pinned, deleted}` — parsed into fields;
- `LISTS = {aliases}` — parsed as a YAML list, inline (`[a, b]`) or as indented `- item` continuation lines;
- **everything else — every key the app does not know, and every line that is not `key: value` — goes into `extra: string[]` and is written back byte-for-byte on the next rewrite.** That is deliberate and documented in the file: *"front matter written by another program — Obsidian's, most likely — must survive a rewrite untouched."*

So a `status: draft` written in Obsidian survives here today, but is **completely invisible**: nothing shows it, nothing searches it, nothing can change it. The app already edits exactly one such property through a dedicated command — `aliases`, `Ctrl+Shift+A`, stored the way Obsidian stores them.

**Links.** `[[Target]]`, `[[Target|shown as this]]`. One `LINK_PATTERN` in `src/renderer/notes.ts`, shared by the editor's tokeniser, marked's inline extension and every rewriter. `resolveLink(notes, target)` returns `{kind:'one'|'none'|'many'}` — 0.22.0 made a slash mean a path (`[[Work/Plan]]`) and made an ambiguous bare `[[Plan]]` a *question the app asks*, never a guess. Titles beat aliases. `qualifiedLink` is how a link would have to be written to mean one note and no other.

**Headings as addresses, already.** `[[Note#Heading]]` links to a heading; `![[Note#Heading]]` **embeds** it, rendering the live source (never a copy), resolved in one place — `src/core/embeds.ts` — used by the preview, all five exports and the offline CLI render. `sectionOf(body, heading)` returns the heading and everything under it, stopping at the next heading of the same level or above. `headingsIn` is ATX-only by design.

**The editor.** A contenteditable with live formatting: markdown is drawn as what it means *while it is typed* (`src/renderer/inline.ts`, `richeditor.ts`). `[[links]]`, `![[embeds]]`, images and `---` rules are non-editable **chips**; everything else stays characters. Undo/redo is the app's own per-note log, not the browser's. There is also a rendered preview (marked + DOMPurify + KaTeX + mermaid + highlight.js).

**Panes and tabs (0.17.0).** Up to **three** panes side by side, each with its own tab strip, its own open note, its own scroll and its own preview toggle. Persisted as `ui.panes: PaneShape[]` + `ui.paneAt` in localStorage, where `PaneShape = {tabs: string[], activeId: string|null, preview: boolean}`. `ui.folder` (the folder being browsed) and `ui.tags` are **window-level**, not per-pane, because there is one sidebar.

**Commands (0.21.0).** **61 commands in one `ACTIONS` array** in `src/renderer/main.ts`, each `{id, label, group, chord, also, hint, terms, run, enabled, on, menuSection, pill}`. That one array feeds **four** surfaces at once: the keyboard map, the shortcuts sheet, the command palette (fuzzy, `Ctrl+Shift+K`/`Ctrl+P`), and the pane header's controls — four pills (Task / Date / Divider / Attach) plus four generated menus (Note / Write / View / Window). There is also a generic `openPicker(placeholder, items, onClose, {at, typed})` overlay used by move-lines, merge, tag-rename, recent notes and templates.

**Search.** `src/core/query.ts` `parseQuery` — 19 operators: `tag: todo: done: task: tasks: due: pinned: pin: untitled: created: updated: edited: links: from: linked: orphan: folder: sort: limit:`, plus `"phrases"`, `-word` and `/regex/`. Saved searches ("views") live in settings.json and are shown as chips in the sidebar.

**Templates.** A note tagged `#template`. `expandTemplate` fills `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}` and `{{date:FORMAT}}` (a hand-written `formatDate`: `YYYY MM DD HH mm ss DDD MMM`, `[literal]` escapes). `Ctrl+Shift+N` new-from-template, `Ctrl+Shift+E` insert-at-caret, `Ctrl+;` insert today's date.

**Dates already in the app.** `- [ ] thing @2026-09-10` is a scheduled task; `src/core/due.ts` parses `today/tomorrow/week/7d/overdue/any/date` windows and `+3d/fri/ISO/16:00` moments; `Ctrl+Shift+U` lists what is due; Windows notifications fire from the main process. There is an **Inbox** note that a global quick-capture box appends to.

**Beyond the window.** A `notes` CLI on PATH (~45 commands; file mode through `src/core/` when the app is closed, a named-pipe JSON-RPC to the window when it runs, so the app stays the single writer). An **MCP server** (`notes mcp`) with **12 tools**, all prefixed `notes_`, no SDK dependency. Exit codes in `src/core/ipc-protocol.ts` are relied on by scripts: **add codes, never change them.**

## The design stances this app holds (overturn one only deliberately, and say so out loud)

- **"Ink and margin"**: paper-like, restrained, **no new accent colours**. The only accent is a 2px `border-left` in `--margin` on the sidebar's selected row.
- **The folder on disk is a first-class artifact.** Readable and editable by Obsidian, by Explorer, by git, by hand. Unknown front matter survives a rewrite untouched.
- **Keyboard-first, one registry.** A command cannot gain a key without appearing in the sheet and the palette.
- **A standing "no" from 0.21.0, currently enforced by a test** (`src/renderer/registry.test.ts`): **no bold / italic / heading / list / quote formatting commands.** Your own words then: adding them "would create a substantial new editing model under cover of a discoverability change." The shortcuts sheet says the absence out loud.
- **0.21.0's diagnosis:** the problem with 61 commands is **recall**, not discoverability and not reach — you know the command exists; what fails is which chord it is. So a command surface's job is to **print the chord beside the command every time you use it**.
- **0.22.0's diagnosis:** folders answer *"where does this note live?"*; tags answer *"what is true about this note?"*; mirrored structures are the duplication folders exist to eliminate.

---

## Question 1 of seven: the shape of the release, and the ruling on the file format

Before any of the six features has a shape, I want two things settled.

### (a) Is this one release, or two — and if two, which three or four ship first?

The user asked for all six. I am not going to quietly narrow that, and I will implement everything you settle on. But you are the product owner, and I want you to say out loud whether these six are **one coherent release with a name**, or **two releases with a boundary that means something**. If it is one release, tell me what it is *about* — what single sentence covers a journal, a hover card, block ids, a YAML editor, a `/` menu and saved layouts, or admit that it is a grab bag and say why that is fine. If it is two, draw the line and justify where it falls, and rank the six.

Note that three of the six are **read-only conveniences** (peek, slash commands, workspaces — nothing new reaches the disk) and three **change what is written into a `.md` file or how it is addressed** (today's note chooses a filename and a folder; block references mint `^ids` into paragraphs; properties writes and deletes YAML keys). That is a candidate boundary. It is not necessarily the right one.

Also: **YAGNI ruthlessly.** If one of the six is not worth building for this app — if it is a feature that exists in Obsidian because Obsidian is a plugin platform and it would be a worse fit here — say so plainly and say what to build instead, or that we build nothing there. I would rather cut one now than ship six half-features.

### (b) Rule on the file format, before anything is designed on top of it.

Two of the six put new bytes into the user's markdown, and this app's most-stated stance is that the folder on disk is a first-class artifact that Obsidian, git and a human must all still find sane.

- **Block references** mean a `^abc123` marker appended to a paragraph or list item. That is Obsidian's own convention and it is plain text, but it is *visible clutter in the file* — a line ending `^k3n9dq` that the writer did not type.
- **Properties** mean the app starts writing keys into front matter that today it only carries through untouched in `extra`. The moment the app can *edit* `status: draft`, it also has to decide how to serialise a value it did not write, what a list looks like, what happens to a key whose value is a YAML structure it cannot parse (`extra` currently swallows those lines whole), and what a *deletion* means.

So: **state the rule.** What is the app allowed to write into a note's markdown that the person did not type, and under what conditions? When is a block id minted — only on demand, or eagerly? What must an Obsidian user's file still look like after this app has opened, edited and saved it? Is `extra` still the safety net, or does it shrink? Be exact enough that I could implement `formatNoteFile` from your answer.

**Answer (Codex):**

This is architectural and too large for one implementation/spec cycle. I’m splitting it into two releases along the durable-file boundary.

## Release shape

### 0.23.0 — Addressable Notes

Theme: **make the notebook’s durable contents structured and directly addressable without making the Markdown proprietary.**

It ships:

1. Today’s note
2. Block references
3. Properties editor

This release establishes the file-format rules first. The CLI and MCP server must support the same concepts in this release, so the on-disk contract has one implementation rather than renderer-only exceptions.

### 0.24.0 — Working Context

Theme: **reach commands, referenced content, and saved working arrangements without losing your current place.**

It ships:

4. Link peek
5. Slash commands
6. Named workspaces

That boundary matters: 0.23 changes durable notebook semantics; 0.24 changes how the window exposes and preserves working context. It also prevents us from debugging new serialization behavior at the same time as three substantial renderer interaction systems.

My overall priority is:

1. Properties
2. Today’s note
3. Block references
4. Link peek
5. Slash commands
6. Workspaces

Properties comes first because it replaces the weakest current abstraction: unknown front matter is preserved but unusable. Today’s note is next because it offers high daily value with a small, intelligible disk footprint. Block references are powerful but should not drive a generalized block-based editing model. Peek naturally follows addressable content. Slash commands improve access, but the palette already provides reach. Workspaces are useful mainly to users with recurring multi-pane routines, so they rank last.

I am not cutting any of the six. However, slash commands will be a new entrance to the existing `ACTIONS` registry, not an excuse to add formatting commands or a second command vocabulary. The standing prohibition on bold, italic, heading, list, and quote actions remains. Workspaces likewise save existing window state; they do not become sessions, projects, or synced environments.

## File-format ruling

The governing rule is:

> Notes may write machine-added Markdown only as the direct, reversible result of an explicit user command, using syntax that remains meaningful or harmless in Obsidian and plain-text tools.

Opening, indexing, hovering, previewing, searching, exporting, or ordinarily saving a note must never mint block IDs, normalize arbitrary YAML, reorder properties, or otherwise “improve” the file.

### Block IDs

Block IDs are minted **only on demand**.

An ID may be added when the user explicitly:

- copies or inserts a link to a particular block;
- assigns an ID to the current block through a command; or
- completes a block-reference flow that requires an address for an unaddressed block.

They are never added eagerly during parsing, rendering, indexing, save, migration, or hover.

New IDs use the Obsidian-compatible form:

```md
A paragraph of text. ^k3n9dq
```

or:

```md
- A list item ^k3n9dq
```

The generated portion is six lowercase ASCII alphanumeric characters, random rather than content-derived. Generation checks for collision within the note. Existing user-written IDs are accepted as written and are never renamed merely because they use another valid length or casing.

The marker belongs to the Markdown body. Once created, it is ordinary user-visible text:

- normal editing may move or delete it;
- the app does not silently restore a deleted ID;
- duplicate IDs are reported as ambiguous, never resolved by guessing;
- rewriting a note must preserve an unchanged marker byte-for-byte.

This does not turn Notes into a block editor. Paragraphs and list items gain addresses; they do not gain persistent internal objects, automatic identities, nesting semantics, or a hidden block database.

### Front matter

`extra` remains the safety net, but its representation must become more precise. It should no longer mean “an unordered bag of lines we do not understand.” Parsing must retain the front matter as an **ordered sequence of source spans**, including:

- known app fields;
- recognized editable properties;
- comments and blank lines;
- malformed or unrecognized lines;
- complete unsupported YAML values, including their continuation lines.

`formatNoteFile` follows these rules:

1. If a property was not changed, emit its original source span byte-for-byte.
2. Editing one property replaces only that property’s span.
3. Removing a property removes only its key and attached value span. It does not remove neighboring comments or blank lines unless a comment is syntactically inside that value.
4. Adding a property inserts it after the last existing front-matter property and before trailing comments or the closing delimiter.
5. Ordinary body edits must not reorder, re-indent, requote, or normalize unrelated front matter.
6. Duplicate YAML keys remain preserved. The properties UI marks them as conflicting; it must not silently choose one. Removal or editing must identify the particular occurrence, or offer an explicit “remove all” operation.
7. Reserved keys remain owned by Notes: `id`, `title`, `created`, `updated`, `pinned`, `deleted`, and `aliases`. The generic properties editor may display them but must route changes through their existing domain operations rather than treating them as arbitrary YAML.

The structured editor supports YAML scalars and flat lists:

- strings;
- numbers;
- booleans;
- `null`;
- inline or indented lists containing scalar values.

Serialization uses conservative YAML:

- plain scalars only when unambiguous;
- otherwise double-quoted strings with escaping;
- lists preserve their existing inline-versus-indented style when edited;
- newly created lists use indented `- item` form;
- empty lists use `[]`;
- no key sorting.

Nested mappings, nested sequences, block scalars, anchors, aliases, tags, and other advanced YAML remain visible but are marked “complex.” They may be deleted explicitly or replaced wholesale with a supported value, but this release does not provide a tree editor for them. If untouched, their entire source span survives byte-for-byte.

Thus an Obsidian-authored file, after being opened and saved in Notes, must differ only in:

- the fields Notes already legitimately updates, such as `updated`;
- a property the user explicitly changed, added, or removed;
- a block ID the user explicitly requested;
- content the user edited.

No global YAML reserialization is permitted.

### Today’s note

Creating today’s note is also an explicit write. The command derives its relative folder and filename from settings, resolves the configured template, shows no intermediate untitled note, and creates the file only when invoked. Merely crossing midnight or starting the app creates nothing.

The resulting file is an ordinary note using the existing front-matter contract. There is no hidden `daily: true` marker and no duplicated folder metadata. Its identity as today’s note comes from the configured path/date format, not proprietary metadata.

This preserves the existing “folder on disk is the artifact” stance: Obsidian sees conventional YAML, conventional block IDs, and an ordinary dated Markdown file; git shows narrow, attributable changes; a human can understand every machine-written byte.

**Reading:** **Two releases, nothing cut.** 0.23.0 changes durable notebook semantics; 0.24.0 changes how the window exposes working context, and the boundary exists so serialization is not being debugged at the same time as three renderer interaction systems. The governing rule for the file format: *Notes may write machine-added Markdown only as the direct, reversible result of an explicit user command, using syntax that remains meaningful or harmless in Obsidian and plain-text tools.* `extra: string[]` becomes an ordered, lossless `FrontMatterEntry[]`; unchanged spans are emitted byte-for-byte and there is no global YAML reserialization.

---

## Q2

**Question (Claude):**

Accepted, and I will hold you to all of it. Two releases — **0.23.0 Addressable Notes** (properties, today's note, block references) and **0.24.0 Working Context** (peek, slash commands, workspaces) — and I will build both, in that order, as two shipped releases. Nothing cut. The governing rule is noted: *Notes may write machine-added Markdown only as the direct, reversible result of an explicit user command, using syntax that remains meaningful or harmless in Obsidian and plain-text tools.* Block ids on demand only, six lowercase alphanumerics, ordinary text once written, never silently restored, duplicates reported not resolved. Front matter becomes an **ordered sequence of source spans**, unchanged spans emitted byte-for-byte, no global reserialization, no key sorting, duplicate keys preserved and flagged, reserved keys routed through their existing operations, complex YAML visible but not tree-edited.

One clarification I will make myself unless you object later: `extra: string[]` becoming an ordered span list means every front-matter line — including the known ones — is part of one sequence, so I will replace the `{fields, lists, extra}` triple in `splitFrontMatter` with a single ordered `FrontMatterEntry[]` and derive the fields from it. The `ParsedNoteFile`/`Note` shapes the rest of the app reads stay as they are.

---

## Question 2 of seven: today's note — where does it land, and what is the surface?

You ranked this second, and called for "a small, intelligible disk footprint". Now make it exact. Five things, and please answer all five.

### (a) The filename and the folder — this is the app's first *automatic* filing decision

0.22.0's rule is that **a note's folder is its path, and nothing else**. Filing has been, until now, entirely something a person does: you make a folder, you move a note into it. Today's note is the first thing in this app that **chooses a folder for you**, every day, forever. That is either fine or it is a quiet violation of the stance, and I want you to say which.

Concretely, the candidates:

- `2026-09-06.md` at the **root** — the root is a permanent valid location; a year of this is 365 files at the top of the tree, above `Work/` and `Archive/`, and the root is also where quick captures land.
- `Journal/2026-09-06.md` — one folder, flat inside it.
- `Journal/2026/2026-09-06.md` or `Journal/2026/09/…` — a tree that stays browsable at 5 years.
- Something the user configures entirely, as a **path format** rather than a folder plus a filename format — e.g. one setting whose value is `Journal/YYYY/YYYY-MM-DD`, run through the existing `formatDate` (which already understands `YYYY MM DD HH mm ss DDD MMM` and `[literal]` escapes), where any `/` in the result is a folder.

Rule on the **shape of the setting** and on the **default**. If the default creates folders that did not exist, say plainly that today's note is allowed to create directories — 0.22.0 says folders are never created implicitly by filing, and this would be an exception that needs stating. And say what the note's **title** is: the date string, or nothing (untitled, taking its name from the filename), and whether the title and the filename are allowed to drift apart — remembering that this app **renames the file when the title changes** (`fileNameFor`, `nameSuits`).

### (b) What identifies a note as today's note?

You already ruled out a `daily: true` marker: "its identity as today's note comes from the configured path/date format, not proprietary metadata." Good — but then what happens when the user **changes the format** after three months of journalling? The old notes stop being journal notes. Is that acceptable (they are just notes, and always were), or does the app need to do something about it? And what does "open today's note" do if a note **already exists at that path**? (Open it, obviously — but: place the caret where? Append the template again if the note is empty? Do nothing else?)

### (c) The template

Templates are notes tagged `#template`, expanded through `expandTemplate` with `{{title}} {{date}} {{time}} {{datetime}} {{date:FORMAT}}`. Rule on:

- Is the journal template a **setting** (one named template, used every day) or is it chosen each time? A setting, surely — but say so.
- The date placeholders in a template today expand to **now**. If I open yesterday's journal note on Monday and it is created fresh, `{{date}}` means *today*, not the note's date. Does the journal expansion pass the **note's own date** as "now"? I think it must, or a back-filled entry is stamped wrong. Rule on it, and say whether that is a new option on `expandTemplate` or a change to what it means.
- Is there a `{{yesterday}}` / `{{tomorrow}}` — or links to the neighbouring days written into the template — or is that Logseq-brain we should not import?

### (d) The commands and their chords

The app has 61 commands and 52 chords; every chord is scarce. What commands does this feature add? My candidates, and I want you to cut ruthlessly:

- **Today's note** (open/create). This one certainly exists. What chord? `Ctrl+Shift+D` and `Ctrl+D` are free; `Ctrl+;` is already "insert today's date" and `Ctrl+Shift+U` is "what is due".
- **Yesterday / tomorrow** — or a single **"journal for a date…"** that opens the existing `openPicker` overlay and takes a date, using `parseDueMoment` (which already reads `today`, `tomorrow`, `+3d`, `fri`, an ISO date, `16:00`).
- **Previous / next journal entry** — moving between the entries that *exist*, which is a different and possibly better thing than moving between calendar days.

And: **is there a calendar?** A month grid with dots on the days that have entries is the obvious Obsidian-plugin answer and it is a genuinely new UI surface in an app whose visual system is "ink and margin, no new accent colours". I am inclined to say no calendar this release — a command plus the date picker plus a `Journal/` folder you can browse in the existing sidebar tree is the whole feature. Rule on it. If you want a calendar, say where it lives and what it costs.

### (e) Does anything else in the app become journal-aware?

The pieces that are already date-shaped: `@2026-09-10` scheduled tasks, the due sheet (`Ctrl+Shift+U`), the Inbox note that quick-capture appends to, `created:`/`updated:` search operators. Two questions:

- Should the **quick-capture box** append to today's note instead of, or as well as, the Inbox? That is Logseq's model — the journal *is* the inbox. It is also a real change to a thing the user already relies on.
- Does the search grammar need a `journal:` operator, or is `folder:Journal` already the answer? (I suspect the latter and that we should not spend an operator.)

**Answer (Codex):**

Your `FrontMatterEntry[]` clarification is correct. Make it the lossless source of truth and derive today’s `fields`, `aliases`, and other convenient projections from it. Do not retain a parallel mutable `extra` representation.

## (a) Path, filename, and title

Use one setting:

```text
journal.pathFormat = "Journal/YYYY/YYYY-MM-DD"
```

It is a relative path format without `.md`, expanded using the existing `formatDate` tokens and literal escaping. `/` creates folder boundaries. Validate the expanded result with the same path-safety rules as other note paths: it must remain relative, inside the notes root, contain a nonempty filename, and contain no `.` or `..` segments.

The default is:

```text
Journal/YYYY/YYYY-MM-DD
```

So today’s default path is:

```text
Journal/2026/2026-09-06.md
```

This is the right balance: one year remains browsable as a single folder, while five years do not become one giant list. `Journal/YYYY/MM/YYYY-MM-DD` is needless nesting for 365 files per year.

The Today’s note command is explicitly allowed to create missing directories. This is a deliberate, narrow exception to 0.22.0: the directories are created only while fulfilling an explicit create/open-journal command, never as a side effect of browsing, indexing, startup, or ordinary filing.

The initial title is the expanded leaf filename without `.md`; with the default, `2026-09-06`. This keeps `fileNameFor` and `nameSuits` aligned instead of fighting the journal path.

Title and canonical journal path may drift only through explicit user action. If the user renames or moves a journal note, it becomes an ordinary note at its new location. We do not pin its filename, restore its date title, or retain hidden journal identity.

## (b) Identity and opening behavior

A journal note is identified only by occupying the path produced for a particular local calendar date under the **current** `journal.pathFormat`.

Changing the format does not migrate or relabel old notes. They remain ordinary notes in their existing folders. The setting UI should state this plainly: “Changing this affects newly opened journal dates; existing notes are not moved.”

If a note already exists at the calculated path, the command opens that exact note and performs no write:

- do not apply or reapply the template;
- do not repair its title;
- do not update front matter merely because it was opened;
- do not treat an empty existing note as uninitialized.

Use the app’s normal note-opening behavior for caret, scroll, tab reuse, and preview state. Do not create special “always append at end” behavior. A newly created note naturally places the caret at the end of its expanded initial body and focuses the editor, following the normal new-note flow.

Path occupancy wins. Even if the existing file was created manually and has an unusual title or contents, it is the note for that date while it occupies that canonical path.

## (c) Template

The journal template is one optional setting:

```text
journal.templateId = "<note-id>" | null
```

Store the note ID, not its title or path, so renaming or moving the template does not break the setting. If that ID no longer exists or no longer denotes a template, creation proceeds with an empty body and gives a restrained notification; it must not block creation.

It is configured once, not selected each time. Anyone wanting an occasional different template can create the note through the existing template command and move it to the journal path.

Extend `expandTemplate` with an optional reference instant or date context. Its existing callers retain “now” behavior. Journal creation passes the selected journal date at local noon, so:

- `{{date}}` describes the journal date;
- `{{date:FORMAT}}` describes the journal date;
- `{{datetime}}` and `{{time}}` are deterministic and do not accidentally describe the moment a back-filled note was created.

Use local noon rather than midnight to avoid DST-boundary date drift when formatting. For a journal entry, `{{time}}` will therefore be `12:00`; that is acceptable and more honest than inserting the unrelated current time. The note’s `created` and `updated` metadata still record the actual creation instant.

Do not change the meaning of `expandTemplate` globally; add context.

Do not add `{{yesterday}}`, `{{tomorrow}}`, automatic neighboring links, or navigation metadata. Those are Logseq conventions, not requirements of a dated note. A user can put literal wiki links or date-formatted headings in a template, but this release does not add date arithmetic to templates.

## (d) Commands and surfaces

Add exactly two actions to `ACTIONS`:

1. **Today’s note**
   - ID: `journal.today`
   - Chord: `Ctrl+Shift+D`
   - Opens or creates today’s canonical note in the active pane.
   - Appears in the palette, shortcuts sheet, and Note menu.

2. **Journal for date…**
   - ID: `journal.openDate`
   - No chord.
   - Appears in the palette and Note menu.
   - Opens a picker accepting a date expression, then opens or creates that date’s canonical note.

Reuse the date language where it makes sense: `today`, `tomorrow`, `yesterday`, `+3d`, `-3d`, weekday names, and ISO dates. Do not accept time-only inputs such as `16:00`; this picker resolves calendar dates, not moments. Extract or wrap the reusable date-resolution logic rather than making journal code depend semantically on task due times.

Do not add separate yesterday, tomorrow, previous-entry, or next-entry commands. “Journal for date…” covers calendar navigation without consuming more registry space. Existing folder browsing and search cover navigation among entries that actually exist.

There is no calendar in 0.23.0. A month grid would be a new navigation surface, selection model, keyboard interaction scheme, and accessibility problem. The two commands plus the ordinary `Journal/` folder are the complete surface.

Do not add a toolbar pill. This is not an insertion action and does not belong beside Task / Date / Divider / Attach.

## (e) Other journal awareness

Quick capture continues to append to **Inbox**, unchanged. A journal is chronological writing; an inbox is unprocessed capture. Conflating them would erase a useful distinction and silently change an established global workflow.

Do not add a `journal:` search operator. Under the default, `folder:Journal` is sufficient. With a custom path format, users can search the corresponding stable folder prefix or save that query as a view.

Nothing else becomes journal-aware in 0.23.0:

- scheduled tasks keep their existing `@date` meaning;
- the due sheet does not privilege journal notes;
- `created:` and `updated:` retain filesystem/note metadata semantics;
- journal dates are derived from requested dates and configured paths, not inferred as a new indexed note property.

The feature is deliberately a reliable path-and-template command, not a second organizing system.

**Reading:** **One setting, `journal.pathFormat`, defaulting to `Journal/YYYY/YYYY-MM-DD`** — a relative path format run through the existing `formatDate`, where a `/` makes a folder. Today's note is the one narrow exception allowed to create directories, and only while fulfilling an explicit command. **Occupancy wins**: a note already at the canonical path is opened with no write at all. `expandTemplate` gains a reference instant — local noon of the journal date — so a back-filled entry is not stamped with the moment it was typed. Two commands, no calendar, no `journal:` operator, and the Inbox stays the Inbox.

---

## Q3

**Question (Claude):**

Settled and accepted. `journal.pathFormat` defaulting to `Journal/YYYY/YYYY-MM-DD`, expanded through `formatDate`, `/` making folders, path-safety validated; today's note is the one narrow exception allowed to create directories, and only while fulfilling an explicit command. Title = the expanded leaf. Occupancy wins, and an existing note is opened with **no write at all**. `journal.templateId` stores the note id, missing template never blocks creation. `expandTemplate` gains a reference instant (local noon of the journal date), existing callers unchanged. Two commands: `journal.today` on `Ctrl+Shift+D`, and `journal.openDate` with no chord, calendar dates only, no time-only input. No calendar, no pill, no `journal:` operator, Inbox stays the Inbox, nothing else becomes journal-aware.

---

## Question 3 of seven: block references — the address, the flow, and what the editor draws

You have already ruled the format: `^k3n9dq`, six lowercase alphanumerics, minted only on demand, ordinary text once written, duplicates ambiguous never guessed, never silently restored. This question is about everything above the bytes.

### (a) How the address composes with what 0.22.0 just built

`[[…]]` currently means, in one `resolveLink`:

- `[[Plan]]` → the note titled or aliased Plan; **more than one is `{kind:'many'}` and the app asks rather than guesses**;
- `[[Work/Plan]]` → a slash means a path (tried second: a title containing a slash still wins);
- `[[Plan|the plan]]` → alias for display;
- `[[Plan#Heading]]` → a heading inside it, and `![[Plan#Heading]]` embeds that section live.

Now add blocks. Rule on the exact grammar and the order the parts are read, including all of these:

- `[[Plan#^k3n9dq]]` and `![[Plan#^k3n9dq]]` — the Obsidian spelling, `#` then `^`.
- `[[#^k3n9dq]]` — a block **in this note**, no target. Obsidian supports it. Does this app? (`[[#Heading]]` for a same-note heading is **not** supported today either, so this is a second decision, not an extension of an existing one.)
- `[[Work/Plan#^k3n9dq|as this]]` — path + block + alias in one link. Does the split order hold? (`linkParts` splits on `|` first, then the target is split on `#`.)
- What if a note genuinely has a **heading** whose text starts with `^`? What if a note has both a heading `^k3n9dq` and a block id `^k3n9dq`?
- **A block id is scoped to its note**, so `[[#^k3n9dq]]` inside note A and `[[B#^k3n9dq]]` may be two different blocks with the same id. Confirm that is the rule and that nothing tries to make ids notebook-unique.

Also: what does a link to a **missing** block do? Today an unresolvable `[[link]]` is drawn as a link that goes nowhere and offers to create the note. A block that has been deleted is different — the note exists, the paragraph is gone. Say what the reader sees.

### (b) What *is* a block?

`sectionOf(body, heading)` today returns a heading and everything under it, stopping at the next heading of the same level or above. A block is smaller and the boundaries are less obvious. Rule on exactly what text a `^id` addresses when it is embedded:

- A **paragraph** — a run of non-blank lines. (The editor already has `paragraphBounds` for focus mode, defined exactly that way.)
- A **list item** — and if so, does it include its **nested children**? Obsidian includes them. Logseq's entire model is that it does. This is the single biggest semantic decision in the feature: "the item" versus "the item and its subtree".
- A **table**, a **fenced code block**, a **blockquote**, an **image**, a **heading**. Which of these can carry an id, and where does the marker go? (`^id` after the closing fence of a code block is not inside it; `^id` on the line after a table is Obsidian's convention. A `^id` on a heading line is legal in Obsidian and means the heading's own block, not its section.)
- A `^id` on a line **by itself**, immediately after a block, separated by nothing — Obsidian's own convention for tables and code blocks. Is that supported for reading? For writing?

Say what `blockOf(body, id)` returns, precisely enough that I can write it and its tests, and say which block kinds the **minting command** is allowed to address (reading more kinds than we write is fine and probably right).

### (c) The flow: how does a person actually get one?

This is where the feature lives or dies. In Obsidian you type `[[Note#^` and it offers you the note's blocks; you also right-click a block and "Copy link to block". This app has no right-click menu on the editor (there is a spellcheck context menu from the main process) and its `[[` completion is… let me be honest: **there is no link autocomplete at all today**. A `[[link]]` becomes a chip when you type `]]`, and that is the whole affordance. Ambiguity is resolved by a question after the fact.

So rule on the flow, concretely, from an empty caret to a working block link. Candidates:

- A command **"Copy link to this block"** — mints an id on the caret's block if it has none, puts `[[Note#^id]]` on the clipboard. Then you paste it wherever. Simple, no new UI, composes with everything, and matches "explicit user command".
- A command **"Link to a block…"** — opens the existing `openPicker` twice: pick a note, then pick a block from a list of that note's blocks (first line, truncated), and it writes the link at the caret. This mints an id **in another note**, which is a write to a note you are not looking at. Is that allowed?
- Both.
- Something at the `[[` typing site, which would mean building link autocomplete — a much bigger feature that the app has deliberately not built.

Also rule on the **inverse**: is there a "what points at this block" (backlinks are per-note today, `backlinksOf`), and does an addressed block show any mark in its own note that it is addressed? Obsidian shows nothing. I lean towards nothing. Say so or not.

### (d) What the editor and the preview draw

The editor draws `[[links]]`, `![[embeds]]`, images and `---` as non-editable **chips**; everything else is characters. Two decisions:

- The link chip for `[[Plan#^k3n9dq]]`: what does it **say**? `Plan#^k3n9dq` is honest and ugly. `Plan` alone loses that it is a block link. Obsidian shows the raw text unless there is an alias. Given this app's live-formatting model, rule on the chip's label and whether a block link is visually distinct from a note link (remembering: no new accent colours).
- The `^k3n9dq` marker **in the block it marks**: it is ordinary user-visible text by your ruling. Does live formatting fade it the way it fades `**` markers (which are faded, never hidden — hiding them made Chromium's delete skip them and leave stray characters), or is it left completely plain? And in the **rendered preview**, does `^k3n9dq` show? Obsidian hides it in reading view. Hiding it in the preview is safe (the preview is generated, not edited) and I lean that way, but say so.

### (e) The pieces that must follow

- **`![[Note#^id]]` embeds** go through `src/core/embeds.ts`, which is the one answer for the preview, all five exports and the offline CLI render. Confirm block embeds go through the same door and that cycle/depth-4 refusal applies unchanged.
- **`rewriteLinks` in `src/core/refactor.ts`** rewrites links when a note is renamed. It must not damage the `#^id` part. Confirm.
- **`move-lines` / `move-section`** (`Ctrl+Shift+V`, "move these lines to another note") physically move text between notes. If the moved lines carry a `^id`, every `[[A#^id]]` pointing at them now points at nothing while the text lives in B. Does the app do anything about that — rewrite the links, warn, or nothing at all? The comparison report said block refs "complement `Ctrl+Shift+V` — sometimes you want to *point* at lines instead of moving them", which suggests nothing. But rule on it, because it is the one place the app already knowingly moves addressed text.

**Answer (Codex):**

## (a) Link grammar and resolution

Parse in this order:

1. Remove the optional embed prefix `!`.
2. Split display alias at `|`.
3. Split the address at the first `#`.
4. Resolve the note portion using the existing title/alias/path rules.
5. Interpret the fragment:
   - fragment beginning with `^` → block ID;
   - every other nonempty fragment → heading;
   - no fragment → whole note.

Therefore all of these are valid:

```md
[[Plan#^k3n9dq]]
![[Plan#^k3n9dq]]
[[Work/Plan#^k3n9dq|as this]]
[[#^k3n9dq]]
```

Support same-note addresses. This deliberately extends the grammar to support both:

```md
[[#^k3n9dq]]
[[#Heading]]
```

An empty note portion means the source note. This is more coherent than introducing local block links while arbitrarily withholding local heading links.

`#^` is reserved for block addressing. A heading literally named `^k3n9dq` cannot be addressed through that spelling. If a heading and block ID collide textually, block interpretation wins. Do not invent escaping or another fragment syntax in this release.

Block IDs are scoped to one note. The same ID may occur once in A and once in B without conflict. Generation checks only the destination note, and no index enforces notebook-wide uniqueness.

Within one note:

- no matching ID → missing;
- exactly one → resolved;
- more than one → ambiguous.

A missing or ambiguous block never falls back to a heading and never offers to create a note. The containing note already exists. Clicking it leaves the current note in place and reports:

- `Block ^k3n9dq was not found in Plan`, or
- `Block ^k3n9dq is duplicated in Plan`.

Rendered output keeps the visible link label but marks the link unresolved using the existing broken-link treatment. Its tooltip explains the missing or duplicate block.

## (b) Definition of a block

Create one Markdown-aware block locator in core; do not implement slightly different boundary logic in the renderer and embeds.

`blockOf(body, id)` returns either:

```ts
type BlockResolution =
  | { kind: "one"; block: BlockSlice }
  | { kind: "none" }
  | { kind: "many"; blocks: BlockSlice[] };

type BlockSlice = {
  id: string;
  kind: "paragraph" | "list-item" | "heading" | "blockquote" | "table" | "code";
  start: number;
  end: number;
  content: string;
};
```

`start` and `end` delimit the complete addressed source range. `content` is the Markdown suitable for an embed: the same range with the address marker removed. Preserve all other bytes. For a nested list item, remove only the selected item’s common leading indentation from every returned line so it renders as a standalone list.

The supported blocks are:

- **Paragraph:** consecutive nonblank, non-structural lines. An inline ID at the end of its final line addresses the whole paragraph.
- **List item:** the item line plus all more-deeply-indented child lines and nested items, ending at the next sibling or ancestor item or another top-level block. The marker is written at the end of the selected item’s own first line. The embed includes the full subtree.
- **Heading:** only the ATX heading line, not its section. The marker is appended to the heading line.
- **Blockquote:** one contiguous run of `>` lines. The marker is appended within the final quoted line, after its content.
- **Table:** the contiguous Markdown table. Its marker is a standalone line immediately following the table, with no blank line.
- **Fenced code block:** opening fence through closing fence. Its marker is a standalone line immediately after the closing fence, with no blank line.
- **Image:** treated as part of its containing paragraph, not as a separate block kind.

A standalone marker line attaches only to the immediately preceding table or closed fenced-code block. Support that form for both reading and writing. Do not attach a standalone marker generically to an arbitrary preceding paragraph or list.

Do not address:

- blank lines;
- thematic breaks;
- front matter;
- an unclosed fenced-code block;
- an entire list independently of one of its items.

The minting commands may address every supported kind: paragraph, list item, heading, blockquote, table, and closed fenced code block. If the caret has no addressable block, the command is disabled or reports “Place the caret in a paragraph, list item, heading, quote, table, or code block.”

Parsing must ignore marker-like text inside code fences and inline code. A valid inline marker is the final syntactic token of its owning line, preceded by whitespace. The standalone table/code marker contains only optional indentation followed by the ID.

## (c) User flow

Build both commands. Do not build `[[` autocomplete in 0.23.0.

### Copy link to this block

Add an action:

```text
block.copyLink
Copy link to this block
```

No default chord.

It:

1. Finds the addressable block at the caret.
2. Reuses its existing unique ID, if present.
3. If absent, generates an ID and inserts it in the correct location.
4. Saves that source edit through the normal undoable note-edit path.
5. Copies a portable link using `qualifiedLink`, preserving the block fragment:

```md
[[Work/Plan#^k3n9dq]]
```

The copied link is fully qualified when qualification is necessary; do not copy the local shorthand. If the source edit cannot be saved, do not update the clipboard.

### Link to a block…

Add an action:

```text
block.insertLink
Link to a block…
```

No default chord.

It uses a two-stage picker:

1. Choose a note using title, alias, and path.
2. Choose one of that note’s addressable blocks.

Each block row shows its kind and a compact, single-line textual preview. Blocks without IDs remain selectable. Selecting one explicitly authorizes Notes to mint an ID in that other note.

The operation order is:

1. mint and save the target ID if required;
2. insert the qualified block link at the original caret;
3. leave the target note unopened.

If saving the target fails, insert nothing into the source. The target write participates in its own per-note undo history.

Do not add block-specific backlinks. Existing note backlinks continue to show that the source note links to the target note, including links containing fragments, but they are not subdivided by heading or block.

Do not add a gutter badge, backlink count, or other decoration to an addressed block. Its faded textual marker is the only indication in the source editor.

## (d) Editor and preview rendering

A block-link chip without an alias displays:

```text
Plan · ^k3n9dq
Work/Plan · ^k3n9dq
This note · ^k3n9dq
```

A block link with an alias displays only the alias, exactly as other aliased links do:

```md
[[Plan#^k3n9dq|the decision]]
```

becomes:

```text
the decision
```

Use the existing chip colors and borders. The centered dot and visible `^id` make an unaliased block link distinct without introducing another accent color or icon system.

The source marker remains editable text. Fade it using the same restrained marker treatment as other Markdown punctuation, but never hide it or make it non-editable. Selection, Backspace, Delete, undo, and copy must treat it as ordinary characters.

Hide block-address markers in rendered reading output:

- preview;
- embedded block rendering;
- rendered HTML/PDF and other rendered exports;
- offline CLI render.

Raw Markdown and notebook-copy exports retain the marker because it is part of the source file.

For a heading such as:

```md
## Decision ^k3n9dq
```

the rendered heading text is `Decision`, and the marker does not affect heading matching. `[[Note#Decision]]` and `[[Note#^k3n9dq]]` may therefore address that line through different address types: the former by heading text, the latter as one heading block.

## (e) Integration rules

Block embeds go through `src/core/embeds.ts`, alongside whole-note and heading embeds. The preview, all rendered exports, and offline CLI render must consume that one implementation. Existing cycle detection and depth-four refusal apply unchanged.

`rewriteLinks` must treat the note target and fragment as separate components. Renaming or moving a note may rewrite:

```md
[[Plan#^k3n9dq|label]]
```

to:

```md
[[Work/Plan#^k3n9dq|label]]
```

but it must preserve `#^k3n9dq` and `|label` byte-for-byte. The same applies to heading fragments.

Moving addressed text between notes does **not** rewrite block links. IDs are scoped to their original note address, so automatic rewriting would require a broader cross-note refactor with difficult partial-selection semantics.

However, do not let the move fail silently. Before `move-lines` or `move-section` completes:

- detect block IDs in the material being moved;
- count links that currently address those IDs in the source note;
- check whether any moved IDs already exist in the destination.

If either broken inbound links or destination collisions exist, show one confirmation describing both consequences, for example:

> Moving this text will break 3 block links to this note. `^k3n9dq` also exists in the destination and will become ambiguous. Move anyway?

Cancel is the default. If confirmed, move the bytes unchanged. Do not regenerate IDs, rewrite links, or restore anything afterward. The explicit confirmation makes the resulting broken or ambiguous addresses the user’s choice.

**Reading:** **`#^` is the block address and `#` anything else is a heading**, split at the first `#` after the alias split; `[[#^id]]` and `[[#Heading]]` both become legal, because withholding local heading links while adding local block links would be incoherent. Block ids are **note-scoped** and nothing tries to make them notebook-unique. One `blockOf(body, id)` in core over six addressable kinds — a list item carries its subtree and is de-indented for the embed. Ids are minted only by two explicit commands; the marker is faded but never hidden and always editable, and hidden in every rendered surface. Moving addressed text does not rewrite links, but warns once, with Cancel as the default.

---

## Q4

**Question (Claude):**

Accepted in full. Fragment split at the first `#`, `^` means a block and every other fragment is a heading; `[[#^id]]` and `[[#Heading]]` both become legal (the same-note heading link too, for coherence); block ids are note-scoped; missing/ambiguous blocks report and never fall back to a heading nor offer to create a note. One `blockOf(body, id)` in core returning `{kind, block:{id,kind,start,end,content}}`, six addressable kinds, a list item carries its subtree and is de-indented for the embed, standalone marker lines attach only to a table or a closed fence, markers inside fences and inline code are not markers. Two commands, no chord, no `[[` autocomplete, no block backlinks, no gutter badge. Chip reads `Plan · ^k3n9dq` / `This note · ^k3n9dq`, alias wins, existing chip colours. Marker faded but never hidden and always editable; hidden in every rendered surface, kept in raw markdown export. `rewriteLinks` treats target and fragment as separate components. `move-lines`/`move-section` do not rewrite, but warn once with a Cancel default naming both the broken inbound links and any destination collision.

---

## Question 4 of seven: the properties editor — the surface, and what a property *is* to the rest of the app

The format rule from Q1 is settled: an ordered `FrontMatterEntry[]` as the lossless source of truth, unchanged spans byte-for-byte, no reserialization, no sorting, duplicates preserved and flagged, complex YAML visible but not tree-edited, reserved keys routed through their existing operations. This question is what the person sees and what the rest of the app can do with it.

### (a) Where does the editor live, and what does it look like?

Every existing surface in this app is one of four shapes, and I want you to pick one rather than invent a fifth:

- **A modal sheet** (`Ctrl+,` Layout, `Ctrl+Shift+R` history, `Ctrl+Shift+U` due, trash, shortcuts): a centred card over a dimmed app. Takes focus, Esc closes. This is where `aliases` (`Ctrl+Shift+A`) already lives, as a one-line prompt sheet.
- **A strip below the words**, inside `.text`, like backlinks / related / unlinked-mentions (three `.backlinks` strips already sit under the note body). Always visible, never takes focus, scrolls with the note.
- **The marginalia column** (`.marginalia`, right of the page, hideable, ~176px) — where "edited" lives. This user keeps the margin hidden, which is why backlinks went under the words instead.
- **A block at the top of the editor, above the title** — Obsidian's own answer. It is *in the document flow*, editable in place, and it is a genuinely new thing for this editor: a region of the contenteditable that is not the note's markdown. That is a real cost; the editor's whole model is "the text you see is the file".

Rule on one. Consider that properties are per-note, are edited rarely but read often, and that a note with no properties is the common case — whatever this is, it must cost **nothing** visually on a note that has none. And say what the **empty state** is: does a note with no properties show an "Add property" affordance at all, or is the only way in a command?

### (b) The interaction, exactly

Say what adding, editing and removing look like, keystroke by keystroke, for:

- adding a key that **already exists elsewhere in the notebook** (`status`, having been used on nine notes) — is there completion from the notebook's own vocabulary? I think there must be, or the feature produces `status` / `Status` / `state` within a week. Say how it is offered.
- adding a key that is **new**.
- editing a value that is a **list** (`aliases` is one today; `tags` is the other one Obsidian users have).
- **removing** a key. Is it two-press-guarded like the delete command (`armDelete` — the row's label becomes "Delete this note — click again"), or is undo enough? Note that a property edit lands on the note's own undo log by the Q1 ruling, so `Ctrl+Z` should already restore it — confirm that is the answer.
- what happens when the value the user types **cannot be a plain scalar** (it starts with `[`, contains `: `, is `yes`, is `2026-09-06`, is empty). Your Q1 rule was "plain scalars only when unambiguous; otherwise double-quoted". Confirm the app never asks the user about quoting and simply does the right thing.

And rule on **type**: does a property have a declared type (Obsidian has text/list/number/checkbox/date), or is the type simply what the YAML says it is? Obsidian keeps a notebook-wide type registry in a JSON file. That is a second store, outside the markdown, and this app has been strict about the folder being the artifact. I lean strongly towards **no type registry — the value's YAML shape is its type** — but say so yourself.

### (c) The notebook-wide view

The comparison report asked for "list every property in use across the notebook". Rule on what that is:

- A **sheet** listing every key, how many notes carry it, and its distinct values? Clicking a value searches for it.
- Or is it simply **`prop:` in the search box** plus the existing sidebar, and no new surface at all?
- Or both — the sheet being a way to discover what to type.

Remember the standing complaint that started 0.21.0: 61 commands and almost no way to *recall* them. A vocabulary of property keys has exactly the same problem, which is an argument for the sheet.

### (d) The search operator

I proposed `prop:status=draft`. Rule on the exact grammar, remembering `parseQuery`'s tokenizer: a `word:` is only an operator when the name is in `OPERATOR_NAMES`; values may be `"quoted"`; `-word` negates; `/regex/` exists. Cases to cover:

- `prop:status` — has the key at all, any value.
- `prop:status=draft` — equals. Case-sensitive? Exact or substring?
- `-prop:status=draft` — negation; `NEGATABLE` is a per-operator allowlist today.
- a key whose value is a **list** — does `prop:tags=work` match a list containing `work`?
- a **numeric** comparison (`prop:rating>3`). Worth it, or scope creep?
- Is it one operator `prop:`, or does every property key become its own operator (`status:draft`)? The latter is what Obsidian does and it would collide catastrophically with the 19 existing operator names. I assume `prop:` and I want you to confirm and to say what happens for `prop:tag` and `prop:folder`, which name things the app already means something else by.

### (e) What the rest of the app must and must not do

- Do properties appear in **`notes show --json`** and in the MCP `notes_read` output? (I will ask the whole CLI/MCP surface as its own question later, but rule the *principle* now: are properties part of a note's public shape, or an editing convenience?)
- Does `Note` in `src/shared/types.ts` gain a `props` field, or do properties stay inside the parsed-file layer and get read on demand? A `props` field means every note carries its front matter in memory and every consumer sees it; keeping it in the file layer means the search operator has to go somewhere for it. Rule.
- Does the app ever **write** a property of its own? `aliases` is one already; `pinned` is a reserved field. Does today's note write anything? (You said no.) Is there any circumstance where the app adds a key the user did not ask for? I expect a flat no, and I want it on the record.

**Answer (Codex):**

## (a) Surface

Use a **modal sheet**.

Properties are read often only when they exist, but they are edited rarely. Putting a synthetic region inside the contenteditable would break the editor’s strongest invariant: what appears in the writing surface is the file. The marginalia is commonly hidden, and a strip beneath the body is the wrong place for focused form controls.

Add one action:

```text
note.properties
Properties…
```

It opens a centered sheet for the active note. `Esc` closes it. The existing aliases action remains in `ACTIONS`, but `Ctrl+Shift+A` now opens this same sheet with the aliases row focused; there must not be two property editors.

The sheet contains:

- a compact “Note fields” section for reserved keys;
- a “Properties” section for user-defined keys;
- one row per occurrence, preserving file order;
- an **Add property** row at the bottom.

A note with no custom properties gains no persistent affordance in the editor. The command palette and Note menu are the entrance. Opening the sheet shows the empty custom-property state and Add property control.

Duplicate occurrences appear as separate rows in source order, each marked `Duplicate key`. Editing or deleting acts on that occurrence only.

## (b) Interaction and types

### Adding an existing key

Activating Add property focuses a key field. As the user types, it offers case-insensitive completion from custom keys already present anywhere in the notebook, ordered by:

1. prefix match;
2. usage count;
3. alphabetical order.

Each suggestion shows the canonical spelling and note count:

```text
status                         9 notes
```

Selecting it preserves the spelling from the notebook vocabulary. If casing variants already exist, show them separately and mark them as inconsistent; do not silently merge them.

`Enter` accepts the key and moves to the value. `Esc` cancels the unfinished row.

### Adding a new key

A new key is accepted when it is a simple YAML key:

```text
[A-Za-z_][A-Za-z0-9_-]*
```

This is deliberately narrower than everything YAML permits. Existing exotic keys remain preserved and visible as complex entries, but Notes does not create new quoted, mapping, or otherwise syntactically elaborate keys.

A key cannot duplicate a reserved key through the custom-property flow. Choosing a reserved name routes to that field’s existing operation.

### Editing values

There is no type registry. A property’s type is derived from its YAML value each time the notebook is parsed:

- string;
- finite number;
- boolean;
- null;
- flat list of those scalar types;
- complex/unsupported.

This keeps the Markdown folder authoritative and avoids a second schema stored in settings JSON.

Scalar values use one text field. Lists use an ordered set of editable rows, with Add item and Remove item controls. Keyboard behavior is:

- `Enter` commits a scalar;
- `Enter` on a list item creates the next item;
- `Backspace` on an empty list item removes it;
- `Alt+Up` / `Alt+Down` reorders list items;
- `Esc` abandons the current uncommitted field edit.

`aliases` uses this same list interaction but commits through the existing alias operation. A custom `tags` property is just YAML data; it does not become equivalent to Markdown `#tags` elsewhere in the app.

Complex values show their original YAML as a read-only monospaced preview. The available operations are:

- leave unchanged;
- delete this occurrence;
- replace with a supported scalar or flat list.

There is no raw-YAML mini-editor and no tree editor.

### Scalar interpretation and quoting

The person edits values, not YAML quoting. Notes never asks whether something should be quoted.

Input is interpreted conservatively:

- exact `true` or `false` → boolean;
- exact `null` → null;
- an unambiguous finite numeric literal → number;
- everything else → string.

Thus `yes`, `2026-09-06`, `[draft]`, a value containing `: `, and an empty value are strings. Serialization quotes them whenever plain YAML could alter their meaning or structure. An empty string becomes `""`.

Existing untouched YAML retains its original spelling. Editing an existing unquoted date may therefore change it to a quoted string; that is acceptable because the user changed that occurrence.

### Removing and undo

Removing a custom property is a single explicit action with no two-press guard. Note deletion is existential and deserves arming; removing one property does not.

Every committed add, edit, reorder, replacement, or removal is one entry in that note’s undo log. While the sheet is open, `Ctrl+Z` and `Ctrl+Shift+Z` operate on the note history and immediately refresh the rows. Closing the sheet does not prevent undo afterward.

Required reserved fields cannot be removed through this sheet. Optional reserved fields use their domain behavior: aliases can be emptied, pinned can be toggled, and deletion continues through the trash/restore commands. Do not expose raw editing for `id`, `created`, `updated`, or `deleted`.

## (c) Notebook-wide view

Provide both discovery and search, using the same modal-sheet shape.

Add an action:

```text
properties.notebook
All properties…
```

No default chord.

The sheet lists every **custom** property key in the notebook, excluding Notes-owned metadata and `aliases`. Each row shows:

- exact key spelling;
- number of notes containing it;
- detected value shapes, such as `text · list`;
- whether duplicate occurrences or casing variants exist.

Selecting a key runs:

```text
prop:status
```

and closes the sheet.

Expanding a key shows its distinct supported scalar values with note counts. List elements count individually. Select a value to run the corresponding equality query. Complex values are counted as `complex` but not enumerated or made searchable by serialized YAML.

Do not dump thousands of values initially. Show the ten most frequent values, with a filter field that searches the remaining distinct values. This is still one vocabulary sheet, not a property-management database.

Reserved fields already have dedicated concepts and searches, so listing ubiquitous keys such as `id`, `updated`, and `title` would obscure the useful vocabulary.

## (d) Search grammar

Add exactly one operator: `prop:`. Individual property names never become top-level operators.

Supported forms are:

```text
prop:status
prop:status=draft
prop:"review_status=needs review"
-prop:status
-prop:status=draft
```

The quoted form quotes the entire operand when whitespace or tokenizer-significant characters are required. Property keys created by Notes cannot contain whitespace, but preserved external keys may, so quoted lookup remains useful.

Semantics:

- `prop:key` matches a note containing at least one custom occurrence with that exact key spelling.
- `prop:key=value` matches when at least one occurrence equals the value.
- For a list, equality matches when any list element equals the requested value.
- Duplicate occurrences use “any occurrence matches.”
- Negation is supported and means the logical inverse of the complete positive predicate.

Key matching is case-sensitive because YAML keys are case-sensitive. The vocabulary completion prevents accidental variants without pretending `status` and `Status` are the same key.

Value matching is exact, never substring:

- strings compare case-insensitively over the entire value;
- numbers compare numerically;
- booleans and null compare by type;
- query literals `true`, `false`, `null`, and finite numbers receive those types;
- all other query literals are strings.

Do not add numeric inequalities in 0.23.0. `prop:rating>3` is rejected as an invalid property filter with a concise explanation; it must not silently search for a key literally named `rating>3`.

`prop:tag` and `prop:folder` mean custom YAML keys named exactly `tag` and `folder`. They do not invoke the existing `tag:` or `folder:` operators because only the outer operator name participates in query dispatch.

Complex property values support presence queries but not equality queries. `prop:config` may match; `prop:config=value` does not inspect or stringify the nested YAML.

## (e) Public model and write authority

Properties are part of a note’s public shape, not merely a renderer convenience. They must eventually appear in `notes show --json` and MCP `notes_read`; the exact external schema can be settled with the CLI/MCP question.

Add a derived field to `Note`:

```ts
properties: NoteProperty[]
```

Use an occurrence list rather than a map so order, duplicates, and complex values survive:

```ts
type NoteProperty = {
  key: string;
  value: PropertyValue;
  occurrence: number;
  complex: boolean;
};
```

The lossless `FrontMatterEntry[]` remains part of the parsed-file/write layer. `Note.properties` is its read-oriented projection containing custom properties only. It lets search, the notebook-wide vocabulary, CLI, and MCP consume one shared interpretation without reparsing files independently.

Reserved fields remain in their existing typed `Note` fields and are not duplicated into `properties`.

Finally, a flat rule: **Notes never adds a custom property unless the user explicitly asks it to.**

Today’s note adds none. Opening the properties sheet adds none. Search, indexing, export, templates discovery, and block addressing add none. Creating a note from a template may copy properties already present in that explicitly selected template; that is user-directed content creation, not an inferred property.

**Reading:** **A modal sheet, and `Ctrl+Shift+A` is re-pointed at it** so there is one property editor and not two. **No type registry** — the YAML value's shape is the type, because a second schema outside the markdown would contradict the folder being the artifact. Quoting is never a question the app asks: only exact `true`/`false`/`null` and unambiguous finite numerics are non-strings. One search operator, `prop:`, with exact key case and case-insensitive whole-value comparison; individual property names never become operators. `Note` gains a read projection `properties: NoteProperty[]` as an occurrence list, so order, duplicates and complex values survive. And on the record: **Notes never adds a custom property unless the user explicitly asks it to.**

---

## Q5

**Question (Claude):**

Accepted in full. A modal sheet, `note.properties` / "Properties…", `Ctrl+Shift+A` re-pointed at it with the aliases row focused so there is one property editor and not two; no persistent affordance on a note with none. Key completion from the notebook's own vocabulary with counts, casing variants shown separately and never merged, new keys restricted to `[A-Za-z_][A-Za-z0-9_-]*`. No type registry — the YAML value's shape is the type. List rows with Enter/Backspace/Alt+Up/Alt+Down. Conservative interpretation: only exact `true`/`false`/`null` and unambiguous finite numerics are non-strings; everything else is a string and quoting is never a question asked. No two-press guard on removal, every commit is one undo entry, `Ctrl+Z` works while the sheet is open. `properties.notebook` / "All properties…" as the vocabulary sheet, ten most frequent values then a filter. One operator `prop:`, exact key case, case-insensitive whole-value string compare, list membership, negation, no inequalities, `prop:rating>3` rejected with an explanation rather than searched literally. `Note.properties: NoteProperty[]` as the read projection with `{key, value, occurrence, complex}`, reserved fields not duplicated into it. And on the record: **Notes never adds a custom property unless the user explicitly asks it to.**

That is 0.23.0. The next three questions are 0.24.0 — **Working Context** — which I will build and ship as its own release straight after.

---

## Question 5 of seven: peeking a link without leaving the page

The comparison's phrasing: *"Hovering a `[[link]]`, a backlink or a search result shows that note's contents in a small panel."* Obsidian calls it **Page preview** and it is one of the features people name first when they describe what makes Obsidian feel fast.

### (a) The premise, and whether hover is the right trigger at all

This app is **keyboard-first**. Every one of its 61 commands has a chord or a menu row; the mouse is a second-class citizen by design, and the user's own complaint that opened 0.21.0 was about the *keyboard* surface. A hover-only feature is the first thing in the app that a keyboard user cannot reach.

Meanwhile the app already has three ways to see another note without losing this one: **`![[embeds]]`** (which render the live source in the page), **up to three panes** (open it beside this one), and **`Alt+←`** (go and come back, with the caret and scroll restored). The last of those exists *because* looking at a linked note used to cost you your place.

So rule on the premise first: **is peek a real gap, or is it a fourth way to render a note that the app does not need?** If it is real, say what it does that a second pane and `Alt+←` do not — I think the answer is something like "a glance costs no state change at all", but I want it in your words, and I want to know whether that is worth a new rendering surface.

If you keep it: what triggers it?

- **Hover** with a delay, Obsidian-style. Natural, discoverable, mouse-only.
- **A modifier + hover** (Obsidian's own default is actually Ctrl+hover for some link types), which stops accidental panels while reading.
- **A key on the focused thing** — the editor's caret is inside a link chip, or a backlink row has keyboard focus, and a chord peeks it. This is the keyboard-first answer and it is the one that makes the feature reachable without a mouse.
- **Both** hover and a chord.

Rule, and if you keep hover, give me the numbers: the open delay, the close delay, whether moving into the panel keeps it open, and what dismisses it.

### (b) What can be peeked

Candidate sources, all of which exist today:

- a `[[link]]` **chip in the editor** (a non-editable span carrying `data-link`);
- a link in the **rendered preview** (an `<a>` produced by marked's wikilink extension);
- a **backlink** row, an **unlinked mention** row, a **related note** row (three `.backlinks` strips under the body);
- a row in the **sidebar note list**;
- a row in the **command palette** or the **picker** overlay (recent notes, move-lines destination…);
- a **dot in the graph** (`Ctrl+Shift+G`);
- an **outline** heading (same note — probably meaningless);
- a **folder row** in the sidebar tree (there is no note to show).

Say which of these peek and which do not, and why. A rule I can implement — "anything that carries a note id and is not itself a note being edited" — is better than a list, if a rule exists.

And now that 0.23.0 exists: does hovering `[[Plan#^k3n9dq]]` peek **the block**, and `[[Plan#Heading]]` peek **the section**? I think it must — the address says what you meant — but confirm. Does hovering an ambiguous `[[Plan]]` (0.22.0's `{kind:'many'}`) show **both candidates with their folders**, which would make the peek genuinely useful rather than decorative?

### (c) The panel itself

- **Where does it sit?** A floating card near the pointer/caret (needs collision handling against three panes, the sidebar, and the window edges), or a fixed region — and if fixed, where, in an app whose only spare space is a marginalia column the user keeps hidden?
- **How big?** Obsidian's is a small scrolling card. This app's writing column is 960px by default and a note is set in 17px serif. A peek at that measure is a big panel; at 300px it is a different typographic object.
- **Rendered or raw?** The preview pipeline is marked + DOMPurify + KaTeX + mermaid + highlight.js. Mermaid is a **lazy `import()`** that swaps `<pre>` for SVG *after* render, and KaTeX pulls a 360KB generated stylesheet. Rendering a peek through the full pipeline on every hover is a real cost. Options: full pipeline; markdown-without-diagrams; or plain text. Rule, and if diagrams are out, say what the panel shows in their place.
- **Is it interactive?** Can you scroll it, click a link inside it (peek-within-peek?), tick a checkbox in it, select and copy from it? Obsidian's is scrollable and its links work. I lean towards: scrollable, selectable, links **navigate** (they don't nest), checkboxes are inert.
- Does it **embed** (`![[…]]` inside the peeked note) — which would mean the embed machinery running inside a hover card — or does it show embed markers unresolved?

### (d) The cost, honestly

`renderEditor` already does real work per keystroke; the app has a 700ms watcher settle and a rAF-coalesced `syncWriting`. Peek adds: a hover listener across several surfaces, a debounce, a markdown render, a DOM insert, and a positioning pass. Say what the budget is and what gets sacrificed to stay inside it. Specifically: is the peeked render **cached** per note (invalidated how?), or done fresh every time?

### (e) The setting

Every comparable app makes this toggleable, and this app has a Layout sheet full of checkboxes (`ui.controls`, focus mode, typewriter, outline, live format, margin, reminders). Does peek get one? Does it default **on** or **off**? Given the user's stated stance — restrained, paper-like, nothing that moves unbidden — I could argue either. Rule.

**Answer (Codex):**

## (a) Premise and trigger

Keep peek. It fills a real gap:

> Peek answers a question about another note without changing tabs, pane history, caret, scroll, or layout.

An embed changes the document, a second pane changes the workspace, and `Alt+←` repairs a navigation change after it happens. Peek creates no state change at all. That is worth one deliberately lightweight rendering surface.

Support both mouse and keyboard.

### Pointer

Ordinary hover opens peek; no modifier is required.

- Open delay: **450 ms**
- Close delay: **180 ms**
- Moving from the source into the card cancels closing.
- Moving back to the same source keeps the existing card.
- Moving directly to another peekable target starts a new 450 ms delay; it does not flash intermediate content.

A pointer-opened card closes on:

- leaving both source and card for 180 ms;
- `Esc`;
- clicking outside;
- navigating to a note;
- typing or changing the editor selection;
- scrolling the containing pane or sidebar;
- opening another modal or picker;
- window blur.

### Keyboard

Add:

```text
view.peek
Peek linked note
Alt+P
```

It appears in `ACTIONS`, the shortcuts sheet, palette, and View menu.

The command uses the current keyboard context:

- link chip containing or immediately adjacent to the editor caret;
- focused preview link;
- focused backlink, mention, related-note, search-result, sidebar-note, or graph-node row.

A keyboard-opened card is pinned until `Esc`, `Alt+P` again, navigation, editing, or focus leaving both the source and card. Focus moves into the card so it can be scrolled, selected, and traversed without a mouse. Closing it restores focus to the originating element or editor position.

## (b) Peekable targets

The rule is:

> A stable UI element may peek when its primary activation opens a specific note or note address.

Peek:

- wiki-link chips in the editor;
- wiki links in rendered preview;
- backlink rows;
- unlinked-mention rows;
- related-note rows;
- search-result rows;
- sidebar note rows;
- graph note nodes.

Do not peek:

- command-palette rows;
- picker rows, including recent notes and move destinations;
- outline headings;
- folder rows;
- toolbar or menu commands.

Pickers and modal sheets must not spawn a second floating selection surface. An outline target is already visible in the current note, and folders have no note content.

Address specificity is preserved:

- `[[Plan]]` peeks the whole note;
- `[[Plan#Heading]]` peeks that section;
- `[[Plan#^k3n9dq]]` peeks that block;
- local `[[#Heading]]` and `[[#^id]]` work identically.

Missing headings and blocks show the same unresolved explanation established in 0.23.0.

An ambiguous note link shows a resolution card rather than concatenating full notes. It lists every candidate with:

- title;
- folder-qualified path;
- up to two plain-text preview lines.

This is informational only. Clicking the original link still invokes the established ambiguity flow. A candidate inside the peek may be activated directly because it represents an exact note ID; doing so navigates to that note and closes the card.

## (c) Panel

Use one floating card anchored to the target element, or to the editor caret for keyboard invocation. There is never more than one peek card.

Position it beside the source with an 8 px gap:

1. prefer right;
2. then left;
3. then below;
4. then above;
5. clamp to the usable window bounds.

It may overlap document content, but not leave the viewport. It is not constrained to the originating pane.

Dimensions:

```text
width: clamp(320px, 34vw, 440px)
max-height: min(520px, 60vh)
```

On very narrow windows, use the viewport width minus 24 px. The body scrolls internally. Typography uses the existing paper colors and typefaces, at a slightly reduced 15 px reading size. No new accent color, shadow language, or arrow ornament is needed; use the existing sheet border and restrained elevation.

### Rendering

Use a deliberately reduced reading pipeline:

- Markdown through `marked`;
- sanitization through DOMPurify;
- headings, emphasis, lists, tables, links, images, blockquotes, and plain code blocks;
- task checkboxes rendered but disabled;
- block markers hidden.

Do not run:

- Mermaid;
- syntax highlighting;
- asynchronous render enrichments;
- embedded-note expansion.

A Mermaid fence becomes a muted block reading `Mermaid diagram`. Other fenced code appears as unhighlighted code. Math remains readable source text rather than invoking a separate typesetting pass.

An embed such as `![[Other]]` appears as a compact inert preview placeholder containing its resolved label, for example:

```text
Embedded: Other
```

It does not expand. This prevents a hover from triggering recursive note rendering, depth traversal, images, and diagrams.

### Interaction

The card is:

- scrollable;
- text-selectable;
- copyable;
- keyboard-focusable.

Links inside it navigate normally in the active pane and close the card. They do not open another nested peek. Preserve existing modified-click behavior for opening beside or in another tab if such behavior already exists.

Checkboxes are inert. Images may load using the existing safe attachment resolution, but the card reserves their dimensions and limits their height to avoid repositioning after load.

## (d) Performance budget and caching

Peek must not participate in `renderEditor` or run during typing. Use delegated listeners at each stable surface rather than attaching handlers to every row or chip.

Performance targets on an already loaded note:

- timer-to-visible work on a cache hit: within one animation frame;
- uncached basic Markdown render: **under 50 ms** for an ordinary note;
- positioning: one measurement pass and one write pass;
- no Mermaid import, highlighting pass, embed expansion, or notebook-wide recomputation.

Cache sanitized rendered fragments by:

```text
note id + in-memory content revision + address
```

Use a bounded LRU cache of the most recent **32 entries**. Cache the generated safe markup, not a live DOM node, so event state cannot leak between cards.

Invalidate every cached entry for a note when:

- its in-memory body changes;
- a filesystem-watcher update replaces it;
- it is renamed, moved, deleted, restored, or reloaded.

A fragment key distinguishes whole-note, heading, and block peeks. Note links inside cached markup resolve at click time through the current note index, so unrelated notebook changes do not require global cache invalidation.

For extremely large notes, extract the addressed heading/block before rendering. A whole-note peek renders at most the first **12 KB of source** and ends with a muted `Open note to continue` row. This is a preview, not a miniature second pane.

The sacrificed features are deliberate: no diagrams, highlighted code, typeset math, expanded embeds, editable tasks, or unlimited documents.

## (e) Setting

Add one Layout setting:

```text
ui.linkPeek = true
```

Label:

```text
Preview notes on hover
```

It defaults **on**, because hover preview is the promised feature and a 450 ms dwell prevents ordinary pointer travel from opening it constantly.

This setting controls pointer hover only. `Alt+P` remains available when hover preview is disabled; keyboard access is an explicit command, not unsolicited motion.

Disabling the setting immediately closes a pointer-opened card and cancels pending hover timers. It does not affect the command, rendered embeds, or ordinary link activation.

**Reading:** **"Peek answers a question about another note without changing tabs, pane history, caret, scroll, or layout."** That is what an embed, a second pane and `Alt+←` all fail to do — each of them changes something. Hover with no modifier at 450/180 ms, **plus `Alt+P` so the feature is reachable from the keyboard**. The rule for what peeks: *a stable UI element whose primary activation opens a specific note or note address* — so pickers, the palette, outline rows and folder rows do not. A deliberately reduced pipeline: no mermaid, no highlighting, no math pass, no embed expansion, first 12 KB of a whole note. It is a preview, not a miniature second pane.

---

## Q6

**Question (Claude):**

Accepted in full. *"Peek answers a question about another note without changing tabs, pane history, caret, scroll, or layout"* is the sentence the feature is built around. Hover with no modifier, 450/180ms, plus `view.peek` on `Alt+P` for the keyboard; one card ever; the rule for what peeks is "a stable UI element whose primary activation opens a specific note or note address", so pickers, the palette, outline rows and folders do not. Address specificity preserved; an ambiguous link peeks a candidate list with folders. `clamp(320px, 34vw, 440px)`, right→left→below→above→clamp, 15px. Reduced pipeline: marked + DOMPurify, no mermaid, no highlighting, no math pass, no embed expansion — a mermaid fence reads `Mermaid diagram` and an embed reads `Embedded: Other`. Scrollable, selectable, links navigate and never nest, checkboxes inert. Bounded LRU of 32 keyed on `id + revision + address`, first 12KB of a whole-note peek then `Open note to continue`. `ui.linkPeek` defaults on and governs hover only.

---

## Question 6 of seven: slash commands, and named workspaces

Two features, both pure window-state, and I am asking them together because the honest answer to one of them may be "no".

## Part one: slash commands

### (a) The hard question first

0.21.0 diagnosed the command problem as **recall**, not discoverability and not reach — *"you know the command exists and your hand is already on the keyboard; what fails is which chord it is"* — and answered it with four pills and four generated menus in the pane header, all reading the one `ACTIONS` registry, all printing the chord beside the command. The palette (`Ctrl+Shift+K` / `Ctrl+P`) was already the complete searchable catalog and stayed that way.

A `/` menu would be the **fifth reader of that registry**, and the fourth way to reach a command. So: **what does `/` do that the palette and the header menus do not?**

The honest candidate answers I can see:

1. **Nothing — cut it.** The palette is a fuzzy-matched list of every command, two keys away. `/` is Notion's answer to a problem this app solved differently, and adding it makes the app's command story worse by making it longer.
2. **It is about the caret, not the command.** The palette runs a command *somewhere*; `/` runs it *here*, and for the insert-shaped commands (task, date, divider, template, table, attach, and now a block link) "here" is the whole point. The app already half-admits this: 0.21.0's four **pills** are exactly Task / Date / Divider / Attach — the insert-shaped ones — pulled out of the menus because they are different.
3. **It is about the hands.** You are typing prose; `/` is on the home row of the thing you are already doing, and `Ctrl+Shift+E` is not.

If your answer is (1), say so plainly and we build five features, not six — I would rather that than a fifth surface nobody needs. If it is (2) or (3), then the design follows from it and I want the following settled.

### (b) If we build it

- **What is in the menu?** All 61 commands (making it a palette with a different key), or **only the insert-shaped ones**? If the latter, name the membership rule — I would expect it to be a new flag on `Action`, the way 0.21.0 added `menuSection` and `pill`, and I would expect `registry.test.ts` to assert the exact membership the way it already asserts the twelve menu sections and the four pills.
- **The standing "no" holds**: no bold / italic / heading / list / quote commands sneak in through this door. Confirm.
- **When does `/` open it?** Obsidian opens on `/` at the start of a line or after whitespace, never mid-word. What about inside a code fence, inside inline code, inside a link chip, in the title field, in the search box, in a table cell? What about a person who is typing a file path or `and/or`?
- **How does it close without running anything?** Esc, obviously. What about typing a space? Typing a character that matches nothing? Moving the caret?
- **What happens to the typed `/query` text when a command runs?** It must be removed, and it must be **one undo step** together with whatever the command inserted — this app's undo is its own per-note log with 800ms coalescing, and `insertAtCaret` is already "splice into the model + `setBody` + `placeCaretAt`" precisely so an insert is one step. Confirm that is the requirement.
- **What does it look like?** The picker overlay (`openPicker`) is a centred sheet that takes focus — wrong for something anchored to a caret mid-sentence. The peek card from Q5 is anchored to a caret and does not take focus. Is the slash menu a third floating thing, or does it borrow the peek card's positioning code? And does it print chords beside its rows, per 0.21.0's rule that a command surface's job is to print the chord?

## Part two: named workspaces

### (c) The premise

The app persists `ui.panes: PaneShape[]` (`{tabs, activeId, preview}` per pane, up to three) plus `ui.paneAt`, and window-level `ui.folder`, `ui.tags`, `ui.selectedId`, and the layout numbers (`textW`, `marginW`, `marginHidden`, `focusMode`, `typewriter`, `outline`, `liveFormat`, `controls`, `sidebarHidden`). One arrangement, restored on launch.

Obsidian's Workspaces plugin saves the whole layout under a name and switches between them. Rule on whether that is worth building **for this app** — three panes maximum, one window, no plugin panels, no sidebars-full-of-views. Obsidian's workspaces are valuable partly because an Obsidian layout is *complicated*. This app's layout is three panes and some tabs. Is a named arrangement of that a real thing to want, or is it Obsidian-envy?

If you keep it, settle:

- **What is in a workspace?** Just `panes` + `paneAt`? Also the folder being browsed and the search box's text (which would make a workspace a *task*, not a layout — "the writing one", "the release one")? Also the reading settings (`focusMode`, `typewriter`, `textW`)? Each inclusion makes switching more of a jolt. Say exactly which fields, and say what happens to a field that is *not* in a workspace when you switch.
- **What if a saved workspace names notes that no longer exist?** (Trashed, or missing per 0.22.0's `missing.json`.) Drop them silently, drop them with a message, or refuse to switch?
- **Where do they live?** `settings.json` (like saved searches — shared with the CLI, portable, and the CLI could then switch one) or `localStorage` (like the rest of `ui`, window-only)? Saved searches went to settings.json precisely so `notes list --view` could answer. Is there a CLI story for workspaces, or is this window-only state that has no business in a file the CLI reads?
- **The commands.** Save / switch / rename / delete is four; the app has 61 commands already and 0.21.0 was about there being too many to recall. Can this be fewer — one command that opens a picker listing the saved workspaces with a "Save this arrangement as…" row in it, the way the template picker has a "Create '<typed>'" row? And do workspaces appear in the sidebar as chips like saved searches do, or is a command enough?
- **Does switching a workspace do anything to the notes being typed?** There is a flush-before-anything-destructive discipline throughout this app (`void flush()` before trash, before delete, before relocate). Confirm switching flushes.

**Answer (Codex):**

Keep both features. Slash commands are justified only as a caret-local insertion surface; workspaces are justified as named snapshots of multi-note arrangements, not as copies of Obsidian’s entire window-layout system.

## Slash commands

### (a) Purpose

The `/` menu is not another command palette.

> The palette answers “what can Notes do?” Slash commands answer “what can Notes insert here?”

Its value is both caret locality and continuity: while writing, the user can insert structured Markdown without leaving the editor or recalling a chord. That is narrower than the palette and worth preserving as a distinct interaction.

### (b) Membership

Add an explicit optional field to `Action`, such as:

```ts
slash?: boolean
```

Only actions that insert content at the current body caret may set it. For 0.24.0, the exact membership is:

- Insert task
- Insert today’s date
- Insert divider
- Insert from template
- Insert table
- Attach file
- Link to a block…

No navigation, note management, view, window, search, export, or settings action appears.

`registry.test.ts` must assert this exact membership and assert that every slash action is enabled only in an editable note body.

The standing prohibition remains unchanged: no bold, italic, heading, list, quote, or similar formatting actions are created for this menu. Slash commands do not establish a general formatting-command model.

### Trigger and lifetime

The menu opens only in the editable Markdown body when `/` is typed:

- at the beginning of a line; or
- immediately after whitespace.

It does not open:

- mid-word, including `and/or`;
- after another path character;
- inside inline code;
- inside a fenced code block;
- inside a link/embed/image chip;
- in the title;
- in search, sheets, pickers, or other inputs;
- inside a Markdown table row.

The `/` and following query remain ordinary temporary body text while the menu is open. This means paths and prose are never swallowed merely because the menu appeared.

While open:

- typing filters by action label, terms, and hint;
- spaces are allowed in the query;
- `Up` / `Down` changes selection;
- `Enter` runs the selected command;
- `Tab` also runs the selected command;
- `Esc` closes the menu and leaves `/query` in the note;
- moving the caret outside the query closes it and leaves the text;
- clicking elsewhere closes it and leaves the text;
- newline closes it and leaves the text;
- an empty result shows `No matching insert command` and remains open.

Backspacing through the opening `/` closes it. If an external edit changes the body or the active note changes, close it without attempting to recover the query.

### Execution and undo

When a command runs, remove the complete `/query` range and perform the insertion as one atomic note edit. One `Ctrl+Z` must restore exactly the `/query` text and remove everything inserted by the command.

For commands requiring a secondary choice—template, attachment, block target—the `/query` remains in place while that chooser is open. Only after the user completes the chooser does Notes atomically replace it. Canceling the chooser leaves `/query` unchanged.

Commands that fail likewise leave `/query` unchanged and report the existing error.

This requires a caret insertion transaction rather than two independent calls to `setBody`; do not depend on the 800 ms coalescing window to make it appear atomic.

### Appearance

The slash menu is an anchored listbox below the query or above it when space requires. It shares the anchored-positioning utility introduced for peek, but it is a separate component with different focus and dismissal behavior.

The editor retains DOM focus. The menu uses active-descendant/listbox semantics so arrow keys can select rows without moving the caret.

Each row displays:

```text
Insert today’s date                         Ctrl+;
```

Always print the chord when one exists, preserving 0.21.0’s recall rule. Chordless actions show their hint or nothing in that column; do not display a fake shortcut.

Use the existing paper, border, type, and selection treatment. No new accent color.

## Named workspaces

### (c) Purpose

Keep workspaces, but define them narrowly:

> A workspace is a named snapshot of which notes are arranged in which panes.

This is valuable even with three panes. A release task may require specification, implementation notes, and testing notes side by side; a writing task may use a draft beside references. Reconstructing those tab sets repeatedly is real friction.

It is not a general window-layout profile.

### Captured state

A workspace stores exactly:

```ts
type Workspace = {
  id: string;
  name: string;
  panes: PaneShape[];
  paneAt: number;
  createdAt: string;
  updatedAt: string;
};
```

Because `preview` is already part of `PaneShape`, each pane’s preview state is included.

It does not store:

- current folder;
- tags or search text;
- sidebar visibility;
- selected sidebar row;
- text or margin width;
- focus mode;
- typewriter mode;
- outline visibility;
- live-format setting;
- controls visibility;
- marginalia settings;
- caret or scroll history;
- navigation history.

Those fields remain exactly as they were when switching. This keeps the switch spatial rather than turning it into a wholesale mode change.

Per-note caret and scroll restoration may continue to work through the app’s existing note-state mechanism, but the workspace itself does not copy or own those values.

### Snapshot behavior

Workspaces are snapshots, not live configurations.

After loading one, opening or closing tabs does not mutate the saved workspace. The workspace sheet may indicate that the current arrangement differs from the loaded snapshot, but no automatic save occurs.

The user must explicitly choose **Update from current arrangement** to replace its snapshot. This is consistent with the rule against unrequested durable changes.

Names are trimmed, case-insensitively unique, and limited to 80 characters. Preserve the user’s entered casing.

### Missing notes

Switching resolves every tab ID against the current notebook:

- missing or trashed notes are removed from the loaded tab arrays;
- panes that become empty remain as empty panes if other panes contain notes;
- if all panes become empty, load one empty pane;
- clamp `paneAt` to a surviving pane;
- choose the first surviving tab when a saved `activeId` is unavailable.

Do not refuse the entire workspace because some notes disappeared. After switching, show one notification:

```text
Opened “Release”. 2 unavailable notes were omitted.
```

Do not modify the saved snapshot merely because notes are currently missing; a temporarily missing file may return.

### Storage

Store workspaces in `localStorage` beside `ui.panes`, under a versioned window-state key such as:

```text
ui.workspaces
```

They are window-only UI state, not notebook content or CLI data. They do not belong in `settings.json`, do not sync with the notes folder, and have no CLI or MCP commands.

Scope them using the same notebook/root identity used for other persisted UI state so note IDs from different notebooks cannot be mixed.

### Commands and UI

Add exactly one registry action:

```text
workspace.open
Workspaces…
```

No default chord. It appears in the palette and Window menu.

It opens one modal sheet containing:

- saved workspaces;
- **Save current arrangement as…**;
- when a workspace was most recently loaded, **Update “Name” from current arrangement**;
- inline Rename and Delete actions for each row.

Selecting a workspace switches to it. Typing a new name and confirming saves the current arrangement. Attempting to use an existing name offers **Replace existing snapshot** rather than silently overwriting it.

Rename commits on `Enter`; `Esc` cancels. Delete uses a lightweight inline confirmation because deleting a saved snapshot is not undoable, though it does not affect notes or the current arrangement.

These sheet operations do not become four separate `ACTIONS`: they have no global chords and make sense only inside the workspace-management surface.

Do not put workspace chips in the sidebar. Saved searches describe notebook content and belong beside navigation; workspace snapshots are infrequent window commands.

### Switching safety

Switching always:

1. flushes all pending note edits;
2. aborts if any flush fails;
3. validates and resolves the saved tab IDs;
4. applies the pane snapshot in one UI-state update;
5. persists the new current `ui.panes` and `ui.paneAt`;
6. focuses the saved active pane or the first surviving pane.

It never discards unsaved editor text, changes note files merely by switching, empties undo histories, or mutates the saved workspace.

**Reading:** **"The palette answers 'what can Notes do?'; slash commands answer 'what can Notes insert here?'"** — which is why the membership is exactly seven insert-shaped actions behind a new `slash?: boolean`, asserted by `registry.test.ts`, and why the standing "no formatting commands" holds. `/query` stays ordinary body text throughout, so prose and paths are never swallowed; running a command is one atomic transaction, so one `Ctrl+Z` restores the query exactly. **A workspace is "a named snapshot of which notes are arranged in which panes"** and nothing else — no folder, no search text, no reading settings, so a switch is spatial rather than a wholesale mode change. Snapshots never self-update, missing notes are omitted rather than refusing the switch, and it is window-only state with no CLI and no MCP.

---

## Q7

**Question (Claude):**

Accepted in full. *"The palette answers 'what can Notes do?'; slash commands answer 'what can Notes insert here?'"* — a new `slash?: boolean` on `Action`, exactly seven members, `registry.test.ts` asserting the membership and that each is enabled only in an editable body. `/` opens only at a line start or after whitespace in the body, never mid-word, in code, in a chip, in the title, in an input or in a table row; `/query` stays ordinary text throughout, Esc leaves it, a secondary chooser keeps it until the chooser completes, and running is one atomic transaction so a single `Ctrl+Z` restores `/query` exactly. Anchored listbox, editor keeps DOM focus, active-descendant semantics, chord printed in the right column. Workspaces are *"a named snapshot of which notes are arranged in which panes"* and nothing else — `{id, name, panes, paneAt, createdAt, updatedAt}` in `ui.workspaces` in localStorage, scoped by notebook identity, no CLI, no MCP, no sidebar chips, one action `workspace.open` and every other operation inside the sheet. Snapshots never self-update; missing notes are omitted with one notification and the snapshot is not rewritten; switching flushes first and aborts if a flush fails.

---

## Question 7 of seven: the command line, the MCP server, and what each release is called

Everything so far has been the window. This app's rule is that the notebook is not the window: there is a `notes` command with ~45 commands (file mode through `src/core/` when the app is closed, a named-pipe JSON-RPC to the running window otherwise, so the app stays the single writer), and an MCP server with 12 `notes_`-prefixed tools that an assistant drives. Both read the same notes. If a concept exists on disk and the CLI cannot see it, the CLI is lying.

Three of the six features change what is on disk (journal paths, block ids, properties); three do not (peek, slash, workspaces — and you have already ruled workspaces out of `settings.json` and out of the CLI entirely). So this question is mostly about 0.23.0.

### (a) The CLI surface for 0.23.0

Rule on each of these — the exact command names, their arguments, what the plain / pretty / `--json` output is, and which of them are worth having at all. Cut anything that is API-completeness rather than something a person or a script would run.

**Journal.**
- `notes journal` / `notes today` — which name? (Note `notes folder` already means "the notebook's location" and 0.22.0 had to use the plural `notes folders` for the tree; I would rather not repeat that.) Does it open the note in the running window, print its path, or print its body? Does it take a date (`notes journal yesterday`, `notes journal 2026-09-01`)?
- Does it **create** the note when run from a script, or is creating a window-only act? (`notes journal --no-create`? The reverse?)

**Properties.**
- `notes props <note>` to list, `notes props <note> <key>` to read one, `notes prop set <note> <key> <value>`, `notes prop rm <note> <key>`? Or one `notes props get/set/rm`? Say the shape.
- Setting a **list** value from a shell, where `--` and quoting are already awkward. Repeated `--value`? A comma? JSON?
- `notes props --all` for the notebook-wide vocabulary sheet's data?
- Does `notes list "prop:status=draft"` work? (`parseWords` is the per-argv variant of the query parser; if `prop:` is in `OPERATOR_NAMES` this is free — confirm it is, and that the CLI's search grammar and the window's stay identical.)

**Blocks.**
- Do block ids appear in `notes show --json`? As what — a list of `{id, kind, line}`?
- Is there `notes block link <note> <id>` (print the link) or `notes show <note> --block ^abc` (print the block's text)? Is either worth it, or is the CLI's job here purely not to *break* block ids?
- **`notes show --json` and `notes list --json` are a contract.** Say exactly which new fields are added to each and confirm nothing existing changes shape. (Exit codes: `EXIT` in `src/core/ipc-protocol.ts` — add codes, never change them. Does anything here need a new one? Ambiguity is already 7.)

### (b) The MCP surface

The server has 12 tools, each with an `inputSchema` (`additionalProperties: false`) and an `outputSchema` (a declared output schema is a promise — only declare one where structured output is *always* returned). Tools are prefixed `notes_` because an assistant holds several servers at once. `notes_read` returns a note; `notes_search` pages; `notes://<id>` are resources.

Rule on:
- Do properties appear in `notes_read`'s structured output, and can `notes_update` (or a new `notes_set_property`) change them? An assistant that can read `status: draft` but not set it is half a feature; an assistant that can rewrite arbitrary YAML is a liability. Where is the line?
- Does `notes_search` accept `prop:` (it takes the same query grammar)? Free if so.
- Blocks: a new `notes_read_block`, or a `block` argument on `notes_read`? Can an assistant *mint* a block id? (That is a write to a note, on an assistant's initiative — your Q1 rule says machine-added markdown must be "the direct, reversible result of an explicit user command". Is a tool call an explicit user command?)
- Journal: a `notes_today` / `notes_journal` tool, or nothing? An assistant asked to "add this to today's note" is a plausible thing; an assistant creating dated files on its own is less so.
- `phase3-check.mjs` asserts the **tool count is 12**. Say the number it becomes, so the harness is updated deliberately rather than discovered.

### (c) The two releases, named

0.21.0 shipped as *"Commands come out from behind their shortcuts"*; 0.22.0 as *"Folders: every note has somewhere to live"*. Both are a sentence that says what changed for the person, not a feature list. You named the two rounds **Addressable Notes** and **Working Context**, which are good internal names and are not that.

Give me:
- the **release title** for 0.23.0 and for 0.24.0, in that register;
- for each, the **one criterion** you would judge it by on release day — 0.21.0's was "all four menus survive a three-way split at 1440px", 0.22.0's was that a note keeps its id through a move made in Explorer. A single observable thing that, if it fails, the release is not done.

### (d) Anything I have not asked

You have seen the whole design now. Name anything that is wrong, missing, or that you have changed your mind about across these seven questions — including anything in 0.23.0 that Q5/Q6 revealed a problem with. If there is nothing, say so and we are finished.

**Answer (Codex):**

## (a) CLI surface for 0.23.0

The CLI exposes journal creation, custom properties, and block reading. It does not gain commands merely to reproduce every window interaction.

### Journal

Use one command:

```text
notes journal [date] [--no-create] [--json]
```

Do not add `notes today`; `notes journal` already defaults to today.

Accepted dates use the journal date parser established in Q2:

```text
notes journal
notes journal yesterday
notes journal 2026-09-01
notes journal +3d
```

Time-only values remain invalid.

By default, the command opens or creates the canonical journal note. It does **not** navigate the running window. When Notes is running, the CLI sends the operation through JSON-RPC so the app remains the single writer; it receives the result without changing tabs, panes, focus, or workspace state.

`--no-create` resolves only an existing entry. If none occupies the canonical path, return the existing not-found exit code.

Output:

- Plain: notebook-relative Markdown path.
- Pretty: `Journal for 2026-09-04` followed by its relative path and whether it was created or already existed.
- JSON: the same complete note object returned by `notes show --json`, plus:

```json
{
  "journalDate": "2026-09-04",
  "createdNow": false
}
```

Those two fields belong to the command result wrapper, not permanently to the note.

Do not add body-printing flags; `notes show` already does that.

### Properties

Use one plural command family:

```text
notes props <note>
notes props <note> <key>
notes props set <note> <key> <value>
notes props set <note> <key> --value <item> [--value <item> ...]
notes props remove <note> <key> [--occurrence <n> | --all]
notes props --all
```

`rm` may be accepted as an undocumented alias for `remove` if that matches existing CLI conventions, but help prints `remove`.

Rules:

- Positional `<value>` sets a scalar using the same conservative interpretation as the properties sheet.
- Repeated `--value` sets a flat list. One `--value` still means a one-element list.
- Positional value and `--value` are mutually exclusive.
- No comma splitting and no raw JSON/YAML input.
- Complex values cannot be created.
- `--occurrence` is one-based in source order.
- Removing a unique key needs no occurrence flag.
- Removing a duplicated key without `--occurrence` or `--all` returns existing ambiguity exit code 7.
- Reserved keys are rejected here with guidance to their existing command, where one exists.

For listing one note:

- Plain: one occurrence per line as `key<TAB>type<TAB>value`; list values repeat one tab-separated value per item, and complex values print `<complex>`.
- Pretty: a table with Key, Type, Value, and an Occurrence column only where duplicates exist.
- JSON: an array of the public property objects.

For reading one key:

- Plain: one value per occurrence; list items print one per line.
- Pretty: labeled occurrence rows.
- JSON: an array, even when only one occurrence exists, because duplicates are legal.

For `set` and `remove`:

- Plain: print the notebook-relative path of the changed note.
- Pretty: print `Set status on Work/Plan.md` or `Removed status from Work/Plan.md`.
- JSON: return the updated public property array for that key, plus the note ID and path.

For `notes props --all`:

- Plain: `key<TAB>noteCount<TAB>types`.
- Pretty: the same notebook-wide vocabulary table as the sheet.
- JSON: an array of:

```json
{
  "key": "status",
  "noteCount": 9,
  "types": ["string"],
  "duplicateCount": 0,
  "casingVariants": []
}
```

The JSON output is not limited to ten values; the UI’s ten-value limit is presentation-only. Include distinct supported values and counts in a `values` array. Complex values contribute to type/count data but are not serialized as distinct values.

`prop:` is added to `OPERATOR_NAMES`, `NEGATABLE`, `parseQuery`, and `parseWords` through the same shared implementation. Therefore this works identically in the window and CLI:

```text
notes list "prop:status=draft"
```

### Blocks

Add block discovery to `notes show --json` and block reading to the existing `show` command:

```text
notes show <note> --block <id>
notes show <note> --block <id> --json
```

Accept `abc123` or `^abc123` and normalize only the argument, not the source file.

Plain output is `BlockSlice.content`: exact addressed Markdown with its marker removed and list indentation normalized as established in Q3.

Pretty output adds a heading such as:

```text
Plan · ^abc123 · list item · line 18
```

followed by the content.

JSON output is:

```json
{
  "noteId": "...",
  "path": "Work/Plan.md",
  "block": {
    "id": "abc123",
    "kind": "list-item",
    "line": 18,
    "content": "- Decision\n  - Supporting detail"
  }
}
```

Line numbers are one-based. Missing blocks use the existing not-found code; duplicate blocks use ambiguity code 7.

Do not add `notes block link`. Printing syntax around an already known ID adds little, while minting from a shell would require a new and fragile way to identify a source block. The CLI reads block addresses and preserves them but does not mint them.

### JSON contracts

`notes show --json` adds exactly:

```json
{
  "properties": [
    {
      "key": "status",
      "occurrence": 1,
      "type": "string",
      "value": "draft"
    },
    {
      "key": "config",
      "occurrence": 1,
      "type": "complex",
      "value": null,
      "raw": "config:\n  nested: true"
    }
  ],
  "blocks": [
    {
      "id": "abc123",
      "kind": "paragraph",
      "line": 12
    }
  ]
}
```

Every duplicate block appears separately. `blocks` does not include content; use `--block` to retrieve it.

`notes list --json` adds:

```json
{
  "properties": [...]
}
```

using the same property occurrence schema. It does not add `blocks` or bodies.

All existing fields, nesting, meanings, and exit-code numbers remain unchanged. This design needs no new exit code:

- malformed arguments or unsupported values use the existing usage/error code;
- missing note/property/block uses existing not-found;
- ambiguous note, duplicate property occurrence, or duplicate block uses 7.

## (b) MCP surface

Increase the tool count from **12 to 14**.

### Existing tools

`notes_read` adds `properties` and `blocks` using the CLI JSON schemas above.

It also gains one optional input:

```json
{
  "block_id": "abc123"
}
```

When supplied, it returns the resolved block content and metadata instead of the whole body. A missing or duplicate block returns the normal structured tool error. Do not create a separate `notes_read_block` tool; it is a narrower read of the same note resource.

`notes_search` accepts `prop:` automatically through the shared query parser. Search result objects include custom properties if they parallel `notes list --json`.

`notes://<id>` resources continue representing notes. Their Markdown contents naturally retain front matter and block IDs; no separate resource family is needed.

### New property tool

Add:

```text
notes_set_property
```

It handles both set and remove through an explicit operation:

```json
{
  "note": "Work/Plan",
  "operation": "set",
  "key": "status",
  "value": "draft"
}
```

or:

```json
{
  "note": "Work/Plan",
  "operation": "remove",
  "key": "status",
  "occurrence": 1
}
```

For lists, `value` is an array of supported scalar JSON values. For scalars, it is a string, finite number, boolean, or null. Reject objects, nested arrays, non-finite numbers, reserved keys, and unsupported YAML.

Removal requires `occurrence` when duplicates exist. An explicit `all: true` permits removing every occurrence. Keep `additionalProperties: false`.

This is the only structured property writer. Do not let an assistant submit raw YAML or replace the complete front-matter document. `notes_update` continues handling the fields/body it already handles; it does not gain an arbitrary `frontMatter` string.

### New journal tool

Add:

```text
notes_journal
```

Input:

```json
{
  "date": "today",
  "create": true
}
```

Both fields are optional; defaults are today and `true`. It returns the complete structured note plus `journalDate` and `createdNow`. It never changes the visible window arrangement.

This supports requests such as “add this to today’s note”: resolve/create through `notes_journal`, then update the returned note using the existing note-update tool.

A tool call is an explicit operation by the MCP client and therefore may create a journal note or set a property. It satisfies the write rule because the exact mutation is named in the tool call, validated, and undoable/reversible through ordinary note history or another tool call.

### Block minting

Do not expose automatic block-ID minting through MCP in 0.23.0.

An assistant can read existing blocks, link to known IDs, and explicitly edit a body through existing tools. It cannot ask Notes to infer “the third paragraph” and inject an address. That inference lacks the caret/selection context which makes the window command safely explicit.

## (c) Release titles and gates

### 0.23.0 — Addressable Notes

Release title:

> **A note can carry its facts, its date, and an address to the exact thought.**

Release-day criterion:

> Starting from an Obsidian-authored note containing comments, complex YAML, duplicate properties, headings, and block IDs, a user can edit one property, create and embed one block link, and create today’s journal note; the resulting git diff contains only those explicitly requested bytes plus the existing legitimate metadata update, and every address resolves identically through the window, CLI, exports, and MCP.

If that diff contains normalized unrelated YAML, eagerly minted IDs, or divergent block content between surfaces, 0.23.0 is not done.

### 0.24.0 — Working Context

Release title:

> **Glance, insert, and switch contexts without losing your place.**

Release-day criterion:

> With unsaved typing in a three-pane workspace at 1440 px, the user can peek a linked block, run an insertion through `/`, switch to another named workspace and back, and recover the original text, panes, active tabs, caret behavior, and note history with no lost edit or unintended note write.

If any one of those interactions steals or discards the writing context, 0.24.0 is not done.

## (d) Final corrections and missing architectural seams

I have not changed my mind about any accepted product decision. Four implementation constraints should be explicit in the final design:

1. **Centralize link parsing now.**  
   `LINK_PATTERN`, chip rendering, marked, refactoring, embeds, backlinks, peek, CLI rendering, and MCP must consume one parsed `LinkAddress` representation. Adding local targets and block fragments while continuing to split strings independently will create incompatible grammars.

2. **Centralize address extraction.**  
   Heading lookup, `blockOf`, marker stripping, block enumeration, and fragment rendering belong in core. Renderer code may display resolutions but must not rediscover Markdown block boundaries.

3. **Treat multi-note edits as transactions at the application layer.**  
   Remote block minting and slash commands with secondary choosers must save the target before changing the source, retain both notes’ independent undo entries, and stop cleanly on failure. They are ordered edits, not an atomic filesystem transaction pretending to offer rollback it cannot guarantee.

4. **Suspend slash dismissal during its own chooser.**  
   Opening the template picker, attachment dialog, or block picker normally causes focus movement that would dismiss the slash session. Those flows must explicitly suspend it, then either atomically replace `/query` on success or restore the unchanged session text on cancellation.

With those seams recorded, the seven-question design is complete.

**Reading:** **The CLI and MCP get the concepts, not a mirror of every window interaction.** `notes journal [date]`, one `notes props` family, block reading through `notes show --block` — but **no `notes block link` and no MCP block minting**, because minting from a shell or on an assistant's initiative lacks the caret context that makes the window command safely explicit. `prop:` reaches the CLI free through the shared query parser. MCP goes 12 → 14 tools (`notes_set_property`, `notes_journal`), and a tool call *is* an explicit user command because the exact mutation is named in it. Four implementation seams recorded: centralize link parsing into one `LinkAddress`, centralize address extraction in core, treat multi-note edits as ordered application-layer transactions, and suspend slash dismissal during its own chooser.
