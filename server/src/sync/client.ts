import type { AppContext } from "../http/app.js";
import { applyPullResponse, upsertBankContent, NEVER_PULLED, type PullRequest, type PullResponse, type PushRequest, type PushResult, type TemplateDrawResponse } from "../domain/sync.js";

export interface SyncRuntime {
  online: boolean;
  connectivityTimer: ReturnType<typeof setInterval> | null;
  syncTimer: ReturnType<typeof setInterval> | null;
}

export function createSyncRuntime(): SyncRuntime {
  return { online: false, connectivityTimer: null, syncTimer: null };
}

export async function checkConnectivity(ctx: AppContext, runtime: SyncRuntime): Promise<boolean> {
  if (!ctx.env.remoteUrl) { runtime.online = false; return false; }
  try {
    const res = await fetch(`${ctx.env.remoteUrl}/sync/health`, { signal: AbortSignal.timeout(5000) });
    runtime.online = res.ok;
  } catch {
    runtime.online = false;
  }
  return runtime.online;
}

export async function runSync(ctx: AppContext, runtime: SyncRuntime): Promise<{ pushed: number; pulled: number }> {
  if (!ctx.env.remoteUrl) return { pushed: 0, pulled: 0 };
  const { db, env, node } = ctx;
  let pushed = 0;
  let pushOk = true; // true when push succeeded, or was skipped because outbox was empty

  try {
    // Push
    const outboxRows = db.prepare("SELECT id, entity_type, entity_id, payload FROM outbox WHERE tries < 5")
      .all() as { id: number; entity_type: string; entity_id: string; payload: string }[];
    if (outboxRows.length > 0) {
      const pushBody: PushRequest = { node_id: node.id, protocol_version: node.protocol_version, attempts: [], responses: [], grades: [] };
      for (const row of outboxRows) {
        const payload = JSON.parse(row.payload);
        if (row.entity_type === "attempt") pushBody.attempts.push(payload);
        else if (row.entity_type === "response") pushBody.responses.push(payload);
        else pushBody.grades.push(payload);
      }
      const pushRes = await fetch(`${env.remoteUrl}/sync/push`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pushBody),
        signal: AbortSignal.timeout(15000),
      });
      if (pushRes.ok) {
        const result = (await pushRes.json()) as PushResult;
        const cleared = new Set([...result.accepted, ...result.duplicate]);
        for (const row of outboxRows) {
          if (cleared.has(row.entity_id)) {
            db.prepare("DELETE FROM outbox WHERE id = ?").run(row.id);
          } else {
            const rejection = result.rejected.find((r) => r.id === row.entity_id);
            db.prepare("UPDATE outbox SET tries = tries + 1, last_try_at = datetime('now'), last_error = ? WHERE id = ?")
              .run(rejection?.detail ?? rejection?.reason ?? "not acknowledged", row.id);
          }
        }
        pushed = result.accepted.length;
        db.prepare("UPDATE sync_state SET last_push_at = datetime('now'), last_error = NULL WHERE id = 1").run();
      } else {
        pushOk = false;
        db.prepare("UPDATE sync_state SET last_error = ? WHERE id = 1").run(`push failed: HTTP ${pushRes.status}`);
      }
    }

    // Backfill pull: slices recorded while offline still sit at the
    // NEVER_PULLED sentinel and have no historical content. The regular pull
    // below is incremental off the global last_pull_at, which would only ever
    // bring them content created since the last successful sync — so those
    // slices get their own full (since: null) pull first.
    const sentinelSlices = (
      db.prepare("SELECT tag_slug FROM local_slice WHERE pulled_at = ?").all(NEVER_PULLED) as {
        tag_slug: string;
      }[]
    ).map((r) => r.tag_slug);
    let backfilled = 0;
    if (sentinelSlices.length > 0) {
      const backfillBody: PullRequest = {
        node_id: node.id, protocol_version: node.protocol_version, slices: sentinelSlices,
        since: null, include_grades_for_node: false,
      };
      const backfillRes = await fetch(`${env.remoteUrl}/sync/pull`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backfillBody),
        signal: AbortSignal.timeout(15000),
      });
      if (backfillRes.ok) {
        const backfillResponse = (await backfillRes.json()) as PullResponse;
        backfilled = applyPullResponse(db, backfillResponse, sentinelSlices).questions_applied;
      }
    }

    // Pull
    const state = db.prepare("SELECT last_pull_at FROM sync_state WHERE id = 1").get() as { last_pull_at: string | null };
    const slices = (db.prepare("SELECT tag_slug FROM local_slice").all() as { tag_slug: string }[]).map((r) => r.tag_slug);
    const pullBody: PullRequest = {
      node_id: node.id, protocol_version: node.protocol_version, slices,
      since: state.last_pull_at, include_grades_for_node: true,
    };
    const pullRes = await fetch(`${env.remoteUrl}/sync/pull`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pullBody),
      signal: AbortSignal.timeout(15000),
    });
    let pulled = 0;
    if (pullRes.ok) {
      const response = (await pullRes.json()) as PullResponse;
      const applied = applyPullResponse(db, response, slices);
      pulled = applied.questions_applied;
      if (pushOk) {
        db.prepare(
          "UPDATE sync_state SET last_pull_at = ?, remote_protocol_version = ?, last_error = NULL WHERE id = 1"
        ).run(applied.cursor, response.protocol_version);
      } else {
        // A preceding push failure indicates a real durability problem (stuck outbox rows).
        // Don't let a successful pull clobber that error signal.
        db.prepare(
          "UPDATE sync_state SET last_pull_at = ?, remote_protocol_version = ? WHERE id = 1"
        ).run(applied.cursor, response.protocol_version);
      }
    } else {
      db.prepare("UPDATE sync_state SET last_error = ? WHERE id = 1").run(`pull failed: HTTP ${pullRes.status}`);
    }

    runtime.online = true;
    return { pushed, pulled: pulled + backfilled };
  } catch (err) {
    runtime.online = false;
    db.prepare("UPDATE sync_state SET last_error = ? WHERE id = 1").run(String(err));
    return { pushed, pulled: 0 };
  }
}

