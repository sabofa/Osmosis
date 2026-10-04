# Adding a special file format to the workspace

For the agent who builds the special files: item files, and long-lived documents such as a unit's USERNOTES or a plan. The workspace frame (trajectories, tracks, courses, folders, files, tabs, the centre pane) and the data layer under it are finished enough for this. A new format is **an optional set of server hooks, one web registration and one import line**, with no change to the shell and no migration. A file's `format` is a plain text column that the data layer never interprets, so a format needs tables of its own only if it wants something the layer cannot hold.

The code says **format** where the first design said *type*: a file has a `format`, the server registers `FormatHooks`, and the web registers a `WebFileType` keyed by `format`. (The web module and its functions keep the old name: `fileTypes.tsx`, `registerWebFileType`, `webFileType`. This file keeps its name too, so links to it hold.)

The design is the Learn spec `spec/osmosis/workspace/02-data-layer.md`, especially §7 (content and the format hooks), §5.7 (creating and saving), §8 (uploads) and §9 (concurrency and authors). It supersedes `01-shell.md` §2–§6 (data model, rules, reads, content). The rest of `01-shell.md` still stands, in particular §10 (the hooks the shell provides); §17 describes the first design's registry, and its server half is superseded by 02 §7 and this guide. Ben's answers are `ruling-2026-10-03-shell-answers.md` beside them. Where they disagree, the ruling wins. This guide quotes the parts that bind you.

Read these first. Together they are the whole contract, and each is short:

| File | What it gives you |
|---|---|
| `server/src/domain/workspace/formats.ts` | `FormatHooks`, `registerFormat`, `formatHooks`, `listFormats`, and `searchSourceFor`, the one place that says what a hook's `searchText` is handed |
| `server/src/domain/workspace/content.ts` | `saveContent` (optimistic), `appendContent`, `readContent`, `listVersions` |
| `server/src/domain/workspace/uploads.ts` | how an upload gets its `asset:<id>` file (format `upload`); you do not make these |
| `web/src/workspace/fileTypes.tsx` | `WebFileType`, `FileViewProps`, `registerWebFileType`, `webFileType`, `listWebFileTypes` |
| `web/src/workspace/useFileDraft.ts`, `ConflictBanner.tsx`, `saveFlow.ts` | the one never-overwrite save flow |
| `web/src/workspace/MarkdownFile.tsx` | a complete worked View (read, edit, conflict) |
| `web/src/workspace/BuiltinViews.tsx`, `CenterPane.tsx` | thin Views over existing panels; how a View is mounted |

## Ground rules

These come from Ben and from the spec. They are not preferences.

1. **The viewer is a viewer.** The workspace renders, navigates and selects, and has no knowledge that questions, sessions or attempts exist. Its practical test: it must be complete and pleasant where none of them do. Nothing in the frame reads items, and a format you add must not make the frame start to.
2. **Evidence comes only from items with outcomes.** Homework, practice and measures produce evidence; reading and writing documents do not. So an item file **points at** items and never stores answers, responses, scores or outcomes. Those belong to attempts. A file is never an answerable document.
3. **Directed mode guides and never limits.** Ben, on the directed-mode question (whether his own tabs are gated while an item is pending): "no when an item is shown it should direct me to it, i answer the question or look at the graph but it should not limit me, it should only guide me." When the tutor shows an item, the workspace brings Ben to it by focusing its tab, marked `directed` (not built yet, see section 5). Nothing else is collapsed, gated or disabled, and a View renders the same whether its tab was directed or opened by Ben.
4. **Every format that saves goes through `useFileDraft`.** Ben, the tutor and the planner all write these files. A save names the version it started from, and a stale one is a conflict Ben chooses about (Reload or Overwrite, and Merge when the tutor only appended), never something to retry quietly. A View that calls `saveContent` itself will, sooner or later, overwrite the tutor's note.
5. **Writers are `ben`, `tutor` and `planner`, and are never conflated.** See section 4.
6. **The markdown viewer and editor are placeholders.** Ben, after seeing the frame: "the actual document files and editing and graphing engine port will be handled later, document files are ran by the document engine and editing will be a new mode in the document engine."
   - Document files will render in the **document engine**, and editing will be **a mode of the document engine**. The graph engine is ported into the centre pane later.
   - So a format whose content is prose should keep its View thin and replaceable. Don't build features on `MarkdownFile`'s textarea.
   - The registry, `FileViewProps` and `useFileDraft` are the parts meant to last.

## 1. What a format is

A file node has content in a **format**: a name the layer stores and never interprets (`markdown`, `graph`, `upload`, and later your `usernotes` or `item-set`). The name is lowercase letters, digits and `-`, starting with a letter, at most 40 characters (`^[a-z][a-z0-9-]{0,39}$`). The content is a `body` (text, or JSON as text) or, for `upload` only, an `asset_id`. Every save is a new **version** (1, 2, 3, ...) that records its `author` (`ben`, `tutor` or `planner`) and `saved_at`, and the latest version is the file's content. Every version is kept: `ws_content` has one row per version.

A file takes its format when it is created and keeps it. A save writes the next version in the same format, and nothing retypes a file.

**The layer never interprets content.** It checks the name's grammar, stores the body as given, and returns it. Everything a format *means* is supplied by its owner as **hooks**, and every hook is optional. A format with none, which includes any name nobody registered, is stored and returned verbatim: it is **unsearchable by its content, not appendable, and never validated**. There is no `unknown_file_type` any more: nothing refuses a format for being unregistered.

The registry has two halves, one per side. They share nothing but the format name.

**Server**, `FormatHooks` (`server/src/domain/workspace/formats.ts`), registered with `registerFormat`:

| Field | Meaning |
|---|---|
| `format` | The name above. `registerFormat` throws (a plain `Error`, at startup) on a bad name and on a duplicate. |
| `searchText(body)` (optional) | The plain text search should read for a version. The layer calls it when the version is written and stores the result as that version's `search_text`; search reads the stored text. Absent: only placement names and node titles are searched. It is given the body, `null` included (for `upload` it is given the asset's extracted text, see below). |
| `validate(body)` (optional) | Return a message to refuse the body (`invalid_content`, HTTP 400) or `null` to accept it. Runs on create, `saveContent` and `appendContent`, for every writer including Ben, over the whole new body, `null` included. The message reaches the writer as you wrote it. |
| `append(body, text)` (optional) | Present means the format is appendable (`ws_append`, `appendContent`), and it returns the new body. The joining is yours: `markdown` puts a blank line between what is there and the new text. The result goes through `validate` and `searchText` like any save. Absent: `not_appendable`. |

