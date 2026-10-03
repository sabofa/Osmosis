# Adding a special file type to the workspace

For the agent who builds the special files: item files, and long-lived documents such as a unit's USERNOTES or a plan. The workspace frame (tracks, courses, folders, files, tabs, the centre pane) is finished enough for this. It was built so that **a new type is two registrations and one import line**, with no change to the shell and no migration (a file's `type` is a plain text column and nothing constrains its values; only a type that needs tables of its own would need one).

The design is the Learn spec `spec/osmosis/workspace/01-shell.md`, especially §6 (content), §10 (hooks), §12 (API) and §17 (this registry). Ben's answers are `ruling-2026-10-03-shell-answers.md` beside it. Where they disagree, the ruling wins. This guide quotes the parts that bind you.

Read these first. Together they are the whole contract, and each is short:

| File | What it gives you |
|---|---|
| `server/src/domain/workspace/fileTypes.ts` | `FileTypeSpec`, `registerFileType`, `getFileType`, `listFileTypes`, `classOf` |
| `server/src/domain/workspace/content.ts` | `saveContent` (optimistic), `appendContent`, `readContent` |
| `web/src/workspace/fileTypes.tsx` | `WebFileType`, `FileViewProps`, `registerWebFileType`, `webFileType`, `listWebFileTypes` |
| `web/src/workspace/useFileDraft.ts`, `ConflictBanner.tsx`, `saveFlow.ts` | the one never-overwrite save flow |
| `web/src/workspace/MarkdownFile.tsx` | a complete worked View (read, edit, conflict) |
| `web/src/workspace/BuiltinViews.tsx`, `CenterPane.tsx` | thin Views over existing panels; how a View is mounted |

## Ground rules

These come from Ben and from the spec. They are not preferences.

1. **The viewer is a viewer.** The workspace renders, navigates and selects, and has no knowledge that questions, sessions or attempts exist. Its practical test: it must be complete and pleasant where none of them do. Nothing in the frame reads items, and a type you add must not make the frame start to.
2. **Evidence comes only from items with outcomes.** Homework, practice and measures produce evidence; reading and writing documents do not. So an item file **points at** items and never stores answers, responses, scores or outcomes. Those belong to attempts. A file is never an answerable document.
3. **Directed mode guides and never limits.** Ben, on the directed-mode question (whether his own tabs are gated while an item is pending): "no when an item is shown it should direct me to it, i answer the question or look at the graph but it should not limit me, it should only guide me." When the tutor shows an item, the workspace brings Ben to it by focusing its tab, marked `directed` (not built yet, see section 5). Nothing else is collapsed, gated or disabled, and a View renders the same whether its tab was directed or opened by Ben.
4. **Every type that saves goes through `useFileDraft`.** Ben, the tutor and the planner all write these files. A save names the revision it started from, and a stale one is a conflict Ben chooses about (Reload or Overwrite), never something to retry quietly. A View that calls `saveContent` itself will, sooner or later, overwrite the tutor's note.
5. **Writers are `ben`, `tutor` and `planner`, and are never conflated.** See section 4.

## 1. What a file type is

A file node has a `type`: a registered name (`markdown`, `graph`, `asset`, and later your `usernotes` or `item-set`). A file of an unregistered type cannot be created (`unknown_file_type`). Its content is a `body` (text, or JSON as text) or an `asset_id`, plus a `revision` and who saved it (`saved_by`). Every save is a new revision row.

The registry has two halves, one per side. They share nothing but the type name.

**Server**, `FileTypeSpec` (`server/src/domain/workspace/fileTypes.ts`):

| Field | Meaning |
|---|---|
| `type` | Lowercase letters, digits and `-`, starting with a letter, at most 40 characters. `registerFileType` throws on anything else and on a duplicate. Stored on the file, and nothing retypes a file afterwards. |
| `storage` | `"text"`, `"json"` or `"asset"`. See below. |
| `appendable` | Whether `ws_append` (`appendContent`) may add to it. |
| `kinds(body)` | The page kinds the body holds, for the file's `class`. `text` is a document, `plot`, `space` and `figure` are a graph, `flow` a flowchart, `sheet` a spreadsheet, `code` code; no kinds is `empty`; an unknown name, or more than one family, is `mixed` (`classOf`). Called for every file of the type each time the workspace is listed or searched, and with `null` for an empty file. |
| `validate(body)` (optional) | Return a message to refuse the body (`invalid_content`, HTTP 400) or `null` to accept it. Runs on create, `saveContent` and `appendContent`, for every writer including Ben, over the whole new body, `null` included. |
| `searchText(body)` (optional) | The text search should read. Absent means only names and titles are searched. |

