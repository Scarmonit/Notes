# Editor controls — the settled design (0.21.0)

Brainstormed 2026-09-04 with Codex CLI as the answering product owner. The verbatim
question-and-answer is in `2026-09-04-toolbar-brainstorm.md`; this file is what gets built.

Release title: **Commands come out from behind their shortcuts**

## The problem, as diagnosed

Fifty-eight commands, fifty-two of them with a chord, and almost no buttons. The failure
is **recall**, not discoverability and not reach: the capability is known, the hand is
already on the keyboard, and what is missing is which of Ctrl+Shift+L and Ctrl+Shift+M
opens the outline. The palette rescues every such moment but turns a forgotten command
into a search task, and — Codex's sharpest line — "the missing control changes what I do,
not merely how quickly I do it": commands whose chord will not come to mind simply do not
get used.

So the surface being built is a **recognition surface**, and its most important job is not
to run commands but to **print each command's chord beside its name every time it is
used**. The palette stays the complete searchable catalog. All fifty-eight do not go on
screen at once.

## The shape

A per-pane strip of controls in the existing `.pane-head`, right-hand side. No new row
under the title: the paper still begins with the title and then the note.

Two halves, separated by a thin rule:

1. **Four permanent pills** — `Task`, `Date`, `Divider`, `Attach`. Uppercase `.pill.u`
   like every pill today. Text, never pictograms: the surface exists for recognition and
   an ambiguous icon undermines that.
2. **Four menu buttons** — `Note`, `Write`, `View`, `Window` — one per `ActionGroup`,
   each opening a panel built from the registry.

The permanent-slot rule, stated so a future command can be judged against it: *frequent,
local writing actions whose shortcut is hard to recall and whose effect is immediate and
reversible.* It is not a favourites system and it is not user-configurable this round.

**The four existing pills go away.** Preview, Export, Pin and Delete stop being pills and
become menu items — the new controls replace that strip rather than sitting beside it.
Attach keeps a pill because it is a common editing operation.

## The registry change

Two optional fields are added to `Action` in `src/renderer/actions.ts`. There is no
parallel toolbar table: the menus are the fourth reader of the one registry, and a new
command declares its own place in them.

```ts
/** The heading this command sits under in its menu; unsectioned menus leave it off. */
menuSection?: string;
/** The commands that earn a permanent button, and what it says on it. */
pill?: { label: string; priority: number };
```

`priority` is the order the pills survive a narrowing pane — higher survives longer:
`task` 4, `date` 3, `divider` 2, `attach` 1.

Two pure functions join `matchActions` and `keyMap` in `actions.ts`, so the whole model is
testable without a DOM:

- `menuModel(actions): Menu[]` — the four menus, each with its display name and its
  sections in registry order, every section holding its items in registry order.
- `pillActions(actions): Action[]` — the pill-bearing actions, highest priority first.

## The menus

Display names differ from the group names where the group is plural and the menu is about
one thing: `Notes` → **Note**, `Writing` → **Write**, `View` → **View**, `Window` →
**Window**.

**Note** (28) is sectioned, because a flat 28-item column is 700px of scanning:

| Section | Commands |
| --- | --- |
| Create | New note · New note from a template… · Import markdown or text files… |
| Find and navigate | Find a note · Recent notes… · Previous note · Next note · Back · Forward |
| This note | Rename this note · Other names for this note… · Pin or unpin this note · Note history… · Save now · Export this note… · Merge this note into another… · Delete this note |
| Tabs | Open a note in a new tab… · Close this tab · Next tab · Previous tab |
| Saved searches | Save this search… · Saved searches… · Forget a saved search… |
| Library | Scheduled tasks… · Rename a tag everywhere… · Deleted notes… · Open the notes folder |

**Write** (16) is sectioned:

| Section | Commands |
| --- | --- |
| Edit | Undo · Redo · Find in this note · Replace in this note |
| Insert | Attach an image… · Insert a section divider · Code block around this · Checklist item on this line · Insert a template… · Insert the date |
| Table | Table · Add a table row · Add a table column · Remove this table row |
| Move | Move lines to another note… · Move this section to another note… |

**View** (6) stays flat in registry order. Six related items do not need headings.

