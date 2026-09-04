# Editor-controls brainstorm for 0.21.0 (2026-09-04)

The `brainstorming` skill was run with **Codex CLI as the answering partner** (the user delegated the product-owner role to Codex for this round, as they did for 0.15.0). Every question below went to Codex through `codex exec` — one session, resumed per question, read-only sandbox, cwd = this repo — and the answers are verbatim. The last line of each entry is Claude's one-line reading of the answer.

Path: Architectural. It adds a surface fed by the `Action` registry, changes that registry's interface, and moves the pane header's existing pills.

The user's request, in their own words:

> "start adding buttons to a lot of these shortcuts because as it stands right now it is very confusing trying to memorize all of these different shortcuts it would be much easier if there was some type of editor bar or something like that somewhere."

The settled design is in `2026-09-04-toolbar-spec.md`.

## Q1

**Question (Claude):**

You are the product owner for **Notes**, a keyboard-first markdown notes app for Windows (Electron + TypeScript, at this repo). The user has delegated the product-owner role to you for this design round, exactly as they did for the 0.15.0 round (see `docs/2026-09-03-feature-brainstorm.md` for how that went). I am Claude Code, running the `brainstorming` skill; I will ask you a series of questions, one at a time, and then implement whatever we settle on. Answer decisively and concretely. Do not ask me to decide — you are the one deciding.

## The user's actual request, in their own words

> "start adding buttons to a lot of these shortcuts because as it stands right now it is very confusing trying to memorize all of these different shortcuts it would be much easier if there was some type of editor bar or something like that somewhere."

## Where the app is today

**58 commands, 52 of them with a keyboard chord, 57 chords counting aliases.** There are almost no buttons.

There is exactly one registry that describes every command, in `src/renderer/actions.ts`:

```ts
export type ActionGroup = 'Notes' | 'Writing' | 'View' | 'Window';

export interface Action {
  id: string;
  label: string;          // how it reads in the palette and the sheet
  group: ActionGroup;
  chord?: string;         // 'ctrl+shift+d' spelling
  also?: string[];        // extra chords
  hint?: string;          // a sentence for the shortcuts sheet
  terms?: string;         // extra words the palette finds it by
  run: () => void;
  enabled?: () => boolean; // greyed out and unrunnable while false
  on?: () => boolean;      // for toggles: whether the thing is currently on
}
```

`const ACTIONS: Action[]` lives in `src/renderer/main.ts`. Three surfaces are built from it and nothing else: the keyboard map, the shortcuts sheet (Ctrl+/), and the command palette (Ctrl+Shift+K / Ctrl+P, fuzzy-matched). The file's header comment says the point is that "a shortcut cannot exist without being findable". A toolbar would be a **fourth reader of the same registry**, not a second list.

### The complete inventory, exactly as it stands

**Notes (28)**
- `new` "New note" — Ctrl+N
- `find` "Find a note" — Ctrl+K
- `trash` "Deleted notes…" — Ctrl+Shift+Backspace
- `folder` "Open the notes folder" — *(no chord)*
- `prev` "Previous note" — Ctrl+Up
- `next` "Next note" — Ctrl+Down
- `aliases` "Other names for this note…" — Ctrl+Shift+A *(conditional)*
- `view-save` "Save this search…" — *(no chord)*
- `view-open` "Saved searches…" — Ctrl+Shift+Y *(conditional)*
- `view-forget` "Forget a saved search…" — *(no chord, conditional)*
- `tab-new` "Open a note in a new tab…" — Ctrl+T *(conditional)*
- `tab-close` "Close this tab" — Ctrl+W *(conditional)*
- `tab-next` "Next tab" — Ctrl+Tab *(conditional)*
- `tab-prev` "Previous tab" — Ctrl+Shift+Tab *(conditional)*
- `title` "Rename this note" — Ctrl+R, also F2
- `back` "Back" — Alt+Left *(conditional)*
- `forward` "Forward" — Alt+Right *(conditional)*
- `recent` "Recent notes…" — Ctrl+Shift+B
- `tag-rename` "Rename a tag everywhere…" — *(no chord, conditional)*
- `merge-into` "Merge this note into another…" — *(no chord)*
- `pin` "Pin or unpin this note" — Ctrl+Shift+P **(toggle)**
- `delete` "Delete this note" — Ctrl+Shift+D
- `import` "Import markdown or text files…" — Ctrl+Shift+O
- `export` "Export this note…" — Ctrl+Shift+S
- `history` "Note history…" — Ctrl+Shift+R
- `save` "Save now" — Ctrl+S
- `template-new` "New note from a template…" — Ctrl+Shift+N
- `due` "Scheduled tasks…" — Ctrl+Shift+U

