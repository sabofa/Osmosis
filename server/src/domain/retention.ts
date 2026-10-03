import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { isValidNodeKey } from "./nodeKeys.js";
import { computeWeakWeights, weightedSampleWithoutReplacement } from "./weights.js";
import type { Confidence } from "./attempts.js";

// ----------------------------------------------------------------------------
// The retention loop (stage 2a).
//
// A target belongs to a node and every item carrying that node key inherits
// it (node_retention_target). Gap 1 comes from the target, by Cepeda's ratio.
// At gap 1 the node's first probe is drawn — its discriminating items plus
// one transfer item — and the rest of the node waits as reserve until the
// draw's result says when it comes (retention_schedule, the two-key row).
// From an item's first retention review on, SM2 owns its gaps, clamped so no
// interval steps past an open target.
//
// SM2 state is never stored. It is replayed from the item's graded responses
// every time it is read, keyed by lineage_id, so a re-grade, a late sync
// push, or a reworded version can never leave a schedule stale — and a
// different scheduler can be swapped in over the same history. What is
// stored is what cannot be replayed: the targets, the draws, the draw's
// result, and when each item's retention clock starts (retention_item).
// ----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// Caller-supplied date strings (needs_last_until, before) funnel through
// here. A bare "YYYY-MM-DD HH:MM:SS" is exactly the format this module
// itself stores in and returns from due_at, so the natural caller flow is
// "read a due_at value, pass it back in" — but new Date() parses a
// space-separated, no-timezone string as LOCAL time, not UTC, which would
// silently shift it by the server's UTC offset on any non-UTC host. Force
// UTC for that exact shape rather than trusting the runtime's local-time
// interpretation. Also converts a genuinely unparseable string into a
// legible DomainError instead of letting toISOString() throw a raw
// RangeError — these are LLM-supplied free-form strings via MCP tools.
function parseCallerDateMs(input: string, field: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(input) ? input.replace(" ", "T") + "Z" : input;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new DomainError("invalid_date", `${field} is not a parseable date: "${input}"`);
  }
  return ms;
}

function toSqliteDatetime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

// Every stored datetime here is SQLite's datetime('now') shape, in UTC.
function storedMs(value: string): number {
  return Date.parse(value.replace(" ", "T") + "Z");
}

