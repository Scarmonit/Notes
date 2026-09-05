# Five features brainstorm — Codex Q&A (2026-09-05, v0.28.0)

Verbatim questions and answers. Codex CLI (codex exec, read-only sandbox on this repo) answered every question as the product owner; the settled design is in 2026-09-05-five-features-spec.md.

---


# QUESTION 1 of ~8 — Callouts: syntax, look, editor treatment, insert command

Settle callouts end to end. Facts: a callout is a blockquote whose first line is `> [!type] optional title`, optionally `[!type]-` (starts folded) or `[!type]+` (starts open, foldable). Obsidian ships 13 types with aliases (note; abstract/summary/tldr; info; todo; tip/hint/important; success/check/done; question/help/faq; warning/caution/attention; failure/fail/missing; danger/error; bug; example; quote/cite) and an unknown type falls back to `note`. The preview, every export and the CLI render through one marked instance, so whatever is decided renders everywhere at once. The editor is live-formatted per line: today a `> ` line gets a `.md-quote` wrapper with the `> ` marker faded.

**A. Type palette / colour.** The design language has one accent (the red margin rule) and one blue. Options:
  1. One neutral treatment for every type (raised panel, left rule in `--line`, type name + icon glyph in the small uppercase register), the type only changing the label. Zero new colours.
  2. A SMALL semantic palette: 3–4 new tokens (e.g. `--callout-info` blue reuses `--blue`; `--callout-warn` amber; `--callout-danger` reuses `--margin` red; `--callout-ok` green reuses `--code-string` #9ec89a), with the 13 types mapped onto them; the colour appears only in the left rule and the title glyph, the body stays paper on raised.
  3. Obsidian's full 13-colour scheme.
Pick one and, if 2, give the exact token names, hex values (or which existing token each reuses) and the type→token mapping.

**B. Icon.** Text glyph per type in the title line (e.g. `ⓘ`, `⚠`, `✓`), no icon at all, or an inline SVG set? Say which, and if glyphs, list the 13.

**C. Fold.** In the preview: `[!x]-` renders folded with a chevron in the title, click toggles; `[!x]+` renders open with a chevron; plain `[!x]` has no chevron. Is that right? And in exports (static HTML/PDF): render `-` callouts folded (content hidden — lossy), open (ignore the fold), or use `<details>` in HTML so it stays interactive there and expanded on paper?

**D. Live formatting in the editor.** Options: (1) only the first line gets a `.md-callout` wrapper (type name coloured/labelled, `> [!info]` marker faded like other markers), body lines stay ordinary `.md-quote` lines; (2) the whole block gets a left rule in the type colour drawn per line via a class on every line of the callout; (3) nothing beyond today's quote treatment. Note the editor is line-by-line HTML; a per-block box is not available without restructuring. Pick.

**E. Insert command.** Name (label), id, chord (or none), menu section (Write → Insert), `slash: true`?, and what it inserts (e.g. `> [!note] ` on a fresh line with the caret after it? a picker of the 13 types first? a default type?). Also: should typing `> [!` offer completion of the types (out of scope is fine)?

**F. Unknown types and nesting.** Unknown `[!foo]` → render as `note` but keep the label "Foo"? Nested callouts (a callout inside a callout) — support, since marked's blockquote nests naturally, or out of scope?

Answer A–F with one pick each and the specifics.

### Codex's answer

**A. Palette — option 1, neutral.** Support all 13 canonical types and every listed alias, case-insensitively. Use raised-panel background, a 2px `--line` left border, 12px padding, and no shadow. Type label: `.u`, `--ui-xs`, `--paper-dim`; optional title: serif at the body size, paper colour. Body retains normal note typography. No new colours; red remains exclusive to the page margin.

**B. Icon — none.** The type label supplies the distinction. Display canonical labels: Note, Abstract, Info, Todo, Tip, Success, Question, Warning, Failure, Danger, Bug, Example, Quote. An explicit title follows the label; without one, show only the label. Fold chevrons are controls, not type icons.

**C. Fold — interactive HTML, expanded paper.** Yes to the proposed preview behaviour: `-` starts closed, `+` starts open, plain syntax is nonfoldable. Use native `<details>/<summary>` for foldable callouts in preview, exported HTML and CLI HTML; preserve the authored initial state. Summary supports click and Enter/Space with visible keyboard focus. PDF, PNG and printing expand **every nested callout**, ensuring all content appears. Preview toggles are temporary per mounted pane and never rewrite markdown. Persisting that interaction is out of scope.

**D. Editor — option 2, neutral rule.** Mark every callout line with a continuous 2px `--line` border and raised background; identify block membership using quote depth and fenced-code boundaries. Keep source text intact: the first line receives utility styling for its type token; markers follow existing caret-dependent fading/hiding. Body lines retain quote formatting. No generated duplicate label or title. Callouts stay expanded while editing, including `-`; editor callout folding and per-block DOM restructuring are out of scope.

**E. Insert — “Insert callout”.** Registry id: `callout`; chord: **Ctrl+Alt+C**; **Write → Insert**, after Divider; `slash: true`. No header pill or picker.

Insert these two lines, with the caret after the second line’s space:

```markdown
> [!note]
> 
```

Insert before the current line when the caret is at its start; otherwise after that line. Add blank-line separation where needed to prevent merging with adjacent blocks. Preserve selected text. Slash invocation first removes its trigger/query. Disable in preview. Type completion is out of scope; edit `note` directly.

**F. Unknown types and nesting.** Unknown types use Note treatment but display their supplied name with its first letter capitalized: `[!foo]` → **Foo**. Preserve source spelling; escape labels as text. Support nested callouts at every quote depth in live formatting and shared rendering, including independent preview folds. Recognize callouts only at a blockquote’s first content line, never inside fenced code.
---


# QUESTION 2 of ~8 — Footnotes: syntax coverage and how they render

Settle the footnote *syntax and rendering*; the rail is the next question. Facts: marked has no built-in footnotes (a `marked-footnote` package exists, but the app owns its marked instance and can write its own tokenizer; adding a dependency is allowed but the builder prefers a small in-house extension). Typora and Obsidian: `[^id]` reference, `[^id]: definition text` on its own line (multi-line continuation indented four spaces), inline `^[text]` footnotes (Obsidian yes, GFM no). Definitions can sit anywhere in the note; rendering collects them at the bottom in reference order and numbers them 1..n regardless of the id text.

**A. Coverage.** (1) `[^id]` + `[^id]:` only (GFM). (2) Both of those plus inline `^[text]`. Pick. If 2, how does an inline footnote get numbered and listed — same 1..n sequence as the referenced ones, in order of appearance?

**B. Rendered form (preview, HTML export, CLI).** Reference: `<sup class="footnote-ref"><a href="#fn-N" id="fnref-N">N</a></sup>`? Definitions: an `<section class="footnotes">` at the end of the note with an `<ol>`, each item ending in a back-link `↩` to the reference? Should there be a heading/label ("Footnotes" in the uppercase register, or a rule only)? In PDF/paper output the same? Multiple references to one id: one definition, back-links to each? Undefined `[^x]` reference: render as literal text, or as a superscript marked missing?

**C. Hover.** Typora shows the definition on hover over the superscript. The app already has a hover "peek" card infrastructure (`peek.ts`, 450ms dwell, one card ever) for links. Should hovering a footnote superscript in the preview show the definition in that card (reusing the card and its rules), a native `title=` tooltip only, or nothing (the rail is the view)? Pick.

**D. Live formatting in the editor.** Reference `[^id]` → superscript-styled span with the brackets faded? Definition line `[^id]: text` → the `[^id]:` label styled in the utility register and the text as normal? Inline `^[text]` → the `^[` `]` faded and the text set small? Pick what each of the three looks like, or say "faded markers only".

**E. Jumping.** Clicking a superscript in the preview scrolls to the definition and clicking `↩` back — standard. In the EDITOR (not preview), should clicking a `[^id]` reference move the caret to the definition line (and clicking the definition label go back to the first reference)? Or is editor-side jumping only via the rail (next question)?

**F. Insert command.** Name/label, id, chord, menu section, `slash: true`? What does it do: insert `[^N]` at the caret with the next free number AND append `[^N]: ` at the end of the note (after a blank line), then put the caret… where — at the definition (to type it) or leave it at the reference? Pick one concrete behaviour. Should it prefer numeric ids (`[^1]`) or short words? If the note already has `[^3]`, the next is `[^4]`; if ids are words, the next number is the count+1.

Answer A–F.

### Codex's answer

**A. Coverage — option 2.** Support named references, definitions with four-space continuation, and inline `^[text]`. Use one 1..n sequence in first-reference order; each inline footnote creates a distinct entry. Repeated named references share a number. IDs are case-sensitive, nonempty, and contain no whitespace or brackets. First definition wins; leave duplicate definitions visible as ordinary text. Unreferenced definitions remain visible where authored, without numbering. Ignore syntax inside code and escaped syntax. Inline notes support balanced brackets, escapes and inline formatting; nested footnotes are out of scope. Use a small in-house shared-renderer extension.

**B. Rendered form.** Use the proposed superscript anchors and a terminal `<section class="footnotes"><ol>…</ol></section>`. Prefix generated IDs with a unique render-instance namespace to avoid collisions across panes and embeds; references use `fnref-N-K`, where K is the occurrence number.

Add a 1px `--line` separator and **Footnotes** label in `.u`, `--ui-xs`, `--paper-dim`. Definition bodies retain normal serif typography. References and backlinks use link blue; superscript numbers use `--ui-xs`. Each entry ends with one `↩` per reference, with accessible names such as “Back to reference 2 of footnote 3.” Support keyboard activation and visible focus. Undefined references remain literal text.

PDF, PNG and print include the same numbered endnotes, fully expanded; omit backlinks on those outputs. These are endnotes, not page-bottom footnotes. No generated footnotes label in the heading outline.

**C. Hover — reuse peek.** Preview superscripts show the rendered definition after the existing **450ms** dwell, using the same single-card rules. No recursive footnote peeks. Clicking still jumps. Exported HTML and CLI HTML use anchors only; no hover script or native tooltip.

**D. Live editor.** Style the source ID in `[^id]` as a utility superscript at `--ui-xs`; apply existing caret-dependent marker treatment to `[^` and `]`. Do not substitute generated numbers. Definition labels use `--ui-xs` utility text and `--paper-dim`; bodies retain normal typography. Inline notes keep their text at normal body size, with only `^[` and `]` treated as markers. Preserve every source character.

**E. Editor jumping — rail only.** Clicking source references or definition labels positions the caret normally.

**F. Insert — “Insert footnote”.** ID `footnote`; **Ctrl+Alt+N**; **Write → Insert**, after Callout; `slash: true`; no pill. Disabled in preview and code contexts.

Insert `[^N]` at the caret, or after preserved selection. Append `[^N]: ` after blank-line separation; move the caret after its space. One undo reverses both edits. N is one greater than the largest positive numeric ID used in references or definitions; with only word IDs, start at 1. Slash invocation first removes its trigger/query.
---


# QUESTION 3 of ~8 — The footnotes rail, plus one chord correction

**Correction first (answer in one line):** Ctrl+Alt+N cannot be the Insert footnote chord — it is the app's default GLOBAL "Summon Notes" hotkey (registered with Windows; the window never sees it). Pick another free chord for `footnote` (free: ctrl+alt+ a b e g h i k l o p q r s t u v w x y z, ctrl+shift+q, ctrl+shift+z, ctrl+shift+[ ], ctrl+shift+, ctrl+shift+.).

Now the rail. Facts: the outline is a `<nav class="outline">` column to the RIGHT of the page inside `.page` (grid: marginalia | text | outline). It only appears when the note has ≥2 headings and the pane is ≥820px wide; it lists one button per heading; the heading the caret is under is lit; a click scrolls the editor/preview there. It is toggled by the `outline` View command (Ctrl+Shift+L) and a Layout checkbox, state in `ui.outline` (localStorage). See the attached screenshot for how it looks.

The brief: "a rail beside the page that lists and edits the note's footnotes without losing your place".

**A. Where.** Options:
  1. SAME column, stacked: the outline on top, a "FOOTNOTES" section under it (label in the same `.u` register), the column appearing when EITHER has content (≥2 headings OR ≥1 footnote).
  2. Same column, SWITCHED: one rail, a small two-way toggle at its top (Outline | Footnotes), remembered in `ui`.
  3. A second column to the right of the outline (page grows to four columns).
Pick, and give the width threshold (keep 820px?) and the ordering.

**B. What a row shows.** Number (1..n as rendered), then the definition text, one line, ellipsised? Or wrapped to at most 3 lines? Include the id when it is a word (`[^smith]`)? Inline `^[…]` footnotes in the list too (they have no definition line — editing one edits the inline text)? An undefined reference (`[^x]` with no `[^x]:`) listed as a row that says "No definition" and offers to make one?

**C. Editing in place.** "Edits the note's footnotes without losing your place" — options: (1) each row is a small textarea (contenteditable) bound to the definition text; typing rewrites the `[^id]: …` line in the body (debounced, one undo step per pause), the editor caret and scroll untouched; (2) a row is read-only; clicking it moves the caret to the definition line, and a second control jumps back to the reference; (3) both: click the number to jump to the reference, click the text to edit it in place, a small "↩ back" that returns the caret to where it was. Pick one, and say exactly what happens to multi-line definitions (continuation lines) in the row editor, and what Enter does in the row (new line inside the definition? blur?).

**D. Commands.** A View command "Footnotes" (id `footnotes`, toggle, `on:` state) with a chord? Add it to the Layout sheet as a checkbox like Outline? Where in the View menu (after `outline`)? Should the outline's `ui.outline` and this share one "rail" setting or be independent?

**E. Preview.** Does the rail show in preview mode too (the outline does), and does clicking a row scroll the preview to the endnote?

**F. Out of scope.** Say what is explicitly out: reordering/renumbering footnotes, converting inline↔named, deleting a footnote from the rail, drag?

Answer the correction and A–F.

### Codex's answer

Correction: **Insert footnote (`footnote`) → Ctrl+Alt+E**; Ctrl+Alt+N remains Summon Notes.

**A. Placement — option 1, stacked.** Keep the existing right column and **820px pane-width threshold**. Outline first, Footnotes second, separated by a 1px `--line` rule and 16px spacing. Show the column when either enabled section has content; retain the outline’s ≥2-heading rule. Each section scrolls independently when both overflow, splitting available height equally. Below 820px, hide the rail without changing preferences.

**B. Rows.** Show numbered entries in rendered first-reference order, including inline notes. Definition excerpts wrap to **three lines**, then ellipsise. Use utility `--ui-sm`, paper text, blue reference numbers; labels use `.u` and `--ui-xs`. Show nonnumeric IDs as secondary `[^smith]` text; inline entries say “Inline.”

After numbered entries, show unreferenced definitions in source order, identified by ID without numbers. Then list unique undefined IDs in first-occurrence order: `[^x] · No definition`, with **Create definition**. That explicit action appends `[^x]: ` with blank-line separation and opens its rail editor without moving the document caret. Duplicate definitions receive no additional row.

**C. Interaction — option 3.** The number jumps to the reference nearest the saved document caret, choosing the following occurrence on ties. Text opens one plain textarea at a time. Both controls support keyboard activation. Capture the document selection and scroll before entering the rail; **“↩ Back”** commits and restores both, mapping positions through edits.

Named-definition editors contain the complete markdown body, removing exactly four structural spaces from continuation lines; saving reinstates them. **Enter inserts a newline.** Inline editors edit only the bracket contents, preserve valid escaping, and remain single-line; Enter commits. **Ctrl+Enter commits; Escape cancels uncommitted changes; blur commits.** Each changed commit is one document undo step. No debounce writes. Editing preserves document selection and scroll; emptying text retains the footnote syntax.

**D. Commands.** Add **Footnotes**, ID `footnotes`, **Ctrl+Alt+O**, immediately after Outline in View, plus a Layout checkbox. Independent `ui.footnotes`, default **true**; `on:` reflects that preference. It remains toggleable below the threshold and on empty notes. No shared rail setting.

**E. Preview.** Show the same rail, read-only. Clicking numbered definition text scrolls to its endnote; its number jumps to a reference. Unreferenced entries jump to their authored definitions; undefined entries jump to their first reference. Back restores preview scroll. Create definition remains visible but disabled.

**F. Out of scope.** Rail deletion, ID editing, manual ordering/numbering, inline↔named conversion, drag, narrow-pane overlays, and exported rails. Numbering still updates automatically from source order.
---


# QUESTION 4 of ~8 — Folding headings and lists

Facts about the editor that constrain this: it is ONE contenteditable whose text nodes ARE the markdown; live formatting redraws individual lines as `<span class="md-…">` wrappers after each keystroke (bottom-up patching by line span), and a serializer walks the DOM ignoring wrappers. There is no per-block DOM. A fold therefore has to be: the folded LINES wrapped in an element with `display:none` (their text still serializes, so the file is untouched and the caret can be kept out of them), plus a marker on the fold-head line. `src/core/blocks.ts` already knows heading extents and list-item subtrees (indent-based); `outline.ts` knows heading ranges. The preview is separate rendered HTML (`<h2>…` then siblings), where folding could be done in the DOM too. Obsidian: gutter chevron on hover beside a heading or list item, chords "Fold/Unfold", "Fold all / Unfold all", remembers folds per file.

**A. What can fold.** (1) Headings only (the section down to the next heading of the same or higher level). (2) Headings + list items that have an indented sub-list (the item's subtree). (3) Also callouts / blockquotes / fenced code. Pick.

**B. Where the chevron lives.** The text column has a left margin gutter (the red rule runs there). Options: (1) a small chevron `›`/`⌄` drawn at the left of the fold-head line, visible on hover of that line and always visible when folded; (2) chevron always visible on every foldable line (Obsidian shows on hover). (3) chord-only, no chevron (the outline rows could get a chevron instead). Pick, and give its size/colour (`--paper-faint`, `--ui-xs`?) and how a folded head shows what is hidden (an ellipsis `…` after the heading text? a count "12 lines"?).

**C. Chords and commands.** Registry entries: `fold` "Fold this section" and `unfold`? Or one toggle `fold-toggle` "Fold or unfold at the caret"? Plus `fold-all` and `unfold-all`. Chords — free: ctrl+shift+[ and ctrl+shift+] (Obsidian uses Ctrl+Alt+[ / ] for fold/unfold... pick what fits this app), ctrl+alt+ a b g h i k l p q r s t u v w x y z, ctrl+shift+q/z/,/. . Which menu (Write? View? — they change what is seen, not the text, so View seems right; View is unsectioned today; adding four commands to View may want a section — say whether View gets sections now, and the order).

**D. Behaviour details.** Caret inside a section that gets folded → where does it go (to the head line)? Typing on a folded head line → stays folded? Enter at the end of a folded head → unfold, or insert after the hidden block? Search/find-in-note matching hidden text → unfold that fold? Moving lines / move-section on a folded head → operate on the whole section (already true) and keep the fold? An outline click on a heading whose fold hides it → unfold ancestors. Live-format redraw must keep folds (they're keyed by line; a line insert above shifts them — say: folds are keyed by the head line's TEXT+level, or by line number and re-anchored on edit?).

**E. Persistence.** (1) `ui` localStorage map `folds[noteId] = [headLineText…]`, capped, pruned when the note goes; (2) front matter (`folds:` list — writes to the file, Obsidian would ignore it; goes against the "no machine-added markdown" rule); (3) not remembered. Pick and give the shape and cap.

**F. Preview.** Do folds apply in preview too (the same fold set hiding the rendered section), with the chevron on the rendered heading? Or is folding an editor-only feature (preview and exports always show everything)? Pick.

Answer A–F.

### Codex's answer

**A. Scope — option 2.** Fold headings and list items containing an indented sub-list. Keep the head line visible; hide subsequent lines within its section or item subtree. Empty sections cannot fold. Nested folds retain their state when ancestors reopen. Additional folding of callouts, blockquotes and fences is out of scope; Decision 1 remains unchanged.

**B. Chevron — option 1.** Place `›`/`⌄` in a **24px gutter target**, between the margin rule and text, without moving either. Glyph: utility `--ui-xs`, `--paper-dim`; visible on line hover, keyboard focus, or whenever collapsed. Use blue focus indication. Append a generated `…` to collapsed heads, with accessible text “N lines hidden.” Controls and indicators contribute no serialized text. Buttons expose `aria-expanded` and support Enter/Space.

**C. Three registry commands.**

- `fold-toggle`: **“Fold or unfold at caret”**, **Ctrl+Shift+[**.
- `fold-all`: **“Fold all”**, **Ctrl+Alt+[**.
- `unfold-all`: **“Unfold all”**, **Ctrl+Shift+]**.

Toggle targets the caret’s foldable head, otherwise its innermost containing foldable range. All commands affect the active note; Fold all includes nested ranges.

Section View in this order: **Reading** (Preview, Live formatting); **Navigation** (Outline, Footnotes); **Folding** (the three commands above); **Workspace** (Focus, Typewriter, Peek, Graph). Keep unavailable commands greyed. No slash entries or pills.

**D. Editing rules.** Collapsing across the caret or selection collapses the selection to the visible head’s end. Typing on that head preserves folding while it remains foldable. Enter unfolds before performing normal insertion. Arrow navigation skips hidden lines; any edit or selection crossing hidden text first reveals affected folds.

Activating a find result, outline target, footnote jump or other navigation target unfolds every ancestor hiding it; merely computing search matches does not.

Moving a folded head moves its whole section/subtree and retains descendant folds. Redraws preserve folds. Track head line positions through edit mappings, including moves; never use text alone as identity. Deleted or no-longer-foldable heads lose their fold. Folding creates no document undo step.

**E. Persistence — option 1.** Store `ui.folds[noteId] = {updatedAt, heads: [{line, kind, depth, text}]}`; lines are zero-based. Keep **200 notes**, evicting least recently changed; prune deleted notes. On reload, validate the stored line, otherwise relocate only to a unique matching kind/depth/text; discard ambiguous matches. Synchronize panes showing the same note.

**F. Editor only.** Preview and exports ignore these folds and show complete heading/list content. Disable folding commands in preview; retain editor folds when switching back. Preview folding is out of scope.
---


# QUESTION 5 of ~8 — Table and card views over properties (the Bases-like feature): the model

Facts: a saved search is `{name, query}` in settings.json, shared with the CLI (`notes list --view Due`); clicking its sidebar chip types the query and the note LIST shows the matches. Properties are front-matter keys; `store.setProperty(id, change)` rewrites exactly one line of one file and is already reachable from the window, the CLI and MCP; the vocabulary module knows every key in use and its values. The query grammar has `prop:key`, `prop:key=value`, `sort:title|updated|created|words`. Obsidian Bases are a separate `.base` file with views (table/cards), filters, formulas, and per-view column lists.

**A. What a "table view" IS.** Options:
  1. A **display mode of a saved search**: `SavedView` grows optional `{layout?: 'list'|'table'|'cards', columns?: string[], sortBy?: string, sortDir?, groupBy?: string}`; the CLI keeps reading `query` and ignores the rest. The table replaces the NOTE PANE's content (a "view pane": the pane shows the table instead of a note while the view is open; clicking a row opens that note in the pane / a tab).
  2. Same data model, but the table replaces the sidebar LIST (rows are the list items), keeping the pane on the current note.
  3. A new file kind (`.base`-like JSON in the notes folder) with its own sidebar entry.
Pick, with the exact new `SavedView` fields and defaults. Also: is a saved search REQUIRED (must name/save the search first), or can the CURRENT search box query be shown as a table ad hoc (then saved if wanted)?

**B. Columns.** Default columns when none chosen: Title, then every property key that appears in ≥1 of the matched notes (in vocabulary frequency order), then Updated? Or Title + the keys named by `prop:` in the query + Updated? Cap on default columns (6?). How does the user add/remove/reorder columns — a column picker menu on a header button, a "Columns…" picker sheet (the app has a fuzzy picker), or drag? Column widths: auto, or resizable and remembered?

**C. In-place editing.** Click a cell → an input (text; for `true/false` a checkbox; for a number a number field; for a list, comma text?) → blur/Enter commits through `setProperty`, one undo? (property changes today are NOT in the editor's undo stack — say whether table edits are undoable, and if so how: an undo entry keyed by the note). Title editable in the table too (rename)? Adding a property a note does not have yet by typing in its empty cell — allowed? Removing = clearing the cell?

**D. Sort and group.** Sort: click a header toggles asc/desc, stored in the view; values compare as numbers when both are numbers, else text, empty last. Group: a `groupBy` key renders a heading row per distinct value (in the utility register) with a count; is grouping in scope for 0.28.0 or a stated no? Should the query's `sort:` win over a header click, or does a header click rewrite the view's `sortBy`?

**E. Cards.** Card = title, then the first N properties as `key value` rows, then the first line of the body? Fixed card width (~240px grid)? Same columns setting governs which properties show on a card? Editable on the card too, or cards are read-only and the table is the editor?

**F. Commands / entry points.** "Show as table" / "Show as cards" / "Show as list" — one command `view-layout` that cycles, or a picker `Layout for this search…`, or three toggles? Chord? Where in the Note menu (Saved searches section, after view-forget)? Also a `notes list --view X --json` already returns properties; does the CLI need anything (no?). Does the table survive a restart (view pane remembered in `ui.panes`)?

Answer A–F.

### Codex's answer

**A. Option 1: a saved search’s display mode, opening a view pane.** Keep `{name, query}`; add optional `layout: 'list'|'table'|'cards'` (default `list`), `columns: string[]`, `sortBy: string`, `sortDir: 'asc'|'desc'` (default `asc`), `groupBy: string` (default absent). Column identifiers are `title`, `updated`, and `prop:<key>`. Absent sorting preserves query order.

Allow ad hoc views of the current query; saving captures query and presentation. Chips populate search and open the configured presentation; list mode retains today’s sidebar behavior. Title activation opens a note tab, preserving the view tab.

**B. Columns.** Default: Title, up to four distinct properties mentioned by `prop:` filters in query order, then Updated: **six maximum by default**. Title stays first and cannot be removed. A **Columns…** header button opens a searchable sheet with checkboxes and keyboard-accessible Move up/Move down controls; include vocabulary keys and an explicit new-key entry. No drag. Widths: Title 240px, properties 160px, Updated 180px, multiplied by interface scale; horizontal overflow. Resizing and width persistence are out of scope.

**C. Editing.** Click or Enter on a focused property cell edits it. Booleans use checkboxes; numbers use number inputs; text uses text inputs; lists use YAML flow syntax, such as `[red, blue]`, never comma splitting. Missing cells accept YAML scalars or lists. Reject invalid values and mappings without closing the editor.

Enter/blur commits through `setProperty`; Escape cancels. Clearing removes the key; `""` and `null` explicitly retain those values. Missing properties can be added. **Table edits are not undoable in 0.28.0**, matching Properties; label this in the editing hint. Title and system metadata remain read-only. Refresh results after successful commits; failed writes retain input and show an error.

**D. Sort/group.** Header clicks alternate ascending/descending and set presentation sorting; **Query order** clears it. Apply the complete query, including `limit:`, before presentation sorting. Compare numbers numerically when both numeric, otherwise canonical text; missing/null last in either direction; ties use note ID.

Grouping ships: **Group by…**, one property, typed distinct values, lists grouped by their complete value. Utility heading plus count; missing/null share **No value**, last. Groups ascend; selected sorting applies within groups.

**E. Cards.** Responsive grid: 240px minimum, 12px gaps, one column when narrower. Serif title, first four selected properties excluding Title/Updated, then one ellipsised body line. Read-only; title opens the note. Same grouping.

**F. Entry/persistence.** `view-layout`, **“Layout for this search…”**, **Ctrl+Alt+V**: List/Table/Cards picker. Place after `view-forget` under Note → Saved searches; also expose in view headers. No slash/pill. Persist view tabs, including ad hoc query/presentation, in `ui.panes`. CLI unchanged. Separate files, formulas, and bulk editing are out of scope.
---


# QUESTION 6 of ~8 — Attach any file

Facts: attachments are images only today. Bytes are sniffed (PNG/JPEG/GIF/WebP/BMP) and written to `<notesRoot>/attachments/<16 hex>.<ext>` — the original file name is thrown away, the random name is the reference, and the reference is `![alt](note-asset://<name>)` (or an `<img>` tag when resized). The `note-asset:` protocol serves that folder only; the SAFE_NAME regex rejects anything not hex+image extension. The editor draws an image as an inline picture chip; the preview renders `<img>`. Markdown export copies referenced assets into `<Name>_files/`; HTML/PDF/PNG export inlines them as data URIs. An orphan sweep deletes unreferenced files after 10 min. Drop of `.md`/`.txt` imports as notes. Electron can `shell.openPath(file)` to open a file in its default app, and Chromium can show a PDF inline in an `<iframe>`/`<embed>` and play `<audio>`/`<video>`. Joplin: any file attaches as `[name](:/id)`, images inline, PDFs optionally inline, others open externally.

**A. What is allowed.** Any file type at all (with a size cap — say what: 50 MB? 200 MB?), or a list? Executables (`.exe`, `.bat`, `.js`…) — refuse, or allow but never open from inside the app? Sniffing: images are sniffed today; for other kinds trust the extension (lowercased), or sniff PDF/audio/video magic too?

**B. Names and the markdown written.** Keep the random-hex scheme (`<16 hex>.<ext>`) for every kind, with the ORIGINAL file name kept as the link text — `[report.pdf](note-asset://a1b2….pdf)` — so the file stays deduplicated and safe and the note shows the real name? Or store `<hex>-<original name>` so Explorer shows the name too? Pick, and give the exact markdown for: a PDF, an audio file, a video, a spreadsheet, a generic file. (Image stays `![alt](note-asset://…)`.)

**C. Rendering.** Preview + HTML export: PDF → `<embed>`/`<iframe>` inline (height? 480px? with the file name link above it), audio → `<audio controls>`, video → `<video controls>`, everything else → a link chip with the name and size that opens in the default app (through the main process `shell.openPath` on the attachments folder file — never `openExternal` on a `note-asset:` URL). Editor (contenteditable): images are picture chips; should a PDF/media be a chip too (a compact "file chip": icon-less, `report.pdf · 1.2 MB` in the utility register, click opens, double-click…?) or plain link text with live formatting? PDF inline in the EDITOR — yes/no? Pick, and say what a click on a file chip in the editor does (open externally? select the chip like an image?).

**D. Exports.** Markdown export: copy every kind into `<Name>_files/` (already keyed on `note-asset://` refs, so this may just work — confirm). HTML export: inline PDFs/media as data URIs (a 40 MB video becomes a 53 MB HTML file — cap? skip media over N MB and leave a link?). PDF/PNG export: a PDF embed cannot print — render the link chip instead. Pick rules.

**E. Entry points.** Existing `attach` "Attach images…" (Ctrl+Shift+I, pill Attach, slash) — rename to "Attach a file…" and widen its picker filter to All files (plus an Images preset), or add a second command `attach-file`? Drop: any file dropped that is not `.md`/`.txt` attaches (today it says "Only images…"); should `.md`/`.txt` still import as notes (yes?) and is there a way to ATTACH a `.md` (out of scope?). Paste: a copied file from Explorer attaches. Status messages.

**F. Housekeeping.** Orphan sweep applies to every kind (same grace)? `assetRefs`/SAFE_NAME widened to any lowercase extension of 1–8 chars? CSP: `note-asset:` must be allowed in `frame-src`/`media-src`/`object-src` for the embed — confirm the minimum. Out of scope: previews of Office docs, a file manager, renaming an attachment, drag-out.

Answer A–F.

### Codex's answer

**A. Allow any file, maximum 50 MiB (52,428,800 bytes) each.** Sniff images, PDF, MP3, WAV, Ogg, FLAC, MP4 and WebM; only verified formats receive inline rendering. Other files remain opaque attachments. External opening uses an allowlist: verified formats above plus `txt`, `md`, `csv`, `rtf`, `docx`, `xlsx`, `pptx`, `odt`, `ods`, `odp`. Everything else—including executables and scripts—can attach but has **Open** disabled.

**B. Keep random names.** Generate 16 lowercase hex characters plus the verified extension, otherwise the lowercased original extension. Accept 1–16 ASCII alphanumeric extension characters; use `.bin` otherwise. Preserve the original basename as escaped link text. Random naming does **not** deduplicate bytes; deduplication is out of scope.

Exact examples:

- `[report.pdf](note-asset://0123456789abcdef.pdf)`
- `[interview.mp3](note-asset://0123456789abcdef.mp3)`
- `[demo.mp4](note-asset://0123456789abcdef.mp4)`
- `[budget.xlsx](note-asset://0123456789abcdef.xlsx)`
- `[archive.zip](note-asset://0123456789abcdef.zip)`

Images retain existing syntax.

**C. Preview:** standalone attachment links expand into PDF iframes, **480px** high; audio controls; or video controls, full width, maximum **480px** high. No autoplay; media preload is `none`. Keep a filename-and-size link above each. Links embedded in prose stay inline.

Generic files use iconless chips: utility `--ui-sm`, raised background, line border, blue filename, secondary size. Click/Enter opens eligible files through main-process `shell.openPath`, after validating attachment containment.

**Editor:** retain ordinary live-formatted markdown links. Click positions the caret; no double-click override. Add **Open attachment** to the context menu, disabled when ineligible. No inline PDF/media or new chord.

**D. Exports:** Markdown copies every referenced kind into `<Name>_files/` and rewrites URLs. The existing copy loop supports this once name validation widens.

HTML keeps images inlined; **all nonimages use copied sidecar files**, with relative URLs and the same embeds. Generic links download; browsers do not call `shell.openPath`. No size-dependent export modes.

PDF/PNG/print replace nonimage attachments with static filename-and-size chips; no embedded bytes or inaccessible internal links. Missing assets show **Missing attachment**; exports report missing filenames.

**E. Rename existing `attach` to “Attach a file…”** Preserve chord, pill, slash placement; picker defaults to All files, with Images preset. Drop `.md`/`.txt` imports notes; other files attach. Picker and Explorer-file paste attach `.md`/`.txt` too. Report “Attached N files”; failures identify filename and reason without discarding successes.

**F.** Keep the 10-minute orphan grace and trash protection for every kind. Preserve legacy valid names. Add `note-asset:` to `frame-src` and `media-src`; keep `object-src 'none'`. Permit only generated, validated PDF frames through sanitization.

Out of scope: Office previews, attachment manager, renaming, drag-out, transcoding.
---


# QUESTION 7 of ~8 — Cross-cutting: view tabs, Open attachment, a chord trap, the registry, the words

**A. A view as a TAB.** Decision 5 puts a table/cards view in the pane as a tab. Today a pane's tab strip is a list of note ids (`tabs: string[]`, `activeId`), persisted in `ui.panes`. Proposal: a view tab's id is a string with a prefix — `view:<saved name>` for a saved search, `query:<the query text>` for an ad hoc one — so every tab routine (show/add/close/next/prev/Ctrl+1..9, workspaces) works unchanged, and rendering branches on the prefix. Confirm or change. Then: tab label = the view name (ad hoc: the query text, ellipsised)? Pane header while a view tab shows: the title field becomes the view name (read-only), the marginalia column hidden, the folder breadcrumb hidden, the four pills greyed, the outline/footnotes rail hidden; which Note-menu "This note" commands are enabled (none? `export`? `tab-close` yes). Where do "Columns…", "Group by…", "Layout" and "Query order" live on the view — a small header row above the table in the utility register (name · N notes · Columns… · Group by… · Layout · sort readout)? When `view-layout` runs with a NOTE tab active it reads the search box query; if the box is empty → status "Type a search first" (like Save this search)? Clicking a saved-search chip that has `layout: table` opens the view tab in the focused pane (replacing the active tab like choosing a note does) — confirm.

**B. Open attachment.** Decision 6 said "Add Open attachment to the context menu". The editor's right-click menu is Electron's NATIVE menu (main process: spelling, Cut/Copy/Paste, Select all); the renderer right-click menu exists only on sidebar note rows. Options: (1) a registry command `attachment-open` "Open attachment" (chord?) enabled when the caret is on an attachment link, in Write under a new section "Attachments"? or in Write → Edit?; the native context menu ALSO gets the item when the right-click lands on such a link (main-process change, one item, calls back to the renderer); (2) registry command only, no native menu item; (3) native menu item only, no command. Pick, name the chord and section.

**C. Bracket chord trap.** `chordOf` reads `event.key`; with Shift held a US keyboard reports `{` for `[` and `}` for `]` — so `ctrl+shift+[` must be spelled `ctrl+shift+{` in the registry and the shortcuts sheet would print "Ctrl+Shift+{". Options: (1) accept that and print `{`/`}`; (2) special-case the label so the sheet prints Ctrl+Shift+[ while matching `{`; (3) change the fold chords to ones without the problem, e.g. fold-toggle **Ctrl+Alt+.** , fold-all **Ctrl+Alt+[** (no shift, `[` arrives as `[`), unfold-all **Ctrl+Alt+]**. Pick.

**D. Final registry (confirm the arithmetic and names).** 74 today + `callout`, `footnote`, `footnotes`, `fold-toggle`, `fold-all`, `unfold-all`, `view-layout`, plus `attachment-open` if B says so = 81 or 82. Slash commands become: attach, callout, footnote, divider, task, template-insert, block-link, date, table (9; registry order — Codex: is callout/footnote placed after divider, before code?). Write → Insert order: attach, divider, callout, footnote, code, task, template-insert, block-copy, block-link, date — confirm. View sections per Decision 4: Reading (preview, live), Navigation (outline, footnotes), Folding (fold-toggle, fold-all, unfold-all), Workspace (focus, typewriter, peek, graph) — confirm. Chords: callout Ctrl+Alt+C, footnote Ctrl+Alt+E, footnotes Ctrl+Alt+O, view-layout Ctrl+Alt+V, fold per C.

**E. Layout sheet + help sheet.** The Layout checkbox for Footnotes reads: "Footnotes — The note's footnotes beside it, to jump to and edit"? Help-sheet "Moving around" rows to add (each a `<kbd>` + one sentence): `> [!info]`, `[^1]`, `Click ›` beside a heading, `Drop a file` (reworded). Give the four sentences.

**F. Words.** Release title for v0.28.0 (the pattern: "Right-click a note", "Easier to read, and yours to size", "Folders: every note has somewhere to live"). And a one-line README bullet lead-in (bold words) for each of the five features. The builder writes the sentences; you name them.

Answer A–F.

### Codex's answer

**A. Change tab identity.** Use typed tab records: note tabs carry `noteId`; view tabs carry an opaque UUID, optional saved-search name, and query/presentation snapshot. `activeId` identifies the tab. Migrate existing strings; persist records in panes and workspaces. Names and queries are mutable, unsuitable as identity. Renaming updates linked tabs; deleting a saved search leaves an ad hoc snapshot.

Labels: saved name; otherwise ellipsised query, with full text on hover. Confirm proposed header treatment. Disable every **This note** command, including Export; tab navigation/closing remain enabled.

Use one utility `--ui-sm` row: **N notes · Columns… · Group by… · Layout · sort readout · Query order**. Omit the repeated name. In cards, Columns controls displayed properties.

On note tabs, `view-layout` reads the search box; empty means **“Type a search first”**. On view tabs, it edits that view. Chips populate search and open/activate a view tab in the focused pane, **preserving existing tabs**. Reuse an already-open tab for that saved search in that pane.

**B. Option 1.** `attachment-open`, **“Open attachment”**, **Ctrl+Alt+A**, under **Write → Edit**, last. Enable only for an eligible, existing attachment at the editor caret. Native right-click adds the same command when targeting an attachment link, disabled if ineligible; target the clicked link without moving the caret. Both paths use the same validation and execution.

**C. Option 3.** Toggle **Ctrl+Alt+.**; fold all **Ctrl+Alt+[**; unfold all **Ctrl+Alt+]**. No chord-label special cases.

**D. 82 commands: 74 + 8.** Confirm all proposed names and other chords. Confirm Write → Insert order exactly as supplied, with Callout and Footnote after Divider, before Code. Slash order follows registry order:

**attach, divider, callout, footnote, task, template-insert, block-link, date, table** — nine.

Confirm all four proposed View sections and their command order. View controls reuse registry commands where applicable; no extra registry commands for columns/grouping.

**E.** Checkbox: **“Footnotes — Show footnotes beside the note to jump to and edit.”**

Help rows:

- `> [!info]` — Start a callout with an optional title after the type.
- `[^1]` — Reference a footnote defined with `[^1]: text`.
- `Click ›` — Expand a folded heading section or nested list.
- `Drop a file` — Attach a file; dropping Markdown or text imports notes.

**F.** Release title: **“More room for what belongs in a note”**.

README leads: **Callouts**, **Footnotes beside your writing**, **Fold headings and lists**, **Tables and cards for saved searches**, **Attach any file**.

Out of scope: view exports, bulk actions, additional pills, and a general chord-system rewrite.
---


# QUESTION 8 of 8 — APPROVAL GATE

Below is the complete settled design, written from your seven answers. Read it against your decisions. If it is faithful and complete, answer with exactly the word **APPROVED** on the first line, followed by AT MOST THREE amendments (each one sentence, concrete, only where the design departs from what you decided or leaves something needed unsaid). If it is not approvable, answer **NOT APPROVED** and say precisely what must change (still at most three items). Note one deliberate implementation choice for you to accept or amend: view tabs keep string ids (`view:<uuid>`) with the record in `ui.viewTabs`, rather than converting every tab to a typed record — the identity is still an opaque UUID with a snapshot, as you asked, and no tab arithmetic changes.

--- THE SPEC ---

# v0.28.0 — "More room for what belongs in a note": the settled design

### Codex's answer

APPROVED

1. Disable Insert footnote in code contexts as well as preview, and make both Callout and Footnote slash invocations remove their trigger/query before inserting.
2. The rail must omit duplicate-definition rows, support keyboard activation of numbers and text, commit on “↩ Back” before restoring selection/scroll, preserve selection/scroll during edits, send preview unreferenced/undefined rows to their authored definition/first reference respectively, and remain toggleable below 820px or without content.
3. Markdown export must copy every referenced attachment kind into `<Name>_files/` and rewrite URLs; exports must report missing filenames, and PDF/PNG/print attachment chips must contain neither embedded attachment bytes nor inaccessible internal links.