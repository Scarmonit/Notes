# Notes 0.15.0: keeping a grown notebook (2026-09-03)

Spec for the 0.15.0 feature round, brainstormed with Codex CLI as the product owner (the questions and answers are in `2026-09-03-feature-brainstorm.md`). Three problems, in priority order: refiling captured lines into the note they belong to, finding the way back after following links, and structural changes (rename, tag rename, move a section, merge) that today mean leaving Notes for an editor.

Release-day acceptance tests:

1. **Refiling.** Put three checklist items in Inbox, then, keyboard only, move each beneath a chosen heading in another note. Each disappears from Inbox and arrives unchanged in the right section.
2. **Navigation.** Follow three `[[links]]`, press `Alt+Left` three times, land on the original paragraph with the caret and scroll where they were.
3. **Refactors.** Without another editor: rename a linked note, rename a tag across the notebook, move one heading with its contents, merge a duplicate note. Every affected file and link holds the expected plain text. The same four operations run from `notes`.

## 1. Core: `src/core/refactor.ts`

Pure, synchronous, no I/O. Planners read every note and return a Plan; each environment applies it. Only notes that change appear in a Plan. No index, cache, cap or warning: a few thousand string scans are within budget.

### Types

```ts
interface Write { id: string; before: { body: string; title?: string }; after: { body: string; title?: string } }
interface Plan {
  kind: 'refile' | 'move-section' | 'rename' | 'tag-rename' | 'merge';
  writes: Write[];          // one entry per changed note; the merge source is never here
  trash: Array<{ id: string; before: { body: string; title?: string } }>;   // moved to the trash after the writes; `before` is checked like a write's
  summary: { notes: number; links?: number; tags?: number; lines?: number };
  touched: Array<{ id: string; title: string; changes: ChangeKind[] }>;   // every effect on that note, e.g. a merge destination: ['text added', 'links rewritten']
  select?: string;          // the note the window should show afterwards (merge: the destination)
}
type PlanResult = { ok: true; plan: Plan } | { ok: false; code: PlanErrorCode; message: string };
type PlanErrorCode = 'not_found' | 'same_note' | 'heading_not_found' | 'not_in_section' | 'bad_tag' | 'nothing_selected' | 'nothing_to_do';
type ChangeKind = 'text added' | 'lines removed' | 'links rewritten' | 'tags rewritten' | 'renamed' | 'trashed';
type Target = { line: number } | 'top' | 'end';   // a heading by the line it stands on
```

`describePlan(plan)` gives the one sentence both the confirm sheet and the CLI print, e.g. "Rename 'Old' to 'New' and update 4 links in 3 notes". `checkPlan(plan, notes)` returns `{ ok: true }` or `{ ok: false, code: 'stale', message }` when any write's or trash entry's `before` no longer matches the live note (or the note is gone): a merge confirmed after its source was edited is refused, not applied over the edit. `--force` never bypasses this check.

### Planners

- **`insert(body, addition, { prepend?, heading?, target?, inline? })`** moves here from `src/cli/commands/notes.ts` unchanged in behaviour (the CLI re-exports it): under a heading it lands at the end of that heading's section (the lines up to the next heading of any level), a missing heading is created as `## Heading` at the end. A `target` of `{ line }` names an exact heading, for the window.
- **`planRefile(notes, { from, first, last, to, target, createHeading? })`**: cuts lines `first..last` (0-based, inclusive) from `from`, leaving at most one blank line where they were, and inserts them in `to` at `target` (`createHeading` is the name of a heading to create when `target` is `'end'` under a new heading). The moved lines' characters are identical; the newlines around them may differ. Same-note moves are allowed when the target heading lies outside the moved range: the destination line is resolved before the cut and translated afterwards. `summary.lines` counts the moved lines.
- **`planMoveSection(notes, { from, line, to, target, createHeading? })`**: the section is the nearest heading at or above `line`, through the line before the next heading of the same or a higher level (or the end). Headings keep their levels. Delegates to `planRefile`. Caret above the first heading: `not_in_section`.
- **`planRename(notes, { id, title, links })`**: sets the explicit title. With `links`, rewrites `[[Old]]` and `[[Old|alias]]` to `[[New]]` / `[[New|alias]]` in every note including this one; matching is `linkKey` (trimmed, case-insensitive) on the note's current title. `summary.links` counts rewrites. The note's own write carries both the title and its body rewrite as one mutation.
- **`planTagRename(notes, { from, to })`**: whole-token, case-insensitive rewrite of `#from` and `#from/child` to `#to` / `#to/child`, wherever `tagsOf` would count them (so a `#from` inside a word or a URL, or wherever `tagsOf` already ignores it, stays). `to` must be a tag name: no spaces, no leading `#`, else `bad_tag`. `summary.tags` counts rewrites.
- **`planMerge(notes, { source, into })`**: builds the destination body: source body appended as a paragraph, prefixed by `## <source title>` unless the source's first non-blank line is a heading whose text equals its title (case-insensitive). Then links to the source's title are rewritten to the destination's title in every surviving note (the destination's write already includes the merged text). The source goes in `trash` with its `before`; it never appears in `writes`. `same_note` when source equals destination. `select` = destination.

