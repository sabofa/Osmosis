# mcp-batch stress test findings — math authoring session (2026-08-21)

Authored a full math question bank via `scripts/mcp-batch/cli.mjs` end to end:
`readme` → `bootstrap("math")` → tag taxonomy → questions → templates → tally.
All calls went through the batch script from Bash; no native MCP tool calls
were used for content authoring.

## Content summary (from this session's own `list_tags` / `search_questions` / `list_templates` call)

- **Tags: 40** — 1 root (`math`) + 7 subject tags (all with `question_count: 0`,
  as expected since questions were tagged only at leaf level) + 32 leaf tags.
- **Questions: 167**, confirmed by `search_questions`'s `"total":167` and by the
  sum of every leaf tag's `question_count` in `list_tags` (independently
  cross-checked, both agree). 0 rejections across all 10 `create_questions`
  batches. Breakdown by subject (leaf-tag counts summed):
  - Arithmetic: 20 (fractions, decimals, ratios/proportions, percentages — 5 each)
  - Algebra: 39 (linear equations 6, inequalities 6, quadratics 5, polynomials 5,
    exponents/radicals 6, systems 6, functions 5)
  - Geometry: 30 (triangles, circles, area/perimeter, volume/surface area,
    coordinate geometry, transformations — 5 each)
  - Trigonometry: 20 (right triangle, unit circle, identities, graphs — 5 each)
  - Precalculus: 20 (function composition, sequences/series, conic sections,
    exponential/logarithmic — 5 each)
  - Calculus: 23 (limits 6, derivatives 6, integrals 6, applications 5)
  - Statistics: 15 (descriptive, probability, distributions — 5 each)
  - Mix: roughly 60% MC / 40% written; difficulty spans 1–5, weighted toward
    2–4 (standard practice through solid synthesis), with a handful of 1s
    (recall) and 5s (multi-step calculus optimization).
  - 3 batches produced a `possible_duplicates` report (1 item each, similarity
    0.56–0.67) — in every case the flagged pair were genuinely distinct
    questions on the same sub-topic with similar surface phrasing ("Solve for
    x: ..." twice in one batch, two different right-triangle setups, two
    different definite-integral setups). None were retired — the report is
    correctly a report, not a rejection, and none were true duplicates.
- **Templates: 2** — "Algebra Foundations Practice Set" (15 questions,
  weak-weighted draw across 7 algebra tags, eligible_count 39) and "Calculus I
  Diagnostic Quiz" (12 questions, frozen, 40-minute time limit, eligible_count
  23).

## Friction notes on the tool itself

1. **The calls-file shape is easy to get wrong on the first try.** I drafted
   each question batch as a bare `{"questions": [...]}` object (mirroring the
   *argument* shape documented for `create_questions`) and only discovered the
   file needs to be the outer `[{"name": ..., "arguments": {...}}]` array when
   the CLI rejected it with `calls file must be a JSON array of {name,
   arguments} objects`. The error message itself is clear and immediately
   actionable — this cost one extra round-trip, not real confusion — but a
   one-line example in the `--help` output (or a `cli.mjs --example` flag)
   would avoid it. Minor: worth a one-line callout in MCP-SPEC.md §3a's usage
   block distinguishing "the array you write" from "the arguments a single
   tool call takes," since the existing example already shows the correct
   outer array — I just didn't map it back to a multi-question payload
   correctly on first attempt.
2. **`create_tag`'s `parent_slug` field went unused, harmlessly.** Every tag
   in `list_tags`'s output came back with `parent_slug: null`, including the
   32 leaf tags I created as e.g. `math:algebra:quadratics` — I never passed
   `parent_slug` because `readme`'s `tag_conventions` describes hierarchy
   purely as a slug-grammar convention ("child's slug is its parent's slug
   plus one more segment") and doesn't mention the field is meant to be set
   explicitly too. Nothing broke — search/tag_query presumably works off the
   slug prefix — but if any UI or tool actually reads `parent_slug` to build a
   tree, this taxonomy will show as 40 flat root-adjacent tags instead of a
   nested tree. Worth clarifying in the tag_conventions text whether
   `parent_slug` is required, optional-but-recommended, or purely
   redundant/derived.
3. **Everything else was smooth.** The `--raw` flag worked as documented for
   getting the full JSON tally at the end; the compact per-tool summary format
   was exactly the right level of detail for the 13 `create_questions` /
   `create_tag` batches in between (created/rejected/warnings/duplicate
   counts, no need to see each question echoed back). No timeouts, no
   ambiguous partial-commit situations — every batch's `created` count matched
   what I sent. Batching at ~15-22 questions per call (under the ~25-30
   guidance) was comfortable; no call felt close to the timeout.

## Process note

Read `MCP-SPEC.md` (root of repo, not the superpowers specs dir) directly via
`Bash`/`cat` rather than through the batch script, since it's a plain repo
file — only the actual MCP tool calls went through `mcp-batch`. Also read
`server/src/mcp/tools.ts` directly to get the exact Zod schemas for
`create_questions` and `create_template` (field names, which are required vs.
optional, the mc-choices-need-4 / written-needs-model_answer validation
rules) rather than guessing from `readme`'s prose — `readme`'s
`prompt_conventions`/`tag_conventions` don't include the literal schema, so a
quick source read was faster and more reliable than trial-and-error against
the live endpoint for that part.
