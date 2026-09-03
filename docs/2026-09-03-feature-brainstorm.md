# Feature brainstorm for 0.15.0 (2026-09-03)

The `brainstorming` skill was run with **Codex CLI as the answering partner** (the user delegated the product-owner role to Codex for this round). Every question below went to Codex through `codex exec` (one session, resumed per question, read-only sandbox, cwd = this repo); the answers are verbatim. The last line of each entry is Claude's one-line reading of the answer.

Path: Architectural (new features, no existing flow bounds them).

## Q1

**Question (Claude):**

Question 1 of several: as the person who uses Notes every day, what is the purpose of this feature round? Describe the two or three moments where the app currently lets you down or where you leave it for another tool, in concrete terms (what you were doing, what you wanted, what happened instead). That tells me what problems the round should solve before we talk about specific features.

**Answer (Codex):**

This is architectural product brainstorming: we’re defining a coherent release round, not a single bounded change. The purpose of 0.15.0 should be to make a growing notebook easier to navigate and reorganize. Notes captures and retrieves well today; it becomes less graceful once months of material accumulate.

First, I follow several `[[links]]` while researching, then want to return to the note and exact paragraph where I started. Instead, the app’s previous/next commands follow sidebar order, so I repeatedly search for my way back and lose my reading context.

Second, my Inbox fills with quick captures such as “compare SQLite backup options” or “ask Sam about packaging.” Later I want to move each item into the relevant project note—often beneath a particular heading—but that means selecting, cutting, finding the destination, locating the heading, pasting, and returning to Inbox.

Third, when a project changes shape, I leave Notes for VS Code or PowerShell. Renaming a concept, merging two notes, changing a tag everywhere, or moving a section between notes requires careful multi-file editing. The round should make those structural changes safe and keyboard-driven, with equivalent CLI operations, while leaving the Markdown files as the authoritative result.

**Reading:** the round is about a grown notebook: (1) navigation history back/forward through followed links, (2) moving Inbox items into project notes under a heading, (3) safe structural refactors (rename a concept, merge notes, rename a tag everywhere, move a section) with CLI equivalents.

## Q2

**Question (Claude):**

Question 2: those are three distinct problems (navigation history, refiling Inbox items, structural refactors). One release can hold all three if each stays small, but I need to know how you would rank them and when you would call the round a success.

Pick one:
(a) All three ship in 0.15.0, each in its smallest useful form; success = you stop leaving Notes for VS Code/PowerShell for the three moments you described.
(b) Only the refactor tools (rename/merge/tag rename/move section) ship, done thoroughly, and the other two wait for 0.16.
(c) Navigation history + refiling ship (the daily-frequency pains), refactors wait.

Say which, and then state the single concrete success criterion you would test on release day for each problem you keep in scope (for example: "follow three links, press Alt+Left three times, land on the original paragraph with the caret where it was").

**Answer (Codex):**

I pick **(a)**, ranked:

1. Refiling Inbox items
2. Navigation history
3. Structural refactors

They form one coherent round: maintaining a notebook after capture. Each should ship as a narrow, reliable operation rather than a broad workspace-management system.

Release-day success criteria:

- **Refiling:** Put three checklist items in Inbox, then—using only the keyboard—move each beneath a chosen heading in another note; each disappears from Inbox and arrives unchanged in the correct section.
- **Navigation history:** Follow three wiki links, press `Alt+Left` three times, and land on the original paragraph with the caret and scroll position restored.
- **Structural refactors:** Without opening another editor, rename a linked note, rename a tag across the notebook, move one heading with its contents, and merge a duplicate note; afterward, every affected Markdown file and wiki link contains the expected plain-text result. The same operations must also be scriptable through `notes`.

**Reading:** all three ship in 0.15.0, smallest useful form each; priority refile > history > refactors; the three release-day tests above are the acceptance criteria.

## Q3

**Question (Claude):**

Question 3, refiling (your first priority). The app already has `notes append <note> [text]` with "or under a heading, or at the top" options in the CLI, so the destination-side primitive exists in file mode. What is missing is the keyboard flow in the window. Two designs:

