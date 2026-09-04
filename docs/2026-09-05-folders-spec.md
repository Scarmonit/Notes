# Folders — the settled design (0.22.0)

Brainstormed 2026-09-05 with Codex CLI as the answering product owner. The verbatim
question-and-answer is in `2026-09-05-folders-brainstorm.md`; this file is what gets built.

Release title: **Folders: every note has somewhere to live**

## The problem, as diagnosed

The user asked whether the app could make folders. It could not: the notebook is one flat
directory of `.md` files. The question worth settling first was whether it needed folders
at all, because the app already has a nested tree — `tagTree()` builds one out of
`#work/clients/hale` and the sidebar already draws it, indented, unfolding as you go.

Codex ruled that the missing thing is neither hierarchy nor exclusivity but **a place**:
somewhere a note *lives*, that you move it to and browse, rather than a property it
carries. Its sharpest line: filing by tag leaves "three unrelated files in one growing
pile" in Explorer, and "neither action makes the file itself feel put away". A second
virtual hierarchy would improve the presentation while leaving the actual flat notebook
untouched.

So this is **real nested directories on disk**, and the two systems get separate jobs:

- **Folders answer "where does this note live?"** — exclusive, physical, one per note.
- **Tags answer "what is true about this note?"** — non-exclusive, cross-cutting.

Mirrored structures (`Work/Clients/Hale/` *and* `#work/clients/hale`) are the duplication
folders exist to eliminate, so nothing in the design encourages them.

## The on-disk model

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

**Folder membership is the relative path and nothing else.** It is not duplicated into
front matter — the filesystem is the single authority, so a move made in Explorer, by
OneDrive or by `git pull` is indistinguishable from one made in the app.

The **root stays a permanent valid location**, not a temporary inbox. There is **no
migration**: on the first launch after this ships every existing note is exactly where it
was, with the same id, title, filename, history and links.

**Empty folders are real state.** "New folder" makes a directory immediately; a folder is
never created implicitly by filing and never auto-deleted when its last note leaves. No
`.gitkeep`-style marker file is written to preserve one — that would make the on-disk
artifact less honest. A folder pruned externally simply disappears on the next scan.

### What the scan does not see

The recursive scan skips, at any depth:

- every directory whose name begins with `.` (`.git`, `.obsidian`, `.trash`);
- the one top-level directory `pathsFor` calls `attachments` (a *nested* folder someone
  names `attachments` is ordinary);
- directory symlinks, junctions and other reparse points, which are not followed.

Skipped directories and everything beneath them are **wholly invisible** — absent from the
tree, the counts, search, the CLI and MCP. A `.md` inside one is never a note.

## Identity: the rule that keeps the notebook intact

This is the dangerous part, and it is stated as one implementable rule:

> Reconcile the complete scan by id before processing removals: if an indexed id appears
> once at a new path and its old path is absent, it is the same note moved; if the old path
> still exists, it retains the id and every additional file carrying that id is a copy that
> receives a fresh id.

Consequences:

- **Identity is the front-matter `id`. The relative path is mutable location, never identity.**
- The filename fallback for a file that lost its front matter widens from a basename to
  the **last known relative path**.
- **No file may be marked removed until the whole recursive scan has been parsed** and
  moves, copies and missing-id fallbacks have been reconciled.
- Filename uniqueness is **per folder**, not per notebook. Moving `Plan.md` into a folder
  that already holds one produces `Plan 2.md` with the title still "Plan" — no prompt, no
  refusal, the existing deterministic collision rule.
- **Renaming and moving are independent.** A rename may rename the file but never changes
  the folder; a move changes the folder but never the title. Both preserve id and history.

### Missing notes, and the failure this design is built to survive

The failure mode Codex named as most worrying is a **two-part external move**: OneDrive
removes `Plan.md`, a scan lands in the gap, and `Work/Plan.md` only arrives later. No
single scan contains both paths.

Today an id whose file is gone is simply dropped from the index — and the history sweep
(`sweepDeleted` in `src/core/history.ts`) then deletes every version of a note that is
neither live nor in the trash. The note's history is lost in that gap.

So the lifecycle rule changes:

> Only an explicit delete performed through Notes moves a note into the trash. A file that
> disappears during an external scan becomes persistently **missing** — never automatically
> trashed, never stripped of its identity.

A small persistent record in `userData` (`missing.json`), keyed by id, holds the note's
last relative path and the moment it vanished. Its history is kept for the same 30-day
window the trash uses. If a later scan finds that id at any path — the same one or another
— it is reconnected as the same note and the record is cleared. Records expire after 30
days.

The survival test, verbatim from Codex, is the acceptance test for this whole release:

> Scan `Plan.md` with id `abc`; scan an empty notebook; restart the store; scan
> `Work/Plan.md` with id `abc`; assert that the live note still has id `abc`, its history
> remains, its path is `Work/Plan.md`, and no trash entry or duplicate note was created.

