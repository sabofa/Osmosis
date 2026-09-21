# Osmosis — polish (stage 1 only)

**Scope:** what sessions three through eight will hit. No new surfaces, no workspace, no SM2, no item-model rewrite. Everything here is a fix, a field, a rendering, or a behaviour of things that already exist — plus one small primitive (§5) that the tutor's next sessions use and that can be deferred without breaking anything.
**Sources:** `OSMOSIS-ASKS.md` §1–§13, `OSMOSIS-FRONTEND.md` P0 and §4, the first chem session's notes, and the designer's answers to the Osmosis design questions (2026-09-17).
**Not here:** the 2a spine (backfill, two-key retention row, B4 outcome→schedule loop, Cepeda/SM2 handoff) — that's next, not polish; and stages 2–3 of the desk plan.

Each item has a *done when* so it can be closed by a check, not a feeling.

---

## 1. Rendering

| # | Item | Done when |
|---|---|---|
| 1.1 | **KaTeX** on `prompt`, `choices[].body`, `explanation`, and anything pushed as text. Inline `$…$`, display `\[…\]`. | an AMC item with `$\frac{a}{b}$` and `$\sqrt{30}$` renders in the live view, the review, and the bank browser |
| 1.2 | **mhchem** for chemistry: formulas, subscripts, charges, reaction arrows (`\ce{Al2(SO4)3}`). | the chem items from the 2026-09-16 session render |
| 1.3 | **UTF-8 everywhere** — prompts, choices, explanations, labels; no HTML entity encoding of plain fields. `create_tag` returning `&amp;` for `&` is this bug. | round-trip test: a label with `&`, `<`, `é`, and `日本` comes back byte-identical |
| 1.4 | **Document editor font** — a readable serif or a code-friendly monospace, selectable; formulas legible. | Ben says so |
| 1.5 | Physics units and vectors render (falls out of 1.1); other-language text renders (falls out of 1.3). | covered by 1.1 / 1.3 tests |

## 2. The outcome record — every field the tutor reads, on every read path

The rule: **anything accepted on input is readable on output.** Today `idk`, `confidence`, and `misapplied_method` are accepted on `submit_quick_check` and returned nowhere.

| # | Field | Done when |
|---|---|---|
| 2.1 | `selected_choice_id` on every choice outcome — **the chosen option is the diagnosis**; without it distractor rationales are write-only. | present on `await_item_outcome`, `get_attempt`, and `get_results` at attempt scope |
| 2.2 | `idk` as a distinct third state, on choice and written items, on output. | a learner idk is neither `correct` nor `incorrect` in any aggregate |
| 2.3 | `best_guess_choice_id` after an idk — asked **after** the blank decision, never alongside; marked unscored in the prompt; graded server-side, never scored. | two-step prompt; the guess never touches `mean_score` |
| 2.4 | `confidence` on every item type, in the three-label scale (unsure / somewhat / confident), presentable per item; the numeric scale documented. | the labels the tutor's typed channel shows are the labels Osmosis shows |
| 2.5 | `elapsed_ms` measured on the learner's device, first paint to commit. | drill median seconds computed from it matches a stopwatch within tolerance |
| 2.6 | `misapplied_method` readable on output where supplied. | present on `get_attempt` |
| 2.7 | `chosen_misconception` on a choice outcome when the distractor carried one. | present when the item has it |
| 2.8 | `status: abandoned` distinct from `pending`; `status: paused` for §7.6. | the tutor's typed fallback keys on `abandoned` and not on a slow answer |
| 2.9 | `grader: self \| oracle \| judge` recorded on every written outcome; tutor-presented written items accept the tutor's grade. | a self-graded row is distinguishable from an oracle-graded one in `get_results` |
| 2.10 | **A null score is not zero.** An ungraded response is excluded from `mean_score` and every aggregate; it is never folded in as 0. | the attempt from 2026-09-14 with one null response shows `mean_score: null`, not 0 |

## 3. The item channel

| # | Item | Done when |
|---|---|---|
| 3.1 | `reveal: immediate \| deferred` per presentation, with a session default. Deferred shows only "recorded"; the review at set end shows his answer, the key, and the tutor's one-line diagnosis. | a timed drill never shows correct/incorrect between items |
| 3.2 | Five options confirmed; `ordinal` stable 0–4 in the order sent; assigned on first present and frozen. | the tutor derives the letter from `ordinal` and it never shifts |
| 3.3 | Distractor `misconception` optional; null means unknown in any analytics. | imported AMC items no longer carry the neutral-marker string |
| 3.4 | `await_item_outcome` on the canonical `/mcp/<token>` surface; accepts `timeout_s ≤ 25`. | the connector variant and the canonical node both list it |
| 3.5 | `ephemeral: true` on `create_questions` — presentable once, never scheduled, retired at `end_session`. | the tutor's live tests run against the real node and leave the bank unchanged |
| 3.6 | **Presenter-scoped token** — `create_session`, `create_questions`, `present_item`, `await_item_outcome`, `get_attempt`, `end_session`, nothing else. Media (when it exists) on this token, Tailscale-only. | the tutor server authenticates with it; the shared secret is not in the tutor's config |
| 3.7 | `end_session` returns a summary: n presented / answered / abandoned. | the tutor's CLOSE cross-checks its own count |
| 3.8 | `readme` reports `protocol_version` and a tool-list version. | the tutor's `health` names a mismatch instead of failing on the first present |
| 3.9 | Idempotency key on `create_questions`; a replayed outbox creates no duplicates. | send the same batch twice; one set of rows |
| 3.10 | Items carry `node_keys[]` (tag-shaped, one primary), `provenance`, `claim_rung`, `tags` — stored and searchable by node key. | `search_questions` by `node:` prefix returns a session's items |

