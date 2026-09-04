# Folders brainstorm for 0.22.0 (2026-09-05)

The `brainstorming` skill was run with **Codex CLI as the answering partner** (the user delegated the
product-owner role to Codex for this round, as they did for 0.15.0 and 0.21.0). Every question below went
to Codex through `codex exec` — one session, resumed per question, read-only sandbox, cwd = this repo —
and the answers are verbatim. The last line of each entry is Claude's one-line reading of the answer.

Path: Architectural. It changes the on-disk format from a flat folder of files to a tree, and with it
`pathsFor`, the id rules in `readIntoIndex`, the trash layout, the sidebar, the search grammar, the
command line and the MCP server.

The user's request, in their own words:

> "can this app make folders?"

It could not. The settled design is in `2026-09-05-folders-spec.md`.

## Q1

**Question (Claude):**

You are the product owner for **Notes**, a keyboard-first markdown notes app for Windows (Electron + TypeScript, at this repo). The user has delegated the product-owner role to you for this design round, exactly as they did for the 0.15.0 and 0.21.0 rounds (see `docs/2026-09-03-feature-brainstorm.md` and `docs/2026-09-04-toolbar-brainstorm.md` for how those went — you answered those). I am Claude Code, running the `brainstorming` skill; I will ask you five questions, one at a time, and then implement whatever we settle on. Answer decisively and concretely. Do not ask me to decide — you are the one deciding.

## The user's actual request

The user asked, plainly: **"can this app make folders?"** It cannot. They then said to design the feature and build it.

So the request is folders. But I am not going to take the word at face value before you have ruled on what it should mean here, because this notebook already has three organising systems and a folder would be a fourth.

## Where the app is today, precisely

**Notes are one flat folder of `.md` files.** `pathsFor(root, notesFolder)` in `src/core/paths.ts` decides where that folder is (it can be moved into OneDrive or a git checkout with the `notesFolder` setting). Inside it: `Plan.md`, `Groceries.md`, `Deploy notes.md` — no subdirectories, and `readNoteFiles` does a single non-recursive `fs.readdir` and takes anything ending in `.md`.

Each file carries front matter: `id`, optional `title`, optional `aliases`, `created`, `updated`, optional `pinned`. **The filename is derived from the title** (`fileNameFor`), and when a title changes the file is renamed. Two notes cannot share a filename, so collisions become `Plan.md`, `Plan 2.md`. The id in the front matter is what the app actually goes by; the name is for people reading the folder in Explorer.

### The three organising systems that already exist

**1. Nested tags.** A note's body can contain `#work/clients/hale`. `tagsOf()` extracts them; `tagTree()` builds a real **nested tree** from the `/` separator, where a note tagged `#work/clients/hale` also counts towards `#work` and `#work/clients` — "because that is what filing something under a heading means". The sidebar renders that tree as a rail (`renderTags`), indented, and clicking a tag both filters by it and unfolds what is nested inside. `tag:work` in the search box matches anything nested under it. **A note can carry any number of tags, so it is in many places at once.**

**2. Saved searches ("views").** A named query — `due:week todo:`, `tag:work sort:updated` — kept in settings, shown as chips above the tag rail, opened with Ctrl+Shift+Y. Clicking one types it into the search box. Fourteen search operators exist (`tag:`, `todo:`, `due:`, `pinned:`, `created:>7d`, `links:Title`, `orphan:`, `sort:`, `limit:` …).

**3. Links, aliases and backlinks.** `[[Another note]]` resolves **by title or alias, across the whole notebook**, case- and space-insensitively (`linkKey`). Backlinks are shown in the margin. `orphan:` finds notes with no links either way.

The sidebar is: saved-search chips, then the tag tree, then a flat list of notes (`renderList`) filtered by the search box.

### What "folders" would cost

This is architectural. It touches the on-disk format, `pathsFor`, `readIntoIndex` (the function that decides which file keeps which id — moving a file between directories would look to it like a removal plus an arrival, and the removal path *moves the file to the trash*), the sidebar, the search grammar, ~40 CLI commands that assume a flat namespace, and the MCP server's `notes://<id>` resource list.

## The design stances this app holds (overturn one only deliberately, and say so)

- **"Ink and margin"**: paper-like, restrained, no new accent colours.
- **Keyboard-first.** Every command lives in one `ACTIONS` registry that feeds the keyboard map, the shortcuts sheet, the palette and the pane menus at once.
- **The folder on disk is a first-class artifact.** It is meant to be readable and editable by Obsidian, by Explorer, by git, by hand. Unknown front matter survives a rewrite untouched. Whatever we do must still look sane to someone who opens the folder in Explorer.
- **The app already believes in nesting** — it built a whole tree UI for tags — but the nesting is *non-exclusive*.

---

## Question 1 of five

Before any shape, I want the problem stated, and I want you to rule on the premise itself.

The user said "folders". Two readings are genuinely different products:

**(A) Real nested directories on disk.** `notes/work/clients/Hale.md`. A note is in exactly one folder. Explorer, OneDrive and Obsidian all show the same tree. This is what "folders" means to almost everyone, and it is the only reading that survives leaving the app.