**Writing (16)**
- `table` "Table" — Ctrl+Shift+J *(conditional)*
- `table-row` "Add a table row" — Ctrl+Enter *(conditional)*
- `table-column` "Add a table column" — Ctrl+Shift+Right *(conditional)*
- `table-remove-row` "Remove this table row" — Ctrl+Shift+Left *(conditional)*
- `attach` "Attach an image…" — Ctrl+Shift+I
- `divider` "Insert a section divider" — Ctrl+Shift+H
- `code` "Code block around this" — Ctrl+Shift+C
- `task` "Checklist item on this line" — Ctrl+Shift+X *(cycles: plain → to do → done)*
- `move-lines` "Move lines to another note…" — Ctrl+Shift+V
- `move-section` "Move this section to another note…" — *(no chord)*
- `undo` "Undo" — Ctrl+Z *(conditional)*
- `redo` "Redo" — Ctrl+Y, also Ctrl+Shift+Z *(conditional)*
- `find-in-note` "Find in this note" — Ctrl+F
- `replace-in-note` "Replace in this note" — Ctrl+H
- `template-insert` "Insert a template…" — Ctrl+Shift+E
- `date` "Insert the date" — Ctrl+; (also Ctrl+Shift+; / Ctrl+Shift+:)

**View (6)**
- `preview` "Markdown preview" — Ctrl+E **(toggle)**
- `live` "Live formatting" — Ctrl+Shift+M **(toggle)**
- `outline` "Outline" — Ctrl+Shift+L **(toggle)**
- `focus` "Focus mode" — Ctrl+Shift+F **(toggle)**
- `typewriter` "Typewriter scrolling" — Ctrl+Shift+T **(toggle)**
- `graph` "Graph of the notes…" — Ctrl+Shift+G

**Window (8)**
- `sidebar` "Toggle the sidebar" — Ctrl+\
- `split` "Split the pane" — Ctrl+Shift+\ *(conditional)*
- `pane-close` "Close this pane" — Ctrl+Shift+W *(conditional)*
- `pane-next` / `pane-prev` — Ctrl+Alt+Right / Ctrl+Alt+Left *(conditional)*
- `layout` "Layout and window settings" — Ctrl+,
- `palette` "Command palette" — Ctrl+Shift+K, also Ctrl+P
- `help` "Keyboard shortcuts" — Ctrl+/

## What chrome already exists

Every pane already has a header row (`.pane-head`) with: a sidebar toggle icon button on the left, a status text in the middle, and on the right a row of text pills — **Preview**, **Attach**, **Export** (a real dropdown menu with five formats and arrow-key handling), **Pin**, **Delete**. So six of the 58 commands already have a button. The find bar has its own small buttons (`Aa`, `.*`, prev, next, replace, close). The app's button vocabulary already exists: `.pill.u` (uppercase text pill), `.icon-btn`, `.find-opt`, and a working `role="menu"` dropdown pattern.

## The design stance you have to confront head-on

**The app has no inline formatting shortcuts at all — no Ctrl+B, no Ctrl+I, no heading buttons.** That is deliberate. `src/renderer/richeditor.ts` renders markdown live as it is typed, and the shortcuts sheet says: *"Headings, bold, code and lists take their shape as you write them."* You type `**bold**` or `## Heading` and it becomes bold or a heading in place.

So a conventional Word-style **B** / *I* / H1 / H2 / bullet-list toolbar would be a **change of design stance**, not just new UI, and it would have to insert markdown characters into the rich editor rather than toggle a rich-text run. I am putting this in front of you explicitly rather than letting you assume it either way.

## Constraints that bind any answer

- Visual system is **"ink and margin"**: paper-like, restrained, no new accent colours. The only accent-ish move in the whole app is a 2px `border-left` in the margin colour on the sidebar's selected row.
- Register rule: uppercase `.u` styling is for **short** labels only; anything sentence-length is sentence case.
- **Up to three split panes** can be open side by side. Anything in the pane header is built once per pane, so at a 1440px three-way split each pane is ~470px wide. There are already container queries at 640px (folds the marginalia away) and 820px (drops the outline) that a new bar must participate in.
- The app is and stays keyboard-first. Buttons are an addition, not a replacement, and the chords are not going away.

---

## Question 1 of several

Before we talk about shapes, I want the problem stated properly.

You use this app every day and you asked for this. Describe **the two or three concrete moments** where the missing buttons actually cost you something — what you were doing, what command you wanted, and what happened instead (you gave up, you opened the palette, you guessed a chord and got the wrong thing, you did it by hand). Be specific about *which* of the 58 commands were involved.