// Scoped, synchronous companion to addSlice: does a full (since: null) pull
// of just this one tag slug and applies it immediately, so a newly added
// slice's content shows up right away instead of waiting for the next
// periodic runSync (which pulls all held slices, incrementally).
export async function pullOneSlice(ctx: AppContext, tagSlug: string): Promise<void> {
  if (!ctx.env.remoteUrl) throw new Error("no remote_url configured");
  const pullBody: PullRequest = {
    node_id: ctx.node.id, protocol_version: ctx.node.protocol_version,
    slices: [tagSlug], since: null, include_grades_for_node: false,
  };
  const res = await fetch(`${ctx.env.remoteUrl}/sync/pull`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pullBody),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
  const response = (await res.json()) as PullResponse;
  applyPullResponse(ctx.db, response, [tagSlug]);
}

// ----------------------------------------------------------------------------
// Daily-draw proxy: a local node has no bank content of its own to draw a
// daily question/quiz from, so it asks canonical to resolve today's draw and
// mirrors the returned bank content (questions/tags) plus the daily_draw/
// daily_draw_question rows locally, atomically, using canonical's exact IDs
// so createDailyAttempt's later FK references resolve.
// ----------------------------------------------------------------------------

export interface DailyDrawSyncResponse {
  protocol_version: number;
  daily_draw_id: string;
  draw_date: string;
  kind: "question" | "quiz";
  tags: PullResponse["tags"];
  questions: Record<string, unknown>[];
  question_order: string[]; // question ids, in draw order
  exclusion_relaxed: number | null;
  short_draw: boolean;
  requested: number;
  returned: number;
}