## 2. Window

### Modules

- `src/renderer/journey.ts` (pure, tested): the back/forward stack. `Place { id, caret, scroll, hash }`; `push`, `back`, `forward`, cap 100, consecutive entries for the same note collapse into the latest. `hash` is a cheap string hash of the body.
- `src/renderer/apply-refactor.ts` (pure over a small adapter, tested): `applyPlan(plan, ctx)` runs `checkPlan`, then one mutation per note through the adapter (`update(id, { body, title })`, `trash(id)`, `restore(id)`), and registers one **undo group**: an entry in every touched note's edit log carrying the group id and each note's `before`. `undoGroup(groupId, ctx)` checks every touched note still equals its `after` (else refuses: "changed meanwhile") and reverts them all, restoring a trashed merge source with them; redo is the same in the other direction (the app already has Ctrl+Y). Ctrl+Z on any note whose top undo entry belongs to a group runs the group.
- `src/renderer/refactor-ui.ts`: the flows below, built on `openPicker` and two new sheets, taking an adapter (`notes()`, `selected()`, `selection()`, `apply(plan)`, `status(text)`, `focusEditor()`). `main.ts` only registers the `ACTIONS` and supplies the adapter.

### Commands (`ACTIONS` entries: palette and shortcut sheet come for free)

| id | label | chord | group |
| --- | --- | --- | --- |
| `move-lines` | Move lines to another note… | Ctrl+Shift+V | Writing |
| `move-section` | Move this section to another note… | — | Writing |
| `tag-rename` | Rename a tag everywhere… | — | Notes |
| `merge-into` | Merge this note into another… | — | Notes |
| `back` | Back | Alt+Left | Notes |
| `forward` | Forward | Alt+Right | Notes |
| `recent` | Recent notes… | Ctrl+Shift+B | Notes |

**Move lines / move section.** The selected lines, else the caret line (move section: the section around the caret, `not_in_section` shows "Put the caret in a section first"). Picker 1: every note (title, snippet), the current note included, the session's last destination preselected. Picker 2, placeholder "Move 2 lines under which heading?": a summary row naming the destination, then "Top of the note", "End of the note", every heading indented by level with its line number as the hint, and, whenever the typed text matches no heading exactly, "Create '<typed>' at the end" as the last row. Same-note headings inside the moved range are disabled. The last heading is remembered too, so Enter, Enter repeats the last filing. Enter applies the Plan; the caret stays on the line where the cut was; status "Moved 2 lines to 'Project' › 'Ideas'". The second picker is the confirmation; there is no third dialog. The remembered destination is forgotten when the app exits and ignored if the note or heading is gone.

**Rename a tag.** Picker of every tag in use with counts, then the prompt sheet "Rename #old to" prefilled with `old`; Enter builds `planTagRename` and opens the confirm sheet.

**Merge.** Picker of every other note, then the confirm sheet. Afterwards the destination is selected and the source is in the trash.

**Rename with links.** No new command. While the title box has focus the typed text is provisional UI state: the list item and the heading show it, but the note's title, persistence, history and the Plan precondition stay at the focus-time title until Enter or blur resolves it. On commit with a changed title and at least one `[[link]]` to the old title anywhere, the renamed note included, the Plan is built against that focus-time title and the confirm sheet opens: "Update 4 links in 3 notes to 'New'?" Enter applies that Plan; Esc applies a title-only Plan. Either way the title change is one undoable step.

**Confirm sheet** (new, shared, same card and tokens as the history sheet, no new colour): the `describePlan` sentence, an "n notes" row that Space or → expands into the `touched` titles with every one of their `changes`, Enter applies, Esc cancels and returns focus to the editor. A stale Plan shows "That note changed meanwhile; try again".