Then answer this directly: **is the real problem discoverability (you don't know a command exists), recall (you know it exists but can't remember the chord), or reach (you know the chord fine but your hand is on the mouse)?** These three want different solutions, and the answer determines everything that follows — so pick the dominant one and say why, rather than saying "all three".

**Answer (Codex):**

Three moments keep recurring:

1. While editing, I want to turn the current line into a checklist item, insert today’s date, or add a divider. I know `task`, `date`, and `divider` exist, but I cannot reliably distinguish Ctrl+Shift+X, Ctrl+;, and Ctrl+Shift+H from the many neighboring chords. I open the command palette, type a few letters, and select the command. For something as small as inserting a divider, that feels absurdly indirect.

2. While reviewing a note, I want to change how I’m looking at it—usually `preview`, `outline`, `focus`, or `live`. I remember that each has a shortcut, but not whether Outline is Ctrl+Shift+L or M, or whether Focus is F or something else. Preview already has a visible button, so I use it; for the others I open the palette or simply leave the view unchanged. The missing control changes what I do, not merely how quickly I do it.

3. While organizing notes, I want `history`, `aliases`, `merge-into`, or `move-section`. These are occasional commands, so their chords never become muscle memory—and two do not have chords at all. I typically open the palette, but sometimes I perform the operation manually: copy a section, open another note, paste it, then clean up the original. That is slower and more error-prone than invoking `move-section`.

The dominant problem is **recall**.

I generally know the capability exists, and my hand is usually already on the keyboard. The failure is remembering which chord belongs to which command across 52 shortcut-bearing actions. The palette rescues me, but it makes every forgotten command into a search task.

Discoverability is a meaningful secondary benefit, especially for occasional commands such as `merge-into`, `history`, and `typewriter`, but it is not the primary problem. Reach is third: when my hand happens to be on the mouse, visible controls are convenient, but that alone would not justify a broad editor bar.

So the design target is: provide a stable, visible recognition surface for frequently used and easily confused commands, while keeping the palette as the complete catalog. We should not attempt to put all 58 commands on screen.

**Reading:** the dominant problem is **recall**, not discoverability and not reach. The surface has to be a stable place to *recognise* frequent and easily-confused commands; the palette stays the complete catalog; all 58 do not go on screen.

## Q2

**Question (Claude):**

Good — recall is the target, the palette stays the complete catalog, and we do not try to put all 58 on screen. Noted: "the missing control changes what I do, not merely how quickly I do it" is the strongest line in that answer and I'll hold onto it.

## Question 2 of several: the shape and where it lives

Here are three real shapes. I've costed each against the pane geometry (up to three panes side by side, ~470px each at a 1440px three-way split) and the "ink and margin" restraint. **Pick one, or a named hybrid, and say why the ones you reject are wrong.**

### A — A persistent editor bar: one new row per pane, between the title and the text

A thin row of small buttons sitting under the note title, above the words. Around 10–14 buttons, chosen by a new field on `Action` (say `bar: number` as a priority). Toggles render pressed via the existing `on()`. Disabled ones grey out via `enabled()`. An overflow `…` button at the end opens a menu with the rest of the group. Narrow panes drop buttons into the overflow menu by priority.

- **For:** the requested thing, literally. Always visible, so recognition is passive — you see "Divider" sitting there and stop trying to recall Ctrl+Shift+H. Costs nothing to reach.
- **Against:** it is a permanent horizontal band of chrome across the page in a paper-like app whose whole visual argument is a clean sheet with a margin. At a three-way split, ~470px of pane holds maybe six small buttons before it has to start hiding things — so in the exact case where you have the least room, the bar teaches the least. It also gives *every* pane a bar, tripling the chrome.

### B — A menu bar in the existing pane header: four dropdowns generated from the four `ActionGroup`s

No new row at all. The existing right-hand pill row gains **Note**, **Write**, **View** (Window stays with the app-level items) — each a `role="menu"` dropdown built straight from `ACTIONS.filter(a => a.group === …)`, printing each command's **label and its chord side by side**, disabled items greyed, toggles ticked. Every one of the 58 is two clicks away and its chord is printed next to it every single time you use it.

- **For:** solves recall directly and *teaches* — you cannot invoke "Outline" from a menu without reading "Ctrl+Shift+L" beside it, which is exactly the Ctrl+Shift+L-or-M confusion you named. Zero new chrome height; reuses the export-menu pattern that already works. Survives a 470px pane unchanged, because a menu button is ~50px whatever is inside it. Covers all 58 with no curation argument.
- **Against:** two clicks, not one, for the frequent small ones (`task`, `date`, `divider`). It is a *menu bar*, which is a slightly institutional shape for a paper-like app. And a 28-item "Notes" menu is a long list to scan.

### C — Hybrid: B's group menus for the catalog, plus a *small* always-visible cluster for the handful you actually reach for

