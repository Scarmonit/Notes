# Addressable Notes — the settled design (0.23.0)

Brainstormed 2026-09-06 with Codex CLI as the answering product owner. The verbatim
question-and-answer is in `2026-09-06-six-features-brainstorm.md`; this file is what gets built.
The other half of that brainstorm ships as 0.24.0 and is specified in
`2026-09-06-working-context-spec.md`.

Release title: **A note can carry its facts, its date, and an address to the exact thought.**

## The problem, as diagnosed

A `/compare` pass against Obsidian, Logseq, Joplin, Zettlr and Bear turned up six things this
app does not have. The user asked for all six. Codex's first ruling was that they are not one
release: three of them change what is written into a `.md` file or how it is addressed, and
three only change how the window exposes working context. Debugging new serialization
behaviour at the same time as three substantial renderer interaction systems is a bad trade,
so the durable half goes first.

The theme of this half: **make the notebook's durable contents structured and directly
addressable without making the markdown proprietary.**

Each of the three is a gap that already half-exists in the app:

- **Properties** replace the weakest current abstraction. `splitFrontMatter` preserves unknown
  front-matter keys through a rewrite — deliberately, so Obsidian's front matter survives — but
  a `status: draft` written in Obsidian is *completely invisible* here. Nothing shows it,
  nothing searches it, nothing can change it. The app already edits exactly one such property,
  `aliases`, through a dedicated command.
- **Today's note** joins parts that already exist: `Ctrl+;` inserts today's date, templates
  expand `{{date:DDD D MMM YYYY}}`, `@2026-09-10` schedules a task, `Ctrl+Shift+U` lists what
  is due. What is missing is the habit, not the machinery.
- **Block references** extend an address the app already understands. `[[Note#Heading]]` links
  to a heading and `![[Note#Heading]]` embeds it live; `sectionOf` already finds a heading and
  everything under it. A block is the same idea, smaller.

## The governing rule

Everything below is subordinate to one sentence:

> Notes may write machine-added Markdown only as the direct, reversible result of an explicit
> user command, using syntax that remains meaningful or harmless in Obsidian and plain-text
> tools.

Opening, indexing, hovering, previewing, searching, exporting or ordinarily saving a note must
never mint block ids, normalise arbitrary YAML, reorder properties or otherwise "improve" the
file.

And its corollary, stated flatly because it is the one thing that would make the feature a
liability: **Notes never adds a custom property unless the user explicitly asks it to.**
Today's note adds none. Opening the properties sheet adds none. Search, indexing, export,
template discovery and block addressing add none. Creating a note from a template may copy
properties present in that explicitly selected template, because that is user-directed content
creation, not an inferred property.

## Front matter as an ordered span list

`extra: string[]` — an unordered bag of lines the app does not understand — becomes an ordered,
lossless sequence of source spans. `splitFrontMatter`'s `{fields, lists, extra}` triple is
replaced by a single ordered `FrontMatterEntry[]`, and `fields`, `aliases` and every other
convenient projection are derived from it. There is no parallel mutable representation.

The sequence retains, in source order:

- known app fields;
- recognised editable properties;
- comments and blank lines;
- malformed or unrecognised lines;
- complete unsupported YAML values, including their continuation lines.

`formatNoteFile` follows these rules:

1. An unchanged property emits its original source span byte-for-byte.
2. Editing one property replaces only that property's span.
3. Removing a property removes only its key and attached value span. It does not remove
   neighbouring comments or blank lines unless a comment is syntactically inside that value.
4. Adding a property inserts it after the last existing front-matter property and before
   trailing comments or the closing delimiter.
5. Ordinary body edits must not reorder, re-indent, requote or normalise unrelated front matter.
6. Duplicate YAML keys remain preserved. The properties UI marks them as conflicting and must
   not silently choose one; removal or editing identifies the particular occurrence, or offers
   an explicit "remove all".
7. Reserved keys stay owned by Notes: `id`, `title`, `created`, `updated`, `pinned`, `deleted`,
   `aliases`. The properties editor may display them but routes changes through their existing
   domain operations rather than treating them as arbitrary YAML.

**No global YAML reserialization is permitted.** An Obsidian-authored file, after being opened
and saved here, differs only in: the fields Notes already legitimately updates (`updated`), a
property the user explicitly changed, a block id the user explicitly requested, and content the
user edited.

