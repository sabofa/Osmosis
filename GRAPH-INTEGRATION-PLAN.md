# Graph / Document / Desmos integration — research report

Status: **research only, nothing implemented**. Written for a future agent to execute against. Everything below reflects the actual state of the repo as of this writing — verified by reading the files directly, not assumed.

## Scope note

The user asked for three things to eventually land in Osmosis:
1. Rendering the existing `graph-engine` package for math questions that need a graph.
2. A document viewer (no existing code or decisions for this — see "Open questions").
3. Desmos integration (no existing code or decisions for this either — see "Open questions").

This report focuses on **#1 (graph-engine) in depth**, since that's the piece that already exists and has real integration surface to analyze. Document viewer and Desmos are flagged with the open questions they'll need answered before anyone can plan them concretely — there's nothing in the repo to research for those yet.

## What already exists

**`graph-engine/`** is a separate, fully-built package at the repo root — a text-spec-driven 2D/3D graphing engine (React + Three.js). It is already declared as an npm workspace alongside `server` and `web` (root `package.json`):
```json
"workspaces": ["server", "web", "graph-engine"]
```
...but `web/package.json` does not yet depend on it, and `graph-engine/package.json` has no `main`/`types`/`exports` field — so it isn't actually consumable from `web` yet despite the workspace wiring being half-done. This is the first concrete gap (see Phase 1 below).

**Public API** (`graph-engine/src/index.ts`) — the package's own entry point comment literally says it's for this:
```ts
// Package entry point for future consumers (e.g. QuestionDetail.tsx importing
// GraphViewer directly once the question schema grows a `graph` field).
export { default as GraphViewer } from './GraphViewer'
export type { GraphViewerProps } from './GraphViewer'
export { default as TableView } from './TableView'
export type { TableViewProps } from './TableView'
export { parseSpec } from './parser/parseSpec'
export type { Statement, Condition, ParseError, ParseResult } from './parser/types'
export { defaultConfig } from './parser/config'
export type { GraphConfig, GraphBounds, HoverMode, FeaturePointKind } from './parser/config'
export { buildScene } from './scene/buildScene'
...
```

