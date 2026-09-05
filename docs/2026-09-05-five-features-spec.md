# v0.28.0 — "More room for what belongs in a note": the settled design

Five features from a `/compare` against Obsidian, Joplin, Logseq, Zettlr and Typora, brainstormed on 2026-09-05 with Codex CLI as the product owner (verbatim Q&A in `2026-09-05-five-features-brainstorm.md`). Everything below is what Codex decided; the builder implements exactly this. One release.

## Invariants that hold for all five

- The file is the truth. Nothing here writes to a note except as the direct, reversible result of an explicit command (an insert, a footnote edit committed from the rail, a property cell committed in a table). Fold state, rail toggles and view presentation never touch a `.md`.
- One registry. Eight new commands (74 → **82**), every one an `ACTIONS` entry with a label, group, section and chord. No formatting commands, no new pills.
- Design language of 0.27.0: every size a `--ui-*` token, every colour an existing token (no new colour literals), disabled rows greyed not hidden.
- Everything the markdown core learns (callouts, footnotes, attachment rendering) lands in `src/shared/markdown-core.ts`, so the preview, HTML/PDF/PNG exports and `notes render` agree.

## 1. Callouts

**Syntax.** A blockquote whose first content line is `> [!type]`, `> [!type]-` (starts folded), `> [!type]+` (starts open, foldable), optionally followed by a title on the same line. Types: the 13 Obsidian types and every alias (note; abstract/summary/tldr; info; todo; tip/hint/important; success/check/done; question/help/faq; warning/caution/attention; failure/fail/missing; danger/error; bug; example; quote/cite), case-insensitive. An unknown type gets the Note treatment but shows its own name, first letter capitalised (`[!foo]` → **Foo**). Recognised only at a blockquote's first content line, never inside fenced code. Nested callouts work at every quote depth.

**Rendering (preview, HTML export, CLI).** `<div class="callout" data-callout="info">` (or `<details class="callout" open?>` when foldable) — raised background, 2px `--line` left border, 12px padding, no shadow. Title line: the canonical label (Note, Abstract, Info, Todo, Tip, Success, Question, Warning, Failure, Danger, Bug, Example, Quote) in `.u` at `--ui-xs` in `--paper-dim`, then the explicit title in serif at body size if there is one. No icons, no per-type colour: red stays the margin rule's alone. Foldable callouts are native `<details>/<summary>` (click, Enter/Space, visible focus); the authored state is the initial one; toggling never writes markdown. PDF/PNG/print expand every callout, nested ones included.

**Editor (live formatting).** Every line of a callout gets a class that draws a continuous 2px `--line` left border and the raised background; block membership is worked out per line from quote depth and fenced-code boundaries (a pass over the lines, like the fence tracker). The first line's `[!type]` token is styled in the utility register; the `> ` and `[!…]` markers follow the caret-dependent fade/hide. No generated label, no duplicate title. Callouts stay expanded while editing, `-` included; editor-side callout folding is out of scope.

**Command.** `callout` — **Insert callout**, **Ctrl+Alt+C**, Write → Insert (after Divider), `slash: true`, no pill. Inserts `> [!note]` and `> ` on two lines (before the current line when the caret is at its start, otherwise after it), with blank-line separation so it does not merge into a neighbouring block; the caret ends after the second line's space. A selection is preserved. Disabled in preview. Type completion is out of scope.

## 2. Footnotes

**Syntax.** `[^id]` references; `[^id]: text` definitions with four-space-indented continuation lines; inline `^[text]` (balanced brackets, escapes, inline formatting; nested footnotes out of scope). Ids are case-sensitive, non-empty, no whitespace or brackets. One 1..n sequence in first-reference order; repeated references to one id share a number; each inline note is its own entry. First definition wins; a duplicate definition stays visible as text. An unreferenced definition stays where it was written, unnumbered. An undefined reference stays literal text. Nothing inside code or escaped counts.

**Rendering.** Reference: `<sup class="footnote-ref"><a href="#fn-<ns>-N" id="fnref-<ns>-N-K">N</a></sup>` where `ns` is a per-render namespace (so two panes or an embed cannot collide) and K the occurrence. At the end of the note: `<section class="footnotes">` with a 1px `--line` separator, a **Footnotes** label (`.u`, `--ui-xs`, `--paper-dim`) and an `<ol>`; each item ends with one `↩` per reference (accessible name "Back to reference K of footnote N"). Numbers at `--ui-xs`; references and back-links in link blue; bodies in the note's serif. PDF/PNG/print: the same endnotes, back-links omitted. The label is not a heading and does not appear in the outline.

**Hover.** In the preview, resting on a superscript for the peek dwell (450 ms) shows the rendered definition in the existing peek card, same single-card rules; no recursive peeks. Exports get anchors only.