(A) "Move line to": a command (say Ctrl+Shift+V, palette "Move to note...") that takes the current line (or the selected lines, or the checklist item the caret is in) and opens a two-stage picker: first a fuzzy note picker, then a fuzzy heading picker for that note (with "top" and "end" as the first two choices). Confirm and the lines are cut from here and appended under that heading there; an undo entry is logged in both notes so Ctrl+Z puts them back. CLI: `notes move <from-note> --line N` is awkward, so instead the CLI gets `notes append <note> --under "Heading"` (already there) plus a new `notes refile <from> <to> [--under H] --match "words"` that moves the first line matching the words.

(B) "Send to" from the Inbox only: a dedicated Inbox review mode that walks items one by one with a picker per item.

I recommend (A): it works from any note, not just Inbox, and it is one command with one picker style the app already has (the template picker and palette). Do you agree, and answer these details: (1) should the moved line keep an `(from Inbox, 2026-09-03)` trailer or arrive unchanged? (2) when the chosen heading does not exist, should the picker offer to create it at the end of the note? (3) should the picker remember the last destination so Enter-Enter repeats it for the next item?

**Answer (Codex):**

I agree with **(A)**. “Move line to” is a general editing primitive, while an Inbox review mode would introduce a special workflow for something the editor can already express more simply.

1. **Arrive unchanged.** Do not add a provenance trailer. It would clutter the Markdown and alter checklist semantics; history already records where the text came from.

2. **Offer to create the missing heading.** When the heading search has no exact match, show `Create “Heading” at end` as an explicit choice. Create it as an H2, then place the moved text beneath it.

3. **Remember the last destination and heading.** Preselect both during the current app session, so `Enter`, `Enter` repeats the previous filing target. Forget it when Notes exits, and fall back normally if the destination or heading no longer exists.

**Reading:** design A (Move line to: two-stage picker, cut here + append there, undo in both). Lines arrive unchanged; missing heading is created as H2 at the end; last destination+heading preselected for the session.

## Q4

**Question (Claude):**

Question 4, navigation history (your second priority). Proposed design: the renderer keeps a back/forward stack of "places" (note id, caret offset, scroll top). A place is pushed whenever you leave a note by any means other than Back/Forward (clicking a [[link]], a backlink, a related note, a graph dot, a search hit, the sidebar, Ctrl+Up/Down, or a `notes open` from the CLI). Alt+Left goes back, Alt+Right goes forward (the browser convention, and Electron does not use them). Returning restores the caret and scroll; if the note has been edited since, the caret clamps to the note length. The stack lives in memory for the session, capped at 100 entries, and a "Recent notes" command in the palette (Ctrl+Shift+B?) lists the last 20 distinct notes visited with their timestamps, for jumping when Back would take too many presses.