**Window** (8) is sectioned: **Workspace** (Toggle the sidebar · Split the pane · Close
this pane · Focus the next pane · Focus the previous pane) and **Application** (Layout and
window settings · Command palette · Keyboard shortcuts).

The section order and membership above are exactly the registry order the `ACTIONS` array
will be put into, so `menuModel` never has to sort anything.

### How a menu row reads

```
✓  Outline                                    Ctrl+Shift+L
```

- A **checkmark gutter** on the left, reserved and aligned on every row including
  non-toggles, holding a tick when `on()` is true. Normal ink colour — no accent, no
  pressed-row fill.
- The **label** exactly as the registry writes it, sentence case.
- The **primary chord** on the right in `<kbd>`. Only `chord`; `also:` aliases stay
  documented in the shortcuts sheet. A chordless command shows nothing there, not an
  empty placeholder.

`<kbd>` inside a menu now means one thing and one thing only: a real keyboard shortcut.
The export menu's mnemonic keys (`M`, `T`, `H`, `D`, `P`) are therefore **removed** —
those five rows join the same first-letter typeahead every other row has.

**Disabled commands stay visible and greyed**, unclickable. The menus are a stable
recognition surface and must not shift contents with context — that is the whole point.
This deliberately differs from the palette, which goes on filtering unavailable commands
out entirely: a palette is an executable search result, a menu is a map.

### Export is a submenu

`export` opens a drill-in inside the Note panel: the panel's contents are replaced by a
back row (`‹ Export this note…`) and the five formats in their current order — Markdown,
Plain text, Web page, Document, Image. Drill-in rather than a side flyout because a flyout
would leave the pane at a 470px three-way split.

Pressing Ctrl+Shift+S, or running Export from the palette, opens the active pane's Note
menu **with the export drill-in already showing and focused**. In the collapsed layout it
goes Commands → Note → Export the same way.

## Keyboard operation

The menus are fully operable from the keyboard, even though the palette remains the faster
path for someone who knows what they want.

| Key | What it does |
| --- | --- |
| `F10`, or `Alt` pressed and released alone | Focus the first menu button in the focused pane |
| `←` / `→` | Between menu buttons |
| `↓` / `Enter` / `Space` on a button | Open its panel, focus the first row |
| `↑` / `↓` in a panel | Between rows, skipping disabled ones, wrapping |
| `Home` / `End` | First / last row |
| `Enter` / `Space` | Run the row |
| a letter | Typeahead to the next row starting with it |
| `Esc` | Close the panel, focus back on the button; from the button, back to the editor |
| `Tab` | Close the panel and move on |

The menus get no chords of their own beyond F10/Alt. `Alt` only opens the bar when it is
pressed and released with no other key in between, so `Alt+←` (Back) is untouched.

## Narrow panes

Up to three panes sit side by side; at 1440px each is about 470px. The strip degrades by
container query on `.pane`, in this order, and **nothing loses access** — every hidden pill
is still in the Write menu:

1. Hide **Attach**.
2. Hide **Divider**.
3. Hide **Date**.
4. Hide **Task**.
5. Collapse the four menu buttons into a single **Commands** button whose panel holds the
   same four groups, one after another, each under its group heading.

The Commands button exists in the DOM at every width and is hidden until the last step, so
the collapse is CSS only.

## Inactive panes

Everything shows in every pane. An inactive pane's controls stand down, and come back to
full strength when the pane is focused, or when the controls are hovered or focused.
Clicking a control in an inactive pane **activates that pane and runs the command in the
same click** — never a preliminary activation click.

Two notes on how this was built, against what the brainstorm said:

- Codex asked for "approximately `0.65`". The app already stands an unfocused pane's
  `.pane-actions` down to `0.55`, alongside its marginalia, in a rule that predates this
  round. That number was kept rather than a second one invented for the same idea; only
  the hover-and-focus restore is new.
- The pane root already calls `focusPane` on `pointerdown` in the capture phase, so a real
  mouse click activates the pane on its way in. The controls say it again for themselves
  (`focusPaneOf`, on both the click and the keydown handler), because a control belongs to
  the pane it sits above and a command must never act on a note other than the one its own
  button is over.

## Delete from a menu

`delete` is guarded by "press again within three seconds", which was designed for a chord.
Clicking a menu row cannot borrow that guard, because the menu closes underneath it.