**Web**, `WebFileType` (`web/src/workspace/fileTypes.tsx`):

| Field | Meaning |
|---|---|
| `type` | The same name as the server's. |
| `label` | What the "New ..." menus call it (when there is more than one creatable type, "New User notes file"). |
| `icon` (optional) | A node for the tree row. Without one the row shows a puzzle piece. |
| `View` | A React component that takes `FileViewProps` and does both reading and editing (there is no separate editor slot; `MarkdownFile` toggles between the two). |
| `newBody` (optional) | Present: the "New ..." menus offer to make a file of this type, starting with this body (`''` is a body). Absent: not offered. An upload is made by uploading, a graph by its author. |

`FileViewProps` is `{ nodeId, type, body, assetId, revision, onSaved }`. **A View is given these once, when it mounts, and owns its state after that.** `CenterPane` mounts the active tab's View from a fresh read, and unmounts it when Ben switches tab. Do not follow later changes to `body` or `revision`; `onSaved(revision)` only moves the frame's copy of the revision along. Nothing refreshes a View when the tutor writes while it is open: the conflict shows up when Ben saves.

**What `storage` does.** Only `"asset"` changes behaviour: such a file has no body, is created only with an `asset_id`, and its content cannot be saved or appended. `"text"` and `"json"` are handled identically: one `body` string, one revision history. `"json"` is a declaration of what the string is (it is what `GET /api/ws/file-types` reports); the frame never parses it. The structure comes from your `validate`, `kinds` and `searchText`. Special types are `text` or `json`. Uploads are the built-in `asset` type and are made by the upload path, not by you.

**What you get for registering.** No shell code is involved in any of these:

| Once registered... | ...because |
|---|---|
| Files of the type open in the centre pane, in a tab | `CenterPane` looks the type up with `webFileType` and renders its `View` (inside an error boundary, so a throwing View does not take the shell down) |
| The tree shows its `icon`, and "New ..." menus offer it | `Tree.tsx` reads `icon`; `newOptions` offers one entry per web type with a `newBody` |
| The tutor and planner can create it, write it and append to it | `ws_create` takes any registered `type`; `ws_write` and `ws_append` run its `validate` and `appendable` |
| Listings carry its `class` | `kinds` through `classOf` |
| Search finds its content | `searchText` |

If only one half is registered: a server-only type opens as plain text under "Can't show files of type ... yet" (so the server can know types the app has not learned), and a web-only type cannot be created (`unknown_file_type`).

## 2. Adding a type, step by step: `usernotes`

First, whether you need one. **A markdown file called USERNOTES already works today**: the tutor creates it in the unit's folder and `ws_append`s to it (section 4). Build a `usernotes` type only if you want something markdown does not give you, such as its own view, its own validation or its own search text. The example below does that, small enough to read at a glance.

Two things to decide before you start, because the frame will not do them for you:

- **No retyping.** The current `ws_create` description tells the tutor to make USERNOTES as `markdown`, and a file made that way stays `markdown` forever. Change that description (step 6) before the tutor makes more, and decide what happens to the ones that exist. They keep working as markdown; nothing migrates them.
- **`validate` binds Ben too.** It runs on his saves as well as the tutor's appends, and his message is shown to him verbatim. Do not refuse a body just because it does not follow your note convention. He may type anything.

The example's files:

| File | Change |
|---|---|
| `server/src/domain/workspace/fileTypes.ts` | one `registerFileType` call, under a "Special types" heading |
| `server/tests/workspaceUserNotes.test.ts` | new |
| `web/src/workspace/UserNotesFile.tsx` | new: the View |
| `web/src/workspace/userNotes.ts` | new: the one `registerWebFileType` call |
| `web/src/workspace/extensions.ts` | one import line |
| `web/src/workspace/userNotes.test.ts` | new |
| `server/src/mcp/workspaceTools.ts` | `ws_create`'s description (step 6) |

