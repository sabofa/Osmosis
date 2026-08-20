# Results Daily History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Daily history" panel to the Results screen, showing recent daily draws (date, kind, score, completion) by wiring the already-existing `GET /api/results/daily` endpoint into the UI — per `docs/superpowers/specs/2026-08-20-daily-history-design.md`.

**Architecture:** Pure frontend addition. `web/src/components/Results.tsx` fetches `getResultsDaily` (already exported from `web/src/lib/api.ts`, currently unused) alongside its existing `getResultsTags`/`listAttempts` calls, and renders a new panel in the existing `.results-side` column reusing established `.results-panel`/`.results-kicker`/`.no-scrollbar` patterns.

**Tech Stack:** React 19, existing `web/` conventions (no new dependencies, no test framework — manual/build verification only, matching this repo's established pattern for frontend-only changes).

## Global Constraints

- No backend changes — `GET /api/results/daily` already returns the exact shape needed (verified against `server/src/domain/results.ts`'s `dailyScope`).
- No new visual patterns — reuse `.results-panel`, `.results-kicker`, `.no-scrollbar`, and a row style modeled on the existing `.results-subject-row` shape.
- Read-only — no click-through/navigation (the API response has no `attempt_id` to act on).
- Active pruning/retention is explicitly out of scope (see spec's Context section) — do not add any.
- `npm run build` and `npm run lint` (from `web/`) must both pass clean, aside from the pre-existing, unrelated `usePanelWidth.ts:30` warning.

---

### Task 1: Daily history panel on Results

**Files:**
- Modify: `web/src/components/Results.tsx`
- Modify: `web/src/components/Results.css`

**Interfaces:**
- Consumes: `getResultsDaily(params?: { limit?: number }): Promise<{ daily: DailyResultStat[] }>` and `DailyResultStat` (both already exported from `web/src/lib/api.ts`:437-450 — `{ draw_date: string; kind: string; score: number | null; question_count: number; completed: boolean }`), `timeAgo(iso: string | null): string` (already exported from `web/src/lib/api.ts`:466, already imported in `Results.tsx`).
- Produces: nothing consumed elsewhere — this is the final piece of the daily-draws feature.

- [ ] **Step 1: Read the current file**

Read `web/src/components/Results.tsx` in full (it's ~165 lines, shown in earlier planning) and `web/src/components/Results.css` in full before editing, so your additions match the file's existing state exactly, not a stale snapshot.

- [ ] **Step 2: Add the `daily` state and fetch**

In `Results.tsx`, add `getResultsDaily` and `type DailyResultStat` to the existing import line from `../lib/api` (currently imports `getResultsTags, listAttempts, timeAgo, type AttemptSummary, type TagResultStat`).

Add a new state declaration alongside the existing ones (`tags`, `attempts`, `error`, `selected`, `chartEl`, `size`):
```ts
const [daily, setDaily] = useState<DailyResultStat[] | null>(null)
```

In the existing `useEffect` that fetches `getResultsTags` and `listAttempts` (the first `useEffect` in the component), add a third fetch following the same non-fatal `.catch()` pattern already used for `listAttempts`:
```ts
getResultsDaily({ limit: 30 })
  .then((r) => setDaily(r.daily))
  .catch(() => {
    /* daily history panel just shows empty state if this fails; not fatal */
  })
```

- [ ] **Step 3: Add the panel markup**

In the JSX, inside `.results-side` (after the existing `.results-panel.results-subjects` block and before or after the `.results-panel.results-heatmap-panel` block — place it between the two, so the column reads: tag list, daily history, activity heatmap), add:

```tsx
<div className="results-panel results-daily-panel">
  <div className="results-kicker">Daily history</div>
  <div className="results-daily-list no-scrollbar">
    {(daily ?? []).map((d) => (
      <div key={`${d.draw_date}-${d.kind}`} className="results-daily-row">
        <span className="results-daily-date">{timeAgo(d.draw_date)}</span>
        <span className={`results-daily-kind-badge ${d.kind}`}>{d.kind === 'quiz' ? 'quiz' : 'question'}</span>
        <span className={`results-daily-score${d.completed ? '' : ' incomplete'}`}>
          {d.completed && d.score !== null ? d.score.toFixed(2) : 'not completed'}
        </span>
      </div>
    ))}
    {daily !== null && daily.length === 0 && (
      <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>No daily history yet.</div>
    )}
  </div>
</div>
```

Note: `timeAgo` expects an ISO datetime string and appends `Z` if missing (see its implementation) — `draw_date` is a bare `YYYY-MM-DD` (per `server/migrations/001_init.sql`'s comment `'YYYY-MM-DD' in daily_timezone`), which `new Date('2026-08-20Z')` parses correctly as midnight UTC on that date, so `timeAgo` works as-is without modification. Verify this renders sensibly (e.g. "2d ago") during manual verification in Step 6 — if it reads oddly for a same-day entry (e.g. "0h ago" appearing thin), that's acceptable per the spec's "implementation's call" note, not a blocker.

- [ ] **Step 4: Add the CSS**

In `Results.css`, add rules for the new classes, matching the file's existing conventions (border/radius/spacing values already used by `.results-subject-row` and `.bank-type-badge`-style badges elsewhere in the codebase — read `web/src/components/Bank.css`'s `.bank-type-badge`/`.bank-type-badge.written` rules first for the exact badge-styling convention to mirror):

```css
.results-daily-panel {
  flex-shrink: 0;
  max-height: 220px;
}

.results-daily-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  min-height: 0;
}

.results-daily-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 2px solid var(--line);
  border-radius: 14px;
  padding: 8px 14px;
  font-size: 13px;
}

.results-daily-date {
  flex: 1;
  color: var(--muted);
}

.results-daily-kind-badge {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-wash);
  color: var(--accent);
}

.results-daily-score {
  font-family: var(--font-display);
  font-weight: 700;
  min-width: 44px;
  text-align: right;
}

.results-daily-score.incomplete {
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}
```

Adjust exact values only if they visibly clash with the live page during Step 6's manual check (e.g. if `.results-side`'s existing `gap: 20px` makes three panels too cramped at typical window heights) — the goal is "reads as part of the same design system," not pixel-exact reproduction of this snippet.

- [ ] **Step 5: Verify build and lint**

```bash
cd web && npm run build && npm run lint
```
Expected: both pass clean (aside from the pre-existing, unrelated `usePanelWidth.ts:30` warning).

- [ ] **Step 6: Manual verification**

Start the dev server against a real running canonical instance with seeded data (reuse the seed-script pattern established in prior plans' frontend tasks — you'll need at least one completed daily draw and, ideally, one generated-but-not-yet-attempted one to see both score states). In the Browser pane:
- Confirm the "Daily history" panel renders between the tag list and the heatmap panel.
- Confirm a completed entry shows its score (`X.XX` format) and kind badge.
- Confirm a not-yet-completed entry shows "not completed" rather than `null`/`0.00`.
- Confirm the empty state ("No daily history yet.") renders correctly if you test against a database with no daily draws generated yet.
- Confirm the panel scrolls (not overflow-clips) if you seed more than ~4-5 daily draws.

If you don't have Browser pane access in your environment, do your best with static code review and say so plainly in your report rather than skipping the note.

- [ ] **Step 7: Commit**

```bash
cd web && git add src/components/Results.tsx src/components/Results.css
git commit -m "feat: daily history panel on Results screen"
```

---

## Self-Review Notes

- **Spec coverage:** The spec's single Goal (Results daily history display, read-only, reusing existing patterns) is fully covered by Task 1. The spec's Non-goals (no backend change, no pruning, no Home/generation changes) are respected — this plan touches only `Results.tsx`/`Results.css`.
- **Placeholder scan:** No TBD/TODO markers. Every step has real, copy-pasteable code — the one open judgment call (exact date-formatting readability, exact CSS pixel values) is explicitly flagged as implementer's-call-during-manual-verification, per the spec's own "implementation's call" language, not left vague.
- **Type consistency:** `DailyResultStat`'s field names (`draw_date`, `kind`, `score`, `question_count`, `completed`) are used exactly as defined in `web/src/lib/api.ts` — verified against the actual source during planning, not assumed.