### The supported value shapes

The structured editor handles YAML scalars and flat lists: strings, numbers, booleans, `null`,
and inline or indented lists of those. Serialization is conservative — plain scalars only when
unambiguous, otherwise double-quoted with escaping; lists keep their existing inline-versus-
indented style when edited; new lists use indented `- item`; an empty list is `[]`; no key
sorting.

Nested mappings, nested sequences, block scalars, anchors, aliases and tags are **complex**.
They stay visible and are marked as such. They may be deleted explicitly or replaced wholesale
with a supported value, but there is no tree editor and no raw-YAML mini-editor. Untouched,
their entire source span survives byte-for-byte.

## Properties

### `Note.properties`

The lossless `FrontMatterEntry[]` stays in the parsed-file / write layer. `Note` gains a
read-oriented projection holding **custom properties only** — an occurrence list, not a map, so
order, duplicates and complex values survive:

```ts
type NoteProperty = {
  key: string;
  value: PropertyValue;
  occurrence: number;
  complex: boolean;
};
```

Reserved fields keep their existing typed `Note` fields and are not duplicated into it. Search,
the vocabulary sheet, the CLI and MCP all consume this one interpretation rather than reparsing
files independently.

### The sheet

A **modal sheet**, `note.properties` / "Properties…", opened from the palette and the Note menu.
Putting a synthetic region inside the contenteditable would break the editor's strongest
invariant — what appears in the writing surface is the file — the marginalia is commonly
hidden, and a strip beneath the body is the wrong place for focused form controls.

`Ctrl+Shift+A` (aliases) now opens this same sheet with the aliases row focused. There must not
be two property editors.

The sheet holds a compact "Note fields" section for reserved keys, a "Properties" section for
user-defined ones with one row per **occurrence** in file order, and an **Add property** row.
Duplicate occurrences appear as separate rows marked `Duplicate key`; editing or deleting acts
on that occurrence only.

**A note with no custom properties gains no persistent affordance in the editor.** The command
is the entrance. Opening the sheet shows the empty state and the Add property control.

### Interaction

Adding a key offers case-insensitive completion from custom keys already present anywhere in
the notebook, ordered by prefix match, then usage count, then alphabetically, each showing its
canonical spelling and note count (`status   9 notes`). Selecting one preserves the notebook's
spelling. **Casing variants are shown separately and marked inconsistent, never silently
merged.** `Enter` accepts the key and moves to the value; `Esc` cancels the unfinished row.

A new key must be a simple YAML key — `[A-Za-z_][A-Za-z0-9_-]*` — deliberately narrower than
YAML permits. Existing exotic keys stay preserved and visible as complex entries, but Notes
does not create new quoted, mapping or otherwise elaborate keys. A reserved name routes to that
field's existing operation.

There is **no type registry**. A property's type is derived from its YAML value on every parse:
string, finite number, boolean, null, flat list of those, or complex. A second schema stored
outside the markdown would contradict the folder being the artifact.

Scalars use one text field. Lists use editable rows: `Enter` commits a scalar, `Enter` on a list
item creates the next, `Backspace` on an empty item removes it, `Alt+Up`/`Alt+Down` reorders,
`Esc` abandons the uncommitted edit. `aliases` uses the same list interaction but commits
through the existing alias operation. **A custom `tags` property is just YAML data**; it does
not become equivalent to markdown `#tags` anywhere else in the app.

Values are interpreted conservatively, and the app never asks about quoting:

- exact `true` / `false` → boolean;
- exact `null` → null;
- an unambiguous finite numeric literal → number;
- everything else → string.

So `yes`, `2026-09-06`, `[draft]`, a value containing `: `, and an empty value are all strings.
Serialization quotes whenever plain YAML could alter meaning or structure; an empty string is
`""`. Editing an existing unquoted date may therefore quote it — acceptable, because the user
changed that occurrence.

Removing a custom property is one explicit action with **no two-press guard**. Note deletion is
existential and deserves arming; removing one property does not. Every committed add, edit,
reorder, replacement and removal is one entry in that note's undo log; `Ctrl+Z` / `Ctrl+Shift+Z`
work while the sheet is open and refresh the rows immediately. `id`, `created`, `updated` and
`deleted` are never raw-editable.

### The vocabulary sheet