Two details to decide: (1) should mouse buttons 4/5 (the thumb buttons) also go back/forward, like a browser? (2) should the "Recent notes" list persist across restarts (stored in the app's settings, note ids only) or be session-only like the stack? Answer both, and say if anything in the design above is wrong for how you use the app.

**Answer (Codex):**

1. **Yes, mouse buttons 4/5 should navigate back and forward** while the Notes window is focused. They should invoke exactly the same commands as `Alt+Left` and `Alt+Right`, including disabled-state behavior.

2. **Recent notes should persist across restarts.** Store the 20 note IDs plus their last-visited timestamps—no titles or note content. Remove missing or trashed notes when the list is opened. The actual back/forward stack should remain session-only.

One correction: clamping the caret only handles text shortened past the saved offset; edits earlier in the note can make a valid offset point somewhere unrelated. For 0.15.0 that limitation is acceptable, but restoration should use the saved offset only when the note is unchanged. If it changed, restore the note and approximate scroll position without pretending the old caret location is reliable. Everything else fits how I would use it.

**Reading:** design accepted with one change: restore the saved caret only when the note body is unchanged (compare a hash), otherwise restore note + approximate scroll only. Thumb buttons = same commands as Alt+Left/Right. Recent notes (20 ids + timestamps) persist in settings; the stack is session-only.

## Q5

**Question (Claude):**

Question 5, structural refactors (your third priority). I checked the code: today Ctrl+T rename and `notes rename` change the title only; no `[[link]]` in any other note is rewritten, so links break silently. You named four operations. Here is the smallest set I think covers them, each a pure function in src/core (so the CLI in file mode and the window share one implementation), each writing plain markdown and logging history snapshots for every note touched:

1. Rename with links: Ctrl+T and `notes rename` gain "also update N links in M notes" (the window asks with a one-line confirm in the rename box, the CLI does it by default with `--no-links` to opt out). Matching is case-insensitive on `[[Old Title]]` and `[[Old Title|alias]]`.
2. Tag rename: palette "Rename tag..." (pick a tag from the ones in use, type the new name) and `notes tag rename <old> <new>`; rewrites `#old` and every nested `#old/child` in every note, whole-token only.
3. Move section: in the editor, "Move section to note..." takes the heading the caret is under plus everything up to the next heading of the same or higher level, and reuses the Move-to picker from the refile feature (so this is refile with a bigger selection); CLI `notes section move <from> "Heading" <to> [--under H]`.
4. Merge: palette "Merge note into..." picks a destination; this note's body is appended to the destination under an H2 of this note's title, links to this note are rewritten to the destination (via 1), this note is moved to the trash; CLI `notes merge <source> <destination>`.

Two questions: (1) is that the right set and shape, and is there any of the four you would cut or change? (2) every one of these is a multi-file write: is history snapshots for each touched note plus the trash for merge enough of a safety net, or do you want an explicit dry run (`--dry-run` in the CLI, a preview list of affected notes in the window before confirming)?

**Answer (Codex):**

That is the right set; I would keep all four. They share one theme—safe structural edits—and reuse the same core primitives and picker rather than becoming four unrelated systems.

I would change two details:

- **Merge:** do not add a duplicate heading when the source body already begins with a heading equivalent to its title. Reuse that heading; otherwise add the H2.
- **Move section:** preserve the selected section’s Markdown exactly, including its heading level. Do not silently promote or demote headings to fit the destination.

I want an explicit preview before every operation commits. In the window, show a compact confirmation containing the destination and affected-note count, with a keyboard-expandable list of note titles. In the CLI, support `--dry-run` with the normal table/JSON output and no writes. History and trash protect recovery, but preview prevents a broad case-insensitive rename or nested-tag rewrite from being wrong in the first place.

**Reading:** keep all four. Merge reuses an existing leading heading equal to the title instead of adding a second one. Move section copies markdown verbatim (no heading re-levelling). Every operation previews first: window = compact confirm with destination + affected count + expandable title list; CLI = --dry-run with normal output.

## Q6

**Question (Claude):**

Question 6: where the logic lives. Three approaches for the refile/refactor code (the navigation history is renderer-only either way):

(A) Pure functions in src/core/refactor.ts operating on plain `{ id, title, body }` records: `planRename`, `planTagRename`, `planMerge`, `planMoveSection`, `planRefile`, each returning a Plan `{ writes: [{id, body, title?}], trash: [id], summary }`. The window calls them on its in-memory notes and applies the Plan through its normal save path (one undo entry per note, history snapshots as usual); the CLI in file mode calls the same functions and writes through file-backend; in app mode the CLI sends a `refactor` request over the pipe and the window applies the same Plan. One implementation, the preview is just the Plan before it is applied, --dry-run is "print the Plan". Recommended.

(B) Main-process implementation exposed over IPC to both the renderer and the pipe: single writer, but the renderer's undo log and live-formatting state have to be reconciled after the main process rewrites files under it, which is the same file-watcher path that already exists but is the least tested part of the app.

(C) Renderer-only, with the CLI always going through the pipe (starting the app if needed): simplest, but `notes rename --links` in a script would then need the window, which breaks the file-mode promise.

Do you accept (A)? And one constraint question for it: the Plan's link rewrite for rename needs every note's body; for a notebook of a few thousand notes that is already in memory in the window and read in ~100 ms by the CLI, so I intend no index or cache. Agree, or do you want a cap/warning above some note count?

**Answer (Codex):**

I accept **(A)**. Planning and applying are the correct boundary: `src/core/refactor.ts` determines the complete Markdown transformation without performing I/O, while each environment retains control of saving, history, undo, trash, and error reporting. It also makes previews and `--dry-run` truthful because they display the exact Plan that would be applied.

Use no index, cache, note-count cap, or warning. A few thousand in-memory string scans are well within scope, and an index would add invalidation complexity to operations that still need the complete bodies to produce writes. Only changed notes should appear in `Plan.writes`; keep planning synchronous and deterministic. If real measurements later show noticeable latency, optimize from evidence rather than adding a threshold now.

**Reading:** approach A: pure synchronous planners in src/core/refactor.ts returning a Plan; each environment applies it. No index, cache, cap or warning; only changed notes in Plan.writes.

## Q7 (design section 1: core model)

**Question (Claude):**

Design, section 1 of 3: the core model (src/core/refactor.ts, pure, synchronous, no I/O; tested in src/core/refactor.test.ts). Tell me whether this section looks right, and name anything to change, before I go on to the window.

Types:
- `Plan { kind, writes: Array<{ id, body, title? }>, trash: string[], summary: { notes: number, links?: number, tags?: number, lines?: number }, touched: Array<{ id, title }> }`. `touched` is the preview list (every note in writes or trash, by title). `writes` holds only notes whose body or title actually changes. Applying a Plan means: for each write, updateBody/updateTitle (so updatedAt moves and history snapshots happen as they do for any edit); for each trash id, the ordinary delete.
- Planners, each `(notes: Note[], ...) => Plan | PlanError`, where PlanError is `{ error: string }` (destination missing, nothing selected, same note as source, heading not found when creation is not allowed):
  1. `planRefile(notes, { from, lines: {first, last}, to, under: { heading } | 'top' | 'end', createHeading })`: cuts lines first..last (inclusive) out of `from`, collapses the blank lines left around the gap to at most one, and appends them to `to` with the same rules as today's CLI `insert()` (which I move from src/cli/commands/notes.ts into core/refactor.ts and re-export: end of the heading's section, `## Heading` created at the end when missing and `createHeading` is set, `--prepend` = top). The moved text is byte-identical. Moving into the same note is allowed (it is "move to heading") as long as the target section is outside the moved lines.
  2. `planMoveSection(notes, { from, line, to, under })`: `line` is any line inside the section; the section is the nearest heading at or above that line, through the line before the next heading of the same or a higher level (or the end of the note). Delegates to planRefile with those bounds. Not a refile of "just the caret line": if the caret is above the first heading, PlanError "not in a section".
  3. `planRename(notes, { id, title, links: boolean })`: sets the explicit title; when `links`, rewrites `[[Old]]` and `[[Old|alias]]` (case-insensitive, trimmed, matching the old title as the app's `linkKey` does) to `[[New]]` / `[[New|alias]]` in every other note, and in the note itself. summary.links counts rewrites; a note whose only change is a link rewrite is in writes.
  4. `planTagRename(notes, { from, to })`: whole-token, case-insensitive rewrite of `#from` and `#from/child` to `#to` and `#to/child`, using the same token rule as tagsOf (so `#from` inside a word or a URL is untouched, and `#from` inside a code fence is treated as tagsOf treats it today). `to` is validated as a tag name (no spaces, no leading #). summary.tags counts rewrites.
  5. `planMerge(notes, { source, into })`: appends source's body to `into`: if the source body's first non-blank line is a heading whose text equals the source's title (case-insensitive), the body is appended as is; otherwise `## <source title>` is put above it. Links to the source title are rewritten to the destination title in every note (planRename's rewrite, applied to the merged bodies), then the source id goes into `trash`. Merging a note into itself is a PlanError. summary.links counts the rewrites.
- `describePlan(plan)` returns the one-line sentence both the window confirm and the CLI print, e.g. "Rename 'Old' to 'New' and update 4 links in 3 notes".

Not in scope: attachments are not moved between notes (they are shared files referenced by name, so nothing breaks); front-matter beyond title/pinned is untouched; nothing is done to history or trash beyond the ordinary paths.

**Answer (Codex):**

The model is right, but I would change four details before moving on.

- Make results discriminated: `{ ok: true, plan } | { ok: false, code, message }`. Stable codes such as `heading_not_found` and `same_note` let the window and CLI present errors appropriately without parsing prose.
- Add the expected prior values to each write, such as `{ id, before: { body, title }, after: { body, title? } }`. A Plan may sit in a confirmation UI while an external editor changes a file; application must reject a stale Plan instead of overwriting that edit.
- Apply each write as one note mutation. A rename that changes both title and self-links must advance `updatedAt`, create history, and create renderer undo state only once—not once through `updateTitle` and again through `updateBody`.
- A heading target needs occurrence identity, not only its text, because duplicate headings are valid Markdown. Use something like `{ heading, occurrence }` or a line-based heading reference. The CLI may resolve `--under` to the first match, but the window picker must target the exact heading selected.

For same-note refile, resolve the destination before cutting and correctly translate its position afterward. “Byte-identical” should mean the characters inside the selected lines remain identical; necessary boundary newlines may differ. In merge plans, the trashed source should not also appear in `writes`: construct the final destination body, rewrite surviving notes, then trash the untouched source through the ordinary path. Everything else looks right.

**Reading:** accepted with: discriminated results with stable error codes; each write carries before+after so a stale Plan is rejected; one mutation per note; heading targets by line (occurrence identity); same-note refile resolves the destination before cutting; merge trashes the source without also writing it.

## Q8 (design section 2: the window)

**Question (Claude):**

Section 1 is amended as you said (results `{ ok: true, plan } | { ok: false, code, message }` with codes `not_found`, `same_note`, `heading_not_found`, `not_in_section`, `bad_tag`, `nothing_selected`, `stale`; writes as `{ id, before: {body,title}, after: {body,title} }`; heading targets are `{ line }` of the heading, the CLI resolves text to the first match; one mutation per note; merge never writes the source).

Design, section 2 of 3: the window. Tell me whether it looks right and name anything to change.

Commands (all `ACTIONS` entries, so they get palette + shortcut-sheet listings for free; group 'Notes' unless said):
- `move-lines` "Move lines to another note…" Ctrl+Shift+V (group Writing). Takes the selected lines, else the line the caret is on. Stage 1: note picker (label = title, hint = snippet), the current note included, last destination preselected. Stage 2: heading picker for that note: "Top of the note", "End of the note", then every heading (indented by level, hint = its line number), then "Create '<typed text>' at the end" as the last row whenever the typed text matches no heading exactly. Enter applies: the lines leave this note (one undo entry here via the existing rememberEdit + setBody path) and land there (rememberFor(id) + update, so Ctrl+Z in either note reverts its half). Caret stays on the line where the cut was. Status line: "Moved 2 lines to 'Project' › 'Ideas'". Because refile is two files, the confirm you asked for is the second picker itself: its placeholder reads "Move 2 lines under which heading?" and the summary row at the top of the heading list names the destination. No extra dialog.
- `move-section` "Move this section to another note…" (Writing, no chord): same pickers, bounds from planMoveSection; PlanError not_in_section shows the status "Put the caret in a section first".
- `tag-rename` "Rename a tag everywhere…" (Notes, no chord): picker 1 lists allTags with counts; then a small prompt sheet (the rename box the app already uses for titles is a bare input, so this is a new one-line input sheet, "confirm sheet" below) reading "Rename #old to" with the input prefilled "old". Enter builds planTagRename and shows the confirm.
- `merge-into` "Merge this note into another…" (Notes, no chord): note picker (this note excluded), then the confirm.
- Rename with links: no new command. On title commit (Enter/blur in the title box) when the title changed and other notes link to the old one, the confirm appears: "Update 4 links in 3 notes to 'New'?" Enter = yes, Esc = keep the title change but leave the links. `notes rename` on the CLI does the same with `--no-links` to opt out.
- The confirm sheet (new, shared): a card like the delete confirm/history sheet, with `describePlan(plan)` as its sentence, an "n notes" row that expands with Space/→ into the title list (the `touched` array), Enter applies, Esc cancels. It applies the Plan by checking `before` against the live notes (stale → status "That note changed meanwhile; try again") and then one mutation per note: the open note through setBody/updateTitle so the editor re-renders, others through rememberFor + updateBody. After merge, select the destination.
- Navigation history: `back` Alt+Left / `forward` Alt+Right (group Notes, enabled() checks the stack), a module src/renderer/journey.ts (pure: push/back/forward/cap 100/dedupe consecutive same-note entries, tested) holding `{ id, caret, scroll, hash }` where hash is a cheap string hash of the body. `select()` records the place being left into the stack unless the call comes from back/forward; the caret is only restored when the hash still matches, else scroll only. Mouse buttons 3 and 4 (`auxclick`/`mouseup` with `button === 3 | 4`) run the same two actions. `recent` "Recent notes…" Ctrl+Shift+B: picker of the last 20 distinct notes visited (title, hint = relative time), most recent first, persisted in localStorage as `[{id, at}]` (the same store as the other UI state), trashed/missing ids dropped when the picker opens.

Files: main.ts gets the ACTIONS, the confirm sheet wiring and the pickers; index.html + styles.css get the confirm sheet and the one-line prompt sheet (same tokens as the existing sheets; no new colours); journey.ts is new; core/refactor.ts is called directly from the renderer (it is pure).

**Answer (Codex):**

The window design is sound, with three changes.

First, cross-note undo must be atomic. “Ctrl+Z in either note reverts its half” can duplicate or lose text: undoing only the source restores the lines while leaving the destination copy. Applying a multi-note Plan should register one inverse Plan; invoking Undo from any touched note reverts every touched note after checking that their current values still match the Plan’s `after` values. If they do not, refuse with a stale-status message. Merge undo must likewise restore the trashed source and every rewritten link together.

Second, build rename-with-links before mutating the title. Enter or blur produces the full Plan and opens confirmation; Enter applies it atomically, while Esc applies a separate title-only Plan. Otherwise the full Plan’s `before.title` is already stale when confirmation opens.

Third, keep the wiring out of `main.ts`. Put the picker/prompt/confirmation flows in a focused `refactor-ui.ts` module with a small interface, and put Plan validation, application, and inverse-Plan registration in `apply-refactor.ts`. `main.ts` should register actions and provide the adapters those modules need. This concentrates the tricky multi-note behavior behind one testable seam.

The heading picker is enough confirmation for move-lines and move-section; no third dialog is needed. Disable same-note heading targets that fall inside the moved range, remember both the last note and heading, and handle mouse navigation from one event (`mouseup` or `auxclick`) so buttons 3/4 cannot fire twice. The journey and persisted-recent design otherwise looks right.

**Reading:** accepted with: multi-note undo is atomic (one inverse Plan; Ctrl+Z from any touched note reverts all, refused as stale if any note moved on); rename-with-links builds the Plan before the title mutates (Esc = title-only Plan); flows live in refactor-ui.ts and apply-refactor.ts, main.ts only registers actions and adapters; same-note heading targets inside the moved range are disabled; one mouse event for buttons 3/4.

## Q9 (design section 3: CLI, testing, release)

**Question (Claude):**

Section 2 is amended as you said (atomic group undo: applying a Plan registers one group across the touched notes' edit logs, Ctrl+Z from any of them reverts all after checking the `after` values, else "changed meanwhile"; rename-with-links builds the Plan against the pre-edit title and applies it atomically, Esc applies a title-only Plan; new modules src/renderer/refactor-ui.ts and src/renderer/apply-refactor.ts with main.ts only registering actions and passing adapters).

Design, section 3 of 3: the command line, testing and the release. Tell me whether it looks right and name anything to change; after this I write the spec file for your review.

CLI (src/cli/commands/refactor.ts, one file, using the same planners):
- `notes refile <from> <to> (--lines N[-M] | --match <words>) [--under <heading> | --top] [--dry-run]`: `--lines` are 1-based; `--match` takes the first line whose text contains all the words (case-insensitive) and errors with exit 3 when none does. A missing `--under` heading is created (as `append --heading` does today). No flag means the end of the note.
- `notes section move <from> <heading> <to> [--under <heading> | --top] [--dry-run]`: `<heading>` is text, first match; `section` becomes a noun like `tag` and `trash`, so `notes section list <note>` is an alias of `outline` for symmetry (cheap: same rows).
- `notes rename <note> [title]`: unchanged, plus link rewriting on by default with `--no-links` to opt out and `--dry-run`; the message says how many links in how many notes were updated.
- `notes tag rename <old> <new> [--dry-run]`.
- `notes merge <source> <into> [--dry-run]`.
- `--dry-run` prints `describePlan` and the touched notes as the usual table (id, title, what: "links rewritten"/"section removed"/"text added"/"trashed"), or the Plan's summary and touched list under `--json`, exit 0, no writes.
- Application: `Backend` gains `applyPlan(plan, { force }) => Promise<{ applied: true }>`. File mode checks every write's `before` against the files (stale → exit 1 with the message), then writes through the store in one pass (each note once, removals last) and trashes. App mode sends a new pipe method `refactor.apply` with the Plan; the window runs the same apply-refactor.ts path as its own commands (busy check on every touched note first, `--force` overrides, atomic group undo registered), so a script and the keyboard produce identical results and identical undo. PROTOCOL stays 1: an older client never sends the method, an older server answers methodNotFound, which the client already maps to exit 6.
- No CLI for the navigation history or recent notes (window-only state).

Testing:
- src/core/refactor.test.ts: each planner, including duplicate headings by line, same-note refile with the target below and above the cut, links with aliases and mixed case, nested tags, tag inside a word/URL untouched, merge with and without the leading heading, stale detection, every error code, `insert` behaviour preserved from the CLI's existing tests.
- src/renderer/journey.test.ts: push/back/forward/cap/dedupe, hash-mismatch rule.
- src/renderer/apply-refactor.test.ts: apply + group undo/redo on a fake notes array and edit logs, stale refusal.
- src/cli: program.test.ts help snapshot updated; e2e.test.ts gets refile, section move, rename with links, tag rename, merge and `--dry-run` in file mode; src/main/ipc-server.test.ts gets `refactor.apply`.
- The CDP screenshot harness captures the two pickers, the confirm sheet and the recent-notes picker for the visual check against the design system.

Release: 0.15.0; README gains one bullet per feature (moving lines/sections, rename with links, tag rename, merge, back/forward + recent) and the regenerated CLI table; Squirrel installer + zip on GitHub as every release.

**Answer (Codex):**

This section is nearly ready. I would make five changes before the spec.

- Drop `notes section list`; `notes outline` already provides it. The alias adds CLI surface without solving a release problem.
- `--force` may override only the “currently being edited” lock. It must never override a stale `before` check, since that would overwrite newer content.
- Do not describe multi-file persistence as physically atomic. Preflight every note before any mutation, create all required history snapshots, then write each note once and trash last. The operation is logically grouped and undoable, but a process or disk failure midway can still leave partial filesystem changes; report exactly which notes were written if that happens.
- Make `--dry-run --json` return the complete stable Plan, including `before` and `after`, so automation can inspect the exact proposed transformation. Human-readable output can remain the summary plus affected-note table.
- Test the renderer flows behaviorally, not only through screenshots: keyboard movement through both pickers, remembered destination and heading, disabled in-range same-note headings, create-heading choice, confirm expansion, rename Enter versus Esc, and focus restoration after cancel/apply. Screenshots cover appearance, not interaction.

Also remove “redo” from the `apply-refactor` test unless Notes already has a deliberate redo interface; atomic group undo is the committed requirement. Ensure app-mode planning reads the window’s live bodies before constructing the Plan. With those amendments, section 3—and the overall design—is approved for the written spec.

**Reading:** approved for the spec with: no `section list`; --force never overrides a stale check; persistence is preflight + snapshots + one write per note + trash last, partial failures reported by note; --dry-run --json = the whole Plan; renderer flows get behavioural tests. Redo: the app already has a deliberate redo (Ctrl+Y), so group redo stays, symmetric to group undo.