**(B) The tag tree, made to look and behave like folders.** No directories. `tagTree()` already builds the nested tree and the sidebar already draws it — what is missing is that it doesn't *feel* like filing: you file by typing `#work/clients` into the body rather than by moving a note, there is no "new folder", no drag, no "where does this note live", and the rail reads as metadata rather than as a place.

Answer three things:

1. **Describe the two or three concrete moments** where the missing folders actually cost you something. What were you doing, what did you want to put where, and what did you do instead (used a tag, gave up, made a note with links in it, left it in the pile)? Be specific about which notes and which tags.

2. **Is the real problem the absence of a hierarchy, the absence of *exclusivity* (one home per note), or the absence of a *place* (somewhere a note lives, that you move it to and browse, rather than a property it has)?** These want different solutions. Pick the dominant one and say why, rather than saying "all three".

3. **Rule on A versus B**, or a named hybrid — and if you pick a hybrid, be exact about what is on disk and what is not. If your answer is B, say plainly that we are not building folders and what we are building instead. If your answer is A, say what the tag tree is *for* once folders exist, because two nested trees in one sidebar is a real cost and I will hold you to justifying it.

**Answer (Codex):**

This is an **architectural** feature: folders become part of the notebook’s durable on-disk model, not merely a new sidebar treatment.

1. The missing folders cost me in these concrete moments:

   - I have `Hale brief.md`, `Hale meetings.md`, and `Hale deployment.md`. I want to put them in `Work/Clients/Hale/`. Today I add `#work/clients/hale` to each note, but Explorer still shows three unrelated files in one growing pile, and every new client note must repeat that metadata.
   - When a release finishes, I want to move `0.21 plan.md`, `0.21 testing.md`, and `0.21 retrospective.md` together from `Projects/Notes/` to `Archive/2026/Notes 0.21/`. Today I can rename a tag, but that does not create an archived place either in Notes or on disk. I usually leave the files in the pile.
   - Quick captures begin as root-level notes such as `SQLite backup options.md`. Once the thought becomes part of a project, I want to file the whole note into `Projects/Notes/Storage/`. Today I either add a tag or create a project index note full of links. Neither action makes the file itself feel put away.

2. The dominant problem is the absence of a **place**.

A note should have a location that answers “where does this live?”, can be browsed, and can be changed with a Move command. Exclusivity is a necessary consequence—one Markdown file has one path—but it is not the primary user benefit. We already have excellent non-exclusive classification through tags. Adding another virtual hierarchy would improve presentation while leaving the actual flat notebook untouched.

3. Choose **A: real nested directories on disk**.

A filed note is physically stored at a path such as:

```text
notes/
  Inbox.md
  Work/
    Clients/
      Hale/
        Hale brief.md
        Hale meetings.md
  Archive/
    2026/
      Notes 0.21/
        0.21 retrospective.md
```

Folder membership comes only from the relative filesystem path. Do not duplicate it into front matter. Root-level notes remain valid: the notebook root is itself a filing location. Wiki links, aliases, backlinks, and note identity remain notebook-wide and ID-backed; moving a file must not change its ID or break links.

Folders and tags have separate jobs:

- **Folders answer “where does this note live?”** They are exclusive, physical, and suitable for projects, clients, areas, and archives.
- **Tags answer “what is true about this note?”** They remain non-exclusive and cross-cutting: `#waiting`, `#meeting`, `#person/sam`, `#status/draft`, or `#topic/security`.

The sidebar may therefore contain two trees, but they must not compete visually. **Folders** become the primary browsing tree. **Tags** remain a separately labelled, collapsible secondary section for filtering across folder boundaries. We should not disguise tags as folders or encourage mirrored structures such as both `Work/Clients/Hale/` and `#work/clients/hale`; that duplication is precisely what real folders should eliminate.

**Reading:** **A — real nested directories on disk.** The missing thing is a *place*, not a hierarchy and not exclusivity: folder membership is the relative path and nothing else, the root stays a permanent valid location, and tags keep their own job — "what is true about this note" — in their own labelled section rather than being disguised as folders.

## Q2

**Question (Claude):**

Good. Real directories, folder membership is the path and nothing else, no front-matter duplication, root stays a valid place, ids and links stay notebook-wide. Folders answer "where does this live", tags answer "what is true about this", folders become the primary browsing tree and tags a separately labelled secondary section. I'll hold you to "do not encourage mirrored structures".

## Question 2 of five: identity, renaming, and what happens to what is already there

This is the part that can actually corrupt the notebook, so I want you to rule on it before we talk about UI.

### The machine, precisely

`readIntoIndex` in `src/core/store.ts` is the function that decides which file on disk is which note. It runs on load, and again every time the folder changes from outside (a watcher with a 700ms settle, because OneDrive writes in bursts). Its rules today:

- Every `.md` file is parsed. The `id:` in its front matter is its identity.
- A file with **no** id is stamped with one and written back — unless the *filename* was already known to the index, in which case it keeps the id it had (an editor that dropped the front matter must not create a new note).
- A file carrying an id the index **already holds under a different filename**, while that other file is still present, is treated as a **copy**: it gets a fresh id. That is how a OneDrive "conflicted copy" is handled.
- **An id in the index whose file is no longer found is `removed` — and on the next save, `removed` means the file is moved to the trash.**