How hooks behave:

- **Hooks run only on writes** (create, save, append), never during a read or a listing. A hook that throws, or returns the wrong kind of value (`searchText` and `append` must return a string), fails *that one write* with `invalid_content`. A bad body therefore cannot break the roots, a folder's children or search for the whole workspace, which is what a throwing hook could do in the first design. Still, refuse a body by *returning* a message from `validate`: a thrown error reaches the writer wrapped in "The "x" format could not check this content: ...".
- **`searchText` runs once per version, when it is written.** Changing a format's `searchText` later does not re-index versions already stored; a file is re-read the next time anyone writes it.
- **The layer computes no class** (document, graph, flowchart, ...). There is no `kinds` hook and no `storage` declaration: the UI and the engines derive such things from the format and its content. A body is a string, and "this format is JSON" is a convention the format keeps in its own `validate`.
- `formatHooks(format)` returns a format's hooks, or `null` when it has none. `listFormats()` (the route `GET /api/ws/formats`) lists the registered formats as `{ format, searchable, appendable, validated }`.

**`upload` is the one format the layer treats specially.** An `upload` file wraps an uploaded asset (`asset_id`) and has no body. It is made by the upload path (an `asset:<asset id>` file, placed nowhere, tagged `source`), and its `searchText` is handed the asset's extracted text instead of a body (`searchSourceFor`). You never make one.

**Web**, `WebFileType` (`web/src/workspace/fileTypes.tsx`):

| Field | Meaning |
|---|---|
| `format` | The same name as the server's. |
| `label` | What the "New ..." menus call it (when there is more than one creatable format, "New User notes file"). |
| `icon` (optional) | A node for the tree row. Without one the row shows a puzzle piece. |
| `View` | A React component that takes `FileViewProps` and does both reading and editing (there is no separate editor slot; `MarkdownFile` toggles between the two). |
| `newBody` (optional) | Present: the "New ..." menus offer to make a file of this format, starting with this body (`''` is a body). Absent: not offered. An upload is made by uploading, a graph by its author. |

`FileViewProps` is `{ nodeId, format, body, assetId, version, onSaved }`. **A View is given these once, when it mounts, and owns its state after that.** `CenterPane` mounts the active tab's View from a fresh read, and unmounts it when Ben switches tab. Do not follow later changes to `body` or `version`; `onSaved(version)` only moves the frame's copy of the version along. Nothing refreshes a View when the tutor writes while it is open: the conflict shows up when Ben saves.

**What you get for registering.** No shell code is involved in any of these:

| Once registered... | ...because |
|---|---|
| Files of the format open in the centre pane, in a tab | `CenterPane` reads the file's latest version, looks its format up with `webFileType` and renders its `View` (inside an error boundary, so a throwing View does not take the shell down) |
| The tree shows its `icon`, and "New ..." menus offer it | `Tree.tsx` reads `icon`; `newOptions` offers one entry per web format with a `newBody` |
| The tutor and planner can create it, write it and append to it | `ws_create` takes any valid `format`; `ws_write` and `ws_append` run the server hooks (`validate`, `append`) |
| Search finds its content | the `searchText` hook (server half) |
| Listings carry its `format` | the layer stores it, and `ws_list`, `ws_read`, `ws_search` and `GET /api/ws/nodes/:id/children` show it |

The first two rows are the web half alone. The next two need server hooks, or they are the verbatim defaults above.

If only one half is registered: a format with hooks and no web entry opens as plain text under "Can't show files of format ... yet" (so the server can know formats the app has not learned). A format with a web entry and no hooks can be created, shown and saved, but it is stored verbatim: not searchable by its content, not appendable, never validated.

## 2. Adding a format, step by step: `usernotes`

First, whether you need one. **A markdown file called USERNOTES already works today**: the tutor creates it in the unit's folder and `ws_append`s to it (section 4). Build a `usernotes` format only if you want something markdown does not give you, such as its own view, its own validation or its own search text. The example below does that, small enough to read at a glance.

Two things to decide before you start, because the frame will not do them for you:

- **No retyping.** The current `ws_create` description tells the tutor to make USERNOTES as `markdown`, and a file made that way stays `markdown` forever (Ben would have to make a new file and copy the text). Change that description (step 6) before the tutor makes more, and decide what happens to the ones that exist. They keep working as markdown; nothing migrates them.
- **`validate` binds Ben too.** It runs on his saves as well as the tutor's appends, and his message is shown to him as you wrote it. Do not refuse a body just because it does not follow your note convention. He may type anything.

The example's files:

| File | Change |
|---|---|
| `server/src/domain/workspace/formats.ts` | one `registerFormat` call, under a "Special formats" heading at the bottom |
| `server/tests/workspaceUserNotes.test.ts` | new |
| `web/src/workspace/UserNotesFile.tsx` | new: the View |
| `web/src/workspace/userNotes.ts` | new: the one `registerWebFileType` call |
| `web/src/workspace/extensions.ts` | one import line |
| `web/src/workspace/userNotes.test.ts` | new |
| `server/src/mcp/workspaceTools.ts` | the descriptions that name the formats (step 6) |

### Step 1. Register the server half

At the bottom of `server/src/domain/workspace/formats.ts`, after the built-ins:

```ts
// ---- Special formats ---------------------------------------------------------

// USERNOTES: the tutor's running notes about Ben for one unit, one entry at a
// time, each with a specific example. Ben can edit the file too.
export const USERNOTES_MAX_CHARS = 200_000;

registerFormat({
  format: "usernotes",
  // The body is the text search should read.
  searchText: (body) => body ?? "",
  // Having an append hook is what makes the format appendable. The joining is the
  // format's: a blank line between what is there and the new entry, as markdown does.
  append: (body, text) => (body ? `${body}\n\n${text}` : text),
  validate: (body) =>
    body !== null && body.length > USERNOTES_MAX_CHARS
      ? `A usernotes file holds at most ${USERNOTES_MAX_CHARS} characters. Read it, condense it, and ws_write the shorter version.`
      : null,
});
```