`properties.notebook` / "All properties…", no chord. It lists every **custom** key in the
notebook — excluding Notes-owned metadata and `aliases` — with its exact spelling, the number of
notes carrying it, the detected value shapes (`text · list`), and whether duplicate occurrences
or casing variants exist. Selecting a key runs `prop:status` and closes the sheet.

Expanding a key shows its distinct supported scalar values with note counts, list elements
counted individually; selecting a value runs the equality query. Complex values are counted as
`complex` but not enumerated. Show the **ten most frequent** values with a filter field for the
rest — this is a vocabulary sheet, not a property-management database.

The vocabulary problem here is exactly the recall problem that started 0.21.0: without this
sheet, a notebook grows `status` / `Status` / `state` inside a week.

### The search operator

Exactly one new operator, `prop:`. Individual property names never become top-level operators —
that is what Obsidian does and it would collide with the 19 operator names this app already has.

```text
prop:status
prop:status=draft
prop:"review_status=needs review"
-prop:status
-prop:status=draft
```

- `prop:key` matches a note with at least one custom occurrence of that exact key spelling.
- `prop:key=value` matches when at least one occurrence equals the value.
- A list matches when any element equals the value.
- Duplicate occurrences use "any occurrence matches".
- Negation is the logical inverse of the complete positive predicate.

**Key matching is case-sensitive**, because YAML keys are; the vocabulary completion is what
prevents accidental variants, rather than pretending `status` and `Status` are one key. Value
matching is **exact, never substring**: strings compare case-insensitively over the whole value,
numbers numerically, booleans and null by type. Query literals `true`, `false`, `null` and
finite numbers take those types; everything else is a string.

No numeric inequalities in 0.23.0 — `prop:rating>3` is **rejected with a concise explanation**
and must not silently search for a key literally named `rating>3`.

`prop:tag` and `prop:folder` mean custom keys named exactly `tag` and `folder`; only the outer
operator name participates in dispatch. Complex values support presence queries but not
equality — `prop:config` may match, `prop:config=value` does not inspect nested YAML.

## Today's note

### The path

One setting:

```text
journal.pathFormat = "Journal/YYYY/YYYY-MM-DD"
```

A relative path format without `.md`, expanded with the existing `formatDate` tokens and
`[literal]` escaping, where `/` makes a folder boundary. The expanded result is validated with
the same path-safety rules as any other note path: relative, inside the notes root, a non-empty
filename, no `.` or `..` segments.

The default gives `Journal/2026/2026-09-06.md`. One year stays browsable as a single folder
while five years do not become one giant list; `Journal/YYYY/MM/…` is needless nesting for 365
files a year.

**Today's note is the one narrow exception to 0.22.0's "folders are never created implicitly by
filing".** The command may create missing directories — but only while fulfilling an explicit
create/open-journal command, never as a side effect of browsing, indexing, startup or ordinary
filing.

The initial title is the expanded leaf filename without `.md` (`2026-09-06`), which keeps
`fileNameFor` and `nameSuits` aligned instead of fighting the journal path. Title and canonical
path may drift only through explicit user action: renaming or moving a journal note makes it an
ordinary note at its new location. Nothing pins its filename, restores its date title or retains
a hidden journal identity.

### Identity

A journal note is identified **only by occupying the path produced for a local calendar date
under the current `journal.pathFormat`**. There is no `daily: true` marker and no duplicated
folder metadata.

Changing the format does not migrate or relabel old notes; they remain ordinary notes where they
are. The setting says so: *"Changing this affects newly opened journal dates; existing notes are
not moved."*

**Occupancy wins.** If a note already exists at the calculated path, the command opens that exact
note and performs **no write**: no template applied or reapplied, no title repaired, no front
matter touched merely because it was opened, and an empty existing note is not treated as
uninitialised. Even a manually created file with an unusual title is the note for that date while
it occupies the canonical path. A newly created note places the caret at the end of its expanded
body and focuses the editor, following the normal new-note flow.

### The template

```text
journal.templateId = "<note-id>" | null
```

The note **id**, not its title or path, so renaming or moving the template does not break the
setting. A missing or no-longer-template id proceeds with an empty body and a restrained
notification; it must not block creation. It is configured once, not chosen each time — anyone
wanting an occasional different template can use the existing template command and move the note.