The pane header gets the group menus from B **and** four-to-six icon buttons for the genuinely high-frequency writing commands sit in the bar/header permanently — one click each. Everything else lives one click deeper in its menu, chord printed. Optionally the always-visible cluster is what a narrow pane keeps and the menus are what it folds into.

- **For:** one click where frequency justifies it, complete coverage everywhere else, chords taught on every menu use. Degrades gracefully at 470px.
- **Against:** two mechanisms to design and explain instead of one, and it needs a rule for what earns a permanent slot.

**My recommendation is C**, because B alone is the thing that actually fixes recall (printed chords beside labels, every time) while A alone fixes reach — which you ranked third — and B's only real weakness is the second click on the three or four commands you use constantly, which a small cluster removes.

Answer with:
1. **Which shape.** If a hybrid, say precisely what is permanently visible and what is in a menu.
2. **Where it physically sits** — in the existing `.pane-head` pill row, or a new row under the title, or somewhere else. Be concrete; I am going to build exactly what you say.
3. **Per pane or once for the window?** Every pane gets its own (consistent with today's Preview/Attach/Export/Pin/Delete pills, and correct because commands act on *this* pane's note), or one bar at the top of the window that acts on the focused pane (less chrome, but a bar that acts on something other than what it sits above).
4. **Can it be turned off?** The app has a settings dialog (Ctrl+,) with line width, margin, focus, tray. Does this surface get a switch there, and if so what is its default?

**Answer (Codex):**

1. **Choose C: grouped command menus plus a small permanent cluster.**

Permanently visible:

- **Task**
- **Date**
- **Divider**
- **Attach**

Use short text pills, not unlabeled icons. This surface exists to support recognition; ambiguous pictograms would undermine that purpose.

Beside them are four dropdowns:

- **Note**
- **Write**
- **View**
- **Window**

Each menu is generated from its `ActionGroup`. Every item shows its label and primary chord, reflects `enabled()`, and marks `on()` actions. Chordless commands remain included without an empty shortcut placeholder.

The current **Preview**, **Export**, **Pin**, and **Delete** pills move into their appropriate menus rather than remaining as duplicates. Attach stays visible because it is a common editing operation and already has an established button. Preview moves into View: it is easy to find there, while the permanent slots should address the less memorable writing commands that prompted this work.

The permanent-slot rule is: **frequent, local writing actions whose shortcut is difficult to recall and whose effect is immediate and reversible**. It is not a general-purpose favorites system in this round.

2. **Put everything in the existing `.pane-head` right-hand control area. Do not add a row under the title.**

The paper should still begin with the title and then the note. A permanent horizontal toolbar between them would make the editor feel like a document processor and consume vertical space in every pane.

At comfortable widths, show the four writing pills followed by the four group menus, with a subtle separator between the two sets.

At narrow pane widths, degrade in this order:

- Hide **Attach** first because it remains in Write.
- Hide **Divider**, then **Date**, then **Task**, each remaining available in Write.
- Keep the four group menus.
- If all four named menus cannot fit, collapse them into one **Commands** menu containing the same four grouped sections.

Nothing should disappear from access because a pane became narrow.

3. **Per pane.**

Each pane gets the controls, and they operate on that pane directly. A window-level surface acting on whichever pane last held focus would introduce invisible targeting and make destructive actions such as Delete especially uncomfortable.

Only the active pane’s controls should have full visual weight. Inactive panes may render their controls more quietly, consistent with the existing pane treatment, but they remain usable and clicking one should establish that pane as active before running its action.

4. **Yes, it can be turned off; default is on.**

Add a setting named **Show editor controls**, enabled by default. Turning it off hides the new permanent writing pills and group menus, returning the pane header to its minimal form. It must not disable commands, shortcuts, or the palette.

A is wrong because it spends permanent vertical space primarily to improve mouse reach, while recall is the problem we identified. It also performs worst when panes are narrow.

B is close, but insufficient by itself. Requiring a menu traversal for Task, Date, and Divider would leave the most repetitive recall failures feeling unnecessarily ceremonial. C gives those actions a stable visual home while the menus teach and expose the complete command set.

**Reading:** shape **C** — four permanent pills plus four generated group menus, all of it in the existing `.pane-head`, per pane, quieter when the pane is not focused, with a "Show editor controls" switch defaulting to on and a named degradation order for narrow panes.

## Q3

**Question (Claude):**

Settled: shape C, in `.pane-head`; permanent pills Task / Date / Divider / Attach; four generated menus Note / Write / View / Window; Preview, Export, Pin and Delete stop being pills and become menu items; per pane; quieter in inactive panes; a "Show editor controls" setting, default on; narrow-pane degradation Attach → Divider → Date → Task, then collapse to one **Commands** menu.