The cap is this example's own choice (an agent that appends every session must not be able to grow the file without bound, and a full file tells the tutor to condense it). Drop it if you do not want one. Registering at the bottom of `formats.ts` is what the built-ins do, and it puts the registration in place for everything that reaches the domain at all, tests included.

Rules for the hooks you pass:

- **Every hook must cope with `null`.** A file created with no `body` has a `null` body, and HTTP lets a save carry `body: null`, so `validate` and `searchText` can be given `null`. `append` is given the current body, which is `null` for a file created with none: `usernotes`' hook returns the bare text.
- **`validate` returns a message, it does not throw.** It must accept `null` and decide about `""`. It sees only the body, with no database handle.
- **`searchText` is stored once per version** (section 1): if you change the hook later, versions already written keep the text they were indexed with.
- **A hook module of its own only exports its hooks.** If you put the hooks in a module of their own, as `item-set` does in section 3, do not have that module call `registerFormat` and then import it from `formats.ts`. That is a circular import, and it fails at load with `Cannot access 'FORMAT_NAME' before initialization`. Export the hooks object, use `import type { FormatHooks }` in the module (a type import is erased, so there is no cycle), and let `formats.ts` import it and call `registerFormat(hooks)`.

### Step 2. Test the server half

`server/tests/workspaceUserNotes.test.ts`, in the style of `workspaceContent.test.ts` (`openTestDb` for an in-memory database, the domain functions called directly):

```ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";
import { USERNOTES_MAX_CHARS, listFormats } from "../src/domain/workspace/formats.js";
import { createNode } from "../src/domain/workspace/graph.js";
import { appendContent, listVersions, readContent, saveContent } from "../src/domain/workspace/content.js";
import { search } from "../src/domain/workspace/reads.js";

function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected a DomainError, nothing was thrown");
}

describe("the usernotes format", () => {
  it("has all three hooks", () => {
    expect(listFormats()).toContainEqual({ format: "usernotes", searchable: true, appendable: true, validated: true });
  });

  it("takes the tutor's notes by append, keeps Ben's edits, and records who wrote each version", () => {
    const db = openTestDb();
    const notes = createNode(db, { kind: "file", title: "USERNOTES", format: "usernotes", body: "" }).node;
    appendContent(db, notes.id, { text: "2026-10-03: mixed up moles and mass on Q3 (3.2 g of C)", author: "tutor" });
    saveContent(db, notes.id, { body: "ben rewrote it", base_version: 2, author: "ben" });
    appendContent(db, notes.id, { text: "second note", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("ben rewrote it\n\nsecond note");
    expect(listVersions(db, notes.id).map((v) => v.author)).toEqual(["ben", "tutor", "ben", "tutor"]);
    // What search will read is what searchText returned when the version was written.
    expect(readContent(db, notes.id).search_text).toBe("ben rewrote it\n\nsecond note");
  });

  it("refuses a body over the cap on create, save and append, and leaves the file alone", () => {
    const db = openTestDb();
    const tooBig = "x".repeat(USERNOTES_MAX_CHARS + 1);
    expect(failure(() => createNode(db, { kind: "file", title: "n", format: "usernotes", body: tooBig })).code).toBe("invalid_content");
    const notes = createNode(db, { kind: "file", title: "n", format: "usernotes", body: "short" }).node;
    expect(failure(() => saveContent(db, notes.id, { body: tooBig, base_version: 1, author: "ben" })).code).toBe("invalid_content");
    expect(failure(() => appendContent(db, notes.id, { text: tooBig, author: "tutor" })).code).toBe("invalid_content");
    expect(readContent(db, notes.id)).toMatchObject({ body: "short", version: 1 });
    expect(listVersions(db, notes.id)).toHaveLength(1);
  });

  it("is found by search through its content, once it is placed", () => {
    const db = openTestDb();
    const unit = createNode(db, { kind: "folder", title: "Unit 3" }).node;
    createNode(db, { kind: "file", title: "USERNOTES", format: "usernotes", body: "confuses moles with mass", container_id: unit.id });
    // A file placed nowhere is never a search result, whatever it says.
    createNode(db, { kind: "file", title: "stray", format: "usernotes", body: "moles again" });
    expect(search(db, { q: "moles" }).map((r) => r.name)).toEqual(["USERNOTES"]);
  });
});
```

A test registers nothing itself here, because the format is registered in `formats.ts` and the test imports that module. (A test that wants a throwaway format registers one under a unique name, as `workspaceContent.test.ts` does with `t-picky` and the others. The registry is per process and refuses a duplicate, and Vitest gives each test file its own module registry, so those never leak between files.)

### Step 3. Write the web View

`web/src/workspace/UserNotesFile.tsx`. This is `MarkdownFile`'s read, edit and conflict flow, reduced. Read `MarkdownFile.tsx` for the full version (it has Ctrl+S and an explicit editing flag).

```tsx
import RichText from '../components/RichText'
import ConflictBanner from './ConflictBanner'
import type { FileViewProps } from './fileTypes'
import { useFileDraft } from './useFileDraft'

// The tutor's notes about Ben for one unit: read here, edited here, written by
// the tutor through ws_append. Everything about saving is useFileDraft's.
export default function UserNotesFile({ nodeId, body, version, onSaved }: FileViewProps) {
  const f = useFileDraft({ nodeId, body, version, onSaved })
  // A draft exists from the first Edit until it is discarded or the file is
  // reloaded; one left half-written when Ben switched tab comes back.
  const editing = f.draft !== null

  return (
    <div className="ws-markdown">
      <div className="ws-md-bar">
        {editing ? (
          <>
            <button className="ws-btn primary" disabled={f.busy || f.conflict || !f.dirty} onClick={() => void f.save()}>
              {f.busy ? 'Saving…' : 'Save'}
            </button>
            <button className="ws-btn" disabled={f.busy} onClick={f.discard}>
              {f.dirty ? 'Discard changes' : 'Done'}
            </button>
          </>
        ) : (
          <button className="ws-btn" onClick={f.startDraft}>
            Edit
          </button>
        )}
        {f.dirty && <span className="ws-md-flag">Unsaved changes</span>}
        <span className="ws-md-rev">version {f.saved.version}</span>
      </div>

      {f.conflict && (
        <ConflictBanner busy={f.busy} addition={f.addition} onMerge={() => void f.merge()} onReload={() => void f.reload()} onOverwrite={() => void f.overwrite()} />
      )}
      {f.error && (
        <div className="ws-error" role="alert">
          {f.error}
        </div>
      )}

      {editing ? (
        <textarea className="ws-md-text" value={f.draft ?? ''} spellCheck={false} onChange={(e) => f.setDraft(e.target.value)} />
      ) : (
        <div className="ws-md-view">
          {f.saved.body.trim() === '' ? <div className="ws-note">No notes yet.</div> : <RichText text={f.saved.body} />}
        </div>
      )}
    </div>
  )
}
```