That last rule is the danger. Today the index is keyed by *filename*, and "the file is gone" is unambiguous because there is one directory. With folders, **moving `Plan.md` from the root into `Work/` is, to a naive scan, `Plan.md` disappearing and `Work/Plan.md` appearing.** If the two passes are not the same pass, the note is trashed and then re-created under a new id, and its history, its backlinks and its place in the trash are all wrong.

Second machine fact: **the filename is derived from the title.** `fileNameFor(title)` sanitises it, `nameSuits()` checks whether the current filename still matches, and a save renames the file when the title changes. Two notes cannot share a filename, so collisions become `Plan.md`, `Plan 2.md`.

### Rule on these five, each explicitly

**(a) What is a note's identity now?** Today: the `id` front matter, and the filename as a fallback for a file that lost it. With folders, is identity the id alone (so a file that moves keeps everything), or the *path*? Specifically: when the app rescans and sees `Work/Plan.md` carrying an id that the index last saw at `Plan.md`, and `Plan.md` is gone — **is that a move (same note, new folder) or a delete-plus-create?** State the rule in one sentence a programmer can implement, and say what happens in the ambiguous case where **both** files are present (a copy-paste in Explorer, or a sync conflict).

**(b) A note's title and its folder are now two separate pieces of location state, and only one of them is in the file.** Renaming a note today rewrites the filename. Does renaming ever change the folder? Does moving a note ever change the title? And when the user moves a note to a folder where the filename is taken — `Work/Plan.md` already exists and another `Plan` arrives — what happens: `Plan 2.md`, a refusal, a prompt?

**(c) `[[links]]` resolve by title and alias across the whole notebook.** Once folders exist, **two notes named `Plan` in different folders is a completely reasonable thing to want** — that is half the point of folders. Today the second one is silently `Plan 2.md` but its *title* is still "Plan", and `[[Plan]]` would resolve to whichever the resolver finds first. Rule on it: (i) are duplicate titles in different folders legal, and (ii) if they are, what does a bare `[[Plan]]` mean — nearest in the tree, first found, ambiguous-and-flagged? And is there any path syntax — `[[Work/Plan]]` — or is that a road we refuse to start down?

**(d) What happens to the notebook that exists today?** Every note is at the root right now. On the first launch after this ships: does the root simply stay a valid location and nothing moves (my strong assumption), or is there any migration at all? Say it outright, because "no migration" is a decision worth writing down.

**(e) What is a folder when it has no notes in it?** A directory on disk can be empty. Does the app let you make an empty folder and keep it (meaning the app has state — a directory — that no note refers to, and any sync tool that prunes empty directories will silently delete it), or must a folder always be created by putting something in it? And does the app ever *delete* a folder when its last note leaves?

**Answer (Codex):**

### (a) Identity

A note’s identity remains its front-matter `id`; its relative path is mutable location, not identity.

Implement this rule:

> Reconcile the complete scan by ID before processing removals: if an indexed ID appears once at a new path and its old path is absent, it is the same note moved; if the old path still exists, it retains the ID and every additional file carrying that ID is a copy that receives a fresh ID.

The filename fallback expands to the last known **relative path**, not merely the basename. A file that loses its front matter at the same relative path keeps its prior ID.

No file may be marked removed until the entire recursive scan has been parsed and moves, copies, and missing-ID fallbacks have been reconciled.

### (b) Titles, folders, and collisions

Renaming and moving are independent operations:

- Renaming a note may rename its file, but never changes its folder.
- Moving a note changes its folder, but never changes its title.
- Moving and renaming both preserve the note’s ID and history.

Filename uniqueness applies **within one folder**, not across the notebook. If moving `Plan.md` into a folder already containing `Plan.md`, the arriving file becomes `Plan 2.md` automatically. Its title remains `Plan`. Do not refuse the move or interrupt it with a prompt; use the existing deterministic collision rule.

### (c) Duplicate titles and links

Duplicate titles in different folders are legal. They are a normal consequence of real folders.

A bare `[[Plan]]` resolves only when `Plan` identifies exactly one note by title or alias across the notebook. If several notes match, the link is **ambiguous and flagged**; it must never silently choose the first scan result or the nearest folder. Both would make link meaning depend on incidental location or traversal order.

Add notebook-root-relative path syntax:

```markdown
[[Work/Plan]]
[[Personal/Plan]]
```

The path omits `.md` and resolves to that physical note. A slash therefore means a path-qualified link; without a slash, existing title-or-alias resolution remains unchanged.

When Notes creates a link to an ambiguous title, its note picker must insert the qualified form. Existing unique links stay short. We are accepting path-qualified links only as explicit disambiguation—not changing all links into paths.

### (d) Existing notebooks

There is **no migration**.

On first launch, every existing note remains at the notebook root, with the same ID, title, filename, history, and links. The root is a permanent valid location, not a temporary inbox that must eventually be emptied.

The only automatic disk changes are the existing ones, such as stamping a genuinely new ID-less note.

### (e) Empty folders

An empty folder is valid notebook state. “New folder” creates a real directory immediately; creating a note is not required.

Notes must never automatically delete a folder when its last note leaves. Folder deletion is a separate, explicit operation. An empty folder removed externally—or pruned by a sync system—disappears from Notes on the next scan because the filesystem remains authoritative.

