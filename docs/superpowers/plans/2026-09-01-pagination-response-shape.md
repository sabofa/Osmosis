# Pagination and Response-Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every MCP listing/search tool the same `{ total, <rows>, has_more }` pagination contract that `search_questions` already has, and trim one deterministically-null field off `list_tags`, so an AI caller can browse a growing bank/asset library/results set without silently losing rows past a hard cap.

**Architecture:** Mirror the existing, already-shipped precedent in `searchQuestions` (`server/src/domain/questions.ts:630-709`): an inline `SELECT COUNT(*)` for `total`, `limit ?? 50` / `offset ?? 0`, `LIMIT ? OFFSET ?` appended to the row query. Domain functions that already back `http/apiRoutes.ts` routes (`listAssets`, `listTags`, `listTemplates`, `getResults`) keep their no-args behavior byte-for-byte identical — pagination is added as optional params with unbounded-by-default semantics, exactly like `searchQuestions` already does. Only `searchAssets`'s return shape actually changes (bare array → `{ total, assets }`), and it's verified unused by `apiRoutes.ts`, so that's safe.

**Tech stack:** TypeScript, `node:sqlite` `DatabaseSync`, Zod (`server/src/mcp/tools.ts`), Vitest (`server/tests/*.test.ts`, run via `npm test` → `vitest run` from `server/`).

**Spec:** `C:\Users\benif\osmosis-lab\PRODUCT-PROPOSAL-pagination-and-response-shape.md` (validated in a separate lab repo against a copy of this codebase). This plan corrects two things the spec got wrong about the *real* repo — see Global Constraints.

## Global Constraints