What the hook gives you, so you do not rebuild it:

- `f.saved` is what the server holds as far as this View knows (`body` is `''` for a file whose body is `null`), and `f.draft` is the unsaved text, `null` until editing starts. A body is text, so a format with structure serialises into the draft (section 3 does).
- `f.save()` writes the draft against the version it started from. If the file has moved on, `f.conflict` turns true and **nothing is written**; show `ConflictBanner`. `f.reload()` takes the file as it is now and drops the draft; `f.overwrite()` reads where the file is now and saves the draft over it. Both are Ben's choice, never yours.
- `f.addition` is set with a conflict when the only change to the file is text added at its end (the tutor's `ws_append` to USERNOTES). `f.merge()` then saves Ben's draft plus that text on top of where the file is now, and the draft becomes the merged text; pass both to `ConflictBanner` (`addition`, `onMerge`) and it offers "Merge their additions" beside Reload and Overwrite. The decision is `mergeAppended` in `saveFlow.ts`: the server's text must start with exactly the text the draft started from (the hook keeps it beside the base version), so a rewrite or an edit in the middle is never merged. A format whose draft is structured text (JSON) has no `append` hook, so it never gets an `addition` and can leave the props off.
- A server refusal (your `validate` message, a network failure) lands in `f.error`. Show it.
- The draft survives a tab switch (it lives in memory, not storage, so a page reload drops it).
- An append-heavy format conflicts more often than most: the tutor's append moves the version under Ben's open draft. For the plain-text case the merge above keeps both sides, so his open draft and the tutor's note survive. For any other change, show the draft beside the new text before offering Reload: `reload()` drops the draft, so copy it first.

Style: the shell's classes (`ws-btn`, `ws-md-bar`, `ws-error`, `ws-note` and the rest) are in `web/src/workspace/workspace.css`. If your View needs styles of its own, give it its own CSS file imported by the View and prefix every class `ws-`.

### Step 4. Register the web half, and import it once

`web/src/workspace/userNotes.ts`:

```ts
import { registerWebFileType } from './fileTypes'
import UserNotesFile from './UserNotesFile'

// The only registration for this format. extensions.ts imports this module.
registerWebFileType({ format: 'usernotes', label: 'User notes', View: UserNotesFile, newBody: '' })
```

Then add the import to `web/src/workspace/extensions.ts`, the one place special formats are imported (`Workspace.tsx` imports that file, so the registrations are in place before anything renders). The file starts with only a comment and `export {}`; the first import replaces the `export {}`:

```ts
import './userNotes'
```

It cannot be imported from `fileTypes.tsx` itself: a module that calls `registerWebFileType` needs it to be defined first. If you want a row icon, add `icon: <PencilIcon size={14} />` (or another icon from `../components/icons`, as `fileTypes.tsx` does for the built-ins) and `import { PencilIcon } from '../components/icons'`. That is JSX, so the registration module becomes `userNotes.tsx`; its import in `extensions.ts` stays `./userNotes`. Omitting the icon is fine.

### Step 5. Test the web half

`web/src/workspace/userNotes.test.ts`, in the style of `fileTypes.test.ts` and `newMenu.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listWebFileTypes, webFileType } from './fileTypes'
import { newOptions } from './newMenu'
import './userNotes'

describe('the usernotes web format', () => {
  it('is registered with a View and offered in the "New ..." menus, starting empty', () => {
    expect(webFileType('usernotes')).toMatchObject({ format: 'usernotes', label: 'User notes', newBody: '' })
    expect(typeof webFileType('usernotes')?.View).toBe('function')
    expect(newOptions('course', listWebFileTypes()).map((o) => o.key)).toContain('file:usernotes')
  })
})
```

Web tests run in a node environment with no DOM (`web/vitest.config.ts`), so a View is never rendered in a test. **Put anything worth testing in a plain `.ts` module** (section 3's `itemSetBody.ts`) and test that. One trap: `fileTypes.test.ts` uses `item-set` as its example of an unregistered format (`expect(webFileType('item-set')).toBeNull()`). It passes because it imports only `./fileTypes`, not `extensions`. If a change ever makes it import your registrations, give it another name.

### Step 6. Tell the agents

The tutor and the planner learn the workspace only from the seven `ws_*` tool descriptions (`readme()`'s conventions do not cover it; it only lists the tool names). `server/src/mcp/workspaceTools.ts` names `"markdown"` and `"graph"` as the formats of a file, and says USERNOTES is a markdown file, in five places. Grep it for `markdown`, and name your format and say when to use it in each:

- the `ws_create` description, in the sentence that says what to pass as `format`, and in the one that says the unit's USERNOTES file is a markdown file;
- the `format` field's `describe` text;
- the error `ws_create` throws when a file is made with no format, which lists the values;
- the `ws_append` description, which names `markdown` as the format that accepts an append.

`workspaceMcp.test.ts` pins some of their wording (the containment sentences in `ws_create`, the word USERNOTES in `ws_append` and in each write tool's `as`, and `revision` appearing nowhere), so change the format names and leave those alone.

By the rule in `MCP-SPEC.md` §3 (`tools_version` is bumped when a tool is added, removed or changes shape), a new accepted value of the free-text `format` is not a shape change. If you do add a tool, bump `TOOLS_VERSION` in `server/src/protocol.ts` and the number in `MCP-SPEC.md` (the `readme` row in §3, and the §3.6 heading). If the tool belongs on the presenter surface, update `PRESENTER_TOOLS` too: the allowlist test `mcpPresenterScope.test.ts` names every presenter tool, and `MCP-SPEC.md` and `DEPLOY.md` name them in prose.

### Step 7. Run it

```bash
(cd server && npx vitest run --maxWorkers=2 tests/workspaceUserNotes.test.ts && npx tsc -p tsconfig.json --noEmit)
(cd web && npx vitest run --maxWorkers=2 src/workspace && npx tsc -p tsconfig.app.json --noEmit && npx oxlint src/workspace)
```

(`--maxWorkers=2` keeps Ben's PC usable while he works. `tsc` with no `-p` checks nothing in `web`: its root `tsconfig.json` only has project references. The server's `tsc` covers `src` only, so a server test is checked by running it, not by `tsc`.)

## 3. A structured body: `item-set`

An item-set file is a list of items Ben works through: homework, a practice set, a test. This section sketches it end to end. It is deliberately a **pointer file**: the Learn spec (`01-shell.md` §10) calls the idea a "homework file", a pointer to an item and not an answerable document.

**What the constraints mean here.**

- **The viewer is a viewer.** The View shows a file of pointers. It does not know what a session is, and the file is complete and useful with no session, attempt or tutor anywhere.
- **Evidence comes only from items with outcomes.** The body is `{ "items": [ { "question_id": "..." } ] }`, and neither the body nor an entry may have any other field. The validator refuses one, so a score, an answer or a response cannot be saved into the file by Ben, the tutor or the planner. Answers live in attempts (`web/src/components/Take.tsx` is the answering UI; `createAttempt`, `getAttempt` and `answerResponse` in `web/src/lib/api.ts` are its API). How an item file starts one is the item work's design. Whatever you choose, the evidence is recorded by the attempt, never by saving the file.
- **Directed mode guides, never limits.** Showing an item will focus the tab it appears in, marked `directed` (`Tab.directed`, set through `openTab` in `web/src/workspace/tabs.ts`; the tab bar already draws the mark, and nothing sets it yet). That is all it does. Do not disable the other tabs, hide the tree, put the rest of the workspace behind a modal, or refuse to render the file's neighbours while an item is pending. Ben can answer the question or look at the graph, and can open a note and write something down, at any time.

**What a structured body changes.** The body is still one string, and the layer still never reads it. The structure is yours, in the hooks and in the View.

- It is **not appendable**: it registers no `append` hook, because text added after a blank line is not JSON. Agents `ws_write` the whole body (against the `version` they read), and `ws_append` answers `not_appendable`.
- `validate` must accept `null` (`ws_create` with no `body`) and decide about `''`, because `useFileDraft` hands a View `''` for a null body. The sketch treats both as the empty set. `newBody` must itself be valid.
- **No `searchText`**: a file of ids has nothing a person would search for. With no hook the layer stores no search text for it, and only its name and title are searched. `searchText` sees only the body, with no database handle, so a format cannot search through its pointers.
- **`validate` has no database handle either**, so it cannot check that a `question_id` exists. A pointer can dangle: a question gets retired, or Ben's laptop node never pulled it (a local node holds only the slices it has synced, and `getQuestion` reads the node you are on while the workspace itself is served by canonical). The View shows a missing item as a state, not an error.
- **No class.** The layer computes none, and a format has nowhere to declare one. If the UI wants to treat item files as their own kind of thing, it keys on the `format` name.

### Server

`server/src/domain/workspace/itemSet.ts`. This one lives in a module of its own and only **exports** its hooks:

```ts
import type { FormatHooks } from "./formats.js";

// An item-set file POINTS AT items (by question id) and never stores answers,
// responses, scores or outcomes: those belong to attempts, which only items
// with outcomes produce. The body is JSON text:
//
//   { "items": [ { "question_id": "q_..." }, ... ] }
export interface ItemSetBody {
  items: { question_id: string }[];
}

export type ParsedItemSet = { ok: true; value: ItemSetBody } | { ok: false; problem: string };

// Never throws. A hook that throws fails its write with the engine's wording
// wrapped around yours, so a bad body comes back as a problem to show as it is.
export function parseItemSet(body: string | null): ParsedItemSet {
  if (body === null || body.trim() === "") return { ok: true, value: { items: [] } };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, problem: "An item-set body is JSON." };
  }
  const top = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw) : [];
  const items = (raw as { items?: unknown } | null)?.items;
  if (top.length !== 1 || top[0] !== "items" || !Array.isArray(items)) {
    return { ok: false, problem: 'An item-set body is exactly {"items": [{"question_id": "..."}, ...]}.' };
  }
  for (const [i, item] of items.entries()) {
    const keys = item !== null && typeof item === "object" ? Object.keys(item) : [];
    if (keys.length !== 1 || keys[0] !== "question_id" || typeof (item as { question_id: unknown }).question_id !== "string") {
      return { ok: false, problem: `items[${i}] must be exactly {"question_id": "..."}: an item file points at items and stores nothing else.` };
    }
  }
  return { ok: true, value: { items: items as ItemSetBody["items"] } };
}

export const itemSetHooks: FormatHooks = {
  format: "item-set",
  validate: (body) => {
    const parsed = parseItemSet(body);
    return parsed.ok ? null : parsed.problem;
  },
  // No searchText: a file of ids has nothing a person would search for, so the
  // layer stores no search text for it. No append either: text added after a
  // blank line is not JSON, so agents ws_write the whole body.
};
```

In `formats.ts`, add the import at the top:

```ts
import { itemSetHooks } from "./itemSet.js";
```

and under "Special formats":

```ts
registerFormat(itemSetHooks);
```

`server/tests/workspaceItemSet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";
import { listFormats } from "../src/domain/workspace/formats.js";
import { parseItemSet } from "../src/domain/workspace/itemSet.js";
import { createNode } from "../src/domain/workspace/graph.js";
import { appendContent, readContent, saveContent } from "../src/domain/workspace/content.js";
import { unplaced } from "../src/domain/workspace/reads.js";

function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected a DomainError, nothing was thrown");
}

describe("the item-set format", () => {
  it("accepts an empty set and ids that point at items", () => {
    expect(parseItemSet(null)).toEqual({ ok: true, value: { items: [] } });
    expect(parseItemSet('{"items":[{"question_id":"q1"},{"question_id":"q2"}]}').ok).toBe(true);
  });

  it("refuses anything that is not a pointer: an answer, a second field, not JSON", () => {
    for (const bad of ["not json", "[]", '{"items":"q1"}', '{"items":[],"answers":{"q1":"B"}}', '{"items":[{"question_id":"q1","answer":"B"}]}', '{"items":[{"question_id":5}]}', '{"items":[null]}']) {
      expect(parseItemSet(bad).ok).toBe(false);
    }
  });

  it("is validated only: not searchable, not appendable, and checked on create and write", () => {
    const db = openTestDb();
    expect(listFormats()).toContainEqual({ format: "item-set", searchable: false, appendable: false, validated: true });
    const f = createNode(db, { kind: "file", title: "hw 3", format: "item-set" }).node;
    expect(readContent(db, f.id)).toMatchObject({ body: null, search_text: null });
    saveContent(db, f.id, { body: '{"items":[{"question_id":"q1"}]}', base_version: 1, author: "planner" });
    expect(failure(() => saveContent(db, f.id, { body: '{"items":[{"question_id":"q1","answer":"B"}]}', base_version: 2, author: "planner" })).code).toBe("invalid_content");
    expect(failure(() => appendContent(db, f.id, { text: "more", author: "tutor" })).code).toBe("not_appendable");
    expect(unplaced(db).find((n) => n.id === f.id)).toMatchObject({ format: "item-set" });
    expect(failure(() => createNode(db, { kind: "file", title: "bad", format: "item-set", body: "nope" })).code).toBe("invalid_content");
  });
});
```

### Web

Three small files: the body parse (a plain module, so it can be tested), the View, and the registration.

`web/src/workspace/itemSetBody.ts`. The web and the server share no code, so this is the web's own tolerant parse (the server's `validate` is what refuses a bad save):

```ts
// The item-set body: { "items": [ { "question_id": "..." }, ... ] }. The web and
// the server share no code, so this is the web's own small parse, kept in a plain
// module so it can be unit-tested (vitest here has no DOM). It is tolerant: a body
// that does not parse is an empty set and a problem to show, never a crash, and
// the server's validate is what refuses a bad save.
export function parseItemSet(text: string): { ids: string[]; problem: string | null } {
  if (text.trim() === '') return { ids: [], problem: null }
  try {
    const items = (JSON.parse(text) as { items?: unknown } | null)?.items
    if (!Array.isArray(items)) throw new Error('no items list')
    return { ids: items.map((i) => String((i as { question_id?: unknown }).question_id)), problem: null }
  } catch {
    return { ids: [], problem: 'This file is not a valid item set.' }
  }
}

export const serializeItemSet = (ids: string[]): string =>
  JSON.stringify({ items: ids.map((question_id) => ({ question_id })) }, null, 2)
```

`web/src/workspace/ItemSetFile.tsx`. The View renders each pointer through the question components that already exist, and saves through `useFileDraft`, serialising the structure into the draft text:

```tsx
import { useEffect, useState } from 'react'
import QuestionPanel from '../components/QuestionPanel'
import RichText from '../components/RichText'
import { getQuestion, type QuestionDetail } from '../lib/api'
import ConflictBanner from './ConflictBanner'
import type { FileViewProps } from './fileTypes'
import { parseItemSet, serializeItemSet } from './itemSetBody'
import { useFileDraft } from './useFileDraft'

// One pointed-at item, shown by its prompt and its graph or document panel.
// Deliberately not QuestionDetail: that one prints the correct choice, the model
// answer and the explanation (it is the bank's view). A pointer can dangle (the
// question was retired, or this node never pulled it); that is a state to show,
// not an error.
function ItemCard({ questionId }: { questionId: string }) {
  const [q, setQ] = useState<QuestionDetail | 'missing' | null>(null)
  useEffect(() => {
    let live = true
    getQuestion(questionId)
      .then((found) => live && setQ(found))
      .catch(() => live && setQ('missing'))
    return () => {
      live = false
    }
  }, [questionId])

  if (q === null) return <div className="ws-note">Loading…</div>
  if (q === 'missing') return <div className="ws-note">{`Item ${questionId} is not on this node.`}</div>
  return (
    <div className="ws-item">
      <RichText text={q.prompt} />
      <QuestionPanel
        graphSpec={q.graph_spec}
        desmosAllowed={q.desmos_allowed}
        documentId={q.document_id}
        documentAnchorLabel={q.document_anchor_label}
        documentAnchorStart={q.document_anchor_start}
        documentAnchorEnd={q.document_anchor_end}
      />
    </div>
  )
}

export default function ItemSetFile({ nodeId, body, version, onSaved }: FileViewProps) {
  const f = useFileDraft({ nodeId, body, version, onSaved })
  const [adding, setAdding] = useState('')
  // What is on screen is the draft if there is one, else what is saved.
  const { ids, problem } = parseItemSet(f.draft ?? f.saved.body)
  const edit = (next: string[]) => f.setDraft(serializeItemSet(next))

  return (
    <div className="ws-itemset">
      <div className="ws-md-bar">
        <button className="ws-btn primary" disabled={f.busy || f.conflict || !f.dirty} onClick={() => void f.save()}>
          Save
        </button>
        {f.dirty && (
          <button className="ws-btn" disabled={f.busy} onClick={f.discard}>
            Discard changes
          </button>
        )}
        <input value={adding} placeholder="question id" onChange={(e) => setAdding(e.target.value)} />
        <button
          className="ws-btn"
          disabled={adding.trim() === '' || problem !== null}
          onClick={() => {
            edit([...ids, adding.trim()])
            setAdding('')
          }}
        >
          Add
        </button>
        <span className="ws-md-rev">version {f.saved.version}</span>
      </div>
      {f.conflict && <ConflictBanner busy={f.busy} onReload={() => void f.reload()} onOverwrite={() => void f.overwrite()} />}
      {(f.error ?? problem) && (
        <div className="ws-error" role="alert">
          {f.error ?? problem}
        </div>
      )}
      {ids.length === 0 && problem === null && <div className="ws-note">No items yet.</div>}
      {ids.map((id, i) => (
        <div key={`${id}:${i}`}>
          <ItemCard questionId={id} />
          <button className="ws-btn" onClick={() => edit(ids.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}
```

This is a sketch of the wiring, not a design for the item surface. Two things in it are deliberate. `ItemCard` does not use `QuestionDetail`, because the bank's view prints the correct choice, the model answer and the explanation, so using it for an item still awaiting an outcome would put the answer on screen. (Ben's ruling means the shell will not gate anything, but what your View chooses to show is still yours to decide.) And "add an item by id" is the simplest possible edit; a picker over the bank is the item work. (`ws-item` and `ws-itemset` are placeholder class names with no styles yet.)

`web/src/workspace/itemSet.ts`, then `import './itemSet'` in `extensions.ts` beside `./userNotes`:

```ts
import { registerWebFileType } from './fileTypes'
import ItemSetFile from './ItemSetFile'
import { serializeItemSet } from './itemSetBody'

// newBody is a valid empty set: the server's validate runs on a new file too.
registerWebFileType({ format: 'item-set', label: 'Item set', View: ItemSetFile, newBody: serializeItemSet([]) })
```

`web/src/workspace/itemSetBody.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseItemSet, serializeItemSet } from './itemSetBody'

describe('item-set body', () => {
  it('round-trips ids and treats an empty body as an empty set', () => {
    expect(parseItemSet(serializeItemSet(['q1', 'q2']))).toEqual({ ids: ['q1', 'q2'], problem: null })
    expect(parseItemSet('')).toEqual({ ids: [], problem: null })
  })
  it('turns a body that does not parse into a problem to show, not a throw', () => {
    expect(parseItemSet('nope').problem).not.toBeNull()
    expect(parseItemSet('{"items":"q1"}').problem).not.toBeNull()
  })
})
```

Exposure is not built (see section 5). When you record that Ben looked at an item, that is an exposure (seen, dwell), not evidence. The frame emits no `opened` or `dwell` events today. A View's own mount and unmount are the only per-file lifecycle there is, so you can time a View with those, or add the shell events yourself in `Workspace.tsx` and `tabs.ts`. Either way, only elicited input (an answer in an attempt) is a response.

## 4. How agents write

The tutor and the planner write through MCP, with seven tools (`MCP-SPEC.md` §3.6 has the full rows). Ben writes over HTTP and is always `ben`. A request cannot sign as anyone else: the route sets the author (a `POST /api/ws/nodes` body that names one is refused), and the MCP tools accept only `tutor` or `planner`.

**Two writing agents, never conflated.** Ben's ruling (Learn `spec/osmosis/workspace/ruling-2026-10-03-shell-answers.md`, on whether the tutor may write files):

> "the tutor can edit and write files. there is an important distinction between tutor and planner. tutor is the one who teaches me, if they have notes about me they send it straight to the unit USERNOTES file with spesific examples. the planner is the one that comes up and writes the plan."

So every content write takes `as: "tutor"` or `as: "planner"`, there is no default, and it is recorded on the version (`author`). The **tutor** teaches, and its notes about Ben go into the unit's USERNOTES file with specific examples. The **planner** writes the plan. A View is not handed the author, but it can read who wrote the latest version with `getContent(nodeId)` or `getNodeDetail(nodeId)` (`web/src/workspace/wsApi.ts`; `ws_read` returns it to the agents). The history is not read by anything yet: `GET /api/ws/nodes/:id/versions` (`listVersions` in `content.ts`) lists each version's number, author and time, and no web call or MCP tool uses it.

| Tool | Use it for |
|---|---|
| `ws_list`, `ws_read`, `ws_search` | Read. `ws_list` with no `container_id` is the roots (every trajectory, track and course, `top_level` when it is placed nowhere) plus `unplaced` (the files and folders placed nowhere); with one it is that container's children. `ws_read` returns the node, `appears_in` and, for a file, `content` (`format`, `body`, `version`, `saved_at`, `author`, `asset_id`). `ws_search` matches names, titles and a file's search text, and never lists an unplaced node. |
| `ws_create` | A trajectory, track, course, folder or file. A file needs `format` (and may take `body`, `kind_tag`, and `container_id` to place it in the same call). |
| `ws_append` | **Notes.** Hands the text to the format's `append` hook (markdown puts it after a blank line), needs no version, so it lands on whatever is in the file now, Ben's edits included. Only for a format with an `append` hook. |
| `ws_write` | **A whole document.** Replaces the body. Needs the `version` that `ws_read` showed. |
| `ws_place` | Make an existing node appear in another container (nothing is copied). |

There is no trash, delete, restore, purge, move, rename or retitle tool. Removing things and rearranging the tree are Ben's.

**Append for notes, write for whole documents.**

- `ws_append` is how a long-lived file grows without clobbering anyone: the tutor appends a new entry and never rewrites the file. The server gives the format's `append` hook the body as it is now and the new text, and writes what the hook returns, so the joining is the format's. The format's `validate` runs over the combined body.
- `ws_write` replaces the body, so it must carry the `version` it read (`version` on the tool, `base_version` in the domain and on HTTP). If the file was saved since (Ben edits these files too), it is refused as `stale_version`. The MCP answer is `{ error, message }` and the message names the current version; HTTP's 409 also carries it as `detail.current_version`. The right response is to read again, fold the change into what is there now, and write again with the new version. Never write again with just the new number and the old content: that is the overwrite this check exists to stop.
- A format with no `append` hook (a JSON one, `graph`, an upload) is only ever written whole, with `ws_write`. A plan is a whole document the planner owns, so it takes `ws_write` too.

**The USERNOTES convention.** It is a convention, not something built in: one file called `USERNOTES` in the unit's folder, holding the tutor's notes about Ben, one entry at a time, each with a specific example (for instance "2026-10-03: mixed up moles and mass on Q3 (3.2 g of C)"). A unit is just a folder (a folder has no built-in meaning), so "the unit's folder" is whichever folder Ben made for it. Today the file is a `markdown` file, because no `usernotes` format is registered. The tutor's first note in a unit:

1. `ws_list` with the unit's `container_id`. If a child called `USERNOTES` is there, skip to step 3.
2. Otherwise `ws_create` with `{ kind: "file", title: "USERNOTES", format: "markdown", container_id: <unit>, as: "tutor" }`.
3. `ws_append` with `{ node_id, text: "<the entry>", as: "tutor" }`.

Do not create USERNOTES twice. A second `ws_create` of the same name answers `name_taken`. For an agent, the message says to `ws_list` the container and use the node that is there, and never to make a numbered copy; it does not offer a numbered name. (The app's HTTP API does, as `detail.suggestion`, for Ben's UI; `ws_place` answers the same way as `ws_create`.) So find the file with `ws_list` and append to it. Rewriting it whole with `ws_write` is for tidying, and it is refused if Ben saved since you read.

Errors a writer should expect: `stale_version` (the file moved on), `invalid_content` (the format's `validate`, with its message, or a hook that threw), `not_appendable`, `archived` (the node, or the container you are placing it in, is in Ben's Archive; restoring it is his), `name_taken`, `invalid_name`, `containment_not_allowed`, `cycle_rejected`, `already_placed`, `not_found` and `invalid_input` (a bad format name or kind tag, a missing format, a body on a folder).

## 5. What the frame does not do yet

Do not assume any of these. Each is either Ben's deliberate "frame only" cut or something the frame has no reason to do before the special formats exist.

Already built, so a format does not need to: trajectories (the picker's "New trajectory", `top_level` marks, the header's "in:" links), the picker's "Rename…" and "Delete…" on every row (a trajectory, and a track or course at the top level, appear in no container, so the picker is the only place to rename or delete them), the Archive (a row's "Delete…" shows what it would take, including the orphans, and archives a node everywhere; the Archive lists what was deleted, Restore asks which of the node's former places come back and offers what was deleted with it, and refuses an upload whose upload was deleted (`upload_gone`: purge it), Purge is behind a confirm), "Remove from "X"" with an Undo, and the Tag menu, which suggests five kind tags and accepts any valid one Ben types.

- **No git export or import.** The database is canonical. Nothing writes a container out as a real folder or repository, or reads one back, and the representation is still open (`02-data-layer.md` §11, which wants it settled before the first export exists).
- **No session rooting UI** (`01-shell.md` §7.5, "make this folder the root for this session"). Opening a trajectory, track or course as a workspace is built, and so is creating them and placing one in another.
- **No drag-and-drop.** Everything goes through menus. A row's menu has "Rename here", "Place in…" (a plain list of the containers the containment rules let the node go in), "Tag ▸" for a file, "Remove from "X"" (its notice carries an Undo that puts the node back under the name it had) and "Delete…". There is no one-step move in the app: it is Place in…, then Remove from. (`PATCH /api/ws/placements/:id` with `container_id` moves in one step, and nothing in the app calls it.)
- **Retitle only from the picker.** The picker's "Rename…" calls `retitle` (`PATCH /api/ws/nodes/:id` with `title`, applied together with a `kind_tag` if one is sent). A workspace's own sidebar has no retitle: its rows' "Rename here" changes only the name in one container, and a title is a node's fallback name (an unplaced file, a trajectory, track or course opened as a workspace, a container at the top level).
- **No search UI beyond the filtered partition (the kind-tag chips).** `GET /api/ws/search` and `ws_search` take text (`q`), and nothing in the app calls them with it.
- **No tutor-directed tab opening.** The tab model has a `directed` flag and the tab bar draws it, but nothing sets it: there is no tool for it yet (one comes with live sessions). A directed tab will only focus the file; see ground rule 3.
- **No exposure recording.** The shell emits no `opened`, `focused`, `dwell` or `selected` events and records nothing (`01-shell.md` §10 lists them as the hook for the item work). The `readable(node_id)` hook is not built either: the shell gates nothing, by Ben's ruling.
- **USERNOTES is a convention to build, not a built-in.** No `usernotes` format is registered, and nothing creates the file for the tutor. Section 4 says what the convention is.
- **No item files.** No `item-set` or any other item format is registered. Section 3 is a sketch.
- **A file's format cannot change.** Nothing retypes a file, so a USERNOTES file made as `markdown` stays `markdown`.
- **No version history in the app or over MCP.** Every save is stored with its author, and `GET /api/ws/nodes/:id/versions` lists each version's number, author and time. No web call or tool uses it, and no route returns an old version's body: only the latest content is readable.
- **No live refresh of an open View.** The tutor's write shows up when Ben reopens the tab or when his save conflicts.
- **An upload that lives on canonical does not open in the workspace when the app runs through the laptop's local node.** The workspace file for it is listed (`/api/ws` is forwarded), but the viewer (`DocumentPanel`) fetches `/api/assets/:id` from the node it is served by, that route is not forwarded, and assets do not sync. Open the app on the canonical node to read it.
- **The Archive's advice for an upload that still exists does not work through the laptop's local node.** Purging the file of an upload that exists is refused (`asset_in_use`) and the Archive says to delete the upload in Settings → Documents, but `/api/assets` is not forwarded, so through a local node that page lists the laptop's own uploads and not canonical's. Delete it in the server's Osmosis (on canonical), then purge it from either; the Archive's message says so.
- **Uploads made on the laptop's local node do not appear in the workspace.** Assets do not sync between nodes, and `/api/ws` is served by the canonical node (a local node forwards it). An upload made on the canonical node (through its web app) or over MCP (`create_asset`) appears at once as an unplaced `asset:<id>` file; one made on the laptop does not.
- **No MCP tool lists the formats.** The HTTP route `GET /api/ws/formats` does (each registered format and whether it has `searchText`, `append` and `validate` hooks), but the web registry does not read it and the agents cannot call it. They learn format names from the tool descriptions (step 6).

## 6. Checklist for a new format

- [ ] The ground rules hold: no answers in the file, no gating, every save through `useFileDraft`.
- [ ] Server: hooks registered under "Special formats" in `formats.ts` (hooks in a module of their own only export them). Only the hooks the format needs: `searchText` if people should find it by content, `append` if agents add to it, `validate` if it has a shape. `validate` returns a message, accepts `null`, and does not refuse what Ben might reasonably type. No hook is called on a read, and a hook that throws fails that write with `invalid_content`.
- [ ] Server test: `listFormats()` flags, a refused body on create, save and append, and (if appendable) who wrote each version.
- [ ] Web: a View on `FileViewProps` that saves through `useFileDraft` and shows `ConflictBanner` and `f.error`; one `registerWebFileType` call; one import line in `extensions.ts`; `newBody` only if "New ..." should offer it, and it is a valid body.
- [ ] Web test: registration, plus a test of any pure logic you put in a plain `.ts` module.
- [ ] The `ws_create` and `ws_append` descriptions name the format (step 6).
- [ ] `vitest run` passes in `server` and `web`, and so does `tsc -p tsconfig.json --noEmit` in `server` and `tsc -p tsconfig.app.json --noEmit` in `web`.
