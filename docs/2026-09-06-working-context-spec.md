# Working Context — the settled design (0.24.0)

Brainstormed 2026-09-06 with Codex CLI as the answering product owner, in the same session as
0.23.0. The verbatim question-and-answer is in `2026-09-06-six-features-brainstorm.md`; the
other half of that brainstorm is `2026-09-06-addressable-spec.md` and ships first.

Release title: **Glance, insert, and switch contexts without losing your place.**

## The problem, as diagnosed

Three of the six features from the `/compare` pass change nothing on disk. They change how the
window lets you reach something without giving up what you are doing. That is the theme:

> Reach commands, referenced content and saved working arrangements without losing your current
> place.

Each of the three had to survive a hostile question first, because this app has form for solving
these problems differently and each of them risked being Obsidian-envy.

## Link peek

### Why it survives

The app already has three ways to see another note without losing this one: `![[embeds]]` render
the live source in the page, three panes let you open it beside this one, and `Alt+←` goes and
comes back with the caret and scroll restored. The question was whether a fourth rendering
surface earns its place.

It does, and the sentence the whole feature is built around is:

> **Peek answers a question about another note without changing tabs, pane history, caret,
> scroll, or layout.**

An embed changes the document. A second pane changes the workspace. `Alt+←` repairs a navigation
change *after it happens*. Peek creates no state change at all. That is worth one deliberately
lightweight rendering surface.

### The trigger — both mouse and keyboard

A hover-only feature would be the first thing in this keyboard-first app that a keyboard user
cannot reach, so there are two triggers.

**Pointer.** Ordinary hover, no modifier. Open delay **450 ms**, close delay **180 ms**. Moving
from the source into the card cancels the close; moving back to the same source keeps the
existing card; moving directly to another peekable target starts a fresh 450 ms delay and does
not flash intermediate content.

A pointer-opened card closes on: leaving both source and card for 180 ms, `Esc`, a click outside,
navigating to a note, typing or changing the editor selection, scrolling the containing pane or
sidebar, opening another modal or picker, and window blur.

**Keyboard.** `view.peek` / "Peek linked note" on **`Alt+P`**, in the registry, the shortcuts
sheet, the palette and the View menu. It uses the current keyboard context: a link chip
containing or adjacent to the editor caret, a focused preview link, or a focused backlink,
mention, related-note, search-result, sidebar-note or graph-node row.

A keyboard-opened card is **pinned** until `Esc`, `Alt+P` again, navigation, editing, or focus
leaving both source and card. Focus moves into the card so it can be scrolled, selected and
traversed without a mouse; closing restores focus to the originating element or caret position.

### What peeks

The rule, rather than a list:

> A stable UI element may peek when its primary activation opens a specific note or note address.

Peeks: wiki-link chips in the editor, wiki links in the rendered preview, backlink rows,
unlinked-mention rows, related-note rows, search-result rows, sidebar note rows, graph note
nodes.

Does not peek: command-palette rows, picker rows (recent notes, move destinations), outline
headings, folder rows, toolbar and menu commands. Pickers and modal sheets must not spawn a
second floating selection surface; an outline target is already visible in the current note; a
folder has no note content.

**Address specificity is preserved.** `[[Plan]]` peeks the note, `[[Plan#Heading]]` peeks that
section, `[[Plan#^k3n9dq]]` peeks that block, and the local `[[#Heading]]` / `[[#^id]]` forms
work identically. Missing headings and blocks show the same unresolved explanation 0.23.0
established.