## Question 3 of several: the formatting stance, which I flagged and you have not yet ruled on

This is the question I most need you to decide, because it is the difference between "surface the commands that exist" and "the app grows a formatting toolbar".

**Today the app has no bold, italic, heading, list or link commands at all.** Not hidden ones — they do not exist in `ACTIONS`. The Write group's 16 items are `table`, `table-row`, `table-column`, `table-remove-row`, `attach`, `divider`, `code`, `task`, `move-lines`, `move-section`, `undo`, `redo`, `find-in-note`, `replace-in-note`, `template-insert`, `date`. Formatting happens by typing markdown, which the live editor renders in place: `**bold**` becomes bold as you close the asterisks, `## Heading` becomes a heading, `- ` starts a list.

So when a **Write** menu opens and it does not contain **Bold**, someone who came looking for a formatting menu finds a menu about tables, dates and templates. That may be exactly right — the app's argument is that you never needed a Bold button — but it is a choice worth making on purpose, because a "Write" menu sets an expectation that the current 16 items do not meet.

Three positions. **Pick one.**

**(i) Hold the line.** No formatting commands are added. The menu is renamed if "Write" over-promises — say **Insert** for the things that put something at the caret, or keep the four groups as they are. Bold stays a thing you type. Rationale: the live editor already made the toolbar unnecessary, and adding one contradicts the app's whole premise.

**(ii) Add formatting commands to the registry, wrapped as markdown edits.** New actions — `bold` (Ctrl+B), `italic` (Ctrl+I), `heading` (cycle H1/H2/H3, or a submenu), `bullet-list`, `numbered-list`, `quote`, `link` (Ctrl+K is taken by "Find a note", so it would need another chord) — each of which **inserts or strips the markdown characters** around the selection or the line, and the live editor then renders the result. They appear in the menus like everything else, and get chords like everything else. Rationale: the ones people reach for by reflex are bold, italic and headings; the app is the only markdown editor that offers none of them, and "you can type the asterisks" is a real answer but not a complete one.

**(iii) A middle position** you name precisely — e.g. only `bold` / `italic` / `link` as markdown-wrapping commands and nothing structural, or formatting available only through the menu with no new chords at all.

If you pick (ii) or (iii), also decide:
- **Which exact commands**, with their exact labels and chords. Ctrl+B and Ctrl+I are free. Ctrl+K is taken by "Find a note". Ctrl+1/2/3 — I need to check, but Ctrl+<number> currently goes to the nth tab, so headings cannot have those.
- **Do any of them earn a permanent pill**, or are they menu-only? You currently have four permanent slots spent on Task / Date / Divider / Attach.
- **What happens on a selection that is already bold** — does the command strip the asterisks (a true toggle), or always wrap (so pressing twice gives `****bold****`)? A toggle is more work and the honest answer, and it also means the menu item can show `on()` state when the caret sits inside a bold run.
- **What happens with no selection** — insert `****` and put the caret in the middle, or apply to the word under the caret?

And regardless of which you pick: **does the shortcuts sheet's line "Headings, bold, code and lists take their shape as you write them" survive this round**, or does it get rewritten?

**Answer (Codex):**

Pick **(i): hold the line.**

No Bold, Italic, Heading, Link, Quote, Bullet List, or Numbered List actions are added. This round surfaces the command system that Notes already has; it does not turn markdown syntax into a second formatting API.

Keep the menu named **Write**. “Insert” would be inaccurate because the group also contains Undo, Redo, Find, Replace, and moving content. “Write” describes the activity rather than promising a conventional word-processor formatting menu. Its contents and restrained pill styling should keep it from reading as a traditional application menu bar.

The permanent pills remain exactly:

- Task
- Date
- Divider
- Attach

This is a deliberate product boundary. Notes’ live formatting makes markdown punctuation part of writing, not implementation debris that the interface must conceal. Adding wrappers, toggle detection, caret-state tracking, and conventional chords would create a substantial new editing model under cover of a discoverability change. It would also make the omission of every subsequent formatting operation look accidental.

Rewrite the shortcuts-sheet line because its current mention of code is muddy now that a Code Block action exists:

> Markdown takes shape as you type: use `#` for headings, `**` for bold, and `-` for lists.

Then add a second sentence:

> Writing commands handle larger operations such as checklists, code blocks, tables, attachments, and templates.

That makes the absence of Bold intentional and legible rather than leaving someone to wonder whether the menu is incomplete.

**Reading:** **hold the line** — no Bold, Italic, Heading, Link, Quote or list commands. The Write menu keeps its name; the shortcuts sheet says out loud why formatting is absent so the gap reads as intentional.

## Q4