function configNumber(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  const value = row ? Number(JSON.parse(row.value)) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

// k discriminating items per first probe. At least one: an empty draw could
// never resolve and would hold the node's reserve forever.
function drawK(db: DatabaseSync): number {
  return Math.max(1, Math.floor(configNumber(db, "retention_draw_k", 3)));
}

function clampFloorMs(db: DatabaseSync): number {
  return Math.max(0, configNumber(db, "retention_clamp_floor_hours", 24)) * 60 * 60 * 1000;
}

// SAVEPOINT rather than BEGIN: the refresh runs inside read paths, and some
// of those (a frozen template's draw, inside createTemplate) are already in
// a transaction. A savepoint nests; BEGIN would throw.
function inSavepoint<T>(db: DatabaseSync, name: string, fn: () => T): T {
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Gap 1: Cepeda et al. 2008
// ----------------------------------------------------------------------------

// The optimal first gap is ~20-40% of the retention interval, dropping to
// 5-10% for year-long targets. Linear interpolation between the two known
// bands, clamped at the boundaries — not a precise model, a reasonable
// default per the source plan's own framing.
export function firstGapRatio(totalDays: number): number {
  if (totalDays <= 14) return 0.3; // midpoint of 20-40%
  if (totalDays >= 365) return 0.075; // midpoint of 5-10%
  // Linear interpolation between (14, 0.3) and (365, 0.075).
  const t = (totalDays - 14) / (365 - 14);
  return 0.3 + t * (0.075 - 0.3);
}

// ----------------------------------------------------------------------------
// Outcome → SM2 quality
// ----------------------------------------------------------------------------

// Only an answer key or a tutor's verdict schedules. A self grade carries too
// much noise, and 'model' grades are history from a grader that no longer
// exists. auto_mc is an mc item graded against its own key — an oracle in
// all but name, and the only grade an mc item can ever carry, since a tutor
// verdict on an mc response leaves the score alone.
export const SCHEDULING_GRADERS = ["auto_mc", "oracle", "judge"] as const;

export const PASSING_QUALITY = 3;

// High-confidence-wrong is the worst outcome: a misconception plus a
// calibration failure. idk is honest and sits with low-confidence-wrong, not
// below it. A partial score is a miss without a misconception (2). A missing
// confidence reads as the middle level. misapplied_method never enters: it is
// a tutor-side diagnostic.
export function qualityFor(answer: { idk: boolean; score: number | null; confidence: Confidence | null }): number | null {
  if (answer.idk) return 1;
  if (answer.score === null) return null;
  if (answer.score >= 1) return answer.confidence === "confident" ? 5 : answer.confidence === "unsure" ? 3 : 4;
  if (answer.score <= 0) return answer.confidence === "confident" ? 0 : answer.confidence === "unsure" ? 2 : 1;
  return 2;
}

// ----------------------------------------------------------------------------
// SM2, elapsed-aware
// ----------------------------------------------------------------------------

export interface Sm2State {
  easiness: number;
  repetitions: number;
  interval_days: number;
}

export const SM2_START: Sm2State = { easiness: 2.5, repetitions: 0, interval_days: 0 };

const RELEARN_INTERVAL_DAYS = 1;

// SM-2's easiness update, applied on every review so the six quality levels
// all mean something (a confident miss costs more easiness than an unsure
// one). One change from the textbook interval rule, which multiplies the
// *scheduled* interval whatever actually happened: here the next interval is
// max(previous interval, elapsed × easiness). Reviewed on time, that is the
// textbook rule. Reviewed early — a casual draw, a tutor's direct pick — the
// interval does not grow on evidence it did not get. Reviewed late and still
// passed, the item gets credit for the longer survival. The first pass grows
// from the gap it just survived, so gap 2 = gap 1 × easiness.
export function sm2Step(state: Sm2State, quality: number, elapsedDays: number): Sm2State {
  const miss = 5 - quality;
  const easiness = Math.max(1.3, state.easiness + 0.1 - miss * (0.08 + miss * 0.02));
  if (quality < PASSING_QUALITY) {
    return { easiness, repetitions: 0, interval_days: RELEARN_INTERVAL_DAYS };
  }
  return {
    easiness,
    repetitions: state.repetitions + 1,
    interval_days: Math.max(1, state.interval_days, Math.max(0, elapsedDays) * easiness),
  };
}

// next_due = min(review + sm2_interval, target − ratio × (target − review)),
// over every open target. The clamp converges on the target geometrically,
// so a floor stops it: once the latest permissible review is less than the
// floor away, that target has had its last pre-target pass and adds nothing
// more. Without the floor a target would pull reviews in at 7h, 2h, 35m ...
// before it. A target at or before the review is past: SM2 runs free of it.
export function clampToTargets(reviewMs: number, dueMs: number, targetMs: number[], floorMs: number): number {
  let due = dueMs;
  for (const t of targetMs) {
    if (t <= reviewMs) continue;
    const span = t - reviewMs;
    const latest = t - firstGapRatio(span / DAY_MS) * span;
    if (latest - reviewMs < floorMs) continue;
    due = Math.min(due, latest);
  }
  return due;
}

interface Review {
  response_id: string;
  lineage_id: string;
  ms: number;
  quality: number;
}

interface Replay {
  state: Sm2State;
  count: number;
  lastMs: number | null;
  lastQuality: number | null;
  everPassed: boolean;
}

// Folds an item's reviews into SM2 state. Reviews before firstDueMs are the
// learning phase — the session's own checks, an early casual draw — which
// refresh the item (the next gap is measured from them) but schedule
// nothing: gap 1 belongs to the target, SM2 owns gap 2 onward.
function replay(reviews: Review[], firstDueMs: number, anchorMs: number, untilMs = Infinity): Replay {
  let state = SM2_START;
  let prevMs = anchorMs;
  const out: Replay = { state, count: 0, lastMs: null, lastQuality: null, everPassed: false };
  for (const r of reviews) {
    if (r.ms > untilMs) break;
    if (r.ms < firstDueMs) {
      prevMs = Math.max(prevMs, r.ms);
      continue;
    }
    state = sm2Step(state, r.quality, (r.ms - prevMs) / DAY_MS);
    prevMs = r.ms;
    out.count += 1;
    out.lastMs = r.ms;
    out.lastQuality = r.quality;
    out.everPassed ||= r.quality >= PASSING_QUALITY;
  }
  out.state = state;
  return out;
}

// ----------------------------------------------------------------------------
// Reading the record
// ----------------------------------------------------------------------------

interface TargetRow {
  id: string;
  node_key: string;
  retention_target: string;
  needs_last_until: string;
  set_at: string;
  first_gap_days: number;
  gap1_due_at: string;
  target_source: "engine" | "tutor_direct";
  drawn_at: string | null;
  draw_k: number | null;
  probe_result: "pass" | "fail" | null;
  probe_resolved_at: string | null;
  gap2_days: number | null;
}

interface MembershipRow {
  node_key: string;
  lineage_id: string;
  retention_target: string;
  role: "draw" | "reserve";
}

interface ItemRow {
  lineage_id: string;
  enrolled_at: string;
  first_due_at: string | null;
  first_due_source: "draw" | "reserve_pass" | "reserve_fail" | null;
}

interface LiveVersion {
  question_id: string;
  lineage_id: string;
  type: "mc" | "written";
  retired: boolean;
  ephemeral: boolean;
  tests_error: string | null;
  lineage_created_at: string;
  lineage_seq: number; // insertion order of the lineage's first row: breaks same-second ties
  node_keys: string[];
}

// The latest version of every lineage, with its node keys (primary first).
// A lineage whose latest version is retired has ended: retire_question ends
// the schedule, a supersede does not (the new version is the latest).
function liveVersions(db: DatabaseSync): Map<string, LiveVersion> {
  const rows = db
    .prepare(
      `SELECT q.id, q.lineage_id, q.type, q.retired_at, q.ephemeral, q.tests_error, q.node_key,
              (SELECT MIN(q0.created_at) FROM question q0 WHERE q0.lineage_id = q.lineage_id) AS lineage_created_at,
              (SELECT MIN(q0.rowid) FROM question q0 WHERE q0.lineage_id = q.lineage_id) AS lineage_seq
       FROM question q
       WHERE NOT EXISTS (SELECT 1 FROM question q2 WHERE q2.lineage_id = q.lineage_id AND q2.version > q.version)`
    )
    .all() as {
    id: string;
    lineage_id: string;
    type: "mc" | "written";
    retired_at: string | null;
    ephemeral: number;
    tests_error: string | null;
    node_key: string | null;
    lineage_created_at: string;
    lineage_seq: number;
  }[];
  const keys = new Map<string, string[]>();
  for (const k of db
    .prepare("SELECT question_id, node_key FROM question_node_key ORDER BY question_id, is_primary DESC, ordinal ASC")
    .all() as { question_id: string; node_key: string }[]) {
    const list = keys.get(k.question_id) ?? [];
    list.push(k.node_key);
    keys.set(k.question_id, list);
  }
  const out = new Map<string, LiveVersion>();
  for (const r of rows) {
    out.set(r.lineage_id, {
      question_id: r.id,
      lineage_id: r.lineage_id,
      type: r.type,
      retired: r.retired_at !== null,
      ephemeral: r.ephemeral === 1,
      tests_error: r.tests_error,
      lineage_created_at: r.lineage_created_at,
      lineage_seq: r.lineage_seq,
      node_keys: keys.get(r.id) ?? (r.node_key ? [r.node_key] : []),
    });
  }
  return out;
}

// A lineage that can take part in a schedule: latest version live and not
// ephemeral (an ephemeral item is presentable once, never scheduled).
function schedulable(v: LiveVersion | undefined): v is LiveVersion {
  return !!v && !v.retired && !v.ephemeral;
}

// The node's items, in the order they were first authored.
function nodeItems(versions: Map<string, LiveVersion>, nodeKey: string): LiveVersion[] {
  return [...versions.values()]
    .filter((v) => schedulable(v) && v.node_keys.includes(nodeKey))
    .sort((a, b) => a.lineage_created_at.localeCompare(b.lineage_created_at) || a.lineage_seq - b.lineage_seq);
}

// Every answered, scheduling-grade response, as a review per lineage, in time
// order. An idk counts whoever graded it — it is the learner's own honest
// declaration, not a self grade — and a blank or skipped answer is not a
// retrieval attempt at all.
function reviewsByLineage(db: DatabaseSync): Map<string, Review[]> {
  const graders = SCHEDULING_GRADERS.map((g) => `'${g}'`).join(", ");
  const rows = db
    .prepare(
      `SELECT r.id AS response_id, q.lineage_id, r.idk, r.confidence, g.score,
              COALESCE(r.answered_at, a.submitted_at) AS reviewed_at
       FROM response r
       JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
       JOIN question q ON q.id = r.question_id
       LEFT JOIN grade g ON g.response_id = r.id AND g.superseded_at IS NULL
       WHERE q.ephemeral = 0
         AND (r.idk = 1 OR r.selected_choice_id IS NOT NULL OR TRIM(COALESCE(r.response_text, '')) <> '')
         AND (r.idk = 1 OR g.grader IN (${graders}))
       ORDER BY reviewed_at ASC, r.id ASC`
    )
    .all() as {
    response_id: string;
    lineage_id: string;
    idk: number;
    confidence: Confidence | null;
    score: number | null;
    reviewed_at: string;
  }[];
  const out = new Map<string, Review[]>();
  for (const r of rows) {
    const quality = qualityFor({ idk: r.idk === 1, score: r.score, confidence: r.confidence });
    if (quality === null) continue;
    const list = out.get(r.lineage_id) ?? [];
    list.push({ response_id: r.response_id, lineage_id: r.lineage_id, ms: storedMs(r.reviewed_at), quality });
    out.set(r.lineage_id, list);
  }
  return out;
}

function allTargets(db: DatabaseSync): TargetRow[] {
  return db.prepare("SELECT * FROM node_retention_target ORDER BY created_at, id").all() as unknown as TargetRow[];
}

function memberships(db: DatabaseSync): MembershipRow[] {
  return db
    .prepare("SELECT node_key, lineage_id, retention_target, role FROM retention_schedule")
    .all() as unknown as MembershipRow[];
}

function targetKey(nodeKey: string, label: string): string {
  return `${nodeKey}\u0000${label}`;
}

// ----------------------------------------------------------------------------
// Setting a target
// ----------------------------------------------------------------------------

export interface SetRetentionTargetInput {
  identity_key: string; // the node key the target attaches to
  retention_target: string;
  target_source: "engine" | "tutor_direct";
  needs_last_until: string; // ISO date or datetime the material needs to last until
}

export interface SetRetentionTargetResult {
  id: string;
  node_key: string;
  identity_key: string;
  retention_target: string;
  needs_last_until: string;
  first_gap_days: number;
  due_at: string; // gap 1: when the node's first probe is drawn
  node_items: number;
}

// Setting a target the node already has (same label) starts it over: a new
// teaching anchor, a new gap 1, a new first probe. An item's own retention
// history is untouched — its retention clock (retention_item) never moves
// later.
export function setRetentionTarget(
  db: DatabaseSync,
  input: SetRetentionTargetInput,
  now: Date = new Date()
): SetRetentionTargetResult {
  if (!isValidNodeKey(input.identity_key)) {
    throw new DomainError(
      "invalid_node_key",
      `identity_key "${input.identity_key}" is not a node key. A retention target attaches to a node — ` +
        `node:<textbook_slug>:<section>:<node_key> for course material, node:<topic_slug>:<subtopic>:<node_key> ` +
        `for self-directed — and every item carrying that key inherits it.`
    );
  }
  if (typeof input.retention_target !== "string" || input.retention_target.trim() === "") {
    throw new DomainError("invalid_retention_target", "retention_target must be a non-empty label.");
  }

  const nowMs = now.getTime();
  const targetMs = parseCallerDateMs(input.needs_last_until, "needs_last_until");
  const totalDays = Math.max((targetMs - nowMs) / DAY_MS, 0);
  const firstGapDays = totalDays * firstGapRatio(totalDays);
  const gap1 = toSqliteDatetime(nowMs + firstGapDays * DAY_MS);
  const setAt = toSqliteDatetime(nowMs);
  const needsLastUntil = toSqliteDatetime(targetMs);

  return inSavepoint(db, "set_retention_target", () => {
    db.prepare(
      `INSERT INTO node_retention_target
         (id, node_key, retention_target, needs_last_until, set_at, first_gap_days, gap1_due_at, target_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (node_key, retention_target) DO UPDATE SET
         needs_last_until = excluded.needs_last_until,
         set_at = excluded.set_at,
         first_gap_days = excluded.first_gap_days,
         gap1_due_at = excluded.gap1_due_at,
         target_source = excluded.target_source,
         drawn_at = NULL, draw_k = NULL,
         probe_result = NULL, probe_resolved_at = NULL, gap2_days = NULL,
         updated_at = datetime('now')`
    ).run(uuidv4(), input.identity_key, input.retention_target, needsLastUntil, setAt, firstGapDays, gap1, input.target_source);
    db.prepare("DELETE FROM retention_schedule WHERE node_key = ? AND retention_target = ?").run(
      input.identity_key,
      input.retention_target
    );
    const row = db
      .prepare("SELECT id FROM node_retention_target WHERE node_key = ? AND retention_target = ?")
      .get(input.identity_key, input.retention_target) as { id: string };
    const items = nodeItems(liveVersions(db), input.identity_key).length;
    return {
      id: row.id,
      node_key: input.identity_key,
      identity_key: input.identity_key,
      retention_target: input.retention_target,
      needs_last_until: needsLastUntil,
      first_gap_days: firstGapDays,
      due_at: gap1,
      node_items: items,
    };
  });
}

// ----------------------------------------------------------------------------
// The refresh: draws, late joiners, draw results
// ----------------------------------------------------------------------------

function enroll(
  db: DatabaseSync,
  lineageId: string,
  anchor: string,
  firstDue: string | null,
  source: ItemRow["first_due_source"]
): void {
  // An item's retention clock only ever starts earlier: a second target can
  // add a first probe, never postpone one already scheduled.
  db.prepare(
    `INSERT INTO retention_item (lineage_id, enrolled_at, first_due_at, first_due_source) VALUES (?, ?, ?, ?)
     ON CONFLICT (lineage_id) DO UPDATE SET
       enrolled_at = MIN(enrolled_at, excluded.enrolled_at),
       first_due_source = CASE WHEN excluded.first_due_at IS NOT NULL
                                AND (first_due_at IS NULL OR excluded.first_due_at < first_due_at)
                               THEN excluded.first_due_source ELSE first_due_source END,
       first_due_at = CASE WHEN excluded.first_due_at IS NOT NULL
                            AND (first_due_at IS NULL OR excluded.first_due_at < first_due_at)
                           THEN excluded.first_due_at ELSE first_due_at END`
  ).run(lineageId, anchor, firstDue, firstDue ? source : null);
}

// The first probe: the node's discriminating items (those filed with the
// error they test), the first k by authoring order, plus one transfer item —
// one whose node set spans this node and another, preferring another node
// nothing has targeted yet (practised against unpractised). A node with no
// discriminating record (everything filed before CLOSE recorded one) falls
// back to k drawn weak-weighted, so its gap 1 is never an empty draw.
function chooseDraw(
  db: DatabaseSync,
  items: LiveVersion[],
  nodeKey: string,
  k: number,
  targetedNodes: Set<string>,
  rng: () => number
): LiveVersion[] {
  const spans = items.filter((i) => i.node_keys.length >= 2);
  const transfer =
    spans.find((i) => i.node_keys.some((nk) => nk !== nodeKey && !targetedNodes.has(nk))) ?? spans[0] ?? null;
  const rest = items.filter((i) => i !== transfer);
  const discriminating = rest.filter((i) => (i.tests_error ?? "").trim() !== "");
  const core =
    discriminating.length > 0
      ? discriminating.slice(0, k)
      : weightedSampleWithoutReplacement(
          rest,
          computeWeakWeights(db, rest.map((i) => ({ id: i.question_id, lineage_id: i.lineage_id }))),
          k,
          rng
        );
  return transfer ? [...core, transfer] : core;
}

interface Resolution {
  result: "pass" | "fail";
  resolvedMs: number;
  gap2Days: number | null;
}

export interface RefreshOptions {
  now?: Date;
  rng?: () => number;
}

// Brings the stored half of the loop up to `now`: takes every draw whose gap
// 1 has come, adds items authored onto a drawn node since, and records the
// result of every draw whose probes are in. Idempotent; runs on every read
// that depends on due-ness, so nothing needs a timer.
export function refreshRetention(db: DatabaseSync, opts: RefreshOptions = {}): void {
  const nowMs = (opts.now ?? new Date()).getTime();
  const rng = opts.rng ?? Math.random;

  inSavepoint(db, "retention_refresh", () => {
    let targets = allTargets(db);
    if (targets.length === 0) return;
    const versions = liveVersions(db);
    const targetedNodes = new Set(targets.map((t) => t.node_key));
    const k = drawK(db);
    const floorMs = clampFloorMs(db);
    const insertMember = db.prepare(
      "INSERT OR IGNORE INTO retention_schedule (node_key, lineage_id, retention_target, role) VALUES (?, ?, ?, ?)"
    );

    // 1. A drawn, unresolved target whose draw items have all gone (retired,
    //    or moved off the node) draws again rather than hold its reserve.
    const members = memberships(db);
    for (const t of targets) {
      if (!t.drawn_at || t.probe_result) continue;
      const draw = members.filter(
        (m) => m.node_key === t.node_key && m.retention_target === t.retention_target && m.role === "draw"
      );
      if (draw.some((m) => schedulable(versions.get(m.lineage_id)) && versions.get(m.lineage_id)!.node_keys.includes(t.node_key))) {
        continue;
      }
      db.prepare("DELETE FROM retention_schedule WHERE node_key = ? AND retention_target = ?").run(t.node_key, t.retention_target);
      db.prepare("UPDATE node_retention_target SET drawn_at = NULL, draw_k = NULL WHERE id = ?").run(t.id);
    }
    targets = allTargets(db);

    // 2. Gap 1 has come: take the draw. A node with no items yet waits —
    //    an empty draw could never resolve.
    for (const t of targets) {
      if (t.drawn_at || storedMs(t.gap1_due_at) > nowMs) continue;
      const items = nodeItems(versions, t.node_key);
      if (items.length === 0) continue;
      const draw = new Set(chooseDraw(db, items, t.node_key, k, targetedNodes, rng).map((i) => i.lineage_id));
      for (const item of items) {
        const role = draw.has(item.lineage_id) ? "draw" : "reserve";
        insertMember.run(t.node_key, item.lineage_id, t.retention_target, role);
        enroll(db, item.lineage_id, t.set_at, role === "draw" ? toSqliteDatetime(gap1MsFor(t, item)) : null, "draw");
      }
      db.prepare("UPDATE node_retention_target SET drawn_at = ?, draw_k = ? WHERE id = ?").run(
        toSqliteDatetime(nowMs),
        k,
        t.id
      );
    }
    targets = allTargets(db);

    // 3. Items authored onto a drawn node since its draw join as reserve. If
    //    the draw already has a result, they take its reserve due at once.
    const memberSet = new Set(memberships(db).map((m) => `${targetKey(m.node_key, m.retention_target)}\u0000${m.lineage_id}`));
    for (const t of targets) {
      if (!t.drawn_at) continue;
      for (const item of nodeItems(versions, t.node_key)) {
        if (memberSet.has(`${targetKey(t.node_key, t.retention_target)}\u0000${item.lineage_id}`)) continue;
        insertMember.run(t.node_key, item.lineage_id, t.retention_target, "reserve");
        enroll(db, item.lineage_id, t.set_at, null, null);
        if (t.probe_result && t.probe_resolved_at) {
          const due = Math.max(reserveDue(t, targets, floorMs), gap1MsFor(t, item));
          enroll(db, item.lineage_id, t.set_at, toSqliteDatetime(due), t.probe_result === "pass" ? "reserve_pass" : "reserve_fail");
        }
      }
    }

    // 4. Record the result of every draw whose probes are in. Any miss in
    //    the draw fails it: the discriminating items were chosen one per
    //    hypothesis, so one failing is a live hypothesis, not noise.
    const reviews = reviewsByLineage(db);
    const items = new Map((db.prepare("SELECT * FROM retention_item").all() as unknown as ItemRow[]).map((i) => [i.lineage_id, i]));
    const allMembers = memberships(db);
    for (const t of targets) {
      if (!t.drawn_at || t.probe_result) continue;
      const draw = allMembers.filter(
        (m) =>
          m.node_key === t.node_key &&
          m.retention_target === t.retention_target &&
          m.role === "draw" &&
          schedulable(versions.get(m.lineage_id)) &&
          versions.get(m.lineage_id)!.node_keys.includes(t.node_key)
      );
      const resolution = resolveDraw(t, draw, reviews, items, versions, targets, floorMs);
      if (!resolution) continue;
      db.prepare(
        "UPDATE node_retention_target SET probe_result = ?, probe_resolved_at = ?, gap2_days = ? WHERE id = ?"
      ).run(resolution.result, toSqliteDatetime(resolution.resolvedMs), resolution.gap2Days, t.id);
      const resolved: TargetRow = {
        ...t,
        probe_result: resolution.result,
        probe_resolved_at: toSqliteDatetime(resolution.resolvedMs),
        gap2_days: resolution.gap2Days,
      };
      const due = reserveDue(resolved, targets, floorMs);
      const source = resolution.result === "pass" ? "reserve_pass" : "reserve_fail";
      for (const m of allMembers) {
        if (m.node_key !== t.node_key || m.retention_target !== t.retention_target || m.role !== "reserve") continue;
        const version = versions.get(m.lineage_id);
        const own = version ? Math.max(due, gap1MsFor(t, version)) : due;
        enroll(db, m.lineage_id, t.set_at, toSqliteDatetime(own), source);
      }
    }
  });
}

// When a draw's reserve first comes due. Pass: at the node's gap-2 interval
// from the result, clamped to the node's open targets like any other gap —
// and nothing else: no easiness, no repetition count; the item stays
// never_demonstrated until a real attempt starts SM2 from a real grade.
// Fail: now, as relearn material for the node.
function reserveDue(t: TargetRow, targets: TargetRow[], floorMs: number): number {
  const resolvedMs = storedMs(t.probe_resolved_at!);
  if (t.probe_result === "fail") return resolvedMs;
  const open = targets.filter((o) => o.node_key === t.node_key).map((o) => storedMs(o.needs_last_until));
  return clampToTargets(resolvedMs, resolvedMs + (t.gap2_days ?? RELEARN_INTERVAL_DAYS) * DAY_MS, open, floorMs);
}

function resolveDraw(
  t: TargetRow,
  draw: MembershipRow[],
  reviews: Map<string, Review[]>,
  items: Map<string, ItemRow>,
  versions: Map<string, LiveVersion>,
  targets: TargetRow[],
  floorMs: number
): Resolution | null {
  if (draw.length === 0) return null;
  const probes = draw.map((m) => {
    const gap1Ms = gap1MsFor(t, versions.get(m.lineage_id)!);
    return { lineage: m.lineage_id, gap1Ms, probe: (reviews.get(m.lineage_id) ?? []).find((r) => r.ms >= gap1Ms) ?? null };
  });

  const misses = probes.filter((p) => p.probe && p.probe.quality < PASSING_QUALITY);
  if (misses.length > 0) {
    return { result: "fail", resolvedMs: Math.min(...misses.map((p) => p.probe!.ms)), gap2Days: null };
  }
  if (probes.some((p) => !p.probe)) return null;

  // The node's gap-2 interval: the soonest any drawn item comes back after
  // its own probe — SM2's next gap for it, clamped like every gap.
  const gaps = probes.map(({ lineage, gap1Ms, probe }) => {
    const item = items.get(lineage);
    const version = versions.get(lineage)!;
    const firstDueMs = item?.first_due_at ? storedMs(item.first_due_at) : gap1Ms;
    const anchorMs = item ? anchorMsFor(item, version) : storedMs(t.set_at);
    const r = replay(reviews.get(lineage) ?? [], firstDueMs, anchorMs, probe!.ms);
    const open = openTargetsFor(version, targets);
    const due = clampToTargets(probe!.ms, probe!.ms + r.state.interval_days * DAY_MS, open, floorMs);
    return (due - probe!.ms) / DAY_MS;
  });
  return { result: "pass", resolvedMs: Math.max(...probes.map((p) => p.probe!.ms)), gap2Days: Math.min(...gaps) };
}

// Every target date that applies to an item: the targets on each of its nodes.
function openTargetsFor(version: LiveVersion, targets: TargetRow[]): number[] {
  return targets.filter((t) => version.node_keys.includes(t.node_key)).map((t) => storedMs(t.needs_last_until));
}

// Gap 1 runs from teaching. For an item written before the target was set,
// that is the target's own set_at. An item written later — a target set
// before its node had any items, or an item added to the node afterwards —
// cannot have been taught before it existed, so its gap 1 runs from its
// authoring, by the same Cepeda ratio over the time it has left. Without
// this, the session check on a freshly written item would count as its
// first probe.
function gap1MsFor(t: TargetRow, version: LiveVersion): number {
  const createdMs = storedMs(version.lineage_created_at);
  if (createdMs <= storedMs(t.set_at)) return storedMs(t.gap1_due_at);
  const span = Math.max(storedMs(t.needs_last_until) - createdMs, 0);
  return createdMs + firstGapRatio(span / DAY_MS) * span;
}

// Where an item's first retention gap is measured from: its node's teaching,
// but never before the item existed, and — for reserve a failed draw brought
// forward — never before that failure. A failed draw is evidence the node did
// not survive, so relearning starts the clock again; nothing earns credit for
// surviving since the original teaching.
function anchorMsFor(item: ItemRow, version: LiveVersion): number {
  const anchor = Math.max(storedMs(item.enrolled_at), storedMs(version.lineage_created_at));
  return item.first_due_source === "reserve_fail" && item.first_due_at
    ? Math.max(anchor, storedMs(item.first_due_at))
    : anchor;
}

// ----------------------------------------------------------------------------
// Schedules
// ----------------------------------------------------------------------------

// never_demonstrated: no retention review yet — a drawn item awaiting its
//   first probe, or a reserve item brought in by a passing draw.
// relearn: not yet retained — a reserve item brought forward by a failed draw,
//   or an item whose retention reviews have never passed. Go teach it.
// lapsed: failed after passing before — stale; resurface it sooner.
// decayed: last review passed, its interval has run.
export type DueReason = "never_demonstrated" | "relearn" | "lapsed" | "decayed";

export interface ItemTarget {
  node_key: string;
  retention_target: string;
  needs_last_until: string;
  target_source: "engine" | "tutor_direct";
  role: "draw" | "reserve" | null; // null: not drawn yet
  probe: "not_drawn" | "pending" | "pass" | "fail";
}

export interface ItemSchedule {
  lineage_id: string;
  question_id: string;
  node_key: string | null;
  node_keys: string[];
  // scheduled: has a due date. held: a reserve item waiting on its node's
  // draw. ended: retired — the schedule stopped, the history stays.
  status: "scheduled" | "held" | "ended";
  due_at: string | null;
  reason: DueReason | null;
  first_due_at: string | null;
  interval_days: number | null;
  easiness: number | null;
  repetitions: number;
  retention_reviews: number;
  last_reviewed_at: string | null;
  last_quality: number | null;
  overdue_days: number | null;
  overdue_ratio: number | null;
  targets: ItemTarget[];
}

export function computeSchedules(db: DatabaseSync, now: Date = new Date()): ItemSchedule[] {
  const nowMs = now.getTime();
  const versions = liveVersions(db);
  const targets = allTargets(db);
  const byTarget = new Map(targets.map((t) => [targetKey(t.node_key, t.retention_target), t]));
  const reviews = reviewsByLineage(db);
  const floorMs = clampFloorMs(db);
  const memberByLineage = new Map<string, MembershipRow[]>();
  for (const m of memberships(db)) {
    const list = memberByLineage.get(m.lineage_id) ?? [];
    list.push(m);
    memberByLineage.set(m.lineage_id, list);
  }

  const out: ItemSchedule[] = [];
  for (const item of db.prepare("SELECT * FROM retention_item ORDER BY lineage_id").all() as unknown as ItemRow[]) {
    const version = versions.get(item.lineage_id);
    if (!version) continue;
    const mine = (memberByLineage.get(item.lineage_id) ?? []).filter(
      (m) => byTarget.has(targetKey(m.node_key, m.retention_target)) && version.node_keys.includes(m.node_key)
    );
    const itemTargets: ItemTarget[] = targets
      .filter((t) => version.node_keys.includes(t.node_key))
      .map((t) => {
        const m = mine.find((x) => x.node_key === t.node_key && x.retention_target === t.retention_target);
        return {
          node_key: t.node_key,
          retention_target: t.retention_target,
          needs_last_until: t.needs_last_until,
          target_source: t.target_source,
          role: m?.role ?? null,
          probe: !t.drawn_at ? "not_drawn" : (t.probe_result ?? "pending"),
        };
      });

    const lineageReviews = reviews.get(item.lineage_id) ?? [];
    const anchorMs = anchorMsFor(item, version);
    const base: ItemSchedule = {
      lineage_id: item.lineage_id,
      question_id: version.question_id,
      node_key: version.node_keys[0] ?? null,
      node_keys: version.node_keys,
      status: "held",
      due_at: null,
      reason: null,
      first_due_at: item.first_due_at,
      interval_days: null,
      easiness: null,
      repetitions: 0,
      retention_reviews: 0,
      last_reviewed_at: null,
      last_quality: null,
      overdue_days: null,
      overdue_ratio: null,
      targets: itemTargets,
    };
    if (!schedulable(version)) {
      out.push({ ...base, status: "ended" });
      continue;
    }
    if (!item.first_due_at) {
      // Held only while some draw it belongs to is still to come; an item
      // whose node keys moved off every target has nothing holding it.
      if (mine.length > 0) out.push(base);
      continue;
    }

    const firstDueMs = storedMs(item.first_due_at);
    const r = replay(lineageReviews, firstDueMs, anchorMs);
    let dueMs: number;
    let fromMs: number;
    let reason: DueReason;
    if (r.count === 0) {
      dueMs = firstDueMs;
      fromMs = Math.min(anchorMs, firstDueMs);
      reason = item.first_due_source === "reserve_fail" ? "relearn" : "never_demonstrated";
    } else {
      fromMs = r.lastMs!;
      dueMs = clampToTargets(fromMs, fromMs + r.state.interval_days * DAY_MS, openTargetsFor(version, targets), floorMs);
      reason = r.lastQuality! >= PASSING_QUALITY ? "decayed" : r.everPassed ? "lapsed" : "relearn";
    }

    // A draw this item belongs to that has not had its probe yet still wants
    // it at that draw's gap 1, whatever SM2 says.
    for (const m of mine) {
      const t = byTarget.get(targetKey(m.node_key, m.retention_target))!;
      if (m.role !== "draw" || !t.drawn_at || t.probe_result) continue;
      const gap1Ms = gap1MsFor(t, version);
      if (!lineageReviews.some((x) => x.ms >= gap1Ms)) dueMs = Math.min(dueMs, gap1Ms);
    }

    const intervalDays = Math.max((dueMs - fromMs) / DAY_MS, 0);
    const overdueDays = (nowMs - dueMs) / DAY_MS;
    out.push({
      ...base,
      status: "scheduled",
      due_at: toSqliteDatetime(dueMs),
      reason,
      interval_days: intervalDays,
      easiness: r.count > 0 ? r.state.easiness : null,
      repetitions: r.state.repetitions,
      retention_reviews: r.count,
      last_reviewed_at: r.lastMs !== null ? toSqliteDatetime(r.lastMs) : null,
      last_quality: r.lastQuality,
      overdue_days: overdueDays,
      overdue_ratio: overdueDays / Math.max(intervalDays, 1),
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// get_due_items
// ----------------------------------------------------------------------------

export interface DueItem extends ItemSchedule {
  // Kept from the identity-keyed shape: id is the item (its lineage),
  // identity_key its primary node key, retention_target / target_source the
  // nearest open target, last_result its last retention review.
  id: string;
  identity_key: string | null;
  retention_target: string | null;
  target_source: "engine" | "tutor_direct" | null;
  last_result: "pass" | "fail" | "never_attempted";
}

// Most overdue first, measured against the gap the item was meant to survive:
// two days late on a one-day gap is further gone than three days late on a
// sixty-day one. Ties fall back to the earlier due date.
function byOverdue(a: ItemSchedule, b: ItemSchedule): number {
  return (
    (b.overdue_ratio ?? 0) - (a.overdue_ratio ?? 0) ||
    (a.due_at ?? "").localeCompare(b.due_at ?? "") ||
    a.lineage_id.localeCompare(b.lineage_id)
  );
}

// identity_key is the node the row is due on behalf of — the one owning the
// nearest open target — so a tutor grouping rows by identity_key re-teaches
// the right node when an item spans several. Without an open target it is
// the primary node key. targets[] carries the whole picture.
function toDueItem(s: ItemSchedule, nowMs: number): DueItem {
  const nearest = s.targets
    .filter((t) => storedMs(t.needs_last_until) > nowMs)
    .sort((a, b) => a.needs_last_until.localeCompare(b.needs_last_until))[0];
  return {
    ...s,
    id: s.lineage_id,
    identity_key: nearest?.node_key ?? s.node_key,
    retention_target: nearest?.retention_target ?? null,
    target_source: nearest?.target_source ?? null,
    last_result: s.last_quality === null ? "never_attempted" : s.last_quality >= PASSING_QUALITY ? "pass" : "fail",
  };
}

export function getDueItems(
  db: DatabaseSync,
  opts: { before?: string; limit?: number; offset?: number; node_key?: string; now?: Date } = {}
): { total: number; items: DueItem[]; has_more: boolean } {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  // Accepts both ISO-8601 (with T separator) and space-separated formats —
  // the latter is exactly what due_at itself is returned as, so
  // parseCallerDateMs forces UTC on that shape rather than letting the
  // server's local timezone shift it.
  const beforeMs = opts.before ? parseCallerDateMs(opts.before, "before") : nowMs;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  refreshRetention(db, { now });
  const nodeKey = opts.node_key;
  const due = computeSchedules(db, now)
    .filter((s) => s.status === "scheduled" && storedMs(s.due_at!) <= beforeMs)
    // Segment-aware, like every slug match: node:ebbing11e:2 is not 2.4.
    .filter((s) => !nodeKey || s.node_keys.some((k) => k === nodeKey || k.startsWith(`${nodeKey}:`)))
    .sort(byOverdue);

  const items = due.slice(offset, offset + limit).map((s) => toDueItem(s, nowMs));
  return { total: due.length, items, has_more: offset + items.length < due.length };
}

// ----------------------------------------------------------------------------
// Due-ness for item selection
// ----------------------------------------------------------------------------

export type DueMode = "off" | "weight" | "gate";

export const DUE_MODES: readonly DueMode[] = ["off", "weight", "gate"];

export interface DueInfo {
  due: boolean;
  overdue_ratio: number;
}

// One refresh and one pass over every schedule; draws call this once per
// draw, not per item.
export function dueInfoByLineage(db: DatabaseSync, now: Date = new Date()): Map<string, DueInfo> {
  refreshRetention(db, { now });
  const nowMs = now.getTime();
  const out = new Map<string, DueInfo>();
  for (const s of computeSchedules(db, now)) {
    if (s.status !== "scheduled") continue;
    out.set(s.lineage_id, { due: storedMs(s.due_at!) <= nowMs, overdue_ratio: s.overdue_ratio ?? 0 });
  }
  return out;
}

// A casual draw's weight multiplier: a due item counts two to four times an
// undue one, more the further overdue; everything else is unchanged.
export function dueWeightFactor(info: DueInfo | undefined): number {
  if (!info || !info.due) return 1;
  return 2 + Math.min(Math.max(info.overdue_ratio, 0), 2);
}

// A gated draw's order: due items only, most overdue first. `tiebreak`
// (weak weights, when the draw is weak_weighted) orders items equally overdue.
export function rankByDue<T extends { lineage_id: string }>(
  pool: T[],
  due: Map<string, DueInfo>,
  tiebreak?: number[]
): T[] {
  return pool
    .map((item, i) => ({ item, info: due.get(item.lineage_id), w: tiebreak?.[i] ?? 0 }))
    .filter((x) => x.info?.due)
    .sort(
      (a, b) =>
        b.info!.overdue_ratio - a.info!.overdue_ratio || b.w - a.w || a.item.lineage_id.localeCompare(b.item.lineage_id)
    )
    .map((x) => x.item);
}