`expandTemplate` gains an optional reference instant. Existing callers keep "now"; journal
creation passes **the journal date at local noon**, so `{{date}}` and `{{date:FORMAT}}` describe
the journal date and a back-filled entry is not stamped with the moment it was typed. Local noon
rather than midnight avoids DST date drift. `{{time}}` will therefore read `12:00`, which is more
honest than the unrelated current time; `created`/`updated` still record the real instant.

No `{{yesterday}}`, no `{{tomorrow}}`, no automatic neighbouring links — those are Logseq
conventions, not requirements of a dated note.

### The commands

Exactly two:

| id | label | chord |
| --- | --- | --- |
| `journal.today` | Today's note | `Ctrl+Shift+D` |
| `journal.openDate` | Journal for date… | — |

`journal.openDate` opens a picker accepting a date expression — `today`, `tomorrow`,
`yesterday`, `+3d`, `-3d`, weekday names, ISO dates. **Time-only input such as `16:00` is not
accepted**: this resolves calendar dates, not moments. The reusable date resolution is extracted
rather than making journal code depend semantically on task due times.

No yesterday/tomorrow/previous-entry/next-entry commands — "Journal for date…" covers calendar
navigation without consuming more registry space, and folder browsing covers navigation among
entries that exist. **No calendar** in 0.23.0: a month grid is a new navigation surface,
selection model, keyboard scheme and accessibility problem. **No toolbar pill** — this is not an
insertion action and does not belong beside Task / Date / Divider / Attach.

### What does not become journal-aware

Quick capture continues to append to **Inbox**, unchanged: a journal is chronological writing, an
inbox is unprocessed capture, and conflating them would silently change an established workflow.
No `journal:` operator — `folder:Journal` is sufficient and a custom format can be saved as a
view. Scheduled tasks keep their `@date` meaning, the due sheet does not privilege journal notes,
and `created:`/`updated:` keep their metadata semantics.

## Block references

### The address

Parsed in this order: strip the optional `!` embed prefix; split the display alias at `|`; split
the address at the **first** `#`; resolve the note portion by the existing title / alias / path
rules; then interpret the fragment — beginning with `^` it is a block id, any other non-empty
fragment is a heading, absent it is the whole note.

```md
[[Plan#^k3n9dq]]
![[Plan#^k3n9dq]]
[[Work/Plan#^k3n9dq|as this]]
[[#^k3n9dq]]
[[#Heading]]
```

An empty note portion means the source note. **Same-note heading links become legal too** — it
would be incoherent to add local block links while withholding local heading links.

`#^` is reserved for block addressing; a heading literally named `^k3n9dq` cannot be addressed
that way, and if a heading and a block id collide textually, block interpretation wins. No
escaping and no second fragment syntax.

**Block ids are scoped to one note.** The same id may occur in A and in B without conflict.
Generation checks only the destination note; no index enforces notebook-wide uniqueness. Within
one note: no match is missing, one is resolved, more than one is ambiguous.

A missing or ambiguous block **never falls back to a heading and never offers to create a note** —
the containing note already exists. Clicking leaves the current note in place and reports
`Block ^k3n9dq was not found in Plan` or `Block ^k3n9dq is duplicated in Plan`. Rendered output
keeps the visible label and uses the existing broken-link treatment.

### The marker

Obsidian's own form, six lowercase ASCII alphanumerics, random rather than content-derived,
collision-checked within the note:

```md
A paragraph of text. ^k3n9dq
- A list item ^k3n9dq
```

Existing user-written ids are accepted as written and never renamed for using another valid
length or casing.

Once created the marker is **ordinary user-visible text**: normal editing may move or delete it,
the app does not silently restore a deleted id, duplicates are reported rather than resolved, and
an unchanged marker survives a rewrite byte-for-byte.

This does not turn Notes into a block editor. Paragraphs and list items gain addresses; they do
not gain persistent internal objects, automatic identities, nesting semantics or a hidden block
database.

### What a block is

One markdown-aware locator in core — the renderer must not rediscover block boundaries:

```ts
type BlockResolution =
  | { kind: 'one'; block: BlockSlice }
  | { kind: 'none' }
  | { kind: 'many'; blocks: BlockSlice[] };

type BlockSlice = {
  id: string;
  kind: 'paragraph' | 'list-item' | 'heading' | 'blockquote' | 'table' | 'code';
  start: number;
  end: number;
  content: string;
};
```

`start`/`end` delimit the complete addressed source range; `content` is that range with the
marker removed, every other byte preserved. A nested list item has its common leading
indentation removed from every returned line so it renders standalone.