### Step 1. Register the server half

At the bottom of `server/src/domain/workspace/fileTypes.ts`, after the built-ins:

```ts
// ---- Special types -----------------------------------------------------------

// USERNOTES: the tutor's running notes about Ben for one unit, one entry at a
// time, each with a specific example. Ben can edit the file too.
export const USERNOTES_MAX_CHARS = 200_000;

registerFileType({
  type: "usernotes",
  storage: "text",
  appendable: true,
  kinds: () => ["text"],
  validate: (body) =>
    body !== null && body.length > USERNOTES_MAX_CHARS
      ? `A usernotes file holds at most ${USERNOTES_MAX_CHARS} characters. Read it, condense it, and ws_write the shorter version.`
      : null,
  searchText: (body) => body ?? "",
});
```

The cap is this example's own choice (an agent that appends every session must not be able to grow the file without bound, and a full file tells the tutor to condense it). Drop it if you do not want one.

Three rules for the functions you pass:

- **`kinds` and `searchText` must never throw.** They run over every file of the type whenever the workspace is listed or searched, and only a `DomainError` is tolerated there. A `JSON.parse` that throws on one bad body would break the roots, a folder's children and search for the whole workspace. Parse defensively and return `[]` or `""`.
- **`validate` returns a message, it does not throw.** It must accept `null` (a file created with no body) and decide about `""`.
- **A spec in a module of its own only exports the spec.** If you put one in its own module, as `item-set` does in section 3, do not have that module call `registerFileType` and then import it from `fileTypes.ts`. That is a circular import, and it fails at load with `Cannot access 'registry' before initialization`. Export the spec object, use `import type { FileTypeSpec }` in the module (a type import is erased, so there is no cycle), and let `fileTypes.ts` import the spec and call `registerFileType(spec)`.

### Step 2. Test the server half

`server/tests/workspaceUserNotes.test.ts`, in the style of `workspaceContent.test.ts` (`openTestDb` for an in-memory database, the domain functions called directly):

```ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";
import { USERNOTES_MAX_CHARS, classOf, getFileType } from "../src/domain/workspace/fileTypes.js";
import { createNode } from "../src/domain/workspace/graph.js";
import { appendContent, listRevisions, readContent, saveContent } from "../src/domain/workspace/content.js";
import { searchWorkspace } from "../src/domain/workspace/reads.js";

function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected a DomainError, nothing was thrown");
}

describe("the usernotes file type", () => {
  it("is appendable text that holds one text page", () => {
    expect(getFileType("usernotes")).toMatchObject({ storage: "text", appendable: true });
    expect(getFileType("usernotes").kinds("anything")).toEqual(["text"]);
    expect(classOf(getFileType("usernotes").kinds(null))).toBe("document");
  });

  it("takes the tutor's notes by append, keeps Ben's edits, and records who wrote each revision", () => {
    const db = openTestDb();
    const notes = createNode(db, { kind: "file", title: "USERNOTES", file: { type: "usernotes", body: "" } }).node;
    appendContent(db, notes.id, { text: "2026-10-03: mixed up moles and mass on Q3 (3.2 g of C)", author: "tutor" });
    saveContent(db, notes.id, { body: "ben rewrote it", base_revision: 2, author: "ben" });
    appendContent(db, notes.id, { text: "second note", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("ben rewrote it\n\nsecond note");
    expect(listRevisions(db, notes.id).map((r) => r.saved_by)).toEqual(["ben", "tutor", "ben", "tutor"]);
  });

  it("refuses a body over the cap on create, save and append, and leaves the file alone", () => {
    const db = openTestDb();
    const tooBig = "x".repeat(USERNOTES_MAX_CHARS + 1);
    expect(failure(() => createNode(db, { kind: "file", title: "n", file: { type: "usernotes", body: tooBig } })).code).toBe("invalid_content");
    const notes = createNode(db, { kind: "file", title: "n", file: { type: "usernotes", body: "short" } }).node;
    expect(failure(() => saveContent(db, notes.id, { body: tooBig, base_revision: 1, author: "ben" })).code).toBe("invalid_content");
    expect(failure(() => appendContent(db, notes.id, { text: tooBig, author: "tutor" })).code).toBe("invalid_content");
    expect(readContent(db, notes.id)).toMatchObject({ body: "short", revision: 1 });
    expect(listRevisions(db, notes.id)).toHaveLength(1);
  });

  it("is found by search, through its content", () => {
    const db = openTestDb();
    createNode(db, { kind: "file", title: "USERNOTES", file: { type: "usernotes", body: "confuses moles with mass" } });
    expect(searchWorkspace(db, { q: "moles" }).map((r) => r.node.title)).toEqual(["USERNOTES"]);
  });
});
```