Do not add hidden marker files merely to preserve empty directories. They would make the on-disk artifact less honest. Git users who need an empty directory tracked can add their own visible convention, but Notes should not invent one.

**Reading:** Identity is the `id`, never the path; the whole recursive scan is reconciled by id **before** anything is called removed; the filename fallback widens from a basename to the last known relative path; filename uniqueness is per folder; rename and move never touch each other; duplicate titles are legal, a bare ambiguous `[[Plan]]` is flagged rather than guessed, and `[[Work/Plan]]` is the qualified form; **no migration**; empty folders are real state, never auto-deleted, and get no marker file.

## Q3

**Question (Claude):**

Settled: identity is the id, reconcile the whole recursive scan by id before any removal, the filename fallback becomes the last known relative *path*, name uniqueness is per-folder, rename and move are independent, duplicate titles are legal, a bare ambiguous `[[Plan]]` is flagged rather than guessed, `[[Work/Plan]]` is the qualified form and a slash is what makes it one, no migration, empty folders are real and never auto-deleted, no `.gitkeep`-style marker files.

## Question 3 of five: what the user actually sees and touches

Now the surface. Three things to rule on, and I want a shape, not a range.

### The sidebar

Today the left rail is, top to bottom: **the search box**, **saved-search chips**, **the tag tree** (indented, clicking a tag filters and unfolds it), then **the note list** — flat, filtered by the search box, most-recently-updated first, with the selected row carrying a 2px `border-left` in the margin colour. That is the only accent in the app.

You have already said folders become the primary browsing tree and tags a separately labelled, collapsible secondary section. That leaves a real layout question, because the sidebar is one narrow column and it would now hold **two trees and a list**. Pick one:

**(A) Folder tree above the note list, tags below the list.** The rail reads top-down as: search → folders → notes in the chosen folder → tags. Folders are plainly the spine; tags become a filter you reach past the list for.

**(B) Folder tree replaces the note list's flatness — one tree containing both folders and the notes inside them,** the way Explorer's tree does. No separate list at all: notes are leaves. Tags stay where they are, below.

**(C) A switch at the top of the rail: Folders / Tags / All,** one tree at a time in the same space, with the note list always below it.

Say which, and say what the note list shows when a folder is selected: **only that folder's notes, or that folder and everything nested inside it?** (Note that the tag tree already made the *inclusive* choice — `#work` counts notes tagged `#work/clients/hale` — so an exclusive folder view would contradict the app's own precedent, and an inclusive one may make a top folder useless.) Also rule on whether the root is a row you can click ("All notes"? "Notes"?) or an implicit state.

### The commands

Every command in this app lives in one `ACTIONS` registry, which feeds the keyboard map, the shortcuts sheet, the command palette **and** the four pane menus (Note / Write / View / Window) built last round. A new command declares `menuSection` and optionally `pill` and appears in all four at once. There are 58 commands and 52 chords; the app is short of free ones.

**Name the complete set of folder commands** — the exact label each one shows, which of the four menus it belongs in, and whether it deserves a chord (and if so which; say "no chord" freely, the palette finds everything). Consider at least: move this note to a folder, new folder, rename a folder, delete a folder, reveal this note's folder in Explorer, go to the folder tree. Cut any of those you think should not exist.

Rule specifically on **how a note is moved**. The app is keyboard-first and its existing idiom for "choose a thing" is a **fuzzy-matched picker overlay** (that is how Ctrl+K finds a note, how the palette works, how aliases and merge-into work). Is moving a note a picker that fuzzy-matches folder paths and can create a folder by typing a new path — or is it drag-and-drop in the tree, or both? If you say drag, say it knowing that no part of this app has drag today and it would be the first.

### Where the folder is shown while you are writing

A note's pane has a header (title, then the pills and menus) and a margin that shows backlinks and outline. Right now nothing in the note view says where a note lives, because there was nowhere for it to live.

Does the folder appear in the note view at all, and if so where and how loud? A breadcrumb above the title? A quiet line in the margin? Nothing at all, on the grounds that you just came from the tree and know where you are? Remember: "ink and margin", no new accent colours, and the paper is meant to begin with the title.

**Answer (Codex):**

### Sidebar

Choose **(A): folder tree above the note list, tags below it**.

The rail becomes:

1. Search
2. Saved-search chips
3. **Folders** — labelled, always visible
4. Notes in the selected folder scope
5. **Tags** — labelled, collapsible, collapsed by default unless a tag filter is active

The folder tree contains directories only. Keeping notes in the existing list preserves fast scanning, updated-time sorting, pinned notes, and a stable selected-row treatment. Mixing folders and notes into one Explorer-style tree would sacrifice those strengths and make a busy notebook harder to scan.

Folder selection is **inclusive**: selecting `Work` shows notes in `Work` and every folder beneath it. Parent folders must behave like parent tags and represent their whole branch.

The root is an explicit first row named **All notes**. It is selected by default and shows the entire notebook. Although root is a valid physical filing location, labelling the row “Root” or “Notes” would not communicate that its view includes descendants.

When the selected scope contains nested folders, each note row gets a quiet secondary path such as `Clients / Hale`. Root-level notes have no secondary path. This distinguishes duplicate titles without weakening the title as the primary label.

