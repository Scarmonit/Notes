# Panes and tabs (2026-09-03)

This supersedes the "one window, a sidebar, an editor, and nothing else" line in
[the original design](2026-09-02-notes-app-design.md). Everything else in that
document still stands.

## What changed, and why

Notes was built on one rule: one window, a sidebar of notes, an editor, and
nothing else. It was the right rule for a notebook of twenty notes. It stopped
being the right rule somewhere past two hundred, when the work stopped being
*write this note* and became *hold these three notes at once* — a plan beside
the reference it quotes, a draft beside the notes it is drawn from, the words
beside what they look like.

So the app is allowed a shell now: a note can be open in a tab, and the window
can be split into panes. The restraint moves rather than goes. It is now:

- **A tab is asked for, never accumulated.** Choosing a note in the sidebar
  turns the page — the note takes the place of the one showing. `Ctrl+T` is how
  a second tab comes into existence. A pane with one note has no tab strip at
  all, so a notebook used the way it always was looks exactly as it always did.
- **A pane is a whole pane.** It has its own tabs, its own scroll, its own
  preview toggle, its own find bar and its own margin. There is no "main" pane
  and no "secondary" pane, and no feature that works in one and not the other.
- **Three panes at most.** Below 480px a pane is not a page any more.
- **No new colour.** Which pane has the focus is said with the margin rule the
  page already uses — a 2px line along the top — and by letting the other
  panes' margins and buttons sit back a little. See the "ink and margin"
  system, which is unchanged and still in force.

## How it is built

The renderer is about five thousand lines that were written when there was one
editor, and they say `el.editor` several hundred times. Rewriting all of that to
thread a pane through every function would have been the largest and riskiest
change in the app's history for no gain a reader would ever see. So:

- `index.html` holds a `<template id="pane-tpl">` and an empty `<div id="panes">`.
  A pane is a clone of the template. Elements inside it carry `data-el="editor"`
  rather than `id="editor"`, because an id would name three editors.
- `el` in `src/renderer/main.ts` is unchanged for everything outside a pane, and
  a **getter** for everything inside one: `el.editor` reads
  `here().els.editor` — the pane with the focus. Every existing call site kept
  working untouched.
- The dozen module-level variables that describe *an editor's own state* rather
  than the window's — `editorNoteId`, `drawn`, `revealed`, `outlineKey`,
  `findHits`, `caretBefore`, `pendingTitle`, and `ui.selectedId` and
  `ui.preview` — move with the focus. `stash(p)` puts them on a pane's record,
  `unstash(p)` takes them off it, and `withPane(p, fn)` lends that context to
  another pane for the length of one call. That is how `renderEditor()` draws
  three panes by running the old one-pane code three times.
- Listeners on parts of a pane go through `onPane(name, type, fn)`, which
  records the wiring and replays it onto every pane made afterwards. A
  `pointerdown` and a `focusin` on the pane root are what move the focus, so by
  the time a handler runs, `el` already means the right pane.
- `src/renderer/tabs.ts` is the one piece that is pure: which tab a chosen note
  replaces, where a new one goes, what shows after one is closed, what happens
  when a note is deleted out from under a pane. It has no DOM in it and is
  tested on its own.

## Keys

`Ctrl+T` was "rename this note" and is now "open a note in a new tab", because
`Ctrl+T` is what a window with tabs means by a new tab. Rename moved to
`Ctrl+R`, and gained `F2`, which is what Windows means by rename.

| Keys | Action |
| --- | --- |
| `Ctrl+T` | Open a note in a new tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+W` | Close this tab |
| `Ctrl+1` … `Ctrl+9` | The nth tab of this pane (`Ctrl+9` is the last) |
| `Ctrl+Shift+\` | Split the pane |
| `Ctrl+Shift+W` | Close this pane |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | Move between panes |
| `Ctrl+R` / `F2` | Rename the note (was `Ctrl+T`) |

## What the command line sees

`ui get` and `ui set` are unchanged: the panes are not settings, so they are
kept out of that shape. `note status` now answers `open` for a note showing in
*any* pane, and `dirty` from the note that actually has unsaved keystrokes
(`typedId`) rather than from whichever note is selected — which is a small
correction the panes forced and the command line wanted anyway.