**Question (Claude):**

(i) it is. No formatting commands; Write keeps its name; both shortcuts-sheet sentences noted and I'll use them close to verbatim.

## Question 4 of several: the mechanics

Nine decisions I need before I can build it. Answer them numbered; short answers are fine where the answer is obvious, but rule on all nine.

**1. Export.** The Export pill goes away, but the `export` action's `run()` currently *opens the export menu anchored to that pill* — five items (Markdown / Plain text / Web page / Document / Image) with mnemonic keys M, T, H, D, P. It is not a dialog; it has no other home. Options: (a) **Export becomes a submenu** inside the Note menu — hovering or clicking "Export this note…" opens the five formats to the side; (b) the five formats become **five flat items** in the Note menu ("Export as Markdown", "Export as PDF", …), which makes the Note menu 32 items but kills a whole submenu mechanism; (c) the export menu keeps working exactly as it does but is now **anchored to the Note menu button** and opens over it when the action runs from anywhere (palette, chord, menu). Pick one. Whatever you pick has to also work when Ctrl+Shift+S is pressed with no menu open.

**2. Keyboard access to the menus themselves.** Once they exist, can you *drive* them from the keyboard? (a) No — they are a mouse surface; the keyboard already has the palette. (b) Yes — Alt or F10 focuses the first menu, Left/Right moves between menus, Up/Down within one, Enter runs, Esc closes, letters jump to the first item starting with them. (b) is standard, costs real code, and is arguably redundant with a command palette that does the same job better. Pick, and say whether the menus get chords of their own.

**3. What a menu item looks like.** Each item shows a label and its chord. The existing `.menu-item` pattern puts a `<kbd>` on the right — but in the export menu that `<kbd>` means "press M", a *mnemonic*, not a shortcut. If menu items now show real chords in `<kbd>`, the same visual element means two different things in two menus. Do I (a) render chords in `<kbd>` and drop the export mnemonics, (b) render chords as plain dim text instead of `<kbd>`, or (c) something else? Also: for an action with `also:` aliases (Rename = Ctrl+R / F2, Redo = Ctrl+Y / Ctrl+Shift+Z), show only the first, or both?

**4. The Notes menu is 28 items long.** That is a genuinely long list — around 700px tall. Do I (a) leave it as one column in registry order, (b) break it into labelled sections with a rule between them (e.g. *this note* / *finding notes* / *tabs and history* / *the collection*) — which means inventing a sub-grouping the registry does not currently have, (c) scroll it at a max height, or (d) split Notes into two menus. If (b), give me the section names and which commands go in each — that is a product call, not a mechanical one.

**5. Disabled commands.** Many actions are conditional: `aliases`, `tab-close`, `back`, `forward`, `undo`, `redo`, the four table commands, `split`, `pane-close` and more. In the menu, is a currently-unavailable command **greyed and unclickable but present**, or **hidden entirely**? Greyed teaches that it exists (helps discoverability); hidden makes the list shorter and never disappoints. The palette currently *filters them out entirely* — `matchActions` drops anything whose `enabled()` is false, so the palette already made this choice one way. Should the menus match the palette or differ, and if they differ, is that inconsistency acceptable?

**6. Toggles.** Six actions are toggles (`preview`, `live`, `outline`, `focus`, `typewriter`, `pin`). In the menu, is "on" shown as a tick/check in a gutter on the left, a dot, or the item rendered in a pressed style? Remember: no new accent colours.

**7. The permanent pills.** Confirm their exact visible labels — I'll use **Task**, **Date**, **Divider**, **Attach** unless you want different words — and confirm they are uppercase `.u` pills matching the existing style. Two of them have state worth showing: `task` cycles a line plain → to do → done. Should the Task pill reflect anything about the current line, or stay a plain button? And should each pill's tooltip read the full label plus the chord, e.g. `Checklist item on this line (Ctrl+Shift+X)`?

**8. Inactive panes.** You said inactive panes render their controls "more quietly" but stay usable, and clicking one makes that pane active first. Concretely: do inactive panes show (a) everything at reduced opacity, (b) only the menus, pills hidden, or (c) nothing until the pane is focused or hovered? Note the existing precedent: today's Preview/Attach/Export/Pin/Delete pills are shown in every pane at full strength regardless of focus.

**9. The setting.** "Show editor controls", default on. It lives in the Ctrl+, Layout dialog beside line width, margin, focus mode, tray. Two things: is it a per-machine UI preference (kept in localStorage with preview/outline/focus/typewriter, which is where all the view state lives) or a real setting synced in `settings.json` beside the tray and hotkeys? And when it is off, does the pane header go back to *exactly* today's Preview/Attach/Export/Pin/Delete pills, or to a truly bare header with no command buttons at all?