### Commands

Add these seven commands:

| Label | Menu | Section | Chord |
|---|---|---|---|
| **New folder.** | Note | Create | No chord |
| **Move this note to a folder.** | Note | This note | `Ctrl+Alt+M` |
| **Show this note in Explorer.** | Note | This note | No chord |
| **Rename this folder.** | Note | Folders | No chord |
| **Move this folder.** | Note | Folders | No chord |
| **Delete this folder.** | Note | Folders | No chord |
| **Go to folders** | Window | Workspace | `Ctrl+Alt+F` |

Add the **Folders** section near the end of the Note menu, immediately before Library. Folder-sensitive commands are disabled when **All notes** is selected. The notebook root cannot be renamed, moved, or deleted.

Keep the existing **Open the notes folder** command in Library. It opens the notebook root; **Show this note in Explorer** opens Explorer with the current Markdown file selected.

No drag-and-drop in this release. It would introduce a second interaction model with unclear keyboard parity, drop targets, hover expansion, and accidental-move handling. Folder operations use the app’s established picker and prompt idioms.

**Move this note to a folder** opens a fuzzy picker of complete folder paths:

```text
Work
Work / Clients
Work / Clients / Hale
Archive / 2026
All notes (root)
```

Typing a path that does not exist adds one final choice:

> Create `Work / Clients / Hale` and move this note

Confirming creates every missing directory and moves the note. The picker rejects absolute paths, `.` and `..` segments, and anything that escapes the notebook.

**Move this folder** uses the same picker for the destination parent. It excludes the folder itself and all its descendants. **New folder** prompts for a root-relative path, initially scoped beneath the currently selected folder. **Rename this folder** changes only its final path segment.

### Location in the note view

Show a quiet breadcrumb **inside the pane header, directly beneath the title**, not in the paper body or margin:

```text
Work / Clients / Hale
```

A root-level note shows:

```text
All notes
```

Use the existing subdued ink, small type, and a single truncated line—no icon, badge, border, or accent colour. It is informational rather than a second title. Hovering shows the complete path.

The breadcrumb is clickable: it selects that folder in the sidebar and focuses the folder tree. Moving remains an explicit command, so an informational click cannot accidentally refile the note.

**Reading:** Shape **A** — the folder tree above the note list, tags below it — with an explicit **All notes** root row, inclusive folder scope matching the tag tree's own precedent, a quiet `Clients / Hale` path on note rows, seven commands (`Ctrl+Alt+M` to move, `Ctrl+Alt+F` to reach the tree, the rest chordless), **no drag this release**, a fuzzy picker of whole folder paths that can create as it goes, and a subdued clickable breadcrumb under the title in the pane header.

## Q4

**Question (Claude):**

Settled: shape (A) with an explicit **All notes** root row, inclusive folder selection, a quiet `Clients / Hale` path on note rows when the scope has nesting, seven commands with `Ctrl+Alt+M` and `Ctrl+Alt+F` (I checked — both are free), no drag this release, a picker of complete folder paths that can create as it goes, and a subdued clickable breadcrumb under the title in the pane header. I'll spell the picker-opening labels with the app's existing ellipsis convention (`Move this note…`, the way `Deleted notes…` and `Other names for this note…` are spelled) rather than a full stop.

## Question 4 of five: the other three surfaces, and the mechanics

The window is not the only thing that reads this notebook. Rule on each.

### 1. The search grammar

`src/core/query.ts` has fourteen operators, all of them lower-case and colon-terminated: `tag:wow`, `todo:`, `due:today`, `pinned:`, `untitled:`, `created:>7d`, `links:Title`, `from:Title`, `orphan:`, `sort:title`, `limit:5`, plus `-word`, `"a phrase"` and `/regex/i`. They are documented in one exported `OPERATORS` array that the search box's legend prints verbatim.

- **What is the folder operator?** `folder:Work/Clients`? `in:Work`? `path:`? Give the exact spelling and the exact one-line `means:` text as it will read in the legend beside the others.
- **Is it inclusive** (matching everything nested beneath), matching the folder-tree behaviour you just chose, and is there a way to ask for *only* this folder — or is that a distinction not worth an operator?
- **How do you ask for the root?** Notes filed nowhere is a real question. `folder:/`? `folder:.`?
- **Does the sidebar's folder selection type into the search box** the way clicking a saved search does, or is it separate state? The tag rail today is *separate* state (`tagFilter`) that ANDs with the query, while saved searches type into the box. Pick one and say why.
- Is there a `nested:`-style operator for "notes in a folder that has sub-folders", or anything else — or is one operator the whole grammar change? YAGNI applies.

### 2. The CLI

`notes` is a real command-line program with about forty subcommands, mirrored to the window over a named pipe when it is running: `notes new`, `notes list`, `notes search`, `notes show`, `notes edit`, `notes append`, `notes rename`, `notes delete`, `notes refile`, `notes section move`, `notes attach`, `notes export`, `notes import`, `notes history …`, `notes settings …`, `notes mcp`. Every one of them names a note by **id, title, title prefix, or filename** and assumes a flat namespace. Its README section is generated from the command definitions.

