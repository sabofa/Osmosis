# Results: Daily History Section

Date: 2026-08-20

## Context

Daily draws (backend generation/proxy + Home cards) shipped and merged
2026-08-20. Its brainstorming explicitly deferred one piece: showing daily
draw history on the Results screen. `GET /api/results/daily` already
exists server-side (`server/src/domain/results.ts`'s `dailyScope`) and the
frontend already has a typed client for it (`getResultsDaily` in
`web/src/lib/api.ts`), but nothing in the UI calls it.

A second item — active pruning of daily-mirrored questions on local
nodes, flagged as a Minor in daily draws' final review — was considered
and dropped from scope. The growth rate is ~11 rows/day (1 daily
question + a default 10-question daily quiz); over 10 years that's
roughly 40,000 rows, trivial for SQLite. Pruning would also require
deleting the `daily_draw` row itself (`daily_draw_question.question_id`
has `ON DELETE RESTRICT`, so a mirrored question can't be pruned without
deleting the draw record it belongs to), which would erase that date from
Results' own daily history — directly undermining the "years of use"
goal this pass is meant to serve. This is a documented judgment call, not
an oversight: revisit only if real usage proves the growth assumption
wrong.

## Goals

- `web/src/components/Results.tsx` displays recent daily draw history:
  date, kind (question/quiz), score, completion status.
- Reuses existing visual patterns (`.results-panel`, `.results-subject-row`
  shape, `.no-scrollbar` list scrolling) — no new visual language.
- Read-only. No navigation/click-through, since `dailyScope`'s response
  doesn't include an `attempt_id` to act on.

## Non-goals

- Active pruning/retention of daily-mirrored questions or `daily_draw`
  rows — explicitly dropped, see Context.
- Any backend change — `GET /api/results/daily` already returns exactly
  the shape needed (`draw_date`, `kind`, `score`, `question_count`,
  `completed`), confirmed against `server/src/domain/results.ts`.
- Any change to the Home daily cards or the daily-draw generation/proxy
  logic — both already shipped.

## Design

`Results.tsx` gains a `daily` state (`DailyResultStat[] | null`, using
the existing `DailyResultStat` type from `lib/api.ts`), fetched via
`getResultsDaily({ limit: 30 })` in the same `useEffect` that already
fetches `getResultsTags`/`listAttempts`, following the same
`.catch()`-to-non-fatal pattern already used for the attempts fetch
(a failed daily-history fetch shouldn't block the rest of the page).

A new panel is added to the existing `.results-side` flex column in
`Results.tsx`, alongside the current "All tags, worst first" panel and
the activity-heatmap panel — same `.results-panel` / `.results-kicker`
wrapper, titled "Daily history". Its body is a scrollable list
(`.no-scrollbar`, matching `.results-subject-list`'s `overflow-y: auto`
pattern) of rows, most recent `draw_date` first (the API already returns
them in that order). Each row shows: the date (formatted compactly, e.g.
via the existing `timeAgo` helper already imported in this file, or a
short date format if `timeAgo`'s relative-time style reads oddly for
same-day entries — implementation's call, matching whichever reads more
naturally next to a list of dates), a kind label ("question" vs. "quiz"),
the score (formatted `.toFixed(2)` matching the existing tag-score
formatting elsewhere in this file) or a distinct "not completed" indicator
when `completed` is false (score is meaningless for an incomplete draw —
don't render `null` or `0.00`), reusing existing row/badge CSS if a
similar "state" indicator pattern already exists in this file's CSS,
otherwise a minimal addition.

An empty state ("No daily history yet") mirrors the existing empty-state
pattern already used for the tag list (`tags !== null && tags.length ===
0`).

## Testing / verification

No automated frontend test framework exists in this repo. Verification is
manual: seed at least one completed and one generated-but-not-yet-taken
daily draw (via the existing seed-script pattern used in prior plans'
frontend tasks), confirm the panel renders both states correctly, confirm
the empty state renders when no daily draws exist, confirm `npm run
build`/`npm run lint` pass clean.

## Open questions

None outstanding — scope and the pruning trade-off were confirmed with
the user during brainstorming.