## 4. Tags

| # | Item | Done when |
|---|---|---|
| 4.1 | **Slug grammar admits a dot inside a segment** so `node:ebbing11e:2.4:atomic_weight` is legal. Amend the grammar; do not rewrite `2.4` as `2-4`. | the seven skipped chem rows no longer skip |
| 4.2 | `create_session`'s description says `tag_slug` must already exist. | one clause |
| 4.3 | **Seeded taxonomy per subject**, or `bootstrap(subject)` offering to create one, so a subject's first author doesn't mint ad hoc. The tutor server is the single minter for tutor-side tags and checks `bootstrap` first. | chemistry has a taxonomy before the next chem session |
| 4.4 | Tag kinds by prefix: `tech:`, `topic:`, `node:`. | `merge_tags` and prefix queries work across all three |

## 5. Showing, minimally — the one new primitive

The tutor's next sessions put the worked example, the contrast at CONSOLIDATE, the plan being approved, and the close summary in front of Ben. Today that's a modal or the chat. This is the smallest version of "Osmosis is what he looks at" and it can slip to stage 2 without breaking sessions.

| # | Item | Done when |
|---|---|---|
| 5.1 | `present(session, item)` for `text` / `markdown` / `graph` — non-scored, an OK button, `seen` + `dwell_ms` back. Rendered with §1. | a CONSOLIDATE contrast appears in the session stream |
| 5.2 | `update(item_id, payload)` for `graph` — re-render in place, `@bounds` held. | a curve redraws without the frame jumping |
| 5.3 | **The session stream**: the tutor's session is a list, in order, items and shows together, scrollable back. With a thin banner from `context: {course, unit, node, step, timer_s}` and a *waiting on you* / *tutor is thinking* state. | Ben can scroll to the step above |
| 5.4 | **Push to the browser** (SSE or websocket) so a present or update appears without a reload; `health` reports `push: true \| false`. When false the tutor presents the final spec once instead of building stepwise. | an `update` is visible in under a second; the flag is honest |
| 5.5 | **Reveal gate** (Osmosis's one invariant): *while an item with a pending outcome is open, nothing that would answer it is readable — previously shown items included.* Expired or gated items collapse until the outcome is recorded. Not tamper-proof against the learner, by design. | a deferred-reveal set cannot be scrolled up to |

## 6. Live session organisation

| # | Item | Done when |
|---|---|---|
| 6.1 | One entry per tutor session, in order; a closed session reads as closed. | the list from 2026-09-16 no longer shows open entries for ended sessions |
| 6.2 | When a session closes, the stream collapses to its summary: points, the calibration line, the next mark — the same text the tutor said. | opening a closed session shows the summary first |
| 6.3 | The tutor's sessions and Ben's own practice are distinguishable at a glance. | `source: tutor \| self` on the entry |

## 7. Ease of use (from `OSMOSIS-FRONTEND.md` §4)

| # | Item | Done when |
|---|---|---|
| 7.1 | **Keyboard first** — `1–5` picks, `Enter` submits, `b` blanks, `?` idk, `u/s/c` confidence, `Space` acknowledges a show; focus lands on the new item. | a full drill set runs without the mouse |
| 7.2 | **Drill timer that behaves** — visible, quiet, no colour change under a minute; item timer separate from set timer; the set ending is Osmosis's message, not a surprise. | Ben says so after a timed half-set |
| 7.3 | **Deferred-reveal review from real data** — `Review.tsx` fed by the session, every item with his answer, the key, and the tutor's diagnosis where there was one. | the review after a timed set is complete |
| 7.4 | **Notification when the tutor asks** — desktop notification or title flash when an item lands. | fires when Osmosis isn't the focused window |
| 7.5 | **Latency** — `present_item` visible in under a second. | measured |
| 7.6 | **Pause** — "back in five" on the banner pauses the drill timer and reports `status: paused`; not a timeout, not an abandon. | the tutor's fallback doesn't fire on a pause |
| 7.7 | **One tab, one stream** while a tutor session is open; bank, library, results unchanged. | the session is the home view while open |
| 7.8 | Layout for one wide window: stream left, current graph/document right. Mobile fine; the desk is the laptop. | Ben says so |

## 8. Order

1. §2.10 null-score, §1 rendering, §4.1 grammar — the third session hits all three.
2. §2 outcome fields and §3.1 deferred reveal — the first timed drill needs them.
3. §3.5–3.9 channel hygiene, §4.2–4.4 tags.
4. §6 organisation, §7 ease of use.
5. §5 showing — last, and it can slip.

Then the 2a spine, in the Osmosis chat's own order: backfill of *tutor-sent* items only (the 76 native questions get `node_keys: []`), the two-key retention row, the B4 outcome→schedule loop, the Cepeda/SM2 handoff with draw-k.