A test registers nothing itself here, because the type is registered in `fileTypes.ts` and the test imports that module. (A test that wants a throwaway type registers one under a unique name, as `workspaceContent.test.ts` does with `ws-content-strict`. Vitest gives each test file its own module registry, so those never leak between files.)

### Step 3. Write the web View

`web/src/workspace/UserNotesFile.tsx`. This is `MarkdownFile`'s read, edit and conflict flow, reduced. Read `MarkdownFile.tsx` for the full version (it has Ctrl+S and an explicit editing flag).

```tsx
import RichText from '../components/RichText'
import ConflictBanner from './ConflictBanner'
import type { FileViewProps } from './fileTypes'
import { useFileDraft } from './useFileDraft'

// The tutor's notes about Ben for one unit: read here, edited here, written by
// the tutor through ws_append. Everything about saving is useFileDraft's.
export default function UserNotesFile({ nodeId, body, revision, onSaved }: FileViewProps) {
  const f = useFileDraft({ nodeId, body, revision, onSaved })
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
        <span className="ws-md-rev">revision {f.saved.revision}</span>
      </div>

      {f.conflict && <ConflictBanner busy={f.busy} onReload={() => void f.reload()} onOverwrite={() => void f.overwrite()} />}
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

- `f.saved` is what the server holds as far as this View knows (`body` is `''` for a file whose body is `null`), and `f.draft` is the unsaved text, `null` until editing starts. A body is text, so a type with structure serialises into the draft (section 3 does).
- `f.save()` writes the draft against the revision it started from. If the file has moved on, `f.conflict` turns true and **nothing is written**; show `ConflictBanner`. `f.reload()` takes the file as it is now and drops the draft; `f.overwrite()` reads where the file is now and saves the draft over it. Both are Ben's choice, never yours.
- A server refusal (your `validate` message, a network failure) lands in `f.error`. Show it.
- The draft survives a tab switch (it lives in memory, not storage, so a page reload drops it).
- An append-heavy type conflicts more often than most: the tutor's append moves the revision under Ben's open draft. If that matters to you, show the draft beside the new text before offering Reload. `reload()` drops the draft, so copy it first.

Style: the shell's classes (`ws-btn`, `ws-md-bar`, `ws-error`, `ws-note` and the rest) are in `web/src/workspace/workspace.css`. If your View needs styles of its own, give it its own CSS file imported by the View and prefix every class `ws-`.

### Step 4. Register the web half, and import it once

`web/src/workspace/userNotes.ts`:

```ts
import { registerWebFileType } from './fileTypes'
import UserNotesFile from './UserNotesFile'

// The only registration for this type. extensions.ts imports this module.
registerWebFileType({ type: 'usernotes', label: 'User notes', View: UserNotesFile, newBody: '' })
```

Then add the import to `web/src/workspace/extensions.ts`, the one place special types are imported (`Workspace.tsx` imports that file, so the registrations are in place before anything renders):

```ts
import './userNotes'
```

It cannot be imported from `fileTypes.tsx` itself: a module that calls `registerWebFileType` needs it to be defined first. If you want a row icon, add `icon: <PencilIcon size={14} />` (or another icon from `../components/icons`, as `fileTypes.tsx` does for the built-ins). That is JSX, so the registration module becomes `userNotes.tsx`; its import in `extensions.ts` stays `./userNotes`. Omitting the icon is fine.

### Step 5. Test the web half

`web/src/workspace/userNotes.test.ts`, in the style of `fileTypes.test.ts` and `newMenu.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listWebFileTypes, webFileType } from './fileTypes'
import { newOptions } from './newMenu'
import './userNotes'