**Answer (Codex):**

1. **Export becomes a submenu inside Note.** Its five formats keep their current order. Invoking `export` by Ctrl+Shift+S or the palette opens the active pane’s Note menu with the Export submenu already open and focused. In the collapsed Commands layout, it opens Commands → Note → Export the same way.

2. **Yes, full keyboard operation.** F10 or Alt focuses the first menu; arrows navigate; Enter/Space opens or runs; Esc closes; typing letters performs typeahead. The menus receive no dedicated chords beyond standard F10/Alt access. The command palette remains the faster keyboard path when the user knows what they want.

3. **Use `<kbd>` for real command chords and remove export mnemonics.** Export-format items participate in the same letter-based typeahead as every other menu item. Show only the primary `chord`; aliases remain documented in the shortcuts sheet. This keeps rows compact and gives each `<kbd>` one consistent meaning.

4. **Break Note into labelled sections.** Use this order:

   **Create**
   - New note
   - New note from a template…
   - Import markdown or text files…

   **Find and navigate**
   - Find a note
   - Recent notes…
   - Previous note
   - Next note
   - Back
   - Forward

   **This note**
   - Rename this note
   - Other names for this note…
   - Pin or unpin this note
   - Note history…
   - Save now
   - Export this note…
   - Merge this note into another…
   - Delete this note

   **Tabs**
   - Open a note in a new tab…
   - Close this tab
   - Next tab
   - Previous tab

   **Saved searches**
   - Save this search…
   - Saved searches…
   - Forget a saved search…

   **Library**
   - Scheduled tasks…
   - Rename a tag everywhere…
   - Deleted notes…
   - Open the notes folder

   Add section metadata to the registry rather than maintaining the partition in menu-rendering code. Use a viewport-relative maximum height and scrolling only as a safety measure on short windows.

5. **Disabled commands remain visible, greyed, and unclickable.** Menus are a stable recognition and learning surface, so their contents must not shift with context. The difference from the palette is acceptable: the palette is an executable search result list and should continue hiding unavailable results.

6. **Use a checkmark in a reserved left gutter.** Keep the gutter aligned for every item, including non-toggles. Use the normal ink colour—no accent and no pressed-row treatment.

7. Use exactly **Task**, **Date**, **Divider**, and **Attach**, rendered with the existing uppercase `.pill.u` treatment. Task remains a plain action button; do not attempt to represent its three-state cycle. Every pill tooltip contains the full action label and primary chord, for example `Checklist item on this line (Ctrl+Shift+X)`.

8. **Show everything in inactive panes at moderately reduced opacity.** Use approximately `0.65`, returning to full strength when the pane is active or the controls are hovered/focused. Clicking an inactive pane’s control activates that pane and executes the command in the same click—never require a preliminary activation click.

9. **It is a per-machine UI preference stored in localStorage.** When disabled, leave only the sidebar control and status text in `.pane-head`; show no command pills or menus. Do not restore today’s Preview/Attach/Export/Pin/Delete strip—the new controls replace that strip, and the setting disables the replacement completely.

**Reading:** Export becomes a submenu; the menus are fully keyboard-operable from F10/Alt; `<kbd>` means a real chord and nothing else; the Note menu is sectioned and the sections live in the registry; disabled commands stay visible and greyed; toggles tick in a left gutter; the pills are Task / Date / Divider / Attach; inactive panes at 0.65 with click-through activation; the switch is a localStorage UI preference that hides the whole strip.

## Q5

**Question (Claude):**

All nine taken as ruled. Export as a submenu, full F10/Alt keyboard operation, `<kbd>` reserved for real chords, Note sectioned into Create / Find and navigate / This note / Tabs / Saved searches / Library with the sections carried **in the registry**, disabled items greyed and present, a checkmark gutter, the four pills as named, 0.65 opacity in inactive panes with click-through activation, and a localStorage preference that hides the whole strip.

## Question 5, the last one: loose ends and what success looks like

**1. Sections for the other three menus.** You sectioned Note. Write has 16 items, View 6, Window 8. Do those get sections too, or are they short enough to stay flat? If they get sections, name them and assign every command — here they are again:

- **Write (16):** Table, Add a table row, Add a table column, Remove this table row, Attach an image…, Insert a section divider, Code block around this, Checklist item on this line, Move lines to another note…, Move this section to another note…, Undo, Redo, Find in this note, Replace in this note, Insert a template…, Insert the date
- **View (6):** Markdown preview, Live formatting, Outline, Focus mode, Typewriter scrolling, Graph of the notes…
- **Window (8):** Toggle the sidebar, Split the pane, Close this pane, Focus the next pane, Focus the previous pane, Layout and window settings, Command palette, Keyboard shortcuts