- **Which subcommands change, and how?** Be concrete. Does `notes new` take `--folder Work/Clients`? Does `notes list` grow a `--folder` filter, and does its output gain a path column? Does `notes show` print the folder?
- **What are the new subcommands?** I would expect at least `notes move <note> <folder>` and something for making and listing folders. Name them exactly, and say whether folders get their own noun group (`notes folder new|list|rename|move|delete`) or whether the verbs live at the top level. The existing style has both: `notes rename` is top-level, but `notes history …` and `notes settings …` are groups.
- **Does a note argument accept a path?** `notes show Work/Clients/Hale`, given that a bare title may now be ambiguous. And **what does the CLI do when a name is ambiguous** — today it resolves to one note; with duplicate titles legal it can no longer always do that. Exit non-zero with a list? Pick the first? (`src/core/ipc-protocol.ts` has an `EXIT` map of codes that scripts depend on; adding a code is fine, changing one is not.)

### 3. The MCP server

`notes mcp` serves the notebook to LLM clients. It exposes tools (`notes_search`, `notes_read`, `notes_create`, `notes_update`, `notes_delete`, `notes_list_tags`, `notes_list_links`, `notes_list_tasks`, `notes_add_to_inbox`) and resources at `notes://<id>`, with a resource template `notes://{id}`.

- **Does a note's folder appear in what the tools return?** (`notes_search` results, `notes_read`.)
- **Does `notes_create` take a folder?** Does anything let a model *move* a note — a `notes_move` tool, a `folder` field on `notes_update`, or nothing at all, on the grounds that filing is the human's job?
- **Is there a `notes_list_folders`,** to match `notes_list_tags`?
- **Do the resource URIs change?** They are `notes://<id>` today, which is stable under a move and I am inclined to leave alone — confirm or overrule.

### 4. Two mechanics I need ruled

- **The trash is one flat folder** (`trash/`, beside the notes, files stamped with a `deleted:` date). A note deleted from `Work/Clients/Hale` and then restored a week later — where does it come back to? Its old folder (which may no longer exist), or the root? Does the trash remember the path, and if so where, given that you ruled out putting folder membership in front matter?
- **What is a folder *called*, exactly?** A directory name on disk has the same character restrictions a filename does (`fileNameFor` strips `<>:"/\|?*`, trims trailing dots and spaces, refuses `CON`/`PRN`/`NUL`, caps at 80 characters). Do folder names go through the same sanitiser — meaning a user who types `Q1/Q2` gets something they did not ask for — or does the picker *reject* an unusable name and say so? And is a folder's name case-sensitive, given Windows says no and git says yes?

**Answer (Codex):**

## 1. Search grammar

Add one operator:

```text
folder:Work/Clients
```

Its exact legend text is:

> `folder:path` — in this folder or one beneath it

The match is inclusive. `folder:Work` includes `Work` and every descendant. Do not add an exact-folder variant in this release.

Use:

```text
folder:/
```

to match only root-level notes. The notebook root has no descendants as a folder value here; `/` specifically means “filed directly at the root,” while an empty folder filter means All notes.

Folder selection remains separate state, like `tagFilter`; it does not type into or rewrite the search box. The selected folder scope ANDs with the query and any selected tag. This preserves a user’s query while they browse different branches. The explicit `folder:` operator exists for saved searches and typed compound queries.

One operator is the entire grammar change. No `nested:`, `depth:`, or exact-folder operator.

## 2. CLI

### Existing commands

Make these changes:

- `notes new [title] --folder <path>` creates in that folder; default is root. The folder must already exist.
- `notes import <files...> --folder <path>` imports into that folder; default is root.
- `notes list --folder <path>` filters inclusively. `--folder /` lists only root-level notes.
- `notes search` supports the new `folder:` query operator.
- `notes show`, `notes list`, and search results include `folder` and `path` in structured output.
- Human-readable `notes list` and `notes search` gain a quiet `folder` column, displaying `/` for root.
- Plain-text `notes show` remains the note body only, so piping it into another command does not change. Its JSON output includes `folder` and `path`.
- Any command that accepts a note selector gains path-qualified resolution.

`folder` is the root-relative directory, such as `Work/Clients`. `path` is the root-relative Markdown path, such as `Work/Clients/Hale.md`.

### New commands

Use one top-level note operation:

```text
notes move <note> <folder>
```

This moves a whole note. `<folder>` must already exist; `/` means root. The command reports the resulting path.

Give folder administration its own noun group:

```text
notes folder list
notes folder new <path>
notes folder rename <folder> <name>
notes folder move <folder> <destination>
notes folder delete <folder>
```

Rules:

- `folder list` lists every folder, including empty folders, with note counts both direct and recursive.
- `folder new` creates every missing segment in the supplied path.
- `folder rename` changes the final segment only.
- `folder move` reparents the complete subtree and refuses self-descendant destinations.
- `folder delete` deletes only an empty folder. There is no recursive or force form in this release.
- `/` cannot be renamed, moved, or deleted.

### Note resolution

A note argument accepts an exact root-relative path, with `.md` optional:

```text
notes show Work/Clients/Hale
notes show "Work/Clients/Hale.md"
```

A selector containing `/` is interpreted as a path. Otherwise the existing ID, title, alias, filename, and title-prefix resolution applies.