**Prompt sheet** (new): one labelled input, Enter/Esc.

**Navigation.** `select()` pushes the place being left (id, caret, editor scroll, body hash) unless the call comes from back/forward. Back/forward re-select and restore the caret only when the hash still matches; otherwise the note and the scroll only. Mouse buttons 3 and 4 run the same two actions from one `mouseup` listener. `enabled()` reflects the stack. **Recent notes** persists `[{ id, at }]` (20 entries) in the UI localStorage state; the picker lists them most recent first (title, relative time), dropping ids that no longer exist when it opens.

## 3. Command line: `src/cli/commands/refactor.ts`

| Command | Behaviour |
| --- | --- |
| `notes refile <from> <to> (--lines N[-M] \| --match <words>) [--under <heading> \| --top] [--dry-run]` | `--lines` 1-based inclusive; `--match` picks the first line containing all the words (case-insensitive), exit 3 when none. A missing `--under` heading is created. Default: end of the note. |
| `notes section move <from> <heading> <to> [--under <heading> \| --top] [--dry-run]` | `<heading>` is text, first match (exit 3 when missing). |
| `notes rename <note> [title] [--no-links] [--dry-run]` | As today, plus link rewriting by default; the message says how many links in how many notes changed. |
| `notes tag rename <old> <new> [--dry-run]` | Whole-token, nested tags included. |
| `notes merge <source> <into> [--dry-run]` | As `planMerge`. |

`--dry-run` writes nothing and exits 0: at a terminal the `describePlan` sentence and the `touched` table (id, title, changes); with `--json` the complete Plan, `before` and `after` included. Every plan error maps to exit 3 (`not_found`, `heading_not_found`, `not_in_section`), exit 2 (`bad_tag`, `same_note`, `nothing_selected`, `nothing_to_do`) or exit 1 (`stale`).

`Backend` gains `applyPlan(plan, { force? }) => Promise<{ applied: string[] }>`.

- **File mode**: preflight every note (`checkPlan` against the files; a stale Plan exits 1 and writes nothing), take the history snapshots the store takes for any edit, write each note once, trash last. Persistence is not physically atomic: if a write fails midway the error names the notes already written.
- **App mode**: the command plans on the window's live bodies (`backend.notes()`), then sends `refactor.apply { plan, force }`; the window runs the same `apply-refactor.ts` path as its own commands, refusing while any touched note is being typed in (exit 4, `--force` overrides only that lock, never staleness), and registers the undo group, so a script and the keyboard leave identical files and identical undo. `PROTOCOL` stays 1: an older server answers `methodNotFound`, already exit 6.

No CLI for back/forward or recent notes (window-only state).

## 4. Testing

- `src/core/refactor.test.ts`: every planner; duplicate headings addressed by line; same-note refile with the target above and below the cut; links with aliases and mixed case; nested tags; `#tag` inside a word or URL untouched; merge with and without the leading heading; stale detection; every error code; `insert` keeps its current behaviour (its tests move with it).
- `src/renderer/journey.test.ts`: push, back, forward, cap, collapse, the hash rule.
- `src/renderer/apply-refactor.test.ts`: apply, group undo and redo over a fake notes array and edit logs, stale refusal, merge undo restoring the source.
- `src/renderer/refactor-ui.test.ts` (jsdom, the app's `bootRenderer` harness where it fits): keyboard through both pickers, remembered destination and heading, disabled in-range headings, the create-heading row, confirm expansion, rename Enter versus Esc, focus back in the editor after cancel and apply.
- `src/cli`: `program.test.ts` help snapshot; `e2e.test.ts` gains refile (lines and match), section move, rename with links and `--no-links`, tag rename, merge, `--dry-run` text and JSON, the stale exit; `src/main/ipc-server.test.ts` gains `refactor.apply`.
- The CDP harness captures the pickers, the confirm sheet and the recent picker for the design check.

## 5. Release

Version 0.15.0. README: one bullet each for moving lines and sections, rename with links, tag rename, merge, back/forward and recent notes; shortcuts table rows; `npm run cli:readme`. Squirrel installer and zip on GitHub, then the local install.

Out of scope: attachments stay where they are (shared files, referenced by name); front matter beyond title and pinned is untouched; no heading re-levelling; no provenance trailers on moved text; no index.
