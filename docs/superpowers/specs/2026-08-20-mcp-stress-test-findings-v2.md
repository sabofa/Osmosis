# MCP Content-Authoring Stress Test — Findings v2 (Math, native tool-calling)

Date: 2026-08-20 (session clock reads 2026-08-21 04:xx UTC in tool timestamps —
same wall-clock session, midnight rollover)

Companion to `2026-08-20-mcp-math-stress-test-design.md` and
`2026-08-20-mcp-stress-test-findings.md` (v1). Where v1 drove the Osmosis MCP
surface over `curl` from a subagent with no repo access, this run used the
**real `mcp__osmosis-mathstress__*` native tool-calling surface** directly —
the piece v1 explicitly couldn't test. Run from the main agent (not a
subagent) so it could also read the two human-facing reference docs
(`GRAPH-DSL-REFERENCE.md`, `DOCUMENT-BUILDER-REFERENCE.md`) per the task's
instructions, while continuing to rely on `readme()`/`bootstrap()` alone —
not other repo files — for tag taxonomy, prompt conventions, and batching.

## Content produced

Re-verified via `list_tags`, `search_questions` (broad, no filters), and
`list_templates` after authoring finished.

- **35 tags** under `math` — 8 top-level categories (`algebra`, `geometry`,
  `trigonometry`, `precalculus`, `calculus`, `statistics`, `3d`,
  `word_problems`) and 27 children, e.g. `math:algebra:quadratics`,
  `math:precalculus:polar`, `math:3d:surfaces`.
- **165 questions** (search_questions total, latest versions) spanning every
  category, difficulty 1–5. Explicit territory covered per the task's
  checklist:
  - **3D**: 15 questions under `math:3d:*` — `z = x^2+y^2`-style explicit
    surfaces, a parametric cone and a parametric sphere (two `for` clauses
    each), 3D points/segments/rays, and a 3D helix parametric curve.
  - **Tables**: all three forms — manual `header:`/`row:` (several), an
    auto-generated `table:` with `@formulas: on`, and a spec with two
    independently named tables (`sq.table:` / `cu.table:`) in one
    `graph_spec`.
  - **`animate:`**: one question, a point tracing a circle.
  - **`field:`**: three differential-equation slope-field questions.
  - **`scatter:`**: four regression questions.
  - **`circle:`**: two questions (basic and off-origin).
  - **`polygon:` + markers**: five questions combining `polygon:` with
    `angle:`, `tick:`, and `right-angle:` in various combinations, including
    one spec using all three marker types together.
  - **Document-anchored**: 6 questions (exceeds the 2–3 minimum) against two
    freshly authored `type: "text"` assets — 3 against a Kepler's-laws
    excerpt, 3 against a compound-interest/amortization excerpt — using
    `document_anchor_start/end` (3 of the 6) and `document_marker_offset`
    (the other 3), with every offset computed programmatically against the
    asset's real `extracted_text` rather than estimated.
- **2 templates**: "Precalc & Trig Practice Set" (20 questions, unfrozen,
  47 eligible) and "Calculus Midterm (Frozen)" (15 questions, `frozen: true`,
  resolved and locked immediately, 25 eligible at creation).
- **2 text assets**: a Kepler's-laws excerpt (1850 chars) and a
  compound-interest/amortization excerpt (1755 chars), both `type: "text"`,
  both read back via `read_asset` before anchor-offset computation.

## Were the three targeted fixes actually sufficient? Yes — zero friction on all three.

This is the headline result the task asked me to validate directly.

1. **`tag_conventions` in `readme()`.** Present, and sufficient standalone.
   I created all 35 tags — including a two-level-deep hierarchy
   (`math:algebra:quadratics`, `math:3d:surfaces`, etc.) — directly from the
   `readme()` prose alone, with **zero `invalid_slug_format` rejections**
   across the whole session. v1 burned an entire 22-call failed batch
   discovering this grammar existed at all; this run needed zero discovery,
   because the field states the grammar directly (colon-separated ancestry
   segments, underscore within a segment, lowercase ascii, the
   `math:functions:quadratic` example) rather than requiring it be inferred
   from a validator error. Confirmed fixed.
