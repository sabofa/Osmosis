// ----------------------------------------------------------------------------
// Who is reading, and what a deferred reveal holds back from them (§3.1).
//
// 'learner' is the app: the Take/Review screens, the live poll, the session
// detail the session list renders, and the results screens. 'tutor' is every
// MCP tool. A deferred attempt withholds its verdict from the learner until
// the session it belongs to ends — and that has to hold on every path the
// learner's screens read, not just the attempt read, or the same score comes
// back through a list.
// ----------------------------------------------------------------------------

export type Viewer = "learner" | "tutor";

// True for an attempt whose key is still held back. An attempt with no
// session has nothing to wait for; an ended session has already released it.
export function deferredHoldSql(attempt = "a"): string {
  return (
    `(${attempt}.reveal = 'deferred' AND ${attempt}.session_id IS NOT NULL ` +
    `AND EXISTS (SELECT 1 FROM tutor_session ts WHERE ts.id = ${attempt}.session_id AND ts.ended_at IS NULL))`
  );
}

// The filter to add to a learner-viewer query so held responses contribute to
// neither the rows nor the aggregates. Returns "1 = 1" for the tutor, so a
// query can splice it in unconditionally.
export function notHeldSql(viewer: Viewer, attempt = "a"): string {
  return viewer === "learner" ? `NOT ${deferredHoldSql(attempt)}` : "1 = 1";
}