An **ambiguous** note link (0.22.0's `{kind:'many'}`) shows a resolution card rather than
concatenating full notes: every candidate with its title, its folder-qualified path and up to two
plain-text preview lines. That is informational — clicking the original link still runs the
established ambiguity flow — but a candidate inside the peek may be activated directly, because
it names an exact note id; doing so navigates and closes the card.

### The card

One floating card, never more than one, anchored to the target element or to the editor caret for
keyboard invocation. Positioned with an 8px gap: prefer right, then left, then below, then above,
then clamped to the usable window bounds. It may overlap document content but never leaves the
viewport, and it is not constrained to the originating pane.

```text
width: clamp(320px, 34vw, 440px)
max-height: min(520px, 60vh)
```

On a very narrow window, the viewport width minus 24px. The body scrolls internally. Existing
paper colours and typefaces at a slightly reduced **15px** reading size; the existing sheet border
and restrained elevation. No new accent colour, shadow language or arrow ornament.

### The reduced pipeline

Deliberately not the preview pipeline: marked, then DOMPurify, and headings, emphasis, lists,
tables, links, images, blockquotes and plain code blocks. Task checkboxes render but are
**disabled**. Block markers are hidden.

Not run: mermaid, syntax highlighting, asynchronous render enrichments, embedded-note expansion.
A mermaid fence becomes a muted block reading `Mermaid diagram`; other fences appear unhighlighted;
math stays readable source text rather than invoking a separate typesetting pass. An `![[Other]]`
embed appears as a compact inert placeholder reading `Embedded: Other` and does not expand —
which is what stops a hover triggering recursive note rendering, depth traversal, images and
diagrams.

The card is scrollable, text-selectable, copyable and keyboard-focusable. Links inside it navigate
normally in the active pane and close the card; **they do not open a nested peek**. Checkboxes are
inert. Images load through the existing safe attachment resolution, with dimensions reserved and
height limited so the card does not reposition after load.

### The budget

Peek must not participate in `renderEditor` and must not run during typing. Listeners are
delegated at each stable surface, never attached per row or per chip.

- Timer-to-visible on a cache hit: within one animation frame.
- Uncached basic markdown render: **under 50 ms** for an ordinary note.
- Positioning: one measurement pass and one write pass.
- No mermaid import, highlighting pass, embed expansion or notebook-wide recomputation.

Sanitised rendered fragments are cached by `note id + in-memory content revision + address` in a
bounded **LRU of 32**. The cache holds generated safe *markup*, not a live DOM node, so event
state cannot leak between cards. Every cached entry for a note is invalidated when its in-memory
body changes, a watcher update replaces it, or it is renamed, moved, deleted, restored or
reloaded. The fragment key distinguishes whole-note, heading and block peeks; note links inside
cached markup resolve at click time against the current index, so unrelated notebook changes need
no global invalidation.

For a very large note, the addressed heading or block is extracted before rendering; a whole-note
peek renders at most the **first 12 KB of source** and ends with a muted `Open note to continue`
row. This is a preview, not a miniature second pane.

### The setting

```text
ui.linkPeek = true     "Preview notes on hover"
```

In the Layout sheet, defaulting **on** — hover preview is the promised feature and a 450 ms dwell
stops ordinary pointer travel opening it constantly. It governs **pointer hover only**: `Alt+P`
stays available when it is off, because keyboard access is an explicit command, not unsolicited
motion. Turning it off immediately closes a pointer-opened card and cancels pending timers, and
affects neither the command, rendered embeds, nor ordinary link activation.

## Slash commands

### Why it is not a fifth palette

0.21.0 diagnosed the command problem as **recall** and answered it with pills and generated menus
that print the chord beside the command; the palette was already the complete searchable catalog.
A `/` menu is the fifth reader of the one `ACTIONS` registry, so it had to justify itself:

> **The palette answers "what can Notes do?" Slash commands answer "what can Notes insert here?"**

Its value is caret locality and continuity — while writing, inserting structured markdown without
leaving the editor or recalling a chord. That is narrower than the palette and worth keeping
distinct.

### Membership

A new optional field on `Action`:

```ts
slash?: boolean
```

Only actions that insert content at the current body caret may set it. For 0.24.0 the membership
is exactly seven:

- Insert task
- Insert today's date
- Insert divider
- Insert from template
- Insert table
- Attach file
- Link to a block… *(new in 0.23.0)*

No navigation, note-management, view, window, search, export or settings action appears.
`registry.test.ts` asserts this exact membership and that every slash action is enabled only in
an editable note body — the same way it already asserts the twelve menu sections and the four
pills.

**The standing prohibition is unchanged**: no bold, italic, heading, list, quote or similar
formatting actions are created for this menu. Slash commands do not establish a general
formatting-command model.

### Trigger and lifetime

The menu opens only in the editable markdown body, when `/` is typed at the beginning of a line
or immediately after whitespace.

It does not open mid-word (so `and/or` is safe), after another path character, inside inline code,
inside a fenced code block, inside a link/embed/image chip, in the title, in search or sheets or
pickers or other inputs, or inside a markdown table row.

**The `/` and everything typed after it remain ordinary temporary body text while the menu is
open.** Paths and prose are never swallowed merely because the menu appeared.

While open: typing filters by label, terms and hint; spaces are allowed in the query; `Up`/`Down`
change selection; `Enter` and `Tab` both run the selected command; `Esc` closes and **leaves
`/query` in the note**; moving the caret outside the query, clicking elsewhere, or a newline all
close it and leave the text; an empty result shows `No matching insert command` and stays open.
Backspacing through the opening `/` closes it. An external edit to the body or a change of active
note closes it without trying to recover the query.

### Execution and undo

Running a command removes the complete `/query` range and performs the insertion as **one atomic
note edit**. One `Ctrl+Z` restores exactly the `/query` text and removes everything the command
inserted. This needs a caret insertion transaction — it must not depend on the 800 ms coalescing
window to *appear* atomic.

For a command with a secondary chooser (template, attachment, block target), `/query` stays in
place while the chooser is open and is atomically replaced only when the chooser completes.
Cancelling leaves `/query` unchanged; a command that fails likewise leaves it unchanged and
reports the existing error.

### Appearance

An anchored listbox below the query, or above it when space requires. It shares the anchored-
positioning utility introduced for peek but is a separate component with different focus and
dismissal behaviour.

**The editor keeps DOM focus.** The menu uses listbox / active-descendant semantics so arrow keys
select rows without moving the caret. Each row prints the chord where one exists, preserving
0.21.0's recall rule:

```text
Insert today's date                         Ctrl+;
```

Chordless actions show their hint or nothing in that column — never a fake shortcut. Existing
paper, border, type and selection treatment; no new accent colour.

## Named workspaces

### Why it survives, narrowly

Obsidian's workspaces are valuable partly because an Obsidian layout is complicated. This app has
three panes and some tabs, so the feature had to be defined down to what is actually useful:

> **A workspace is a named snapshot of which notes are arranged in which panes.**

That is real even at three panes: a release task wants a spec, implementation notes and testing
notes side by side; a writing task wants a draft beside references. Rebuilding those tab sets
repeatedly is real friction. It is **not** a general window-layout profile.

### What a workspace holds

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

`preview` is already part of `PaneShape`, so each pane's preview state is included.

It does **not** hold: the current folder, tags or search text, sidebar visibility, the selected
sidebar row, text or margin width, focus mode, typewriter, outline visibility, live format,
controls visibility, marginalia settings, caret or scroll history, or navigation history. Those
stay exactly as they were across a switch, which keeps the switch **spatial** rather than a
wholesale mode change. Per-note caret and scroll restoration keeps working through the app's
existing note-state mechanism; the workspace neither copies nor owns those values.

### Snapshots, not live configurations

After loading a workspace, opening or closing tabs does not mutate it. The sheet may indicate that
the current arrangement differs from the loaded snapshot, but **no automatic save occurs** — the
user chooses "Update from current arrangement", consistent with the rule against unrequested
durable changes.

Names are trimmed, case-insensitively unique, and at most 80 characters, preserving the entered
casing.

### Missing notes

Switching resolves every tab id against the current notebook. Missing or trashed notes are removed
from the loaded tab arrays; panes that become empty stay as empty panes if other panes hold notes;
if all panes empty, load one empty pane; `paneAt` is clamped to a surviving pane; an unavailable
saved `activeId` falls back to the first surviving tab.

**The workspace is never refused because some notes disappeared**, and the saved snapshot is not
rewritten — a temporarily missing file (0.22.0's `missing.json`) may come back. One notification
after the switch:

```text
Opened "Release". 2 unavailable notes were omitted.
```

### Storage

`localStorage`, beside `ui.panes`, under a versioned window-state key `ui.workspaces`. They are
window-only UI state, not notebook content and not CLI data: **not** `settings.json`, no sync with
the notes folder, and **no CLI or MCP commands**. (Saved searches went to `settings.json` because
`notes list --view` needed to answer them; nothing outside the window can act on a pane
arrangement.) They are scoped by the same notebook/root identity as other persisted UI state, so
note ids from different notebooks cannot mix.

### The commands

Exactly one registry action: **`workspace.open` / "Workspaces…"**, no chord, in the palette and
the Window menu. It opens one modal sheet holding the saved workspaces, a **Save current
arrangement as…** row, a **Update "Name" from current arrangement** row when one was most recently
loaded, and inline Rename and Delete on each row.

Selecting a workspace switches to it. Typing a new name and confirming saves the current
arrangement; an existing name offers **Replace existing snapshot** rather than silently
overwriting. Rename commits on `Enter` and cancels on `Esc`. Delete uses a lightweight inline
confirmation, because deleting a snapshot is not undoable — though it touches neither notes nor
the current arrangement.

These sheet operations do **not** become four separate `ACTIONS`: they have no global chords and
make sense only inside this surface. And **no workspace chips in the sidebar** — saved searches
describe notebook content and belong beside navigation; workspace snapshots are infrequent window
commands.

### Switching safely

Switching always:

1. flushes all pending note edits;
2. **aborts if any flush fails**;
3. validates and resolves the saved tab ids;
4. applies the pane snapshot in one UI-state update;
5. persists the new `ui.panes` and `ui.paneAt`;
6. focuses the saved active pane, or the first surviving pane.

It never discards unsaved editor text, changes note files merely by switching, empties undo
histories, or mutates the saved workspace.

## The seam to get right

The fourth of the four implementation constraints Codex recorded (the first three belong to
0.23.0):

4. **Suspend slash dismissal during its own chooser.** Opening the template picker, the
   attachment dialog or the block picker normally moves focus in a way that would dismiss the
   slash session. Those flows must explicitly suspend it, then either atomically replace `/query`
   on success or restore the unchanged session text on cancellation.

## The release-day criterion

> With unsaved typing in a three-pane workspace at 1440px, the user can peek a linked block, run
> an insertion through `/`, switch to another named workspace and back, and recover the original
> text, panes, active tabs, caret behaviour and note history with **no lost edit and no unintended
> note write**.

If any one of those interactions steals or discards the writing context, 0.24.0 is not done.

## Explicitly not in this release

- Nested peeks (a link inside a peek card opening another card).
- Diagrams, syntax highlighting, typeset math, expanded embeds or editable tasks inside a peek.
- Peeking from the palette, the pickers, outline rows or folder rows.
- A slash menu holding anything but the seven insert-shaped commands — and in particular no
  formatting commands.
- Workspaces holding the folder, the search text or any reading setting.
- Workspaces in `settings.json`, in the sidebar, or on the command line.
- Separate save / switch / rename / delete registry actions for workspaces.

## What the build settled differently, and why

Three things came out of building it that the brainstorm could not have known.

**`Ctrl+Shift+D` was already Delete.** Codex chose it for today's note in
0.23.0 without the chord table to hand. `journal.today` took **`Ctrl+Alt+D`**
instead, joining `Ctrl+Alt+F` (go to folders) and `Ctrl+Alt+M` (move this
note) — the family that already means "go to a place in the notebook". The
clash is now a test: `registry.test.ts` refuses two commands on one chord,
because the second would never run and the shortcuts sheet would print a key
that does something else.

**A cancelled chooser leaves the query removed, not in place.** The spec asked
for `/query` to stay in the note while a secondary chooser is open and be
replaced only on success. What is built takes the query out when the command
runs, and the command's own insertion joins that same undo step — so one
`Ctrl+Z` restores the query exactly, whether the chooser completed or was
cancelled. The reason is that every insert command computes its offsets from
the note as it stands; leaving the query in would put the date, the template
or the link *after* the words `/the date`. Cancelling therefore costs one
`Ctrl+Z` rather than nothing, which is the smaller of the two wrongs.

**Replacing an arrangement is not the same as building one.** `openPanes()`
appends, because it runs once at startup. Switching workspaces needed
`setPanes()`, which tears the panes down and puts the saved ones up — without
it the first switch left the panes it came from behind and the window grew a
pane every time.

## What the live check found

`scratchpad/context-check.mjs` is 47 checks against the packaged build. Two of
them are there because they failed first:

- **The pinned card closed itself.** `el.focus()` on a card opened by `Alt+P`
  scrolls it into view, and the capture-phase `scroll` listener that closes a
  hovered card took that for a scroll. Scrolling still closes a card the
  pointer opened; it never closes one asked for by name, and never fires on a
  scroll from inside the card itself.
- **The undo latch.** Taking the query out and inserting the command's words
  were two `setBody` calls and therefore two undo steps, so one `Ctrl+Z` left
  the query gone and the date gone. `joinNextEdit` holds the note's id until
  the next edit is remembered, whenever that comes — which is what makes an
  asynchronous chooser one step as well.