## Links

Duplicate titles in different folders are **legal** — that is half the point of folders.

- A bare `[[Plan]]` resolves only when `Plan` identifies exactly one note by title or alias
  across the notebook. When several match, the link is **ambiguous and flagged**, never
  silently resolved to the first found or the nearest in the tree; either would make a
  link's meaning depend on traversal order or incidental location.
- `[[Work/Plan]]` is the **path-qualified** form: root-relative, `.md` omitted, resolving
  to that physical note. **A slash is what makes a link a path**; without one, existing
  title-or-alias resolution is unchanged.
- When the app inserts a link to an ambiguous title, it inserts the qualified form.
  Existing unique links stay short. Path-qualified links are explicit disambiguation, not
  a migration of every link into a path.

## The sidebar

Top to bottom:

1. Search box
2. Saved-search chips
3. **Folders** — labelled, always visible
4. The note list, in the selected scope
5. **Tags** — labelled, collapsible, collapsed by default unless a tag filter is active

Chosen over an Explorer-style single tree of folders-and-notes: keeping the note list
preserves fast scanning, updated-time sorting, pinned notes and the stable selected-row
treatment.

- The tree contains **directories only**.
- **Folder selection is inclusive**: `Work` shows `Work` and every folder beneath it,
  exactly as `#work` counts a note tagged `#work/clients/hale`.
- The root is an explicit first row named **All notes**, selected by default. ("Root" or
  "Notes" would not convey that the view includes descendants.)
- When the selected scope contains nested folders, each note row carries a quiet secondary
  path — `Clients / Hale`. Root-level notes carry none. This tells duplicate titles apart
  without weakening the title as the primary label.
- The section is **always shown**, even with no folders, where it is just `All notes` plus
  a restrained `+` whose accessible name and tooltip are the full **New folder…** label.
  Hiding the feature's only visible surface until someone found the palette would make a
  feature the user explicitly asked for feel absent.

**Folder scope is separate state**, like `tagFilter`, and ANDs with the query and the tag
filter. It does not type into the search box the way a saved search does — browsing a
branch must not destroy a query. The `folder:` operator exists for saved searches and
typed compound queries.

Scope is **window-level** (there is one sidebar and up to three panes), remembered across
restarts, and falls back to **All notes** when the remembered folder is gone. Opening a
note from outside the scope — a `[[link]]`, the palette, a backlink, `notes open` —
**does not move the scope**. The note appears in its pane without appearing in the list;
its breadcrumb says where it lives, and clicking that breadcrumb brings it into view.

## The note view

A quiet breadcrumb **inside the pane header, directly beneath the title** — not in the
paper, not in the margin:

```text
Work / Clients / Hale
```

A root-level note reads `All notes`. Existing subdued ink, small type, one truncated line,
the full path on hover. No icon, badge, border or accent colour; it is informational, not a
second title. Clicking it selects that folder in the sidebar and focuses the tree. Moving
stays an explicit command, so an informational click can never refile a note by accident.

## The commands

All seven join the one `ACTIONS` registry and therefore appear in the keyboard map, the
shortcuts sheet, the palette and the pane menus at once. A new **Folders** section sits in
the Note menu immediately before Library.

| Label | Menu | Section | Chord |
|---|---|---|---|
| New folder… | Note | Create | *(no chord)* |
| Move this note… | Note | This note | `Ctrl+Alt+M` |
| Show this note in Explorer | Note | This note | *(no chord)* |
| Rename this folder… | Note | Folders | *(no chord)* |
| Move this folder… | Note | Folders | *(no chord)* |
| Delete this folder | Note | Folders | *(no chord)* |
| Go to folders | Window | Workspace | `Ctrl+Alt+F` |

Both chords were free. Picker-opening labels take the app's existing ellipsis, the way
`Deleted notes…` and `Other names for this note…` are spelled.

The three folder commands are disabled while **All notes** is selected; the root cannot be
renamed, moved or deleted. The existing **Open the notes folder** stays in Library and
still opens the notebook root — **Show this note in Explorer** selects the note's own file.

**No drag-and-drop this release.** It would introduce a second interaction model with
unclear keyboard parity, drop targets, hover expansion and accidental-move handling. Folder
operations use the app's established picker and prompt idioms.

**Move this note…** opens a fuzzy picker of complete folder paths:

```text
Work
Work / Clients
Work / Clients / Hale
Archive / 2026
All notes (root)
```

Typing a path that does not exist adds one final choice — *Create `Work / Clients / Hale`
and move this note* — which creates every missing segment and moves the note. The picker
rejects absolute paths, `.` and `..` segments, and anything escaping the notebook.

**Move this folder…** uses the same picker for the destination parent, excluding the folder
itself and all its descendants. **New folder…** prompts for a root-relative path, scoped
beneath the selected folder to begin with. **Rename this folder…** changes the final
segment only.