2. **Same-line `color:`/`name:` clause.** Present in `bootstrap()`'s
   `graph_dsl_reference` (the exact "may end, on the SAME LINE as the
   statement (not a separate line...)" phrasing, with the worked example
   `y = x^2 color: blue name: parabola1`). I used `color:` and/or `name:`
   inline on well over a dozen statements across every batch (`polygon:`,
   `y=`, `vector:`, etc.) and never once put one on its own line or hit a
   `color:`/`name:`-related parse rejection. v1's finding #2 (misreading
   "may end with" as "followed by," because `@key:` directives *do* stand
   alone) does not recur — the explicit "not a separate line" contrast with
   `@key: value` directives closes exactly the ambiguity v1 flagged.
   Confirmed fixed.
3. **Point labels are letters-only.** Present, explicit, and includes the
   failure mode: "(letters only, no digits/underscore — a digit-containing
   lhs is parsed as a named constant instead and fails elsewhere)". I wrote
   dozens of labeled points (`A = (2,3)`, `peak = (0,4,2)`, `midpt = (-1,5)`,
   etc.) and never used a digit- or underscore-containing label, so this
   never round-tripped through a rejection — reading the warning up front
   was enough to avoid the trap entirely, which is the fix working as
   intended (v1 discovered this rule *by hitting the bug*; this run never
   needed to). Confirmed fixed.

I independently re-read the full `GRAPH-DSL-REFERENCE.md`'s "Common
mistakes" section (its own explicit changelog of what cost v1 real failed
round trips) and can confirm all three of its entries now also appear,
compressed, in the live `bootstrap()` tool output — the condensed version
did not drop anything load-bearing from the full reference for these three
items specifically.

## New friction found this run

None of it touches the three targeted fixes; this is genuinely new
territory (3D, tables, document anchoring, richer markers) that v1 barely
exercised.

1. **`if <condition>` on a bare inequality statement silently fails with an
   unhelpful low-level error — this is a real gap, not user error on
   inspection.** I wrote `y > 0 if 0 <= x <= 3`, intending to shade the area
   under a curve on a bounded interval, modeled on the `y = <expr> if
   <condition>` piecewise form shown for explicit functions. It was
   rejected: `graph_spec failed to parse: Unexpected character "<" at
   position 7`. On rereading `GRAPH-DSL-REFERENCE.md`'s "Shaded inequality
   region" entry, the `if` clause is indeed absent from that statement
   form's grammar line (`<expr(x,y)> <|<=|>|>= <expr(x,y)>`, no trailing
   `[if <condition>]`) — so the reference *is* technically correct and I
   misapplied a pattern from one statement form to another. But: (a) nothing
   in either the full reference or the condensed `bootstrap()` version
   explicitly says "`if` is NOT supported on inequality statements," it's
   only inferable from the grammar line's *absence* of the clause, which is
   an easy thing to skim past when two adjacent statement forms
   (`y = ... if ...` and `<expr> <op> <expr>`) look superficially similar;
   and (b) the error message itself is unhelpful for diagnosing this
   specific mistake — `Unexpected character "<" at position 7` describes a
   tokenizer-level symptom (it choked on the second `<` in `0 <= x <= 3`
   once `if` sent parsing down the wrong branch) rather than anything that
   would lead an author back to "if-clauses aren't valid here." Fixed by
   dropping the `if` clause and using `y = x^2 if 0 <= x <= 3` instead
   (piecewise-restricting the function itself, which does support `if`).
   One rejected question, fixed in a 1-item follow-up batch.
