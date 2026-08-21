# MCP Content-Authoring Stress Test — Findings (Math)

Date: 2026-08-20

Companion to `2026-08-20-mcp-math-stress-test-design.md`. One cold-start
subagent session authoring math content through the full MCP tool
surface. The original design called for the subagent to hold the 21
`mcp__osmosis-mathstress__*` tools natively; that wasn't achievable in
this run (see "Execution notes" below) — the subagent instead drove the
same `/mcp/:token` JSON-RPC endpoint via `curl`, with an explicit
instruction not to read repository source, and reported its own findings
without ever seeing `server/src/mcp/tools.ts` or `MCP-SPEC.md`.

## Content produced

Independently re-verified by the controller via direct `list_tags` /
`search_questions` / `list_templates` calls against the running endpoint
after the subagent finished — **exact match, zero discrepancy** against
the subagent's self-reported counts below.

- **28 tags** — 5 top-level subjects (`algebra`, `geometry`,
  `trigonometry`, `calculus`, `statistics_probability`), 23 children.
- **184 questions** — 97 multiple-choice, 87 written. Difficulty spread:
  1→37, 2→57, 3→56, 4→32, 5→2 (skews toward "standard practice," thin
  tail at exam-level synthesis).
- **2 templates** — "Algebra Fundamentals Practice Set" (20 questions,
  unfrozen) and "Precalculus Diagnostic (Trig + Geometry)" (15 questions,
  frozen pre/post-test).

## Friction report (subagent's own account, verbatim)

Session date: 2026-08-20. Cold-start session against the Osmosis MCP endpoint, math subject, no repository access — everything below was derived purely from `tools/list`, `readme`, `bootstrap`, and live tool call responses.

Concrete, in the order encountered.

1. **Tag slug format is undocumented until you hit it.** `readme`'s and `bootstrap`'s prose never state a slug grammar. My first `create_tag` batch used slugs like `algebra-linear-equations` and `statistics-probability` (hyphens, flat namespace) — every single-word root slug (`algebra`, `geometry`, `trigonometry`, `calculus`) succeeded, but every hyphenated or multi-segment slug failed with `invalid_slug_format`: `Tag slug "algebra-linear-equations" is invalid. Expected lowercase ascii segments separated by ":" with "_" separating words within a segment (e.g. "math:functions:quadratic").` I only discovered the real grammar (colon-delimited hierarchy segments, underscore for multi-word segments, and — implicitly — that the slug's segment path is expected to encode the tag's ancestry) by reading this one rejection message and inferring the pattern, then confirming it worked. This cost a full failed batch of 22 `create_tag` calls (all rejected) before I could proceed. The example in the error message (`math:functions:quadratic`) is good, but it should be in `bootstrap`'s tag-taxonomy guidance up front, not something you find only by tripping the validator with a whole batch of already-issued calls. Also worth flagging: `bootstrap` returned `"tags":[]` for an empty subject, meaning a cold-start session gets zero taxonomy convention hints from bootstrap itself for tag slugs — the only source of truth for the naming rule is the validator's error text.

2. **`graph_spec` DSL: color directive must be inline, not its own statement.** My first attempt at a shaded/highlighted segment used a directive on its own line after the segment (`(-2,0) -- (8,0)\ncolor: blue`), following the pattern shown for other config directives like `@bounds`. It failed: `graph_spec failed to parse: Unrecognized statement: "color: blue"; Expected ")"; Expected ")"`. The DSL reference text says "Any statement may end with `color: <name-or-#hex>`" which in hindsight does say "end with," but it reads easily as "a following directive line" given the `@key: value`-per-line pattern used everywhere else in the same reference block. I fixed it by moving `color: blue` onto the same line as the segment statement, which then parsed. Two rejections were folded into a single batch failure (`possible_duplicates`/`rejected` correctly isolated these two from the other 24 valid siblings in that batch, which did commit — that per-question isolation worked exactly as documented and was genuinely useful).

3. **`graph_spec` point/name labels can't be bare numerals.** A point statement `2 = (2, 3)` (intending to label the point "2") failed with a bare `Expected ")"` — no hint that the left-hand label needs to be a valid identifier, not a digit. I had to guess this from the failure and rename the label to `soln = (2, 3)`, which then parsed. The DSL reference's grammar line `label = (x, y[, z]) | (x, y[, z])` doesn't state that `label` must be an identifier (not numeric) or list any naming constraints at all — this would be a one-line addition that saves a guess-and-check cycle.

4. **Duplicate-detection similarity scores feel noisy/high for legitimately distinct questions.** `create_questions`'s `possible_duplicates` report repeatedly flagged pairs that are topically related but substantively different questions (e.g. "Simplify: 2^3 * 2^4" vs "What is 4^(-2)?" at similarity 0.6; "arc length of a 90° sector" vs "sector area at 120°" at 0.571; two different cylinder-volume problems with different radii/heights at 0.667). None of these were true duplicates and none warranted retiring per the documented workflow ("retire whichever side loses"). The mechanism itself worked as documented (report, not rejection) and I did review each one, but the signal-to-noise ratio on a same-topic question bank is low enough that a real author would likely start ignoring the report over time — which defeats its purpose. A similarity threshold tunable per-call, or a report that also surfaces *why* (which n-grams/structure matched), would make the report more actionable.