| kind | extent | where the marker goes |
| --- | --- | --- |
| paragraph | consecutive non-blank, non-structural lines | end of its final line |
| list item | the item line **plus all more-deeply-indented children and nested items**, ending at the next sibling or ancestor item or another top-level block | end of the item's own first line |
| heading | the ATX heading line only, **not** its section | appended to the heading line |
| blockquote | one contiguous run of `>` lines | after the content of the final quoted line |
| table | the contiguous markdown table | a standalone line immediately after it, no blank line |
| fenced code | opening fence through closing fence | a standalone line immediately after the closing fence, no blank line |

An image is part of its containing paragraph, not a block kind. A standalone marker line attaches
**only** to an immediately preceding table or closed fenced code block, for both reading and
writing; it never attaches generically to a preceding paragraph or list.

Not addressable: blank lines, thematic breaks, front matter, an unclosed fence, a whole list
independently of an item.

Parsing ignores marker-like text inside fences and inline code. A valid inline marker is the
final syntactic token of its line, preceded by whitespace; a standalone marker line is optional
indentation and the id, nothing else.

If the caret has no addressable block, the minting command is disabled or reports *"Place the
caret in a paragraph, list item, heading, quote, table, or code block."*

### The two commands

No `[[` autocomplete in 0.23.0.

**`block.copyLink` — "Copy link to this block"**, no chord. Finds the addressable block at the
caret, reuses its existing id or generates and inserts one in the correct location, saves that
edit through the normal undoable path, and copies a portable link built with `qualifiedLink`,
preserving the fragment: `[[Work/Plan#^k3n9dq]]`. The copied link is fully qualified where
qualification is necessary — never the local shorthand. **If the source edit cannot be saved, the
clipboard is not updated.**

**`block.insertLink` — "Link to a block…"**, no chord. A two-stage picker: choose a note by
title, alias or path; then choose one of its addressable blocks, each row showing its kind and a
compact single-line preview. **Blocks without ids remain selectable — selecting one explicitly
authorises Notes to mint an id in that other note.** The order is: mint and save the target id if
required, then insert the qualified link at the original caret, leaving the target note unopened.
If saving the target fails, nothing is inserted into the source. The target write gets its own
per-note undo entry.

No block-specific backlinks: note backlinks continue to show that the source links to the target,
including links carrying fragments, but are not subdivided by heading or block. No gutter badge,
backlink count or other decoration on an addressed block — its faded marker is the only
indication.

### What the editor and the preview draw

An unaliased block-link chip reads `Plan · ^k3n9dq`, `Work/Plan · ^k3n9dq`, `This note ·
^k3n9dq`. An aliased one shows only the alias, exactly as other aliased links do. Existing chip
colours and borders; the centred dot and the visible id are what make a block link distinct,
without another accent colour or an icon system.

The source marker stays editable text, faded with the same restrained treatment as other markdown
punctuation, **never hidden and never non-editable** — selection, Backspace, Delete, undo and copy
treat it as ordinary characters. (Hiding markers is what made Chromium's delete skip them and
leave stray characters in 0.11.0.)

Markers are **hidden in every rendered surface**: preview, embedded block rendering, HTML/PDF and
other rendered exports, and the offline CLI render. Raw markdown and notebook-copy exports keep
them, because they are part of the source file.

For `## Decision ^k3n9dq` the rendered heading text is `Decision` and the marker does not affect
heading matching, so `[[Note#Decision]]` and `[[Note#^k3n9dq]]` address that line through
different address types.

### Integration

Block embeds go through `src/core/embeds.ts` alongside whole-note and heading embeds — the
preview, all five exports and the offline CLI render consume that one implementation, and the
existing cycle detection and depth-four refusal apply unchanged.

`rewriteLinks` treats the note target and the fragment as separate components. Renaming or moving
may rewrite `[[Plan#^k3n9dq|label]]` to `[[Work/Plan#^k3n9dq|label]]`, preserving `#^k3n9dq` and
`|label` byte-for-byte. The same holds for heading fragments.

**Moving addressed text between notes does not rewrite block links** — ids are scoped to their
original note address, and automatic rewriting would need a cross-note refactor with difficult
partial-selection semantics. But the move does not fail silently. Before `move-lines` or
`move-section` completes, detect block ids in the material being moved, count links currently
addressing them in the source note, and check whether any moved id already exists in the
destination. If either is true, show one confirmation naming both consequences:

> Moving this text will break 3 block links to this note. `^k3n9dq` also exists in the
> destination and will become ambiguous. Move anyway?

**Cancel is the default.** If confirmed, move the bytes unchanged — no regenerated ids, no
rewritten links, no restoration. The explicit confirmation makes the resulting broken or
ambiguous addresses the user's choice.

## The command line

### Journal

```text
notes journal [date] [--no-create] [--json]
```

No `notes today` — `notes journal` already defaults to today, and this app has already paid once
for a name clash (`notes folder` is the notebook's location, so the tree had to be the plural
`notes folders`).

Dates use the journal date parser: `notes journal`, `notes journal yesterday`,
`notes journal 2026-09-01`, `notes journal +3d`. Time-only values are invalid.

It opens or creates the canonical note. It **does not navigate the running window** — when Notes
is running the operation goes through JSON-RPC so the app stays the single writer, and the CLI
receives the result without changing tabs, panes, focus or workspace state. `--no-create`
resolves only an existing entry and returns the existing not-found code otherwise.

- Plain: the notebook-relative markdown path.
- Pretty: `Journal for 2026-09-04`, its relative path, and whether it was created or existed.
- JSON: the same note object as `notes show --json`, plus `journalDate` and `createdNow` on the
  command-result wrapper (not permanently on the note).

No body-printing flags — `notes show` already does that.

### Properties

```text
notes props <note>
notes props <note> <key>
notes props set <note> <key> <value>
notes props set <note> <key> --value <item> [--value <item> ...]
notes props remove <note> <key> [--occurrence <n> | --all]
notes props --all
```

`rm` is an accepted alias; help prints `remove`.

A positional `<value>` sets a scalar under the same conservative interpretation as the sheet.
Repeated `--value` sets a flat list (one `--value` is still a one-element list). Positional and
`--value` are mutually exclusive. **No comma splitting and no raw JSON/YAML input**; complex
values cannot be created. `--occurrence` is one-based in source order; removing a unique key
needs no flag, and removing a duplicated key without `--occurrence` or `--all` returns the
existing ambiguity code **7**. Reserved keys are rejected with guidance to their own command.

- List a note — plain: `key<TAB>type<TAB>value` per occurrence, list values one tab-separated
  value per item, complex values print `<complex>`. Pretty: Key / Type / Value, with an
  Occurrence column only where duplicates exist. JSON: an array of public property objects.
- Read one key — plain: one value per occurrence, list items one per line. Pretty: labelled
  occurrence rows. JSON: **always an array**, because duplicates are legal.
- `set` / `remove` — plain: the changed note's relative path. Pretty: `Set status on
  Work/Plan.md`. JSON: the updated property array for that key plus the note id and path.
- `--all` — plain: `key<TAB>noteCount<TAB>types`. Pretty: the vocabulary table. JSON:
  `{key, noteCount, types, duplicateCount, casingVariants, values}` — **not** limited to ten
  values; that limit is presentation-only.

`prop:` is added to `OPERATOR_NAMES`, `NEGATABLE`, `parseQuery` and `parseWords` through the same
shared implementation, so `notes list "prop:status=draft"` works identically to the search box.

### Blocks

```text
notes show <note> --block <id>
notes show <note> --block <id> --json
```

Accepts `abc123` or `^abc123`, normalising only the argument and never the source file. Plain
output is `BlockSlice.content`. Pretty adds a heading — `Plan · ^abc123 · list item · line 18` —
then the content. JSON is `{noteId, path, block: {id, kind, line, content}}` with one-based line
numbers. Missing blocks use the existing not-found code; duplicates use **7**.

**No `notes block link`.** Printing syntax around an already-known id adds little, and minting
from a shell would need a fragile new way to identify a source block. The CLI reads block
addresses and preserves them; it does not mint them.

### The JSON contract

`notes show --json` adds exactly two fields:

```json
{
  "properties": [
    { "key": "status", "occurrence": 1, "type": "string", "value": "draft" },
    { "key": "config", "occurrence": 1, "type": "complex", "value": null,
      "raw": "config:\n  nested: true" }
  ],
  "blocks": [ { "id": "abc123", "kind": "paragraph", "line": 12 } ]
}
```

Every duplicate block appears separately; `blocks` carries no content — use `--block` for that.
`notes list --json` adds `properties` with the same occurrence schema, and no `blocks` and no
bodies. **Every existing field, nesting, meaning and exit-code number is unchanged, and this
design needs no new exit code**: malformed arguments use the existing usage code, a missing
note/property/block uses not-found, and an ambiguous note, duplicate property occurrence or
duplicate block uses 7.

## The MCP server

The tool count goes from **12 to 14**.

`notes_read` gains `properties` and `blocks` using the CLI JSON schemas, and one optional input
`block_id`. Supplied, it returns the resolved block content and metadata instead of the whole
body; a missing or duplicate block is the normal structured tool error. **No separate
`notes_read_block`** — it is a narrower read of the same note resource.

`notes_search` accepts `prop:` for free through the shared query parser, and result objects carry
custom properties in parallel with `notes list --json`. `notes://<id>` resources are unchanged:
their markdown naturally retains front matter and block ids.