export async function fetchAndApplyDailyDraw(
  ctx: AppContext,
  kind: "question" | "quiz"
): Promise<{
  daily_draw_id: string;
  questions: { id: string; lineage_id: string; type: "mc" | "written" }[];
  short_draw: boolean;
  requested: number;
  returned: number;
}> {
  if (!ctx.env.remoteUrl) throw new Error("no remote_url configured");
  const res = await fetch(`${ctx.env.remoteUrl}/sync/daily-draw`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`daily-draw fetch failed: HTTP ${res.status}`);
  const payload = (await res.json()) as DailyDrawSyncResponse;

  const db = ctx.db;
  db.exec("BEGIN");
  try {
    upsertBankContent(db, payload.tags, payload.questions);
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(
      payload.daily_draw_id, payload.draw_date, payload.kind
    );
    db.prepare("DELETE FROM daily_draw_question WHERE daily_draw_id = ?").run(payload.daily_draw_id);
    const insertQ = db.prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, ?)");
    payload.question_order.forEach((qid, i) => insertQ.run(payload.daily_draw_id, qid, i));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const questionById = new Map((payload.questions as { id: string; lineage_id: string; type: "mc" | "written" }[]).map((q) => [q.id, q]));
  const questions = payload.question_order.map((qid) => {
    const q = questionById.get(qid);
    if (!q) throw new Error(`daily-draw response missing question ${qid} in its own questions array`);
    return { id: q.id, lineage_id: q.lineage_id, type: q.type };
  });

  return {
    daily_draw_id: payload.daily_draw_id,
    questions,
    short_draw: payload.short_draw,
    requested: payload.requested,
    returned: payload.returned,
  };
}

// Cloud test: the local node holds the template row (templates always sync)
// but not the slices behind it. Ask canonical to resolve the draw on the full
// bank and mirror exactly the drawn questions (+ their tag closure) locally so
// the attempt's responses have real question rows to reference and the
// attempt pushes up like any other.
export async function fetchAndApplyTemplateDraw(
  ctx: AppContext,
  templateId: string
): Promise<{ questions: { id: string; lineage_id: string; type: "mc" | "written" }[]; short_draw: boolean; requested: number; returned: number; mix_adjusted: boolean }> {
  if (!ctx.env.remoteUrl) throw new Error("no remote_url configured");
  const res = await fetch(`${ctx.env.remoteUrl}/sync/template-draw`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: templateId }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`template-draw fetch failed: HTTP ${res.status}`);
  const payload = (await res.json()) as TemplateDrawResponse;

  const db = ctx.db;
  db.exec("BEGIN");
  try {
    upsertBankContent(db, payload.tags, payload.questions);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const byId = new Map((payload.questions as { id: string; lineage_id: string; type: "mc" | "written" }[]).map((q) => [q.id, q]));
  const questions = payload.question_order.map((qid) => {
    const q = byId.get(qid);
    if (!q) throw new Error(`template-draw response missing question ${qid} in its own questions array`);
    return { id: q.id, lineage_id: q.lineage_id, type: q.type };
  });
  return { questions, short_draw: payload.short_draw, requested: payload.requested, returned: payload.returned, mix_adjusted: payload.mix_adjusted };
}

export function startSyncBackground(ctx: AppContext, runtime: SyncRuntime): void {
  if (ctx.env.role !== "local") return;

  runtime.connectivityTimer = setInterval(async () => {
    const wasOnline = runtime.online;
    const isOnline = await checkConnectivity(ctx, runtime);
    if (!wasOnline && isOnline) await runSync(ctx, runtime); // offline -> online trigger
  }, 30_000);

  const row = ctx.db.prepare("SELECT value FROM config WHERE key = 'sync_interval_sec'").get() as { value: string } | undefined;
  const intervalSec = row ? Number(JSON.parse(row.value)) : 300;
  runtime.syncTimer = setInterval(() => { void runSync(ctx, runtime); }, intervalSec * 1000);

  void runSync(ctx, runtime); // app-start trigger
}

export function stopSyncBackground(runtime: SyncRuntime): void {
  if (runtime.connectivityTimer) clearInterval(runtime.connectivityTimer);
  if (runtime.syncTimer) clearInterval(runtime.syncTimer);
}