**Editor.** `[^id]` → the id as a utility superscript at `--ui-xs`, `[^` and `]` as markers; `[^id]:` label at `--ui-xs` utility in `--paper-dim`, body normal; inline `^[…]` keeps body size with `^[` and `]` as markers. Every source character stays. No editor-side jumping by click (the rail does that).

**Command.** `footnote` — **Insert footnote**, **Ctrl+Alt+E**, Write → Insert (after Callout), `slash: true`. Inserts `[^N]` at the caret (after a preserved selection), appends `[^N]: ` at the end of the note after blank-line separation, moves the caret after that space; one undo step. N = 1 + the largest positive numeric id in use (references or definitions); with only word ids, 1. Disabled in preview.

## 3. The footnotes rail

**Placement.** The existing right column (`<nav class="outline">`'s parent) stacks two sections: **Outline** (unchanged rule: ≥2 headings) then **Footnotes**, separated by a 1px `--line` rule and 16px; the column shows when either enabled section has content; below the 820px pane width it hides without changing preferences; each section scrolls on its own, splitting the height equally when both overflow.

**Rows.** Numbered entries in rendered order (inline ones included, marked "Inline"); a word id shown as secondary `[^smith]`; the definition excerpt in utility `--ui-sm`, paper, wrapped to three lines then ellipsised; the number in link blue; labels `.u`. After the numbered ones: unreferenced definitions in source order (id, no number). Then unique undefined ids: `[^x] · No definition` with a **Create definition** control that appends `[^x]: ` (blank-line separated) and opens that row's editor without moving the document caret.

**Interaction.** Clicking a number moves the caret to the reference nearest the saved document caret (the following one on a tie) and scrolls there. Clicking the text opens one plain textarea in the row (one at a time): a named definition's editor holds the whole markdown body with the four structural spaces stripped from continuation lines and put back on save; Enter inserts a newline; **Ctrl+Enter commits, Esc cancels, blur commits**. An inline note's editor is single-line, edits only the bracket contents, keeps escaping valid, Enter commits. Each changed commit is one undo step; no debounced writes. The document selection and scroll are captured before entering the rail and a **↩ Back** control restores both (positions mapped through the edit). Emptying the text keeps the syntax. In preview the rail is read-only: text scrolls to the endnote, number to a reference, Create definition present but disabled.

**Command.** `footnotes` — **Footnotes**, **Ctrl+Alt+O**, View → Navigation (after Outline), `on:` = `ui.footnotes` (default true, independent of `ui.outline`), plus a Layout checkbox "Footnotes — Show footnotes beside the note to jump to and edit." Out of scope: deleting or reordering footnotes from the rail, editing ids, inline↔named conversion, drag, exported rails.

## 4. Folding

**What folds.** A heading (its section to the next heading of the same or higher level) and a list item with an indented sub-list (its subtree). The head line stays; the lines under it hide. Empty sections cannot fold. Nested folds keep their state when an ancestor reopens. Callouts, quotes and fences do not fold. Editor only: preview and exports show everything; fold commands are disabled in preview and the folds return when switching back.

**Mechanism.** The hidden lines are wrapped in a `display:none` element inside the editor's DOM; their text still serialises, so the file is untouched. The fold head carries a marker element (contributes no text) with a 24px gutter target between the margin rule and the text holding `›` (folded) / `⌄` (open) in utility `--ui-xs`, `--paper-dim`, visible on hover of the line, on keyboard focus, and always when folded; blue focus ring; `aria-expanded`; Enter/Space toggle. A folded head shows a generated `…` (not serialised) with accessible text "N lines hidden".

**Commands.** `fold-toggle` **Fold or unfold at caret** **Ctrl+Alt+.**; `fold-all` **Fold all** **Ctrl+Alt+[**; `unfold-all` **Unfold all** **Ctrl+Alt+]**. Toggle acts on the caret's foldable head, else the innermost foldable range containing the caret. Fold all includes nested ranges. The View menu gains sections: **Reading** (preview, live), **Navigation** (outline, footnotes), **Folding** (fold-toggle, fold-all, unfold-all), **Workspace** (focus, typewriter, peek, graph).

**Editing rules.** Folding over the caret/selection collapses the selection to the head's end. Typing on the head keeps the fold while the head stays foldable; Enter on the head unfolds first. Arrow navigation skips hidden lines; an edit or selection that crosses hidden text reveals the folds it touches. Activating a find match, outline row, footnote jump or any navigation into hidden text unfolds every ancestor; merely computing matches does not. Moving a folded head moves its section/subtree and keeps descendant folds. Redraws preserve folds; folds are tracked by head line position mapped through edits, never by text alone; a deleted or no-longer-foldable head loses its fold. Folding is not an undo step.

**Persistence.** `ui.folds[noteId] = { updatedAt, heads: [{ line, kind: 'heading'|'list', depth, text }] }`, zero-based lines, at most 200 notes (least recently changed evicted), pruned when a note is gone. On load a stored line is validated; otherwise relocated only to a unique match of kind+depth+text, discarded when ambiguous. Two panes on one note share the folds.

## 5. Table and card views over properties

**Model.** A view is a saved search's presentation. `SavedView` gains optional `layout: 'list'|'table'|'cards'` (default list), `columns: string[]` (ids `title`, `updated`, `prop:<key>`), `sortBy`, `sortDir: 'asc'|'desc'` (default asc), `groupBy: string`. The CLI reads `query` and ignores the rest. The current search box query can be shown as a table ad hoc; saving captures query and presentation.

**The view tab.** A view opens as a tab in the focused pane, with an identity of its own: an opaque UUID tab id carrying a snapshot `{ name?, query, layout, columns, sortBy, sortDir, groupBy }`. (Implementation: tab ids stay strings so every tab routine and workspace is unchanged — a view tab's id is `view:<uuid>` and its record lives in `ui.viewTabs[uuid]`, persisted beside `ui.panes` and inside workspaces.) Renaming a saved search updates its tabs; forgetting one leaves the tab as an ad hoc snapshot. Tab label: the saved name, else the ellipsised query with the full text on hover. Clicking a saved-search chip whose layout is table/cards puts the query in the box and opens or re-activates that search's view tab in the focused pane, keeping the other tabs; a list-layout chip behaves as today. While a view tab shows: the title field shows the name read-only, marginalia, breadcrumb and the outline/footnotes column are hidden, the pills are greyed, every **This note** command (Export included) is disabled, tab commands work.

**Controls.** One utility `--ui-sm` row above the grid: **N notes · Columns… · Group by… · Layout · sort readout · Query order**. Columns… opens a searchable sheet (checkboxes; Move up / Move down; the vocabulary's keys plus an explicit new-key entry; Title always first and not removable). Layout opens the List/Table/Cards picker. Group by… picks one property or none. Query order clears the presentation sort. No drag, no column resizing.

**Table.** Default columns: Title, then up to four distinct `prop:` keys from the query in query order, then Updated (six at most). Widths: Title 240px, property 160px, Updated 180px, × interface scale, overflow scrolls horizontally. Title opens the note in a new tab beside the view (the view tab stays). A header click sorts asc, again desc, and sets `sortBy/sortDir`; the full query (including `limit:`) is applied first, then presentation sort: numbers numerically when both are numbers, else canonical text, missing/null last either way, ties by note id. Grouping renders a utility heading row per distinct value with a count, lists grouped by their whole value, missing/null under **No value** last, groups ascending, the sort applied within each.

**Editing.** Click or Enter on a focused property cell edits it: checkbox for booleans, number input for numbers, text input otherwise; lists in YAML flow (`[red, blue]`), never comma-split; an empty cell accepts a scalar or a list. Enter/blur commit through `setProperty`, Esc cancels. Clearing removes the key; `""` and `null` keep those values. Invalid values and mappings are rejected without closing the editor; a failed write keeps the input and shows the error. Not undoable in 0.28.0 (like the Properties sheet; the hint says so). Title, Updated and system metadata are read-only. Results refresh after a commit.

**Cards.** Responsive grid, 240px minimum, 12px gaps, one column when narrower. Serif title, then the first four selected properties (Title/Updated excluded) as key–value rows, then one ellipsised body line. Read-only; the title opens the note. Same grouping.

**Command.** `view-layout` — **Layout for this search…**, **Ctrl+Alt+V**, Note → Saved searches (after Forget). On a note tab it reads the search box (empty → "Type a search first"); on a view tab it edits that view. Out of scope: `.base` files, formulas, bulk edits, view exports.

## 6. Attach any file

**Allowed.** Any file up to 50 MiB. Sniffed: images (as today), PDF, MP3, WAV, Ogg, FLAC, MP4, WebM; only verified formats render inline. Everything else attaches as an opaque file. Opening from inside the app is allow-listed: the verified formats plus `txt md csv rtf docx xlsx pptx odt ods odp`; anything else (executables and scripts included) attaches but **Open** is disabled.

**Names and markdown.** `<16 hex>.<ext>` where ext is the sniffed one, else the lowercased original extension (1–16 ASCII alphanumerics, else `bin`). The original base name is the escaped link text: `[report.pdf](note-asset://0123456789abcdef.pdf)`, `[interview.mp3](…mp3)`, `[demo.mp4](…mp4)`, `[budget.xlsx](…xlsx)`, `[archive.zip](…zip)`. Images keep `![alt](note-asset://…)`. No byte deduplication. Legacy names stay valid; `SAFE_NAME`/`assetRefs` widen to the new extension rule.

**Preview and HTML export.** A standalone attachment link (alone on its line) expands: PDF → an `<iframe>` 480px high; audio → `<audio controls preload="none">`; video → `<video controls preload="none">` full width, 480px max height; each with a file-name-and-size link above it. A link inside prose stays inline. Other files → an iconless chip (utility `--ui-sm`, raised background, `--line` border, blue file name, secondary size); click/Enter opens eligible files through the main process (`shell.openPath` on the file inside the attachments folder, after containment validation). HTML export keeps images inline as data URIs and writes every non-image as a sidecar file beside the page with relative URLs (chips become ordinary download links). PDF/PNG/print replace non-image attachments with static name-and-size chips. A missing asset shows **Missing attachment**.

**Editor.** Attachment links stay ordinary live-formatted markdown links; click positions the caret. `attachment-open` — **Open attachment**, **Ctrl+Alt+A**, Write → Edit (last), enabled only when the caret is on an existing, eligible attachment link. The native right-click menu gets the same item when the click lands on an attachment link (disabled when ineligible; acts on the clicked link without moving the caret); both paths share one validation and one execution in the main process.

**Entry points.** `attach` is renamed **Attach a file…** (chord, pill, slash unchanged); the picker defaults to All files with an Images preset. Dropped `.md`/`.txt` still import as notes; every other dropped file attaches; the picker and an Explorer-file paste attach `.md`/`.txt` too. Status: "Attached N files"; failures name the file and the reason without discarding the successes.

**Housekeeping.** The 10-minute orphan grace and trash protection apply to every kind. CSP: `note-asset:` added to `frame-src` and `media-src`; `object-src 'none'`; only generated, validated PDF frames pass sanitisation. Out of scope: Office previews, an attachment manager, renaming, drag-out, transcoding.

## 7. Registry after this round

82 commands. New: `callout` (Ctrl+Alt+C), `footnote` (Ctrl+Alt+E), `footnotes` (Ctrl+Alt+O), `fold-toggle` (Ctrl+Alt+.), `fold-all` (Ctrl+Alt+[), `unfold-all` (Ctrl+Alt+]), `view-layout` (Ctrl+Alt+V), `attachment-open` (Ctrl+Alt+A). Write → Insert: attach, divider, callout, footnote, code, task, template-insert, block-copy, block-link, date. Write → Edit: undo, redo, find-in-note, replace-in-note, attachment-open. Slash (registry order): attach, divider, callout, footnote, task, template-insert, block-link, date, table. View sections: Reading, Navigation, Folding, Workspace. Note → Saved searches: view-save, view-open, view-forget, view-layout.

## 8. Words

Release title: **More room for what belongs in a note**. README leads: **Callouts**, **Footnotes beside your writing**, **Fold headings and lists**, **Tables and cards for saved searches**, **Attach any file**. Help-sheet rows: `> [!info]` — Start a callout with an optional title after the type. `[^1]` — Reference a footnote defined with `[^1]: text`. `Click ›` — Expand a folded heading section or nested list. `Drop a file` — Attach a file; dropping Markdown or text imports notes.

## 9. Verification

Unit tests proven to fail without the change: markdown-core (callouts, footnotes, attachment rendering), inline.ts (callout/footnote shaping), a new `folds.ts` core (ranges, mapping through edits, persistence pruning), a new `footnotes.ts` core (collection, numbering, rail rows, definition rewrite), `settings` (view presentation fields), a new `viewtable.ts` core (columns, sort, group, cell parse), `assets`/`attachments` (names, sniffing, allow-list), `registry.test.ts` (82, sections, nine slash), `scale.test.ts` for the stylesheet. A new CDP harness `features-check.mjs` against the packaged build, and `scale-check.mjs` extended to the rail, the table, the cards and a callout.

## 10. Approval

Codex answered **APPROVED** with three amendments, all binding:

1. Insert footnote is disabled inside code (a fence or a code span) as well as in preview; both the Callout and the Footnote slash invocations remove their `/query` before inserting.
2. The rail omits duplicate-definition rows; numbers and text are keyboard-activatable; **↩ Back** commits any open edit before restoring selection and scroll; selection and scroll are preserved during edits; in preview an unreferenced row jumps to its authored definition and an undefined row to its first reference; the Footnotes command stays toggleable below 820px and on a note with no footnotes.
3. Markdown export copies every referenced attachment kind into `<Name>_files/` and rewrites the URLs; exports report missing attachment file names; PDF/PNG/print attachment chips carry neither embedded bytes nor internal links that cannot be followed.