describe('the usernotes web type', () => {
  it('is registered with a View and offered in the "New ..." menus, starting empty', () => {
    expect(webFileType('usernotes')).toMatchObject({ type: 'usernotes', label: 'User notes', newBody: '' })
    expect(typeof webFileType('usernotes')?.View).toBe('function')
    expect(newOptions('course', listWebFileTypes()).map((o) => o.key)).toContain('file:usernotes')
  })
})
```

Web tests run in a node environment with no DOM (`web/vitest.config.ts`), so a View is never rendered in a test. **Put anything worth testing in a plain `.ts` module** (section 3's `itemSetBody.ts`) and test that. One trap: `fileTypes.test.ts` uses `item-set` as its example of an unregistered type (`expect(webFileType('item-set')).toBeNull()`). It passes because it imports only `./fileTypes`, not `extensions`. If a change ever makes it import your registrations, give it another name.

### Step 6. Tell the agents

The tutor and the planner learn the workspace only from the seven `ws_*` tool descriptions (`readme()`'s conventions do not cover it; it only lists the tool names). So `ws_create`'s description in `server/src/mcp/workspaceTools.ts`, which names `"markdown"` and `"graph"` as the values of `type` and says USERNOTES is a markdown file, is the place to name your new type and say when to use it. By the rule in `MCP-SPEC.md` §3 (`tools_version` is bumped when a tool is added, removed or changes shape), a new accepted value of the free-text `type` is not a shape change. If you do add a tool, bump `TOOLS_VERSION` in `server/src/protocol.ts` and the number in `MCP-SPEC.md` (the `readme` row in §3, and the §3.6 heading). If the tool belongs on the presenter surface, update `PRESENTER_TOOLS` too: the allowlist test `mcpPresenterScope.test.ts` names every presenter tool, and `MCP-SPEC.md` and `DEPLOY.md` name them in prose.

### Step 7. Run it

```bash
(cd server && npx vitest run tests/workspaceUserNotes.test.ts && npx tsc -p tsconfig.json --noEmit)
(cd web && npx vitest run src/workspace && npx tsc -p tsconfig.app.json --noEmit && npx oxlint src/workspace)
```

(`tsc` with no `-p` checks nothing in `web`: its root `tsconfig.json` only has project references.)

## 3. A JSON-backed type: `item-set`

An item-set file is a list of items Ben works through: homework, a practice set, a test. This section sketches it end to end. It is deliberately a **pointer file**: the Learn spec (§10) calls the idea a "homework file", a pointer to an item and not an answerable document.

**What the constraints mean here.**

- **The viewer is a viewer.** The View shows a file of pointers. It does not know what a session is, and the file is complete and useful with no session, attempt or tutor anywhere.
- **Evidence comes only from items with outcomes.** The body is `{ "items": [ { "question_id": "..." } ] }`, and neither the body nor an entry may have any other field. The validator refuses one, so a score, an answer or a response cannot be saved into the file by Ben, the tutor or the planner. Answers live in attempts (`web/src/components/Take.tsx` is the answering UI; `createAttempt`, `getAttempt` and `answerResponse` in `web/src/lib/api.ts` are its API). How an item file starts one is the item work's design. Whatever you choose, the evidence is recorded by the attempt, never by saving the file.
- **Directed mode guides, never limits.** Showing an item will focus the tab it appears in, marked `directed` (`Tab.directed`, set through `openTab` in `web/src/workspace/tabs.ts`; the tab bar already draws the mark, and nothing sets it yet). That is all it does. Do not disable the other tabs, hide the tree, put the rest of the workspace behind a modal, or refuse to render the file's neighbours while an item is pending. Ben can answer the question or look at the graph, and can open a note and write something down, at any time.

**What `json` changes.** The body is still one string.

- It is **not appendable**: text added after a blank line is not JSON. Agents `ws_write` the whole body (against the `base_revision` they read).
- `validate` must accept `null` (`ws_create` with no `body`) and decide about `''`, because `useFileDraft` hands a View `''` for a null body. The sketch treats both as the empty set. `newBody` must itself be valid.
- `kinds: () => []` gives the class `empty` ("a special type that declares none"). An unknown kind name gives `mixed`. A class of its own would be a change to `classOf`'s table, which the graph-engine spec owns. Raise it there rather than working around it.
- **No `searchText`**: a file of ids has nothing a person would search for, and absent means only its name and title are searched. `searchText` sees only the body, with no database handle, so a type cannot search through its pointers.
- **`validate` has no database handle either**, so it cannot check that a `question_id` exists. A pointer can dangle: a question gets retired, or Ben's laptop node never pulled it (a local node holds only the slices it has synced, and `getQuestion` reads the node you are on while the workspace itself is served by canonical). The View shows a missing item as a state, not an error.

### Server

`server/src/domain/workspace/itemSet.ts`. This one lives in a module of its own and only **exports** its spec:

```ts
import type { FileTypeSpec } from "./fileTypes.js";