If a title, alias, filename, or prefix matches multiple notes, the CLI exits non-zero with a dedicated new **ambiguous** exit code. Human-readable output lists each candidate’s title, relative path, and ID; JSON output returns the same candidates structurally. It never chooses the first candidate.

## 3. MCP server

Folders become visible and operable, but resource identity does not change.

- `notes_search` results include `folder` and `path`.
- `notes_read` includes `folder` and `path`.
- `notes_create` accepts an optional `folder`; omitted means root. It requires an existing folder.
- Add `notes_move` with `id` and `folder`. Keep moving separate from `notes_update`, because a filesystem move deserves an explicit tool call and result.
- Add `notes_list_folders`, returning each folder’s path plus direct and recursive note counts.
- Search queries accepted by MCP support `folder:` through the shared grammar.
- `notes_add_to_inbox` does not change; “Inbox” remains the existing note workflow, not an implicit directory.

Resource URIs remain:

```text
notes://<id>
```

The template remains `notes://{id}`. IDs survive moves; paths do not belong in resource identity.

## 4. Mechanics

### Trash and restoration

Trash preserves the deleted note’s relative directory structure:

```text
notes/Work/Clients/Hale/Plan.md
    ↓
trash/Work/Clients/Hale/Plan.md
```

The existing `deleted:` timestamp remains in front matter, but no folder field is added.

Restoring puts the note back into its former folder and recreates missing directories. If the destination filename is occupied, restoration uses the normal per-folder collision rule, producing `Plan 2.md`. The ID remains unchanged.

Trash scanning therefore also becomes recursive. Notes must not flatten deleted files or depend on a private sidecar index to remember their origin.

### Folder names

Folder paths are sequences of validated directory-name segments. Do not silently sanitise user input.

- In a path-entry surface, `/` separates folders: `Q1/Q2` intentionally creates or addresses `Q1` then `Q2`.
- In a single-name surface such as **Rename this folder**, `/` is invalid.
- Reject Windows-invalid characters, reserved device names, empty segments, `.` and `..`, trailing dots or spaces, and segments longer than 80 characters.
- Show the invalid segment and reason; do not quietly transform it into another name.

Folder identity and collision checks are case-insensitive, matching Windows. Preserve the user’s chosen casing for display and disk. Allow an explicit case-only rename, but never allow sibling folders that differ only by case.

**Reading:** One operator, `folder:path`, inclusive, with `folder:/` for the root, kept as separate ANDing state rather than typed into the search box; `--folder` on `new`/`import`/`list`, a top-level `notes move`, a `notes folder …` group, a slash in a selector meaning a path, and a new **ambiguous** exit code that lists candidates and never guesses; MCP gains `folder`/`path`, `notes_move` and `notes_list_folders` while `notes://<id>` is left alone; the trash mirrors the tree and restore rebuilds it; names are validated and reported, never silently sanitised.

## Q5

**Question (Claude):**

Settled: one operator `folder:path` — "in this folder or one beneath it", `folder:/` for root only, folder scope stays separate state that ANDs; `--folder` on `new`/`import`/`list`, `folder` and `path` in structured output, `notes move <note> <folder>` top-level plus a `notes folder …` group, a slash in a selector means a path, a new ambiguous exit code that lists candidates and never guesses; MCP gains `folder`/`path` in results, an optional `folder` on `notes_create`, `notes_move`, `notes_list_folders`, and `notes://<id>` is unchanged; the trash mirrors the tree and restore recreates it; names are validated and never silently sanitised, case-insensitive collisions, casing preserved.

## Question 5 of five: the loose ends, and what to call it

Six things, then the name.

### 1. What the recursive scan must NOT pick up

The notes folder is not only notes. When the notebook has been moved somewhere of its own — OneDrive, a git checkout — **`attachments/` lives inside it** (`pathsFor` puts it at `<vault>/attachments`), holding images and files pasted into notes. A recursive scan would present it as a folder in the tree, and any `.md` in it as a note.

Rule on the exclusion, and make it a rule rather than a special case if you can: is it just `attachments/`, or is it "any folder whose name starts with a dot" (which would skip `.git`, `.obsidian`, `.trash`) plus `attachments/`? Say exactly what is skipped, and say whether the *user* can see that these skipped folders exist or whether they are simply invisible.

### 2. The tree when there are no folders

Every existing notebook has zero folders on the day this ships. The rail would show a **Folders** section containing one row, **All notes**, and nothing else — a heading and a tautology, sitting above the note list forever for anyone who never files anything.

Does the Folders section hide itself entirely until the first folder exists (the way the tag rail hides when there are no tags, and the saved-search chips hide when there are none)? Or does it always show, because an empty tree is how you learn the feature is there? If it hides, how does a first-timer make their first folder — the palette and the Note menu only?

### 3. Which state is remembered

The app remembers a lot across restarts: the open tabs, the panes, the query, the selected note. **Is the selected folder remembered across a restart?** And **is it per-pane or per-window?** Up to three panes can be open side by side, but there is only one sidebar — so the folder scope is inherently window-level state, unlike the note a pane shows. Confirm that, or overrule it.