**2. Delete from a menu.** `delete` is guarded by "press again within three seconds to confirm" — that guard was designed for a keyboard chord. Clicking **Delete this note** in a menu closes the menu, so confirming means reopening Note → This note → Delete within three seconds, which is a bad confirmation. Do I (a) keep the same two-strike rule and let the menu route be awkward, (b) give the menu route a proper confirm — the status line asks and the menu item stays open/armed, (c) have the menu route show a small confirm dialog, or (d) something else? Same question, in miniature, for **Close this tab** and **Close this pane**, which have no guard at all.

**3. Empty state.** When a pane has no note open, most of the Note and Write commands are disabled. Do the pills and menus still show (all greyed except New note, Find a note, Import, the Window items), or does the strip stay hidden until a note is open?

**4. Does the shortcuts sheet mention the new surface?** The sheet is the app's own documentation of itself, and it is about to stop being the only place a chord is written down. Should it gain a line saying the same commands sit in the pane's menus with their shortcuts printed beside them — and if so, roughly what should it say?

**5. The registry fields.** To build this I need to add to `Action`: something naming the section an item belongs to, and something marking the four commands that get a permanent pill (with their short pill label, since "Checklist item on this line" cannot be a pill and "Task" must come from somewhere). Confirm you are happy for those two fields to be added to the one registry rather than kept in a separate table — that is the "fourth reader of the same registry" principle from the top of this conversation, and it means a future command declares its own place in the menus.

**6. Success criterion.** State the single concrete thing you would do on release day to decide this round worked. The 0.15.0 round's criteria were of the form "follow three links, press Alt+Left three times, land on the original paragraph with the caret where it was" — that specific.

**7. The release name.** Each round gets a one-line release title in the app's voice (recent ones: "Tabs and split panes: the one-window rule retired", "Aliases, embeds, unlinked mentions and saved searches", "The MCP server reviewed against the protocol"). Give me the title for this one.

**Answer (Codex):**

1. Section Write and Window; leave View flat.

   **Write**

   **Edit**
   - Undo
   - Redo
   - Find in this note
   - Replace in this note

   **Insert**
   - Attach an image…
   - Insert a section divider
   - Code block around this
   - Checklist item on this line
   - Insert a template…
   - Insert the date

   **Table**
   - Table
   - Add a table row
   - Add a table column
   - Remove this table row

   **Move**
   - Move lines to another note…
   - Move this section to another note…

   **View** stays flat in registry order. Six related items do not need headings.

   **Window**

   **Workspace**
   - Toggle the sidebar
   - Split the pane
   - Close this pane
   - Focus the next pane
   - Focus the previous pane

   **Application**
   - Layout and window settings
   - Command palette
   - Keyboard shortcuts

2. Choose **(b)** for Delete. The first menu click arms the item, keeps the menu open, retains focus, and changes its label to **Delete this note — click again** for three seconds. The status line repeats the instruction. A second click or Enter confirms; Esc, focus leaving the menu, or timeout disarms it.

   The keyboard chord keeps its existing two-strike behavior.

   **Close this tab** and **Close this pane** remain immediate actions. Notes autosave, and these commands close views rather than delete the note itself, so adding confirmation would create friction without protecting equivalent data.

3. Keep the strip visible in the empty state. The layout must remain stable, and the menus should continue teaching what becomes available when a note is open. Disabled pills and items are greyed; New, Find, Import, and applicable Window commands remain usable.

4. Yes. Add this near the top of the shortcuts sheet:

   > Commands are also available from the pane menus, with their keyboard shortcuts printed beside them.

   Then retain the two markdown-writing sentences settled previously.

5. Yes. Add both declarations to `Action`; do not create a parallel toolbar configuration.

   Concretely, use fields equivalent to:

   ```ts
   menuSection?: string;
   pill?: {
     label: string;
     priority: number;
   };
   ```

   The four pill priorities encode the narrow-pane removal order: Task survives longest, followed by Date, Divider, then Attach. Menu rendering, responsive pills, the palette, shortcut handling, and the shortcuts sheet all continue reading the same action objects.

6. On release day I will open three panes at a 1440px window, focus the middle pane, open **View**, read **Ctrl+Shift+L** beside **Outline**, select it, then press Ctrl+Shift+L to close the outline again—without opening the command palette or shortcuts sheet, and without affecting either neighboring pane.

7. **Commands come out from behind their shortcuts**

**Reading:** Write and Window get sections, View stays flat; Delete arms in place rather than borrowing the chord's two-strike rule; the strip stays visible in the empty state; the sheet points at the menus; `menuSection` and `pill` are added to `Action` itself; and the round is called **Commands come out from behind their shortcuts**.