**`GraphViewer`** (`graph-engine/src/GraphViewer.tsx`) is the thing to actually render. It's about as simple to embed as it gets:
```ts
export interface GraphViewerProps {
  spec: string
  onErrors?: (errors: ParseError[]) => void
}
```
Feed it a spec string, it parses, builds a scene, and renders a canvas (auto-switches 2D pan/zoom, 3D orbit, or a plain HTML table, based on what the spec contains — see `scene/mode.ts`'s `isThreeD` and `@mode: table`). It self-debounces rebuilds (80ms) so it's safe to pass a spec that's actively being typed/streamed. No dependency on anything outside the package.

**The spec DSL** (documented as the source of truth in `graph-engine/src/parser/types.ts`, ~140 lines of grammar comments) is a plain-text line-based format covering: explicit/implicit functions, polar curves, 3D surfaces, regions/inequalities, slope fields, scatter+regression, points/segments/rays/vectors, parametric curves and surfaces, tangent lines, animated points, named functions/constants, tables, and geometry annotations (`circle:`, `polygon:`, `angle:`, `tick:`, `right-angle:`) — clearly built with math-education question authoring in mind, not just generic plotting. Per-spec presentation directives (`@theme`, `@bounds`, `@hide`/`@show`, `@mode: table`, etc.) live inline in the spec text itself (`parser/config.ts`), so a question's graph is fully self-contained in one string — no separate config object needs to travel alongside it.

**Theming already matches Osmosis's visual language on purpose.** `GraphViewer.css`'s own top comment: *"Colors/treatment below match the 'Ink-Framed Ruled Grid' reference... so a plotted graph feels like it belongs to the same family as the rest of the app."* It only supports binary `theme: 'light' | 'dark'` — Osmosis has since grown named theme presets on top of light/dark (`useThemePresets`), so the integration needs to map Osmosis's *resolved* mode (light/dark) to GraphViewer's `@theme`, not the preset name.

## What's missing on the Osmosis side (confirmed by direct search — zero hits)

Grepped `web/src`, `server/src`, and all migrations for "graph" (case-insensitive): **no references anywhere.** This is a fully greenfield integration — matches what you said (nothing built yet except the schema entry you're planning).

Concretely, nothing exists for:
- A `graph` field anywhere in the schema, domain types, or MCP tool input.
- Any import of `graph-engine` from `web`.
- Any rendering surface that shows anything beyond plain-text `prompt`/`explanation`.

## The five rendering surfaces that show a question's prompt today

All currently render `{question.prompt}` (or `{q.prompt}`) as plain text, nothing else:

| File | Where |
|---|---|
| `web/src/components/Take.tsx:121` | mid-quiz, answering |
| `web/src/components/Review.tsx:74` | post-quiz review |
| `web/src/components/QuestionDetail.tsx:33` | Bank's question detail modal |
| `web/src/components/Bank.tsx:120` | Bank's question list row (just a text preview) |
| `web/src/components/Library.tsx:351` | Library's per-template question-preview list |
| `web/src/components/TagDetail.tsx:103` | Tag detail's "used by" question list |

**Important caveat:** `Take.tsx` and `Review.tsx` currently run entirely on **mock data** (`mockQuestions` from `web/src/data/templates.ts`), not the real `/api/questions` backend — there's no real attempt-taking flow wired up yet (that's separate, unbuilt scope, not part of this graph work). Whoever implements this should decide whether to:
  (a) add a `graph` field to the mock shape too so Take/Review can be exercised during development, or
  (b) skip graph rendering in Take/Review until the real attempt flow exists, and only wire it into the three real-data surfaces (QuestionDetail, Bank row, Library preview, TagDetail).
  (a) is probably worth the 10 minutes of mock-data work so the *most important* surface (actually taking a graph question) isn't left unverifiable.

## Proposed plan

### Phase 0 — make `graph-engine` actually importable
1. Add `"main"`, `"types"`, and/or `"exports"` fields to `graph-engine/package.json` pointing at `src/index.ts` (Vite/TS can resolve workspace-linked TS source directly in dev; decide whether prod build (`web`'s `vite build`) needs `graph-engine` pre-built via `tsc -b && vite build` or if bundling straight from source is acceptable — probably fine either way since it's a private monorepo workspace, not a published package, but worth deciding explicitly rather than discovering it at build time).
2. Add `graph-engine` as a `dependency` in `web/package.json` (workspace protocol, e.g. `"graph-engine": "*"` or `"workspace:*"` depending on the package manager in use — check whether this repo uses npm/pnpm/yarn workspaces specifically, since the protocol syntax differs).
3. Confirm `three` (graph-engine's only real dependency, and a large one) doesn't blow up `web`'s bundle size unacceptably — consider whether GraphViewer should be lazy-loaded (`React.lazy`) per-surface so pages that never show a graph question don't pay for the Three.js bundle.

### Phase 1 — schema + domain
1. New migration: add a nullable `graph_spec TEXT` column to `question` (nullable — most questions won't have one). Naming note: call it `graph_spec` not just `graph`, to make it unambiguous that it's the DSL text, not a rendered artifact or a foreign key.
2. Extend `QuestionRow`, `QuestionInput`, `QuestionDetail`, `QuestionSummary` (`server/src/domain/questions.ts`) — decide whether `graph_spec` belongs on `QuestionSummary` (list views) or only `QuestionDetail` (full view). Given list-view previews (Bank row, Library question preview) would presumably want at least a "has a graph" indicator/thumbnail rather than mounting a full WebGL canvas per row, **recommend**: keep `graph_spec` off `QuestionSummary`, add a cheap `has_graph: boolean` there instead, and only send the full spec string on `QuestionDetail` fetches.
3. Update `validateQuestionInput`/`createQuestions`/`editQuestion` to accept/persist `graph_spec`. Since `GraphViewer` already gives you `ParseResult.errors` as structured `{line, message}[]`, consider validating the spec server-side too (import `parseSpec` from `graph-engine` in `server`, which is possible since it's a plain workspace package with no browser-only dependencies as far as the parser goes — check whether `parser/parseSpec.ts` pulls in anything DOM-specific before assuming this).
4. Update the MCP tool schema (`server/src/mcp/tools.ts`'s `questionInputShape`, the `create_questions`/`edit_question` tools) — this is the actual write path per the app's architecture (Claude writes bank content via MCP), so this is not optional plumbing, it's the primary way graph questions will ever get created.

### Phase 2 — API + frontend plumbing
1. `web/src/lib/api.ts` — extend `QuestionSummary`/`QuestionDetail` client types to match the server changes.
2. Add `GraphViewer` to `QuestionDetail.tsx` (Bank modal) first — it's the simplest, already-real-data surface, and the best place to verify the integration end-to-end before touching the others.
3. Then Library's question preview and TagDetail's question list — decide on the `has_graph` badge treatment for those (a small icon in the row, not a full graph render, per the Phase 1 recommendation above).
4. Then Take.tsx/Review.tsx, contingent on the mock-vs-real-data decision above.
5. Theme wiring: pass `@theme: {light|dark}` (as a line prepended to the spec, or — cleaner — check whether `GraphViewer` should grow a `theme` override prop instead of requiring it baked into the spec text, since Osmosis's resolved theme is app-wide state (`useTheme().resolvedMode`) that can change at runtime independent of the question content). **This is worth raising with whoever owns `graph-engine` before assuming spec-text is the only way in** — baking `@theme` into stored spec text means every stored question's graph is pinned to whatever theme was active when it was authored, which is probably not what's wanted if Osmosis has runtime theme switching (it does — light/dark/system + named presets).

### Phase 3 — document viewer + Desmos (unscoped — needs decisions, see below)

## Open questions worth resolving before implementation starts

- **Document viewer**: no existing code, no stated purpose. What documents, stored where, whose questions reference them? Is this "attach a PDF/image reference to a question" (parallel to `graph_spec`) or something else entirely (e.g. a study-notes viewer unrelated to individual questions)? Needs scoping before any file-level plan is possible.
- **Desmos integration**: Desmos has both a free embeddable calculator API (`Desmos.GraphingCalculator`, requires an API key from Desmos) and no self-hosted option — this is an external, network-dependent, key-gated service, categorically different from the fully local/offline `graph-engine`. Worth confirming explicitly whether Desmos is meant to *replace* graph-engine for some question types, *supplement* it (e.g. an "open in Desmos" export button, converting a `graph_spec` into a Desmos state), or serve an unrelated purpose (e.g. a scratch-work calculator available during Take, not tied to question content at all). These have very different implementations.
- **Storage vs. rendering**: confirmed `graph_spec` (text) is the right thing to store, not a rendered image — GraphViewer renders live from spec text and is fast/debounced enough for that. Just flagging this was actually verified, not assumed, since it matters for the schema decision in Phase 1.
- **MC questions with a graph**: schema's `CHECK (type = 'mc' OR model_answer IS NOT NULL)` shows the table already has type-conditional constraints; a graph should presumably attach to either `mc` or `written` questions equally, but worth confirming there's no reason (rubric grading, etc.) a graph should be restricted to one type.

## File reference index (for whoever implements this)

**graph-engine (read, don't modify unless the package.json export fix in Phase 0):**
- `graph-engine/src/index.ts` — public API surface
- `graph-engine/src/GraphViewer.tsx` — the component to embed
- `graph-engine/src/GraphViewer.css` — self-contained styling, already Osmosis-themed
- `graph-engine/src/parser/types.ts` — DSL grammar reference (the comment block IS the spec)
- `graph-engine/src/parser/config.ts` — `@directive` options incl. `theme`
- `graph-engine/package.json` — needs `main`/`types`/`exports` added

**Osmosis schema/domain:**
- `server/migrations/001_init.sql` — `question` table (line ~60), needs new migration file for `graph_spec`
- `server/src/domain/questions.ts` — `QuestionRow`/`QuestionInput`/`QuestionSummary`/`QuestionDetail`, `validateQuestionInput`, `createQuestions`, `editQuestion` (~line 528 `getQuestionDetail`)
- `server/src/mcp/tools.ts` — `questionInputShape` (~line 22), `create_questions`/`edit_question` tool registrations

**Osmosis frontend:**
- `web/package.json` — add `graph-engine` dependency
- `web/src/lib/api.ts` — `QuestionSummary`/`QuestionDetail` client types
- `web/src/components/QuestionDetail.tsx:33` — best first integration target
- `web/src/components/Bank.tsx:120` — question row preview
- `web/src/components/Library.tsx:351` — template question-preview list
- `web/src/components/TagDetail.tsx:103` — tag's "used by" question list
- `web/src/components/Take.tsx:121` — mid-quiz (currently mock-data only)
- `web/src/components/Review.tsx:74` — post-quiz (currently mock-data only)
- `web/src/data/templates.ts` — mock question shape, if Take/Review need graph support before real attempt-taking exists
- `web/src/hooks/useTheme.ts` — `resolvedMode`, for the theme-wiring decision in Phase 2