Also: when a note is opened that is *outside* the current folder scope — from a `[[link]]`, from the palette, from `notes open` on the command line — does the folder scope follow the note (jumping the tree to where that note lives) or stay put while a note from elsewhere sits in the pane?

### 4. Folders made outside the app

Someone will make a folder in Explorer and drop a `.md` in it, or `git pull` a whole tree. The watcher notices, with its 700ms settle. Is a folder that appears from outside simply a folder, no ceremony? And **does the app write anything at all into a folder it did not make** — beyond stamping an id into a note file that lacks one, which it already does anywhere?

### 5. History

Every note's versions are kept in `history/`, keyed by id, in the *userData* folder rather than beside the notes. Since identity survives a move, I believe history needs **no change whatsoever** — a moved note keeps its versions because it keeps its id. Confirm that, or say what I am missing.

### 6. The one thing most likely to go wrong

You know this design now. **Name the single failure mode you are most worried about**, and say what the app should do to make it survivable — not preventable, survivable. I will build a specific test for whatever you name.

### The name

Every round gets a title, in the voice of the others: "Where the notes live, an MCP server, a web clipper, and tables", "The MCP server reviewed against the protocol", "Commands come out from behind their shortcuts". This is 0.22.0. **Give it its title.**

**Answer (Codex):**

## 1. Recursive-scan exclusions

Use a general traversal rule:

- Skip every directory whose name begins with `.` at any depth, including `.git`, `.obsidian`, and `.trash`.
- Skip the exact top-level directory returned as `paths.attachments`.
- Do not follow directory symlinks, junctions, or other reparse points.
- Ignore non-Markdown files, but otherwise retain their ordinary parent directories as folders.

A user-created nested folder named `attachments` is ordinary; only the notebook’s reserved top-level attachment directory is excluded.

Skipped directories and everything beneath them are completely invisible in Notes: absent from the folder tree, folder commands, scans, counts, search, CLI, and MCP. Notes never treats a `.md` file inside one as a note.

## 2. An empty folder tree

Always show the **Folders** section.

With no folders, it contains:

```text
Folders                         +
  All notes
```

The restrained `+` button invokes the registry’s **New folder…** action and has that full label in its tooltip and accessible name. It is not a separate command or configuration table.

The small amount of apparently redundant UI is worthwhile: folders were explicitly requested, and hiding their only visible surface until someone discovers the palette would make the feature feel absent.

## 3. Remembered state

The selected folder is window-level state because there is one sidebar. It is not per-pane.

Persist it across restarts alongside the existing window UI state. If the remembered folder no longer exists, fall back to **All notes**.

Opening a note outside the current folder scope does **not** change that scope, whether it came from a wiki link, command palette, recent notes, CLI, backlink, or graph. Navigation must not destroy the place the user was browsing.

The out-of-scope note may therefore appear in a pane without appearing in the current note list. Its breadcrumb explains where it lives; clicking that breadcrumb selects its folder and brings it into the list.

## 4. Externally created folders

A valid directory created through Explorer, OneDrive, git, or another editor becomes a folder without ceremony on the next settled scan. Empty external directories also appear.

Notes writes nothing into a directory merely because it discovered it. It creates no manifest, marker, metadata file, or hidden state there.

The only existing exception remains: a discovered Markdown note without an ID is stamped with one. Subsequent user edits and explicit folder operations may naturally write or move the affected Markdown files.

## 5. History

History requires no path-model change.

It remains in `userData/history`, keyed only by note ID. Moving or renaming a note preserves its ID, so every snapshot remains attached without being copied, renamed, or rewritten.

History displays should show the note’s **current** folder, not pretend each snapshot recorded a historical path. This release does not add path history.

## 6. Most concerning failure mode

The highest-risk failure is a multi-step external move being observed as separate snapshots:

1. OneDrive removes `Plan.md`.
2. Notes scans before `Work/Plan.md` arrives.
3. A later scan sees the destination.

That must remain survivable even if no single scan contains both paths.

Change the lifecycle rule accordingly:

> Only an explicit delete performed through Notes moves a note into trash. A file that disappears during an external scan becomes persistently “missing,” never automatically trashed or stripped of its identity.

Keep a small persistent missing-note record in `userData`, keyed by ID, containing its last relative path and disappearance time. Retain its history during the same 30-day recovery window used for trash.

If a later scan finds that ID at another path, reconnect it as the same note, clear the missing record, and preserve its history. If it returns at the same path, treat that identically. Missing records expire after 30 days if the file never returns.

The specific survival test should be:

> Scan `Plan.md` with ID `abc`; scan an empty notebook; restart the store; scan `Work/Plan.md` with ID `abc`; assert that the live note still has ID `abc`, its history remains, its path is `Work/Plan.md`, and no trash entry or duplicate note was created.

## Release title

**Folders: every note has somewhere to live**

**Reading:** Dot-prefixed directories and the reserved top-level `attachments/` are wholly invisible; the Folders section always shows, with a restrained `+`; scope is window-level, remembered, and never moved by opening a note from elsewhere; an externally made folder needs no ceremony and gets nothing written into it; history needs no change at all; and the failure to survive is **the two-part external move** — a file that disappears from a scan must become a persistent *missing* record rather than being trashed. The round is called **Folders: every note has somewhere to live**.