2. **`possible_duplicates` noise persists, same character as v1's finding
   #4.** Flagged two pairs across ~165 questions: "limit of (x^2-4)/(x-2) as
   x→2" vs. "limit of (3x^2+2x)/(x^2-5) as x→∞" (0.643 similarity, genuinely
   different limit techniques) and "median of 2,9,4,7,5" vs. an unrelated
   median-adjacent data-analysis question (0.563). Neither was a real
   duplicate; the mechanism worked as documented (report, not rejection),
   but this run's much smaller flag rate (2 pairs across 165 questions vs.
   v1's several across 184) suggests the threshold may already be tuned
   reasonably for *topically diverse* batches and mainly gets noisy when a
   single batch clusters many questions on one narrow subtopic (as some of
   v1's batches did) — worth checking whether flag rate correlates with
   intra-batch topical density before tuning the threshold globally.
3. **The MC "exactly 4 choices" convention from `readme()`'s
   `prompt_conventions` is not enforced by `create_questions`.** I
   accidentally wrote one multiple-choice question with 5 choices (a
   compound-interest doubling-time question) instead of 4; it was accepted
   without complaint. This is a documented *authoring convention*, not a
   schema constraint (the `choices` field has no length bound in the tool
   schema), so this may be intentional flexibility rather than a bug — but
   it means the convention is soft-enforced at best, and a validator hint
   (even just a non-blocking warning) would catch an author's slip the way
   the graph-spec parser catches DSL slips.

## Was tool selection from the native tool list ever ambiguous?

No — and this is itself a data point about native tool-calling ergonomics
specifically, since v1 couldn't test it (curl calls don't have a tool-list
disambiguation step at all). The 21-tool surface maps close to 1:1 onto
authoring actions with no overlap I had to reason about:

- `create_tag` vs. nothing else creates tags; `list_tags` vs. nothing else
  lists them.
- `create_asset` / `read_asset` / `search_assets` / `list_assets` (the last
  two not used this session, no anchored-content search was needed) are
  cleanly separated by verb, matching the `DOCUMENT-BUILDER-REFERENCE.md`
  trio description almost exactly.
- `create_questions` (plural, batched) vs. `edit_question` /
  `retire_question` (not used this session — no edits or retirements were
  needed) is unambiguous from the tool descriptions alone; I never had to
  open a schema to decide which one to call.
- The one moment of actual friction was environmental, not naming: all 21
  tools started in this session's *deferred* state (schemas not loaded),
  requiring one upfront `ToolSearch` call before any could be invoked. This
  is a harness-level mechanic (deferred-tool loading), not an MCP surface
  design issue, and a single batched `select:` query resolved it in one
  round trip.

`create_tag`'s description ("One at a time by design") reads like it might
require strictly sequential, one-per-message calls, but issuing 8 and then
25 `create_tag` calls in two single-message parallel batches (respecting
parent-before-child ordering across batches, not within) worked without
issue — the harness/server serialized them correctly under the hood. Worth
a documentation nod that "one at a time" describes the request shape (one
tag per call), not a constraint on how many calls can be in flight/queued
at once.

## Document builder and richer graph statements — anything confusing even after reading both reference docs?

Genuinely, no significant confusion, and this is worth stating plainly
since it's the direct thing this run was asked to check. Specifics:

- **Document anchoring**: `DOCUMENT-BUILDER-REFERENCE.md`'s guidance to
  "call `read_asset` before computing anchor offsets... don't guess offsets
  from a search snippet, compute them against the real text" was followed
  literally — I pulled both assets' `extracted_text` via `read_asset` and
  computed all 6 anchors/markers with a small script against the exact
  returned strings (not hand-counted), and all 6 validated on the first
  `create_questions` call with zero `invalid_document_anchor` or
  `invalid_document_marker` rejections. The distinction between
  `document_anchor_start/end` (range highlight) and `document_marker_offset`
  (single clickable token) was clear from the reference and I used both
  mechanisms deliberately across the 6 questions with no confusion about
  which one to reach for in which case (range for "this whole sentence
  supports the question," marker for "this inline citation point is what
  the question is about").
- **3D and parametric-surface statements**: the "needs exactly two `for`
  clauses" note for parametric surfaces was sufficient — both my cone
  (`(u*cos(v), u*sin(v), u) for u in [0,3], v in [0,6.283]`) and sphere
  parametrization validated on the first try. The "any point/segment/ray
  form becomes 3D automatically when given a `z` component" note was also
  sufficient — I never had to guess whether a 3-tuple needed a different
  statement keyword.
- **Tables**: the `<name>.` prefix mechanic for multiple named tables in one
  spec (`sq.table:` / `cu.table:`) worked exactly as documented on the
  first attempt, including a question that explicitly tests understanding
  of that mechanic itself.

The one place I'd call a *near-miss* rather than confusion: the inequality
`if`-clause issue (New friction #1, above) is adjacent to this territory —
it's a graph_spec issue, not a document-builder one, and it surfaced
despite having read both references, so I'm not counting it as "the docs
were unclear" so much as "the docs' grammar-by-omission convention (a
missing `[if ...]` in one statement form's grammar line implies it's
unsupported there) is a convention I didn't fully internalize on a single
read, and the parser's error message didn't help me get there faster."

## Suggested improvements

1. **Give the inequality-region statement form an explicit negative example
   or note** in both `GRAPH-DSL-REFERENCE.md` and `bootstrap()`'s condensed
   reference — one line like "`if` is only valid on `y=`/`x=` forms, not on
   inequality regions; to shade over a bounded interval, restrict the
   function itself: `y = x^2 if 0 <= x <= 3`" would have prevented this
   run's only rejected question.
2. **Make the graph_spec parser's error messages diagnose *why*, not just
   *where*, when the failure stems from applying one statement form's
   syntax to another.** `Unexpected character "<" at position 7` is
   accurate but not actionable; something like `Unexpected "if" clause on
   an inequality-region statement (only y=/x= forms support "if")` would
   turn a guess-and-reread cycle into an immediate fix, matching how
   `invalid_slug_format`'s error message (fixed since v1) already includes
   a worked example inline.
3. **Consider enforcing (or at least flagging) the 4-choice MC convention**
   from `readme()`'s `prompt_conventions` at write time, even as a
   non-blocking note in the response — right now it's purely aspirational
   prose with no signal back to the author when violated.
4. **`possible_duplicates` threshold**: no urgent action given this run's
   low flag rate, but if v1's higher rate recurs in future large single-topic
   batches, consider surfacing the matched n-gram/phrase alongside the
   similarity score so an author can eyeball true-vs-false-positive faster
   than re-reading both full prompts.

## Summary verdict

The three fixes patched into `readme()` and `bootstrap()`'s
`graph_dsl_reference` all worked exactly as intended — each of v1's three
concrete, cited friction points (tag-slug grammar, same-line color/name,
letters-only point labels) was fully preventable this run purely from
tool-output prose, with no repo-file consultation needed for any of them
and zero related rejections across 165 questions. Native tool-calling
ergonomics were clean: no ambiguity in tool selection, no schema confusion,
parallel `create_tag` batching worked despite the "one at a time" wording,
and the deferred-tool-loading step was the only environment-level friction,
resolved in one call. The two purpose-built reference docs
(`GRAPH-DSL-REFERENCE.md`, `DOCUMENT-BUILDER-REFERENCE.md`) were sufficient
for genuinely new territory this run deliberately pushed into — 3D surfaces
and curves, all three table forms, `animate:`/`field:`/`scatter:`/`circle:`,
`polygon:` with full marker support, and document anchoring by both range
and marker — with only one real gap surfaced (the inequality-statement
`if`-clause omission) and it is narrow, well-scoped, and cheap to fix with
the same "prose addition, no schema change" character as all three of the
fixes this run was validating.