// An item-set file POINTS AT items (by question id) and never stores answers,
// responses, scores or outcomes: those belong to attempts, which only items
// with outcomes produce. The body is JSON text:
//
//   { "items": [ { "question_id": "q_..." }, ... ] }
export interface ItemSetBody {
  items: { question_id: string }[];
}

export type ParsedItemSet = { ok: true; value: ItemSetBody } | { ok: false; problem: string };

// Never throws. kinds, searchText and validate run over every file of the
// type whenever the workspace is listed or searched, so a bad body has to come
// back as a problem, not an exception.
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

export const itemSetSpec: FileTypeSpec = {
  type: "item-set",
  storage: "json",
  appendable: false, // text after a blank line is not JSON; agents ws_write the whole body
  kinds: () => [], // holds no pages, so its class is "empty"
  validate: (body) => {
    const parsed = parseItemSet(body);
    return parsed.ok ? null : parsed.problem;
  },
  // No searchText: a file of ids has nothing a person would search for.
};
```

In `fileTypes.ts`, add `import { itemSetSpec } from "./itemSet.js";` at the top, and under "Special types":

```ts
registerFileType(itemSetSpec);
```

`server/tests/workspaceItemSet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";
import { getFileType } from "../src/domain/workspace/fileTypes.js";
import { parseItemSet } from "../src/domain/workspace/itemSet.js";
import { createNode } from "../src/domain/workspace/graph.js";
import { appendContent, readContent, saveContent } from "../src/domain/workspace/content.js";
import { listRoots } from "../src/domain/workspace/reads.js";

function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected a DomainError, nothing was thrown");
}