5. **`readme`'s and `bootstrap`'s top-level `node` field (`protocol_version`, `bank_size`, `last_write_at`) is returned by both calls with no stated purpose.** It's redundant across the two calls (both are called once per session per the documented workflow) and its meaning is never explained in the prose — I inferred it was informational fleet/session state, not something I needed to act on, but a first-time caller has to guess that it's safe to ignore.

6. **Minor: `create_tag` is explicitly "one at a time by design," which is reasonable for a controlled vocabulary, but there's no batch dry-run/validate-only mode.** Given finding #1, a `validate: true` flag (or just documenting the slug grammar) would have saved an entire round trip of 22 wasted calls.

7. **Positive note, not friction:** `create_questions` batching worked exactly as documented at the guided ~25-item size — batches of 20–26 questions all returned promptly with clear per-index rejection/duplicate reporting, and fixing two rejected items via a small follow-up batch (referencing their original array index) was straightforward. `bootstrap`'s DSL reference was otherwise sufficient to author polar curves, parametric curves, vectors, value tables, tangent lines, and shaded regions correctly on the first try once the two quirks above (#2, #3) were learned.

### Suggested improvements (subagent's own)

1. **Document the tag slug grammar directly in `bootstrap`'s (or `readme`'s) tag-taxonomy guidance**, not just implicitly via `create_tag`'s validator error. State explicitly: lowercase ASCII segments, colon-separated for hierarchy (segment path should mirror `parent_slug` ancestry), underscore-separated words within a segment, no hyphens. Include the same `math:functions:quadratic`-style example that already exists in the error message.
2. **Clarify the `graph_spec` color/name directive syntax** with an explicit example line showing `color:`/`name:` attached to the *same line* as the statement they modify, e.g. `y = x^2 color: blue name: parabola1` — right now the DSL reference's phrasing ("may end with") is easy to misread as "followed by," especially since `@key: value` config directives *are* meant to stand alone on their own line.
3. **State the naming rules for point/segment/statement labels** in the DSL reference (must be a valid identifier, not a bare number) — one clause would have avoided a guess-and-check round trip.
4. **Tune or explain the `possible_duplicates` similarity signal.** Either raise the default threshold, or return a short reason/matched-phrase snippet alongside the similarity score so an author can tell at a glance whether it's a near-verbatim repeat versus two different questions on the same subtopic.
5. **Explain (or drop) the `node` block** returned by `readme`/`bootstrap` — a one-line description of what `bank_size`/`last_write_at`/`protocol_version` are for (health check? version negotiation?) would remove the need to guess it's safe to ignore.
6. **Consider a `create_tag` validate-only or bulk-preview mode**, or at minimum let the tool accept an array (even if it still applies them one at a time server-side) so a whole taxonomy's slugs can be validated before the first real write — this session lost a full batch (22 calls) to the same discoverable error.

## Notes for MCP-SPEC.md §8 (controller's editorial read)

Findings 1-3 are the load-bearing ones — all three are documentation gaps
in `bootstrap`'s prose/DSL reference, not tool bugs, and all three cost a
concrete, measurable round trip (a 22-call failed batch for #1; one
rejected pair for #2; one rejected question for #3). These read as
genuine, cheap-to-fix follow-ups: the tag-slug grammar and the two DSL
clarifications are prose additions to existing tool descriptions, no
schema or behavior change required. Finding 4 (duplicate-detection noise)
is a real usability observation but is a judgment call on tuning a scoring
threshold, not a clear bug — worth a look if it recurs across future
authoring sessions rather than acted on from this one data point alone.
Finding 5 (the `node` block) and suggestion 6 (`create_tag` batch/dry-run
mode) are minor polish, consistent with the report's own "Minor" labeling.
None of the four findings are new entries for §8's existing open-items
list (batch size, SSRF tradeoff, usage visibility) — they're a
distinct, adjacent set: gaps in what `bootstrap` tells a cold-start
session, not gaps in the tools' capabilities or safety posture.

## Execution notes

The stress test's original design (see the design spec) called for a real
MCP connection — the 21 tools available natively as
`mcp__osmosis-mathstress__*` — plus a hard tool-restriction on the
authoring subagent via a custom agent definition. Neither was achievable
in this session: this harness loads both `.mcp.json` project servers and
`.claude/agents/*.md` custom agent types only at session start, and a
mid-session addition is invisible to the controller and to any subagent
it dispatches (confirmed via a probe dispatch before committing to the
real run). A full session restart would have fixed the first; the user
was not able to trigger one on demand. The exercise proceeded on two
fallbacks instead: raw JSON-RPC over `curl` against the same `/mcp/:token`
endpoint (same schemas, same validation, same tool implementations — just
a hand-built HTTP client instead of native tool-calling), and a
prompt-level (not tool-level) restriction against reading repository
source, on the built-in `general-purpose` agent type rather than a
genuinely tool-restricted one.

Net effect on the findings' credibility: the *content* of the friction
report (findings 1-7 above) is still real — the subagent had to construct
correct tool-call JSON by hand from `tools/list`'s schema, and every
error message/rejection it hit is the actual validator output, not
simulated. What's weaker is the signal on **native tool-calling
ergonomics specifically** (would Claude pick the right tool from a
list, misread a description while skimming rather than reading closely,
etc.) — that signal is the one this exercise didn't get to test, and
would need a real MCP connection (session restart) to capture properly.