So the menu route arms **in place**: the first click leaves the panel open and focused,
changes the row to **Delete this note — click again**, and repeats the instruction in the
status line. A second click or `Enter` deletes. `Esc`, focus leaving the menu, or three
seconds passing disarms it. The keyboard chord keeps exactly the behaviour it has.

`Close this tab` and `Close this pane` stay immediate. Notes autosave and both commands
close a view rather than the note, so a confirmation would be friction protecting nothing.

## The empty state

With no note open the strip still shows, everything greyed except New note, Find a note,
Import and the applicable Window commands. The layout stays stable, and the greyed rows go
on saying what will be available once a note is open.

## The setting

A per-machine UI preference, `controls: boolean`, default `true`, kept in `localStorage`
beside `preview`, `outline`, `focusMode`, `typewriter` and `liveFormat` — where all the
view state lives. Not a synced `settings.json` setting.

It appears in the Ctrl+, Layout dialog as **Editor controls** — "The commands for this
note, with their shortcuts, in the pane header".

Turned off, `.pane-head` keeps only the sidebar button and the status text: no pills, no
menus. It does **not** fall back to today's Preview/Attach/Export/Pin/Delete strip — the
new controls replace that strip, and the switch turns the replacement off completely. It
never disables a command, a chord or the palette.

## The shortcuts sheet

Gains a line near the top:

> Commands are also available from the pane menus, with their keyboard shortcuts printed
> beside them.

And the writing line is rewritten, because "code" in it went muddy once a Code block
command existed:

> Markdown takes shape as you type: use `#` for headings, `**` for bold, and `-` for
> lists. Writing commands handle the larger operations — checklists, code blocks, tables,
> attachments and templates.

## What is deliberately not built

**No formatting commands.** No Bold, Italic, Heading, Link, Quote, Bullet list or Numbered
list. This round surfaces the command system Notes already has; it does not turn markdown
syntax into a second formatting API. Adding wrappers, toggle detection, caret-state
tracking and conventional chords would be a substantial new editing model smuggled in
under a discoverability change, and it would make the absence of every *next* formatting
operation look accidental rather than chosen. The menu keeps the name **Write** — "Insert"
would be wrong for a group that also holds Undo, Redo, Find, Replace and moving content.

No user-configurable pills, no favourites, no icons.

## Testing

Pure model, in `src/renderer/actions.test.ts`: `menuModel` returns four menus in group
order under the display names Note / Write / View / Window; every command lands in exactly
one of them; sections keep registry order and a repeated heading starts a fresh section
rather than merging; a menu whose commands claim no heading is drawn as one list;
`pillActions` returns the pill-bearing commands highest priority first, which is the order
a narrowing pane sheds them from the end.

The registry itself, in `src/renderer/registry.test.ts`. `ACTIONS` lives in `main.ts`,
where every command closes over the renderer it drives, so it cannot be imported into a
test — but it is the one list all four surfaces read, and a command that quietly declares
no `menuSection` falls out of the menus without anything failing. So that test reads the
source and checks it: 58 commands, every one outside View under a heading, View flat, each
heading in one unbroken run, the six Note / four Write / two Window sections named and
filled exactly as the tables above say, four pills with the documented labels and
priorities, and — the standing decision made testable — no `bold`, `italic`, `heading`,
`link`, `quote` or list command, and nothing claiming Ctrl+B or Ctrl+I.

Live checks, in `scratchpad/controls-check.mjs` against the packaged build.

Twenty-eight of them: the strip renders in every pane, a menu opens and its rows carry the
right chords, a toggle shows its tick, a disabled row is greyed, the export drill-in opens
and comes back out, Ctrl+Shift+S lands in it from anywhere, F10 walks the bar, the Delete
row arms in place with the menu still open and Esc disarms it without deleting, three
panes at 1440px shed their pills but keep all four menus, an unfocused pane stands down,
and the setting hides the strip while every chord goes on working. It photographs each
surface as it goes.

## Success criterion

Codex's, to be performed on release day:

> Open three panes at a 1440px window, focus the middle pane, open **View**, read
> **Ctrl+Shift+L** beside **Outline**, select it, then press Ctrl+Shift+L to close the
> outline again — without opening the command palette or the shortcuts sheet, and without
> affecting either neighbouring pane.