describe("the item-set file type", () => {
  it("accepts an empty set and ids that point at items", () => {
    expect(parseItemSet(null)).toEqual({ ok: true, value: { items: [] } });
    expect(parseItemSet('{"items":[{"question_id":"q1"},{"question_id":"q2"}]}').ok).toBe(true);
  });

  it("refuses anything that is not a pointer: an answer, a second field, not JSON", () => {
    for (const bad of ["not json", "[]", '{"items":"q1"}', '{"items":[],"answers":{"q1":"B"}}', '{"items":[{"question_id":"q1","answer":"B"}]}', '{"items":[{"question_id":5}]}', '{"items":[null]}']) {
      expect(parseItemSet(bad).ok).toBe(false);
    }
  });

  it("is JSON-backed, not appendable, has no class, and is validated on create, write and append", () => {
    const db = openTestDb();
    expect(getFileType("item-set")).toMatchObject({ storage: "json", appendable: false });
    const f = createNode(db, { kind: "file", title: "hw 3", file: { type: "item-set" } }).node;
    expect(readContent(db, f.id).body).toBeNull();
    saveContent(db, f.id, { body: '{"items":[{"question_id":"q1"}]}', base_revision: 1, author: "planner" });
    expect(failure(() => saveContent(db, f.id, { body: '{"items":[{"question_id":"q1","answer":"B"}]}', base_revision: 2, author: "planner" })).code).toBe("invalid_content");
    expect(failure(() => appendContent(db, f.id, { text: "more", author: "tutor" })).code).toBe("not_appendable");
    expect(listRoots(db).unplaced.find((n) => n.id === f.id)).toMatchObject({ type: "item-set", class: "empty" });
    expect(failure(() => createNode(db, { kind: "file", title: "bad", file: { type: "item-set", body: "nope" } })).code).toBe("invalid_content");
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

export default function ItemSetFile({ nodeId, body, revision, onSaved }: FileViewProps) {
  const f = useFileDraft({ nodeId, body, revision, onSaved })
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
        <span className="ws-md-rev">revision {f.saved.revision}</span>
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
registerWebFileType({ type: 'item-set', label: 'Item set', View: ItemSetFile, newBody: serializeItemSet([]) })
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

The tutor and the planner write through MCP, with seven tools (`MCP-SPEC.md` §3.6 has the full rows). Ben writes over HTTP and is always `ben`. A request cannot sign as anyone else: the route sets the author, and the MCP tools accept only `tutor` or `planner`.

**Two writing agents, never conflated.** Ben's ruling (Learn `spec/osmosis/workspace/ruling-2026-10-03-shell-answers.md`, on whether the tutor may write files):

> "the tutor can edit and write files. there is an important distinction between tutor and planner. tutor is the one who teaches me, if they have notes about me they send it straight to the unit USERNOTES file with spesific examples. the planner is the one that comes up and writes the plan."

So every content write takes `as: "tutor"` or `as: "planner"`, there is no default, and it is recorded on the revision (`saved_by`). The **tutor** teaches, and its notes about Ben go into the unit's USERNOTES file with specific examples. The **planner** writes the plan. A View is not handed `saved_by`, but it can read who wrote the latest revision with `getContent(nodeId)` or `getNodeDetail(nodeId)` (`web/src/workspace/wsApi.ts`; `ws_read` returns it to the agents). The history is not exposed: `listRevisions` exists in `content.ts` and no route or tool reads it.

| Tool | Use it for |
|---|---|
| `ws_list`, `ws_read`, `ws_search` | Read. `ws_list` with no `container_id` is the roots, with one it is that container's children. `ws_read` returns the node, `appears_in`, `parent_tracks` and, for a file, `content` (`type`, `body`, `revision`, `saved_at`, `saved_by`). |
| `ws_create` | A track, course, folder or file. A file needs `type` (and may take `body`, `kind_tag`, and `container_id` to place it in the same call). |
| `ws_append` | **Notes.** Adds text after a blank line, needs no revision, so it lands on whatever is in the file now, Ben's edits included. Only for a type with `appendable: true`. |
| `ws_write` | **A whole document.** Replaces the body. Needs the `base_revision` that `ws_read` showed. |
| `ws_place` | Make an existing node appear in another container (nothing is copied). |

There is no remove, move, rename or destroy. Rearranging the tree is Ben's.

**Append for notes, write for whole documents.**

- `ws_append` is how a long-lived file grows without clobbering anyone: the tutor appends a new entry and never rewrites the file. The server joins the text to the body with a blank line and keeps it exactly as written. The type's `validate` runs over the combined body.
- `ws_write` replaces the body, so it must carry the `base_revision` it read. If the file was saved since (Ben edits these files too), it is refused as `stale_revision`. The MCP answer is `{ error, message }` and the message names the current revision. The right response is to read again, fold the change into what is there now, and write again with the new revision. Never write again with just the new number and the old content: that is the overwrite this check exists to stop.
- A JSON type (`appendable: false`) is only ever written whole, with `ws_write`. A plan is a whole document the planner owns, so it takes `ws_write` too.

**The USERNOTES convention.** It is a convention, not something built in: one file called `USERNOTES` in the unit's folder, holding the tutor's notes about Ben, one entry at a time, each with a specific example (for instance "2026-10-03: mixed up moles and mass on Q3 (3.2 g of C)"). Today it is a `markdown` file, because no `usernotes` type exists. The tutor's first note in a unit:

1. `ws_list` with the unit's `container_id`. If a child called `USERNOTES` is there, skip to step 3.
2. Otherwise `ws_create` with `{ kind: "file", title: "USERNOTES", type: "markdown", container_id: <unit>, as: "tutor" }`.
3. `ws_append` with `{ node_id, text: "<the entry>", as: "tutor" }`.

Do not create USERNOTES twice. A second `ws_create` of the same name answers `name_taken` and suggests "USERNOTES (2)". Do not take the suggestion. The file exists, so find it with `ws_list` and append to it. Rewriting it whole with `ws_write` is for tidying, and it is refused if Ben saved since you read.

Errors a writer should expect: `stale_revision` (the file moved on), `invalid_content` (the type's `validate`, with its message), `not_appendable`, `unknown_file_type`, `trashed` (restore it first; that is Ben's), `name_taken`, `not_found` and `invalid_input`.

## 5. What the frame does not do yet

Do not assume any of these. Each is either Ben's deliberate "frame only" cut or something the frame has no reason to do before the special types exist.

- **No folder export or import.** The database is canonical; a container cannot yet be written out as a real folder or read back (spec §13).
- **No session rooting UI** (spec §7.5, "make this folder the root for this session"). Placing existing courses into a track, and creating courses and tracks inside one, is built.
- **No drag-and-drop.** Placing and removing go through menus.
- **No search UI beyond the filtered partition (the kind-tag chips).** `GET /api/ws/search` and `ws_search` take text (`q`), and nothing in the app calls them with it.
- **No tutor-directed tab opening.** The tab model has a `directed` flag and the tab bar draws it, but nothing sets it: there is no tool for it yet (one comes with live sessions). A directed tab will only focus the file; see ground rule 3.
- **No exposure recording.** The shell emits no `opened`, `focused`, `dwell` or `selected` events and records nothing (spec §10 lists them as the hook for the item work). The `readable(node_id)` hook is not built either: the shell gates nothing, by Ben's ruling.
- **USERNOTES is a convention to build, not a built-in.** No `usernotes` type exists, and nothing creates the file for the tutor. Section 4 says what the convention is.
- **No item files.** There is no `item-set` or any other item type. Section 3 is a sketch.
- **A file's type cannot change.** Nothing retypes a file, so a USERNOTES file made as `markdown` stays `markdown`.
- **No revision history in the app or over MCP.** Every save is stored with its author; nothing reads the list back.
- **No live refresh of an open View.** The tutor's write shows up when Ben reopens the tab or when his save conflicts.
- **Uploads made on the laptop's local node do not appear in the workspace.** Assets do not sync between nodes, and `/api/ws` is served by the canonical node (a local node forwards it). An upload made on the canonical node (through its web app) or over MCP (`create_asset`) appears at once as an unplaced `asset:<id>` file; one made on the laptop does not.
- **An existing track cannot be placed under a track from the UI.** A new track can be made inside one, and `ws_place` places an existing one.
- **No MCP tool lists the file types.** The HTTP route `GET /api/ws/file-types` does, but the web registry does not read it and the agents cannot call it. They learn type names from the tool descriptions (step 6).

## 6. Checklist for a new type

- [ ] The ground rules hold: no answers in the file, no gating, every save through `useFileDraft`.
- [ ] Server: spec registered under "Special types" (a spec in its own module only exports it). `kinds` and `searchText` never throw. `validate` returns a message, accepts `null`, and does not refuse what Ben might reasonably type.
- [ ] Server test: registered flags, a refused body on create, save and append, and (if appendable) who wrote each revision.
- [ ] Web: a View on `FileViewProps` that saves through `useFileDraft` and shows `ConflictBanner` and `f.error`; one `registerWebFileType` call; one import line in `extensions.ts`; `newBody` only if "New ..." should offer it, and it is a valid body.
- [ ] Web test: registration, plus a test of any pure logic you put in a plain `.ts` module.
- [ ] `ws_create`'s description names the type (step 6).
- [ ] `vitest run` passes in `server` and `web`, and so does `tsc -p tsconfig.json --noEmit` in `server` and `tsc -p tsconfig.app.json --noEmit` in `web`.
