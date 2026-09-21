# Polish stage 2 — Ben's walkthrough list (2026-09-21)

Implemented by hand, in this order. Each item names its check.

## A. Take (the test view)
1. **Question dots** — a scrollable strip (vertical rail in landscape, horizontal bar at the bottom in portrait); never squished. Current dot scrolls into view.
2. **Portrait layout** (`max-aspect-ratio: 1/1` or width < 760): dots bottom, question top, answers, confidence below answers, nav in a fixed footer.
3. **Panel switcher** instead of a side panel on narrow/portrait: a "Graph / Document / Desmos" button flips to a full-screen panel with the question in a bubble at the top and the switcher beside it; tapping the bubble returns to the question. Wide landscape keeps the side-by-side panel.
4. **Exit confirm** — leaving a test asks first (answers so far are kept; the attempt stays resumable is not promised — it is abandoned).
5. **Submit with blanks** asks "N unanswered — submit anyway?".
6. **Timer enforcement** — at 0 the attempt is submitted automatically and the review opens, with a 2 s "Time." message first.
7. **Daily once** — after today's daily question/quiz is taken the Home buttons grey out with "done today".

## B. Review
8. Written items show the rubric and model answer beside the answer; self-grade buttons have the rubric in view; explanation for every item; per-item tags; jump list.

## C. Bank
9. Parent-tag groups fold/unfold (chevron, remembered per tag in localStorage); "collapse all / expand all".

## D. Home heatmap
10. Grid scales to the card width (CSS grid with `aspect-ratio`), card height fits content in portrait.

## E. Results
11. Tag mean-over-time uses the graph engine (`GraphPanel` with a generated spec) instead of the hand-drawn SVG.
12. "All tags" lists parent tags only; double-click a row → full-page tag view: graph on the right, tag info + children on the left.
13. Daily history double-click → full-page view: history list left, details right (questions done, scores, tags touched).

## F. Live sessions on a local node
14. Local node proxies `/live-api/*` → canonical `/api/*` (streaming, SSE) via `@fastify/http-proxy`; the web app switches its API base to `/live-api` while the Live pages are open on a local node, so sessions, streams, answers and pushes all go to canonical.

## G. Settings / administration
15. Settings reorganised into sections (Appearance, Behaviour, Sync, Data, About). Data: rebuild search index, clear attempts / daily history / sessions / everything (typed confirmation), storage sizes. Behaviour: confirm-on-exit, notifications, document font, keyboard hints.

## H. Install / CLI
16. `scripts/osmosis-cli.mjs` (+ `npm run osmosis -- …`): `status`, `start`, `stop`, `open`, `logs`, `sync` for a local node on Windows/Linux; README quick start.

## I. Rendering
17. Confirm KaTeX/mhchem/UTF-8 (Japanese) with a seeded render-test question in the local bank.