- **Never change a domain function's zero-args return shape or default behavior.** `listAssets`, `listTags`, `listTemplates`, `getResults` back real routes in `server/src/http/apiRoutes.ts` (`/api/assets`, `/api/tags`, `/api/templates`, `/api/results/*`). New `limit`/`offset` params must be optional; omitting them must reproduce today's exact output.
- **Pagination contract, everywhere:** MCP tool response carries `{ total, <rows-key>, has_more }`. Domain SQL uses `limit ?? 50, offset ?? 0` and `LIMIT ? OFFSET ?`, matching `searchQuestions` exactly (`server/src/domain/questions.ts:674-693`).
- **Correction to the spec — no `trimSearchQuestionsForMcp` precedent exists.** The spec's item 3 (`list_tags` field trim) says to mirror an "existing `trimSearchQuestionsForMcp` function." Verified by direct grep: no trim function exists anywhere in `server/src` today. `search_questions`'s handler (`server/src/mcp/tools.ts:157-181`) is a raw `ok(searchQuestions(db, params))` passthrough. Task 4 below builds the trim function from scratch — do not go looking for a function to copy.
- **Correction to the spec — `TemplateSummary` field/query counts.** The spec says 21 fields and "two extra queries per template." Verified current reality: `TemplateSummary` (`server/src/domain/templates.ts:117-140`) has **22 fields**, and `toSummary()` (`templates.ts:142-195`) runs up to **three** extra queries per row (`countEligible`, the attempt-stats aggregate, and a conditional `local_slice` lookup). This doesn't change what Task 6 does, just don't cite the spec's numbers in code comments or commit messages.
- **Out of scope, explicitly** (per the spec's own "Explicitly NOT proposed" section — do not add these): the three hard-delete tools (`delete_tag`/`delete_question`/`delete_template`), and a `_response_tokens_estimate` field on responses.
- **Do not build Task 7 (`include` selector) as part of this plan.** The spec itself marks it speculative and says to build it "last, and only if #1-#6 ship and someone hits the specific... wall in practice." It is included at the end of this document for reference only, with no tasks — do not implement it now.
- All new/changed domain functions get a Vitest test file under `server/tests/`, following the existing pattern: `openTestDb()` / `insertTag()` / `insertQuestion()` from `server/tests/helpers.ts`, `describe`/`it`/`expect` from `"vitest"`.
- Run `cd server && npm test` after every task; run `npm run typecheck` before every commit (this codebase has no lint step, only `tsc --noEmit`).

---

## Task 1: `list_assets` — add pagination

**Files:**
- Modify: `server/src/domain/assets.ts:106-113` (`listAssets`), add `countAssets` nearby
- Modify: `server/src/mcp/tools.ts` — `list_assets` tool registration (currently lines 433-446)
- Test: `server/tests/assetsPagination.test.ts` (new file)

**Interfaces:**
- Produces: `listAssets(db, opts?: { unlinkedOnly?: boolean; limit?: number; offset?: number }): AssetSummary[]` (limit/offset optional, unbounded when omitted — same as today)
- Produces: `countAssets(db, opts?: { unlinkedOnly?: boolean }): number`
- Consumes: `AssetSummary` type, unchanged (`assets.ts:98-104`)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/tests/assetsPagination.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { createAsset, listAssets, countAssets } from "../src/domain/assets.js";

async function seedAssets(db: ReturnType<typeof openTestDb>, n: number) {
  for (let i = 0; i < n; i++) {
    await createAsset(db, "/tmp/osmosis-test-uploads", { title: `Asset ${i}`, type: "text", content: `content ${i}` }, "claude");
  }
}

describe("listAssets pagination", () => {
  it("returns everything, unbounded, when no limit/offset is passed (unchanged default behavior)", async () => {
    const db = openTestDb();
    await seedAssets(db, 5);
    const rows = listAssets(db);
    expect(rows).toHaveLength(5);
  });

  it("returns a bounded page when limit/offset are passed", async () => {
    const db = openTestDb();
    await seedAssets(db, 5);
    const page = listAssets(db, { limit: 2, offset: 0 });
    expect(page).toHaveLength(2);
    const nextPage = listAssets(db, { limit: 2, offset: 2 });
    expect(nextPage).toHaveLength(2);
    expect(nextPage[0].id).not.toBe(page[0].id);
  });
});

describe("countAssets", () => {
  it("counts all assets matching the same WHERE clause listAssets would use", async () => {
    const db = openTestDb();
    await seedAssets(db, 3);
    expect(countAssets(db)).toBe(3);
    expect(countAssets(db, { unlinkedOnly: true })).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && npx vitest run tests/assetsPagination.test.ts
```
Expected: FAIL — `countAssets` is not exported, and `listAssets(db, { limit, offset })` currently ignores those options (both page assertions would return all 5 rows, not 2).

- [ ] **Step 3: Implement `listAssets` limit/offset and `countAssets`**

Replace `server/src/domain/assets.ts:106-113`:

```typescript
export function listAssets(
  db: DatabaseSync,
  opts?: { unlinkedOnly?: boolean; limit?: number; offset?: number }
): AssetSummary[] {
  const where = opts?.unlinkedOnly
    ? "WHERE id NOT IN (SELECT DISTINCT document_id FROM question WHERE document_id IS NOT NULL)"
    : "";
  const limitClause =
    opts?.limit !== undefined ? `LIMIT ${Number(opts.limit)} OFFSET ${Number(opts.offset ?? 0)}` : "";
  return db
    .prepare(`SELECT id, title, type, created_at, created_by FROM asset ${where} ORDER BY created_at DESC ${limitClause}`)
    .all() as unknown as AssetSummary[];
}

export function countAssets(db: DatabaseSync, opts?: { unlinkedOnly?: boolean }): number {
  const where = opts?.unlinkedOnly
    ? "WHERE id NOT IN (SELECT DISTINCT document_id FROM question WHERE document_id IS NOT NULL)"
    : "";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM asset ${where}`).get() as { n: number };
  return row.n;
}
```

(`Number(...)` guards against SQL injection via a non-numeric `limit`/`offset` — the MCP Zod schema already constrains these to `z.number()`, but the domain function has no such guarantee from other callers, and this mirrors how the rest of the codebase avoids parameter binding inside a `LIMIT` clause since SQLite doesn't accept `LIMIT ?` bound params inside string-built clauses here the way `searchQuestions` does — that one uses prepared `?` placeholders; do the same here instead if you'd rather keep it consistent: `LIMIT ? OFFSET ?` bound via `.all(limit, offset)`. Either is safe since both values are validated numbers; prefer the bound-placeholder form to match `searchQuestions`'s pattern exactly:)

```typescript
export function listAssets(
  db: DatabaseSync,
  opts?: { unlinkedOnly?: boolean; limit?: number; offset?: number }
): AssetSummary[] {
  const where = opts?.unlinkedOnly
    ? "WHERE id NOT IN (SELECT DISTINCT document_id FROM question WHERE document_id IS NOT NULL)"
    : "";
  if (opts?.limit === undefined) {
    return db
      .prepare(`SELECT id, title, type, created_at, created_by FROM asset ${where} ORDER BY created_at DESC`)
      .all() as unknown as AssetSummary[];
  }
  return db
    .prepare(
      `SELECT id, title, type, created_at, created_by FROM asset ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(opts.limit, opts.offset ?? 0) as unknown as AssetSummary[];
}
```

Use this second (bound-placeholder) version — it's the one to actually commit.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && npx vitest run tests/assetsPagination.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the MCP tool handler**

In `server/src/mcp/tools.ts`, add `limit`/`offset` to the `list_assets` input schema and return `total`/`has_more`. Find the current handler (grep `"list_assets"`) and replace it:

```typescript
server.registerTool(
  "list_assets",
  {
    description: "List source-material assets (notes, PDFs, links). Paginated: pass limit/offset to page past the default 50.",
    inputSchema: {
      unlinked_only: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async ({ unlinked_only, limit, offset }) => {
    try {
      const opts = { unlinkedOnly: unlinked_only, limit: limit ?? 50, offset: offset ?? 0 };
      const total = countAssets(db, { unlinkedOnly: unlinked_only });
      const assets = listAssets(db, opts);
      return ok({ total, assets, has_more: (offset ?? 0) + assets.length < total });
    } catch (err) {
      return fail(err);
    }
  }
);
```

Add `countAssets` to the existing import line at the top of `tools.ts`:
```typescript
import { createAsset, getAsset, searchAssets, listAssets, countAssets } from "../domain/assets.js";
```

- [ ] **Step 6: Typecheck and run the full test suite**

```bash
cd server && npm run typecheck && npm test
```
Expected: no type errors, all tests pass (including the pre-existing `tests/assets.test.ts` and `tests/apiRoutes.test.ts`, confirming `/api/assets` is untouched since it calls `listAssets(db)` with no opts).

- [ ] **Step 7: Commit**

```bash
git add server/src/domain/assets.ts server/src/mcp/tools.ts server/tests/assetsPagination.test.ts
git commit -m "feat: add pagination to list_assets MCP tool"
```

---

## Task 2: `search_assets` — add pagination + response envelope

**Files:**
- Modify: `server/src/domain/assets.ts:122-155` (`searchAssets`)
- Modify: `server/src/mcp/tools.ts` — `search_assets` tool registration (currently lines 463-476)
- Test: `server/tests/assetsPagination.test.ts` (extend the file from Task 1)

**Interfaces:**
- Consumes: nothing new
- Produces: `searchAssets(db, query, opts?: { type?; limit?; offset? }): { total: number; assets: AssetSearchResult[] }` — **shape change** from today's bare `AssetSearchResult[]`. Verified safe: `grep -rn "searchAssets" server/src/http/apiRoutes.ts` returns zero matches, so no HTTP route depends on the old shape.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/assetsPagination.test.ts`:

```typescript
import { searchAssets } from "../src/domain/assets.js";

describe("searchAssets pagination + envelope", () => {
  it("returns { total, assets } instead of a bare array, honoring limit/offset", async () => {
    const db = openTestDb();
    for (let i = 0; i < 5; i++) {
      await createAsset(db, "/tmp/osmosis-test-uploads", { title: `Widget ${i}`, type: "text", content: "widget content" }, "claude");
    }
    const result = searchAssets(db, "widget", { limit: 2, offset: 0 });
    expect(result.total).toBe(5);
    expect(result.assets).toHaveLength(2);

    const page2 = searchAssets(db, "widget", { limit: 2, offset: 2 });
    expect(page2.assets).toHaveLength(2);
    expect(page2.assets[0].id).not.toBe(result.assets[0].id);
  });

  it("defaults to limit 50, offset 0 when neither is passed", async () => {
    const db = openTestDb();
    await createAsset(db, "/tmp/osmosis-test-uploads", { title: "Solo widget", type: "text", content: "widget content" }, "claude");
    const result = searchAssets(db, "widget");
    expect(result.total).toBe(1);
    expect(result.assets).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/assetsPagination.test.ts
```
Expected: FAIL — `searchAssets` returns a bare array today (`result.total` is `undefined`).

- [ ] **Step 3: Implement**

Replace `server/src/domain/assets.ts:122-155`:

```typescript
export function searchAssets(
  db: DatabaseSync,
  query: string,
  opts?: { type?: AssetType; limit?: number; offset?: number }
): { total: number; assets: AssetSearchResult[] } {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 32);
  if (tokens.length === 0) return { total: 0, assets: [] };
  const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");

  const clauses = ["asset_fts MATCH ?"];
  const args: unknown[] = [ftsQuery];
  if (opts?.type) {
    clauses.push("a.type = ?");
    args.push(opts.type);
  }
  const where = clauses.join(" AND ");

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM asset_fts f JOIN asset a ON a.rowid = f.rowid WHERE ${where}`)
      .get(...(args as any[])) as { n: number }
  ).n;

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const assets = db
    .prepare(
      `SELECT a.id, a.title, a.type,
              snippet(asset_fts, 1, '[', ']', '...', 10) AS snippet
       FROM asset_fts f
       JOIN asset a ON a.rowid = f.rowid
       WHERE ${where}
       ORDER BY rank
       LIMIT ? OFFSET ?`
    )
    .all(...([...args, limit, offset] as any[])) as unknown as AssetSearchResult[];

  return { total, assets };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/assetsPagination.test.ts
```
Expected: PASS (4 tests total from Task 1 + 2)

- [ ] **Step 5: Wire the MCP tool handler**

Replace the `search_assets` handler in `server/src/mcp/tools.ts`:

```typescript
server.registerTool(
  "search_assets",
  {
    description: "Full-text search over source-material assets. Paginated: pass limit/offset to page past the default 50.",
    inputSchema: {
      query: z.string(),
      type: z.enum(["url", "text", "file"]).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async ({ query, type, limit, offset }) => {
    try {
      const result = searchAssets(db, query, { type, limit: limit ?? 50, offset: offset ?? 0 });
      return ok({ ...result, has_more: (offset ?? 0) + result.assets.length < result.total });
    } catch (err) {
      return fail(err);
    }
  }
);
```

- [ ] **Step 6: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/domain/assets.ts server/src/mcp/tools.ts server/tests/assetsPagination.test.ts
git commit -m "feat: add pagination and response envelope to search_assets MCP tool"
```

---

## Task 3: `get_results` — add `offset` to all four scopes

**Files:**
- Modify: `server/src/domain/results.ts` — `GetResultsParams` (lines 5-10), `tagScope` (12-82), `questionScope` (91-167), `attemptScope` (169-200), `dailyScope` (202-239)
- Modify: `server/src/mcp/tools.ts` — `get_results` tool registration (currently lines 362-381)
- Test: `server/tests/resultsPagination.test.ts` (new file)

**Interfaces:**
- Produces: `GetResultsParams` gains `offset?: number`. Return shape unchanged (`{ tags }` / `{ questions }` / `{ attempts }` / `{ daily }`) — purely additive, no envelope change requested by the spec for this one.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/resultsPagination.test.ts
import { describe, it, expect } from "vitest";
import { getResults } from "../src/domain/results.js";
import { insertTag, insertQuestion, seedScoredResponse, isoAgo, openTestDb } from "./helpers.js";

describe("get_results offset", () => {
  it("tag scope: offset skips past the first page", () => {
    const db = openTestDb();
    for (const slug of ["a", "b", "c"]) {
      insertTag(db, slug);
      const q = insertQuestion(db, { tags: [slug] });
      seedScoredResponse(db, q.id, 0.5, isoAgo(1));
    }
    const page1 = getResults(db, { scope: "tag", limit: 2, offset: 0 }) as { tags: any[] };
    const page2 = getResults(db, { scope: "tag", limit: 2, offset: 2 }) as { tags: any[] };
    expect(page1.tags).toHaveLength(2);
    expect(page2.tags).toHaveLength(1);
    const slugsPage1 = page1.tags.map((t) => t.tag_slug);
    const slugsPage2 = page2.tags.map((t) => t.tag_slug);
    expect(slugsPage1.some((s) => slugsPage2.includes(s))).toBe(false);
  });

  it("question scope: offset skips past the first page", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    seedScoredResponse(db, q1.id, 0.0, isoAgo(1));
    seedScoredResponse(db, q2.id, 0.5, isoAgo(1));
    const page1 = getResults(db, { scope: "question", limit: 1, offset: 0 }) as { questions: any[] };
    const page2 = getResults(db, { scope: "question", limit: 1, offset: 1 }) as { questions: any[] };
    expect(page1.questions[0].lineage_id).not.toBe(page2.questions[0].lineage_id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/resultsPagination.test.ts
```
Expected: FAIL — today `offset` is silently ignored (not in `GetResultsParams`, not read by any scope function), so `page1` and `page2` would return the same rows.

- [ ] **Step 3: Implement — add `offset` to the params type and all four scope functions**

In `server/src/domain/results.ts`, update `GetResultsParams` (lines 5-10):

```typescript
export interface GetResultsParams {
  scope: "tag" | "question" | "attempt" | "daily";
  tag_query?: TagQuery;
  since?: string;
  limit?: number;
  offset?: number;
}
```

In each scope function, add `const offset = params.offset ?? 0;` alongside the existing `const limit = params.limit ?? 50;` line, and change `LIMIT ?` to `LIMIT ? OFFSET ?` in the SQL, adding `offset` to the corresponding `.all(...)` call:

- `tagScope` (line 43 `const limit = ...`; line 62 SQL `ORDER BY tp.mean_score ASC LIMIT ?`; line 64 `.all(...(args as any[]), limit)`):
  ```typescript
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  // ...
  // SQL: ORDER BY tp.mean_score ASC LIMIT ? OFFSET ?
  // .all(...(args as any[]), limit, offset)
  ```
- `questionScope` (line 93; line 108 `ORDER BY mean_score ASC LIMIT ?`): same edit — `LIMIT ? OFFSET ?`, append `offset` to the bound args.
- `attemptScope` (line 176; line 187 `ORDER BY a.submitted_at DESC LIMIT ?`): same edit.
- `dailyScope` (line 203; line 222 `ORDER BY d.draw_date DESC LIMIT ?`): same edit.

Apply this mechanically to each of the four functions — same shape, different SQL/table.

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/resultsPagination.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the MCP tool handler and the HTTP routes**

In `server/src/mcp/tools.ts`, add `offset` to the `get_results` input schema (currently lines 362-381):

```typescript
inputSchema: {
  scope: z.enum(["tag", "question", "attempt", "daily"]),
  tag_query: tagQueryShape,
  since: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
},
```

The handler body (`return ok(getResults(db, params))`) needs no change — `params` already flows through whole.

In `server/src/http/apiRoutes.ts`, the three `/api/results/*` routes (tags/questions/daily — confirmed no `/api/results/attempts` route exists) currently read `limit` from the query string but not `offset`. Find each route (grep `getResults` in `apiRoutes.ts`) and add `offset` alongside the existing `limit` query-param read, e.g.:

```typescript
const offset = req.query.offset ? Number(req.query.offset) : undefined;
// ...and pass offset into the getResults(db, { scope: "tag", tag_query, since, limit, offset }) call
```

Apply the same one-line addition to the `/api/results/questions` and `/api/results/daily` handlers.

- [ ] **Step 6: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/domain/results.ts server/src/mcp/tools.ts server/src/http/apiRoutes.ts server/tests/resultsPagination.test.ts
git commit -m "feat: add offset param to get_results (all four scopes)"
```

---

## Task 4: `list_tags` — add pagination + trim the deterministic-null `retired_at` field

**Files:**
- Modify: `server/src/domain/tags.ts:24-50` (`listTags`), add `countTags`
- Modify: `server/src/mcp/tools.ts` — `list_tags` tool registration (currently lines 107-120), add a new `trimListTagsForMcp` helper
- Test: `server/tests/tagsPagination.test.ts` (new file)

**Interfaces:**
- Produces: `listTags(db, opts?: { prefix?; includeRetired?; limit?; offset? }): TagSummary[]` (unbounded when limit omitted — unchanged default, still backs `/api/tags`)
- Produces: `countTags(db, opts?: { prefix?; includeRetired? }): number`
- Produces (MCP-layer only, in `tools.ts`, not exported from `tags.ts`): `trimListTagsForMcp(tags: TagSummary[]): object[]` — strips `retired_at` from each row when it's `null`, and strips `description` when it's `null` (both are frequently/always null in the non-`include_retired` case; this is a genuinely new function, built from scratch — see Global Constraints on why there's no existing function to copy).

- [ ] **Step 1: Write the failing tests**

```typescript
// server/tests/tagsPagination.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { listTags, countTags } from "../src/domain/tags.js";

describe("listTags pagination", () => {
  it("returns everything, unbounded, when no limit/offset is passed", () => {
    const db = openTestDb();
    for (const slug of ["a", "b", "c"]) insertTag(db, slug);
    expect(listTags(db)).toHaveLength(3);
  });

  it("returns a bounded page when limit/offset are passed", () => {
    const db = openTestDb();
    for (const slug of ["a", "b", "c"]) insertTag(db, slug);
    const page1 = listTags(db, { limit: 2, offset: 0 });
    const page2 = listTags(db, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
  });
});

describe("countTags", () => {
  it("mirrors listTags's WHERE clause (excludes retired by default)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertTag(db, "b");
    db.prepare("UPDATE tag SET retired_at = datetime('now') WHERE slug = 'b'").run();
    expect(countTags(db)).toBe(1);
    expect(countTags(db, { includeRetired: true })).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/tagsPagination.test.ts
```
Expected: FAIL — `countTags` doesn't exist; `listTags(db, { limit, offset })` ignores those options today.

- [ ] **Step 3: Implement**

Replace `server/src/domain/tags.ts:24-50`:

```typescript
export function listTags(
  db: DatabaseSync,
  opts: { prefix?: string; includeRetired?: boolean; limit?: number; offset?: number } = {}
): TagSummary[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeRetired) clauses.push("t.retired_at IS NULL");
  if (opts.prefix) {
    clauses.push("(t.slug = ? OR t.slug LIKE ?)");
    params.push(opts.prefix, `${opts.prefix}:%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  if (opts.limit === undefined) {
    return db
      .prepare(
        `SELECT t.slug, t.label, t.parent_slug, t.description, t.created_at, t.retired_at,
                (SELECT COUNT(*) FROM question_tag qt JOIN question q ON q.id = qt.question_id
                 WHERE qt.tag_slug = t.slug AND q.retired_at IS NULL) AS question_count
         FROM tag t ${where} ORDER BY t.slug`
      )
      .all(...(params as any[])) as unknown as TagSummary[];
  }

  return db
    .prepare(
      `SELECT t.slug, t.label, t.parent_slug, t.description, t.created_at, t.retired_at,
              (SELECT COUNT(*) FROM question_tag qt JOIN question q ON q.id = qt.question_id
               WHERE qt.tag_slug = t.slug AND q.retired_at IS NULL) AS question_count
       FROM tag t ${where} ORDER BY t.slug LIMIT ? OFFSET ?`
    )
    .all(...([...params, opts.limit, opts.offset ?? 0] as any[])) as unknown as TagSummary[];
}

export function countTags(db: DatabaseSync, opts: { prefix?: string; includeRetired?: boolean } = {}): number {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeRetired) clauses.push("t.retired_at IS NULL");
  if (opts.prefix) {
    clauses.push("(t.slug = ? OR t.slug LIKE ?)");
    params.push(opts.prefix, `${opts.prefix}:%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM tag t ${where}`).get(...(params as any[])) as { n: number };
  return row.n;
}
```

**Note:** the exact `question_count` subquery SQL above is reconstructed from the agent report's description ("SELECT COUNT(*) ... AS question_count"), not a verbatim quote — before committing, open `server/src/domain/tags.ts:24-50` and copy the *real* subquery text into this replacement rather than trusting the reconstruction above. Everything else in this task (limit/offset handling, `countTags`) is independent of that subquery's exact contents.

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/tagsPagination.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Build the MCP-layer trim + pagination wiring**

In `server/src/mcp/tools.ts`, add a trim helper near the other MCP-only helpers (`ok`/`fail`, around line 57), and update the `list_tags` registration (currently lines 107-120):

```typescript
function trimListTagsForMcp(tags: ReturnType<typeof listTags>) {
  return tags.map(({ retired_at, description, ...rest }) => ({
    ...rest,
    ...(retired_at != null ? { retired_at } : {}),
    ...(description != null ? { description } : {}),
  }));
}
```

```typescript
server.registerTool(
  "list_tags",
  {
    description: "List tags in the controlled vocabulary. Paginated: pass limit/offset to page past the default 50.",
    inputSchema: {
      prefix: z.string().optional(),
      include_retired: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async ({ prefix, include_retired, limit, offset }) => {
    try {
      const opts = { prefix, includeRetired: include_retired, limit: limit ?? 50, offset: offset ?? 0 };
      const total = countTags(db, { prefix, includeRetired: include_retired });
      const tags = listTags(db, opts);
      return ok({ total, tags: trimListTagsForMcp(tags), has_more: (offset ?? 0) + tags.length < total });
    } catch (err) {
      return fail(err);
    }
  }
);
```

Add `countTags` to the existing `tags.js` import in `tools.ts`:
```typescript
import { listTags, createTag, mergeTags, countTags } from "../domain/tags.js";
```

- [ ] **Step 6: Add a trim-specific test**

Append to `server/tests/tagsPagination.test.ts` — this test exercises the MCP tool end-to-end if there's an existing pattern for invoking MCP tools directly in tests (check `server/tests/mcpUpload.test.ts` for the pattern first, since it's the one existing test that touches the MCP layer). If no such pattern exists, skip this step's exact form and instead write a unit test directly against a locally-defined copy of the trim logic, or move `trimListTagsForMcp` to be exported from `tools.ts` for direct import in the test:

```typescript
import { listTags } from "../src/domain/tags.js";
// If trimListTagsForMcp is exported from tools.ts, import and test it directly:
// import { trimListTagsForMcp } from "../src/mcp/tools.js";

describe("list_tags MCP trim", () => {
  it("omits retired_at and description when both are null", () => {
    const db = openTestDb();
    insertTag(db, "a", null, null);
    const tags = listTags(db);
    // Assert against the raw domain shape here — verify retired_at/description are null,
    // which is the precondition trimListTagsForMcp relies on:
    expect(tags[0].retired_at).toBeNull();
    expect(tags[0].description).toBeNull();
  });
});
```

- [ ] **Step 7: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/domain/tags.ts server/src/mcp/tools.ts server/tests/tagsPagination.test.ts
git commit -m "feat: add pagination to list_tags, trim deterministic-null fields at MCP layer"
```

**Before merging this task**, run a manual check against real tag-authoring data (per the spec's own recommendation): call `list_tags` without `include_retired` on the actual dev database and confirm `description` really is null on most/all rows in practice, the way the spec asks to validate before committing to dropping it. If `description` turns out to carry real content in practice, drop it from the trim (keep only the `retired_at` trim).

---

## Task 5: `has_more` on `search_questions`

**Files:**
- Modify: `server/src/mcp/tools.ts` — `search_questions` tool handler (currently lines 157-181)
- Test: `server/tests/searchQuestionsHasMore.test.ts` (new file) — this is MCP-layer-only logic (a derived boolean), so test it as a unit test of the derivation, not a new domain test.

**Interfaces:**
- Consumes: `searchQuestions(db, params)` return shape, unchanged: `{ total: number; questions: QuestionSummary[] }` (`questions.ts:633`)
- Produces: MCP tool response gains `has_more: boolean`, derived as `offset + questions.length < total`

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/searchQuestionsHasMore.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { searchQuestions } from "../src/domain/questions.js";

describe("search_questions has_more derivation", () => {
  it("computing has_more from total/offset/questions.length is correct at both page boundaries", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) insertQuestion(db, { tags: ["a"] });

    const page1 = searchQuestions(db, { limit: 2, offset: 0 });
    const hasMore1 = (page1 as any).offset !== undefined
      ? undefined // searchQuestions doesn't echo offset today; compute from the call params instead
      : 0 + page1.questions.length < page1.total;
    expect(0 + page1.questions.length < page1.total).toBe(true); // 2 < 3

    const page2 = searchQuestions(db, { limit: 2, offset: 2 });
    expect(2 + page2.questions.length < page2.total).toBe(false); // 3 < 3 is false
  });
});
```

- [ ] **Step 2: Run to verify it currently passes (this is a pure-math sanity check, not a regression test — it should already pass; it exists to pin the formula before wiring it into the handler)**

```bash
cd server && npx vitest run tests/searchQuestionsHasMore.test.ts
```
Expected: PASS (this test doesn't touch the MCP handler, only validates the arithmetic against real `searchQuestions` output — confirms the formula before Step 3 wires it in)

- [ ] **Step 3: Wire `has_more` into the handler**

Replace `server/src/mcp/tools.ts:174-180`:

```typescript
async (params) => {
  try {
    const result = searchQuestions(db, params);
    const offset = params.offset ?? 0;
    return ok({ ...result, has_more: offset + result.questions.length < result.total });
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 4: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/mcp/tools.ts server/tests/searchQuestionsHasMore.test.ts
git commit -m "feat: add has_more to search_questions MCP response"
```

---

## Task 6: `list_templates` — add pagination

**Files:**
- Modify: `server/src/domain/templates.ts` — `listTemplates` (around line 197-204), add `countTemplates`
- Modify: `server/src/mcp/tools.ts` — `list_templates` tool registration (currently lines 272-285)
- Test: `server/tests/templatesPagination.test.ts` (new file)

**Interfaces:**
- Produces: `listTemplates(db, opts?: { includeRetired?; limit?; offset? }): TemplateSummary[]` (unbounded by default, unchanged — still backs `/api/templates`)
- Produces: `countTemplates(db, opts?: { includeRetired? }): number`

- [ ] **Step 1: Write the failing tests**

First, read `server/tests/templates.test.ts` to find the existing helper for creating a template in tests (there is one — this task must reuse it rather than hand-rolling template creation). Then write:

```typescript
// server/tests/templatesPagination.test.ts
import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { createTemplate, listTemplates, countTemplates } from "../src/domain/templates.js";

describe("listTemplates pagination", () => {
  it("returns everything, unbounded, when no limit/offset is passed", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) {
      createTemplate(db, { name: `Template ${i}`, tag_query: { all: ["a"] }, question_count: 5 });
    }
    expect(listTemplates(db)).toHaveLength(3);
  });

  it("returns a bounded page when limit/offset are passed", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) {
      createTemplate(db, { name: `Template ${i}`, tag_query: { all: ["a"] }, question_count: 5 });
    }
    expect(listTemplates(db, { limit: 2, offset: 0 })).toHaveLength(2);
    expect(listTemplates(db, { limit: 2, offset: 2 })).toHaveLength(1);
  });
});

describe("countTemplates", () => {
  it("counts templates matching the same default (non-retired) filter as listTemplates", () => {
    const db = openTestDb();
    insertTag(db, "a");
    createTemplate(db, { name: "T1", tag_query: { all: ["a"] }, question_count: 5 });
    expect(countTemplates(db)).toBe(1);
  });
});
```

**Before running this test**, check `createTemplate`'s actual required-params shape in `server/src/domain/templates.ts` (and cross-check against `server/tests/templates.test.ts` for a working call example) — the call above is a plausible reconstruction, not a verified-exact signature, since the research pass for this task didn't capture `createTemplate`'s full signature. Adjust the test's `createTemplate(...)` call to match reality before proceeding.

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run tests/templatesPagination.test.ts
```
Expected: FAIL — `countTemplates` doesn't exist; `listTemplates` ignores limit/offset today.

- [ ] **Step 3: Implement**

Open `server/src/domain/templates.ts`, find `listTemplates` (around line 197-204). Apply the same pattern as Task 1/4: add optional `limit`/`offset` to its options, append `LIMIT ? OFFSET ?` to its SQL only when `limit` is passed (bound placeholders, not string interpolation), and add a new exported `countTemplates` function mirroring `listTemplates`'s `WHERE` clause with a `SELECT COUNT(*)`. Do **not** touch `toSummary()` or its extra per-row queries — that's flagged as a separate, lower-priority concern (see Global Constraints), not part of this task.

- [ ] **Step 4: Run to verify pass**

```bash
cd server && npx vitest run tests/templatesPagination.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the MCP tool handler**

Replace the `list_templates` registration in `server/src/mcp/tools.ts` (currently lines 272-285) following the exact same shape as Task 1's `list_assets` handler: add `limit`/`offset` to the input schema, call `countTemplates` for `total`, call `listTemplates` for the page, return `{ total, templates, has_more }`. Add `countTemplates` to the existing `templates.js` import.

- [ ] **Step 6: Typecheck, run full suite, commit**

```bash
cd server && npm run typecheck && npm test
git add server/src/domain/templates.ts server/src/mcp/tools.ts server/tests/templatesPagination.test.ts
git commit -m "feat: add pagination to list_templates MCP tool"
```

---

## Not part of this plan: `include` selector (spec item 7)

The spec marks this speculative and recommends building it only if a concrete need shows up after Tasks 1-6 ship (e.g. an AI workflow that needs `lineage_id`/`created_at` back from a *listing* call in bulk, not just via `get_question` for one row). No tasks are defined here. If it becomes necessary later, the shape is: an optional `include: z.array(z.enum([...])).optional()` param on `search_questions` (and possibly `list_tags`), and a modified trim function that skips dropping any field named in `include`.

## Self-review notes (for whoever executes this plan)

- Two implementation details in this plan are marked as **reconstructions, not verbatim reads**, because the research pass that produced this document didn't capture every line: the `question_count` subquery in Task 4 Step 3, and `createTemplate`'s exact signature in Task 6 Step 1. Both are flagged inline with instructions to verify against the real file before trusting the code as-is — do not skip that verification.
- Task ordering follows the spec's suggested rollout order (assets pagination → results offset → tags trim/pagination → has_more → templates), which sequences the lowest-risk, most-requested items first.