**`notes_set_property`** is the only structured property writer:

```json
{ "note": "Work/Plan", "operation": "set", "key": "status", "value": "draft" }
{ "note": "Work/Plan", "operation": "remove", "key": "status", "occurrence": 1 }
```

`value` is a string, finite number, boolean, null, or an array of those. Objects, nested arrays,
non-finite numbers, reserved keys and unsupported YAML are rejected; `additionalProperties: false`
is kept. Removal needs `occurrence` when duplicates exist, or an explicit `all: true`.
**`notes_update` does not gain an arbitrary `frontMatter` string** — an assistant that can rewrite
arbitrary YAML is a liability.

**`notes_journal`** takes optional `date` (default today) and `create` (default true) and returns
the complete structured note plus `journalDate` and `createdNow`. It never changes the visible
window arrangement. "Add this to today's note" is `notes_journal` then the existing update tool.

A tool call **is** an explicit user command under the governing rule, because the exact mutation
is named in the call, validated, and reversible through ordinary note history or another tool
call.

**Block minting is not exposed through MCP in 0.23.0.** An assistant can read existing blocks,
link to known ids and edit a body through existing tools, but cannot ask Notes to infer "the
third paragraph" and inject an address — that inference lacks the caret and selection context
which is what makes the window command safely explicit.

`scratchpad/phase3-check.mjs` asserts the tool count; it becomes **14**, updated deliberately.

## The seams to get right

Four things Codex named as implementation constraints rather than product decisions:

1. **Centralise link parsing now.** `LINK_PATTERN`, chip rendering, marked, refactoring, embeds,
   backlinks, the CLI render and MCP must consume one parsed `LinkAddress`. Adding local targets
   and block fragments while continuing to split strings independently will create incompatible
   grammars.
2. **Centralise address extraction.** Heading lookup, `blockOf`, marker stripping, block
   enumeration and fragment rendering belong in core. Renderer code may display resolutions but
   must not rediscover markdown block boundaries.
3. **Multi-note edits are transactions at the application layer.** Remote block minting saves the
   target before changing the source, keeps both notes' independent undo entries, and stops
   cleanly on failure. Ordered edits — not an atomic filesystem transaction pretending to a
   rollback it cannot guarantee.
4. (The fourth belongs to 0.24.0 and is recorded there.)

## The release-day criterion

> Starting from an Obsidian-authored note containing comments, complex YAML, duplicate
> properties, headings and block ids, a user can edit one property, create and embed one block
> link, and create today's journal note; the resulting git diff contains **only those explicitly
> requested bytes** plus the existing legitimate metadata update, and every address resolves
> identically through the window, the CLI, the exports and MCP.

If that diff contains normalised unrelated YAML, eagerly minted ids, or divergent block content
between surfaces, 0.23.0 is not done.

## Explicitly not in this release

- A calendar month grid, and yesterday/tomorrow/previous-entry/next-entry commands.
- A `journal:` search operator, and any change to what quick capture appends to.
- `{{yesterday}}` / `{{tomorrow}}` or any date arithmetic in templates.
- `[[` link autocomplete.
- Block-specific backlinks, gutter badges or any decoration on an addressed block.
- Automatic link rewriting when addressed text moves between notes.
- A property type registry, a raw-YAML editor, a nested-YAML tree editor.
- Numeric inequality property queries (`prop:rating>3`).
- `notes block link`, and block minting through MCP.
- A new exit code.