## Folder names

Folder paths are sequences of validated segments, and input is **never silently
sanitised** — unlike `fileNameFor`, which quietly rewrites a title into a filename.

- In a path-entry surface, `/` separates folders: `Q1/Q2` deliberately means `Q1` then `Q2`.
- In a single-name surface such as **Rename this folder…**, `/` is invalid.
- Rejected: Windows-invalid characters, reserved device names, empty segments, `.` and
  `..`, trailing dots or spaces, and segments over 80 characters.
- The error names the offending segment and the reason; it never offers a different name
  instead.
- Collision checks are **case-insensitive**, matching Windows, while the user's chosen
  casing is preserved on disk and on screen. A case-only rename is allowed; two siblings
  differing only by case are not.

## Search

One operator, and one only:

| Operator | Means |
|---|---|
| `folder:path` | in this folder or one beneath it |

`folder:/` matches only notes filed directly at the root. No `nested:`, no `depth:`, no
exact-folder variant this release.

## The command line

`folder` is the root-relative directory (`Work/Clients`); `path` is the root-relative
markdown path (`Work/Clients/Hale.md`).

Changed:

- `notes new [title] --folder <path>` — the folder must already exist; default is root.
- `notes import <files...> --folder <path>` — likewise.
- `notes list --folder <path>` — inclusive; `--folder /` lists only root-level notes.
- `notes search` understands `folder:` through the shared grammar.
- `notes show`, `notes list` and search results carry `folder` and `path` in structured
  output; the human-readable listings gain a quiet folder column showing `/` for root.
- **Plain-text `notes show` stays the body alone**, so piping it is unchanged. Its JSON
  gains `folder` and `path`.

New:

```text
notes move <note> <folder>          # the folder must exist; / means root; reports the new path

notes folder list                   # every folder, empty ones included, with direct and recursive counts
notes folder new <path>             # creates every missing segment
notes folder rename <folder> <name> # the final segment only
notes folder move <folder> <dest>   # reparents the subtree; refuses a self-descendant destination
notes folder delete <folder>        # empty folders only — no recursive or force form this release
```

`/` cannot be renamed, moved or deleted.

**Note resolution:** a selector containing `/` is a root-relative path, with `.md` optional
(`notes show Work/Clients/Hale`). Otherwise the existing id / title / alias / filename /
title-prefix resolution applies. When a name matches several notes the CLI exits non-zero
with a new **`ambiguous`** code, listing each candidate's title, relative path and id
(structurally in JSON). It never picks the first. The existing codes in
`src/core/ipc-protocol.ts` are untouched.

## The MCP server

Folders become visible and operable; resource identity does not change.

- `notes_search` results and `notes_read` carry `folder` and `path`.
- `notes_create` takes an optional `folder`, defaulting to root, which must already exist.
- **`notes_move`** (`id`, `folder`) is a new tool. Moving stays out of `notes_update`: a
  filesystem move deserves an explicit call and an explicit result.
- **`notes_list_folders`** returns each folder's path with direct and recursive counts, to
  match `notes_list_tags`.
- Queries support `folder:` through the shared grammar.
- `notes_add_to_inbox` is unchanged — "Inbox" stays a note workflow, not an implicit
  directory.
- **`notes://<id>` and the `notes://{id}` template are unchanged.** Ids survive moves;
  paths do not belong in resource identity.

## The trash

The trash mirrors the tree:

```text
notes/Work/Clients/Hale/Plan.md   →   trash/Work/Clients/Hale/Plan.md
```

The `deleted:` front-matter timestamp is unchanged and no folder field is added. Restoring
puts a note back in its former folder, recreating missing directories, keeping its id, and
falling back to the per-folder collision rule if the name is taken. Trash scanning becomes
recursive; deleted files are never flattened and no private sidecar index remembers where
they came from.

## History

**No change.** History stays in `userData/history`, keyed by id alone, so a moved or
renamed note keeps every snapshot without anything being copied or rewritten. A history
view shows the note's *current* folder rather than pretending each snapshot recorded a
path; path history is not in this release.

The one adjacent change is the missing-note record above, which exists precisely so the
sweep cannot delete the history of a note that is mid-move.

## Externally made folders

A valid directory made in Explorer, by OneDrive, by git or by another editor becomes a
folder with no ceremony on the next settled scan, empty ones included. **Notes writes
nothing into a directory merely because it found one** — no manifest, marker, metadata or
hidden state. The single existing exception stands: a discovered markdown note without an
id is stamped with one.

## Explicitly not in this release

- Drag-and-drop in the tree.
- An exact-folder search operator, `nested:` or `depth:`.
- Recursive or forced folder deletion.
- Path history for snapshots.
- Folder membership in front matter, or any marker file for empty folders.
- Turning existing links into paths.
