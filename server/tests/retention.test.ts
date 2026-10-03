import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestDb, insertTag } from "./helpers.js";
import {
  setRetentionTarget,
  getDueItems,
  computeSchedules,
  refreshRetention,
  qualityFor,
  sm2Step,
  clampToTargets,
  firstGapRatio,
  SM2_START,
  type DueItem,
} from "../src/domain/retention.js";
import { createQuestions, editQuestion, retireQuestion, type QuestionInput } from "../src/domain/questions.js";
import { createAttempt, answerResponse, submitAttempt, gradeResponse, gradeResponseByTutor, presentItem } from "../src/domain/attempts.js";
import { resolveDrawFromParams } from "../src/domain/draw.js";
import { setConfig } from "../src/domain/config.js";
import { DomainError } from "../src/domain/errors.js";

const DAY = 24 * 60 * 60 * 1000;
// Whole seconds: stored datetimes are second-precision.
const T0 = Math.floor((Date.now() - 40 * DAY) / 1000) * 1000;
const at = (days: number) => new Date(T0 + days * DAY);
const sqlTime = (days: number) => at(days).toISOString().replace("T", " ").slice(0, 19);
const daysOf = (sqlDatetime: string) => (Date.parse(sqlDatetime.replace(" ", "T") + "Z") - T0) / DAY;

const NODE = "node:chemistry:stoichiometry:moles";
const OTHER = "node:chemistry:stoichiometry:molar_mass";

let counter = 0;
function item(db: DatabaseSync, extra: Partial<QuestionInput> & { node_keys: string[] }): { id: string; lineage_id: string } {
  counter += 1;
  const isWritten = extra.type === "written";
  const result = createQuestions(db, [
    {
      type: isWritten ? "written" : "mc",
      prompt: `retention item ${counter} ${"xyz".repeat(counter % 7)} q${counter}`,
      tags: ["chem"],
      ...(isWritten
        ? { model_answer: "the answer" }
        : {
            choices: [
              { body: `right ${counter}`, is_correct: true },
              { body: `wrong ${counter}`, is_correct: false, misconception: "a wrong model" },
            ],
          }),
      ...extra,
    },
  ]);
  expect(result.rejected).toEqual([]);
  return result.created[0];
}

function liveId(db: DatabaseSync, lineageId: string): string {
  return (
    db
      .prepare("SELECT id FROM question WHERE lineage_id = ? ORDER BY version DESC LIMIT 1")
      .get(lineageId) as { id: string }
  ).id;
}

// Answers an item the way the app does, then dates the answer.
function answer(
  db: DatabaseSync,
  lineageId: string,
  days: number,
  how: { correct?: boolean; idk?: boolean; confidence?: "unsure" | "somewhat" | "confident" }
): string {
  const questionId = liveId(db, lineageId);
  const { attempt_id } = createAttempt(db, {
    node_id: "test",
    source: "adhoc",
    question_ids: [questionId],
    delivery_mode: "app_live",
  });
  const responseId = (db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string }).id;
  if (how.idk) {
    answerResponse(db, attempt_id, responseId, { idk: true, confidence: how.confidence ?? null });
  } else {
    const choice = db
      .prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = ?")
      .get(questionId, how.correct ? 1 : 0) as { id: string };
    answerResponse(db, attempt_id, responseId, { selected_choice_id: choice.id, confidence: how.confidence ?? null });
  }
  submitAttempt(db, attempt_id);
  db.prepare("UPDATE response SET answered_at = ? WHERE id = ?").run(sqlTime(days), responseId);
  return responseId;
}

function due(db: DatabaseSync, days: number, opts: { node_key?: string } = {}): Map<string, DueItem> {
  const { items } = getDueItems(db, { now: at(days), limit: 500, ...opts });
  return new Map(items.map((i) => [i.lineage_id, i]));
}

function target(db: DatabaseSync, label: string): Record<string, unknown> {
  return db.prepare("SELECT * FROM node_retention_target WHERE retention_target = ?").get(label) as Record<string, unknown>;
}

// A node as CLOSE leaves it: two discriminating items, one transfer item
// (its node set spans this node and an untaught one), two plain items.
function closedNode(db: DatabaseSync) {
  insertTag(db, "chem");
  const d1 = item(db, { node_keys: [NODE], tests_error: "moles confused with mass" });
  const d2 = item(db, { node_keys: [NODE], tests_error: "Avogadro applied twice" });
  const t1 = item(db, { node_keys: [NODE, OTHER] });
  const r1 = item(db, { node_keys: [NODE] });
  const r2 = item(db, { node_keys: [NODE] });
  // A two-week target, set at teaching: gap 1 = 30% = 4.2 days.
  setRetentionTarget(
    db,
    { identity_key: NODE, retention_target: "ch3-test", target_source: "engine", needs_last_until: sqlTime(14) },
    at(0)
  );
  return { d1, d2, t1, r1, r2 };
}

// ----------------------------------------------------------------------------

describe("outcome → SM2 quality", () => {
  it("follows the table: confident-wrong worst, idk with low-confidence-wrong", () => {
    const q = (score: number | null, confidence: "unsure" | "somewhat" | "confident" | null, idk = false) =>
      qualityFor({ idk, score, confidence });
    expect([q(1, "confident"), q(1, "somewhat"), q(1, "unsure")]).toEqual([5, 4, 3]);
    expect([q(0, "unsure"), q(0, "somewhat"), q(0, "confident")]).toEqual([2, 1, 0]);
    expect(q(0, "confident", true)).toBe(1);
    expect(q(null, null, true)).toBe(1);
  });

  it("reads a missing confidence as the middle level, a partial as a miss without misconception, no grade as nothing", () => {
    expect(qualityFor({ idk: false, score: 1, confidence: null })).toBe(4);
    expect(qualityFor({ idk: false, score: 0, confidence: null })).toBe(1);
    expect(qualityFor({ idk: false, score: 0.5, confidence: "confident" })).toBe(2);
    expect(qualityFor({ idk: false, score: null, confidence: "confident" })).toBeNull();
  });
});

describe("SM2 step", () => {
  it("grows the first pass from the gap it survived: gap 2 = gap 1 × easiness", () => {
    const s = sm2Step(SM2_START, 5, 4.2);
    expect(s.easiness).toBeCloseTo(2.6);
    expect(s.repetitions).toBe(1);
    expect(s.interval_days).toBeCloseTo(4.2 * 2.6);
  });

  it("does not grow the interval on an early review, credits a late one", () => {
    const settled = { easiness: 2.5, repetitions: 3, interval_days: 30 };
    expect(sm2Step(settled, 4, 2).interval_days).toBe(30);
    expect(sm2Step(settled, 4, 30).interval_days).toBeCloseTo(75);
    expect(sm2Step(settled, 4, 50).interval_days).toBeCloseTo(125);
  });

  it("lapses to a one-day relearn interval, costing more easiness the more confident the miss", () => {
    const settled = { easiness: 2.5, repetitions: 3, interval_days: 30 };
    const confident = sm2Step(settled, 0, 30);
    const unsure = sm2Step(settled, 2, 30);
    expect(confident.easiness).toBeCloseTo(1.7);
    expect(confident).toMatchObject({ repetitions: 0, interval_days: 1 });
    expect(unsure.easiness).toBeCloseTo(2.18);
    expect(sm2Step({ easiness: 1.3, repetitions: 0, interval_days: 1 }, 0, 1).easiness).toBe(1.3);
  });
});

describe("the target clamp", () => {
  it("never lets a gap step past target − ratio × (target − now), both as dates", () => {
    const review = T0;
    const t = T0 + 10 * DAY;
    const clamped = clampToTargets(review, review + 30 * DAY, [t], DAY);
    expect((clamped - review) / DAY).toBeCloseTo(10 * (1 - firstGapRatio(10)));
    // A shorter SM2 gap stands.
    expect(clampToTargets(review, review + 2 * DAY, [t], DAY)).toBe(review + 2 * DAY);
  });

  it("stops at the floor instead of converging on the target, and ignores a past target", () => {
    const review = T0;
    // 20h before the target: the latest permissible review is 14h away — under a day.
    expect(clampToTargets(review, review + 30 * DAY, [review + (20 / 24) * DAY], DAY)).toBe(review + 30 * DAY);
    expect(clampToTargets(review, review + 30 * DAY, [review - DAY], DAY)).toBe(review + 30 * DAY);
  });

  it("takes the tightest of several targets — the near one adds a pass, the far one still applies", () => {
    const review = T0;
    const near = clampToTargets(review, review + 60 * DAY, [review + 5 * DAY, review + 90 * DAY], DAY);
    expect((near - review) / DAY).toBeCloseTo(3.5);
  });
});

describe("set_retention_target", () => {
  it("attaches to a node key and puts gap 1 at the Cepeda share of the time left", () => {
    const db = openTestDb();
    const r = setRetentionTarget(
      db,
      { identity_key: NODE, retention_target: "t", target_source: "tutor_direct", needs_last_until: sqlTime(14) },
      at(0)
    );
    expect(r.node_key).toBe(NODE);
    expect(r.first_gap_days).toBeCloseTo(4.2);
    expect(daysOf(r.due_at)).toBeCloseTo(4.2, 3);
    expect(r.node_items).toBe(0);
  });

  it("refuses an identity that is not a node key", () => {
    const db = openTestDb();
    expect(() =>
      setRetentionTarget(db, { identity_key: "calc101:chain-rule", retention_target: "t", target_source: "engine", needs_last_until: sqlTime(7) })
    ).toThrow(DomainError);
  });

  it("starts the target over when the same label is set again", () => {
    const db = openTestDb();
    const { d1 } = closedNode(db);
    due(db, 4.3);
    expect(target(db, "ch3-test").drawn_at).not.toBeNull();
    setRetentionTarget(
      db,
      { identity_key: NODE, retention_target: "ch3-test", target_source: "engine", needs_last_until: sqlTime(30) },
      at(5)
    );
    expect(target(db, "ch3-test").drawn_at).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM retention_schedule").get() as { n: number }).n).toBe(0);
    // The item's own retention clock does not move later.
    expect(daysOf((db.prepare("SELECT first_due_at FROM retention_item WHERE lineage_id = ?").get(d1.lineage_id) as { first_due_at: string }).first_due_at)).toBeCloseTo(4.2, 3);
  });
});

describe("draw-k at the first probe", () => {
  it("draws nothing before gap 1, then the discriminating items plus one transfer item; the rest wait as reserve", () => {
    const db = openTestDb();
    const { d1, d2, t1, r1, r2 } = closedNode(db);

    expect(due(db, 4).size).toBe(0);
    expect(target(db, "ch3-test").drawn_at).toBeNull();

    const atGap1 = due(db, 4.3);
    expect([...atGap1.keys()].sort()).toEqual([d1.lineage_id, d2.lineage_id, t1.lineage_id].sort());
    for (const i of atGap1.values()) {
      expect(i.reason).toBe("never_demonstrated");
      expect(daysOf(i.due_at!)).toBeCloseTo(4.2, 3);
      expect(i.targets[0]).toMatchObject({ retention_target: "ch3-test", role: "draw", probe: "pending" });
    }
    const roles = Object.fromEntries(
      (db.prepare("SELECT lineage_id, role FROM retention_schedule").all() as { lineage_id: string; role: string }[]).map((r) => [r.lineage_id, r.role])
    );
    expect(roles[r1.lineage_id]).toBe("reserve");
    expect(roles[r2.lineage_id]).toBe("reserve");
    const held = computeSchedules(db, at(4.3)).filter((s) => s.status === "held").map((s) => s.lineage_id).sort();
    expect(held).toEqual([r1.lineage_id, r2.lineage_id].sort());
  });

  it("caps the discriminating items at k, first authored first", () => {
    const db = openTestDb();
    setConfig(db, "retention_draw_k", 1);
    const { d1, t1 } = closedNode(db);
    expect([...due(db, 4.3).keys()].sort()).toEqual([d1.lineage_id, t1.lineage_id].sort());
  });

  it("falls back to k weak-weighted items on a node with no discriminating record", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    setConfig(db, "retention_draw_k", 2);
    for (let i = 0; i < 5; i++) item(db, { node_keys: [NODE] });
    setRetentionTarget(db, { identity_key: NODE, retention_target: "t", target_source: "engine", needs_last_until: sqlTime(14) }, at(0));
    expect(due(db, 4.3).size).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM retention_schedule WHERE role = 'reserve'").get() as { n: number }).n).toBe(3);
  });

  it("waits for a node with no items rather than drawing nothing", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    setRetentionTarget(db, { identity_key: NODE, retention_target: "t", target_source: "engine", needs_last_until: sqlTime(14) }, at(0));
    due(db, 5);
    expect(target(db, "t").drawn_at).toBeNull();
    const late = item(db, { node_keys: [NODE] });
    expect([...due(db, 6).keys()]).toEqual([late.lineage_id]);
  });
});

describe("the draw's result", () => {
  it("pass: the reserve comes in at the node's gap-2 interval, still never_demonstrated", () => {
    const db = openTestDb();
    const { d1, d2, t1, r1, r2 } = closedNode(db);
    due(db, 4.3);
    answer(db, d1.lineage_id, 4.5, { correct: true, confidence: "confident" });
    answer(db, d2.lineage_id, 4.6, { correct: true, confidence: "somewhat" });
    expect(due(db, 4.65).has(r1.lineage_id)).toBe(false); // one probe still out
    answer(db, t1.lineage_id, 4.7, { correct: true, confidence: "confident" });

    expect(due(db, 5).size).toBe(0);
    const t = target(db, "ch3-test");
    expect(t.probe_result).toBe("pass");
    expect(daysOf(t.probe_resolved_at as string)).toBeCloseTo(4.7, 3);
    // Each drawn item's next gap is SM2's (elapsed × easiness) clamped to the
    // target: t1 (q5 at 4.7) → 4.7 × 2.6 = 12.2 days, clamped to 14 − 0.3 × 9.3
    // = 11.21. The node's gap 2 is the soonest of them: 6.51 days.
    expect(t.gap2_days as number).toBeCloseTo(6.51, 2);

    const later = due(db, 11.3);
    expect(later.size).toBe(5);
    expect(daysOf(later.get(d1.lineage_id)!.due_at!)).toBeCloseTo(11.15, 2);
    expect(later.get(d1.lineage_id)!.reason).toBe("decayed");
    expect(later.get(d1.lineage_id)!.easiness).toBeCloseTo(2.6);
    for (const r of [r1, r2]) {
      expect(daysOf(later.get(r.lineage_id)!.due_at!)).toBeCloseTo(11.21, 2);
      expect(later.get(r.lineage_id)!.reason).toBe("never_demonstrated");
      expect(later.get(r.lineage_id)!.easiness).toBeNull();
      expect(later.get(r.lineage_id)!.repetitions).toBe(0);
    }
  });

  it("fail: one miss fails the draw at once and brings the reserve forward as relearn material", () => {
    const db = openTestDb();
    const { d1, d2, t1, r1, r2 } = closedNode(db);
    due(db, 4.3);
    answer(db, d1.lineage_id, 4.5, { correct: false, confidence: "confident" });

    const now = due(db, 4.6);
    expect(target(db, "ch3-test").probe_result).toBe("fail");
    for (const r of [r1, r2]) {
      expect(now.get(r.lineage_id)!.reason).toBe("relearn");
      expect(daysOf(now.get(r.lineage_id)!.due_at!)).toBeCloseTo(4.5, 3);
    }
    // The other probes are still wanted.
    expect(now.get(d2.lineage_id)!.reason).toBe("never_demonstrated");
    expect(now.get(t1.lineage_id)!.reason).toBe("never_demonstrated");
    // The miss itself relearns in a day; it never passed, so it is relearn, not lapsed.
    expect(now.has(d1.lineage_id)).toBe(false);
    const missed = due(db, 5.6).get(d1.lineage_id)!;
    expect(daysOf(missed.due_at!)).toBeCloseTo(5.5, 3);
    expect(missed.reason).toBe("relearn");
  });

  it("an idk is a miss", () => {
    const db = openTestDb();
    const { d1 } = closedNode(db);
    due(db, 4.3);
    answer(db, d1.lineage_id, 4.5, { idk: true });
    due(db, 4.6);
    expect(target(db, "ch3-test").probe_result).toBe("fail");
  });

  it("a self grade never schedules; a judge's verdict on the same answer does", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    const w = item(db, { type: "written", node_keys: [NODE], tests_error: "units dropped" });
    setRetentionTarget(db, { identity_key: NODE, retention_target: "t", target_source: "tutor_direct", needs_last_until: sqlTime(14) }, at(0));
    due(db, 4.3);

    const questionId = liveId(db, w.lineage_id);
    const { attempt_id } = createAttempt(db, { node_id: "test", source: "adhoc", question_ids: [questionId], delivery_mode: "app_live" });
    const responseId = (db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string }).id;
    answerResponse(db, attempt_id, responseId, { response_text: "0.5 mol", confidence: "confident" });
    submitAttempt(db, attempt_id);
    db.prepare("UPDATE response SET answered_at = ? WHERE id = ?").run(sqlTime(4.5), responseId);
    gradeResponse(db, responseId, { grader: "self", score: 1 });

    expect(due(db, 4.6).get(w.lineage_id)!.retention_reviews).toBe(0);
    expect(target(db, "t").probe_result).toBeNull();

    gradeResponseByTutor(db, responseId, { grader: "judge", score: 1 });
    const after = computeSchedules(db, at(4.6)).find((s) => s.lineage_id === w.lineage_id)!;
    refreshRetention(db, { now: at(4.6) });
    expect(target(db, "t").probe_result).toBe("pass");
    expect(after.retention_reviews).toBe(1);
    expect(after.last_quality).toBe(5);
  });

  it("an item authored onto a drawn node joins the reserve, and takes the reserve's due once the draw has a result", () => {
    const db = openTestDb();
    const { d1, d2, t1, r1 } = closedNode(db);
    due(db, 4.3);
    const before = item(db, { node_keys: [NODE] });
    due(db, 4.4);
    expect((db.prepare("SELECT role FROM retention_schedule WHERE lineage_id = ?").get(before.lineage_id) as { role: string }).role).toBe("reserve");
    for (const d of [d1, d2, t1]) answer(db, d.lineage_id, 4.5, { correct: true, confidence: "confident" });
    const after = item(db, { node_keys: [NODE] });
    const later = due(db, 11.3);
    expect(later.get(after.lineage_id)!.due_at).toBe(later.get(r1.lineage_id)!.due_at);
    expect(later.get(before.lineage_id)!.due_at).toBe(later.get(r1.lineage_id)!.due_at);
  });
});

describe("SM2 after the first probe", () => {
  it("clamps to the target, stops at the floor, then runs free once the target is past", () => {
    const db = openTestDb();
    const { d1, d2, t1 } = closedNode(db);
    due(db, 4.3);
    for (const d of [d1, d2, t1]) answer(db, d.lineage_id, 4.5, { correct: true, confidence: "confident" });

    // q5 at 11.2: elapsed 6.7 × 2.7 = 18.1 days, clamped to 14 − 0.3 × 2.8 = 13.16.
    answer(db, d1.lineage_id, 11.2, { correct: true, confidence: "confident" });
    expect(daysOf(due(db, 13.2).get(d1.lineage_id)!.due_at!)).toBeCloseTo(13.16, 2);

    // q5 at 13.2: the clamp would land 0.56 days out — under the one-day
    // floor — so this was the last pre-target pass and SM2 runs free: the
    // interval does not grow on a 2-day elapsed (max(18.1, 2 × 2.8)).
    answer(db, d1.lineage_id, 13.2, { correct: true, confidence: "confident" });
    const free = computeSchedules(db, at(13.3)).find((s) => s.lineage_id === d1.lineage_id)!;
    expect(free.easiness).toBeCloseTo(2.8);
    expect(free.repetitions).toBe(3);
    expect(daysOf(free.due_at!)).toBeCloseTo(13.2 + 6.7 * 2.7, 2);
  });

  it("a review answered before the target was set refreshes the item but schedules nothing — gap 1 belongs to the target", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    const checked = item(db, { node_keys: [NODE], tests_error: "x" });
    answer(db, checked.lineage_id, -0.1, { correct: true, confidence: "confident" }); // the session's own check
    setRetentionTarget(db, { identity_key: NODE, retention_target: "t", target_source: "tutor_direct", needs_last_until: sqlTime(14) }, at(0));
    const now = due(db, 4.3).get(checked.lineage_id)!;
    expect(now.retention_reviews).toBe(0);
    expect(daysOf(now.due_at!)).toBeCloseTo(4.2, 3);
    // Its first retention review is measured from that check.
    answer(db, checked.lineage_id, 4.4, { correct: true, confidence: "confident" });
    const s = computeSchedules(db, at(4.5)).find((x) => x.lineage_id === checked.lineage_id)!;
    expect(s.retention_reviews).toBe(1);
    const unclamped = 4.4 + 4.5 * 2.6;
    const clamp = 14 - 0.3 * (14 - 4.4);
    expect(daysOf(s.due_at!)).toBeCloseTo(Math.min(unclamped, clamp), 2);
  });

  it("a reworded version (supersede via lineage_id) carries the history forward", () => {
    const db = openTestDb();
    const { d1, d2, t1 } = closedNode(db);
    due(db, 4.3);
    for (const d of [d1, d2, t1]) answer(db, d.lineage_id, 4.5, { correct: true, confidence: "confident" });
    const edited = editQuestion(db, liveId(db, d1.lineage_id), { prompt: "a reworded prompt about moles" });
    expect(edited.versioned).toBe(true);
    const s = due(db, 11.3).get(d1.lineage_id)!;
    expect(s.question_id).toBe(edited.id);
    expect(s.retention_reviews).toBe(1);
    expect(s.reason).toBe("decayed");
  });

  it("retire_question ends the schedule and keeps the history", () => {
    const db = openTestDb();
    const { d1, d2, t1, r1 } = closedNode(db);
    due(db, 4.3);
    for (const d of [d1, d2, t1]) answer(db, d.lineage_id, 4.5, { correct: true, confidence: "confident" });
    retireQuestion(db, liveId(db, r1.lineage_id), "bad item");
    expect(due(db, 11.3).has(r1.lineage_id)).toBe(false);
    const ended = computeSchedules(db, at(11.3)).find((s) => s.lineage_id === r1.lineage_id)!;
    expect(ended.status).toBe("ended");
    expect((db.prepare("SELECT COUNT(*) AS n FROM retention_schedule WHERE lineage_id = ?").get(r1.lineage_id) as { n: number }).n).toBe(1);
  });
});

describe("get_due_items", () => {
  it("orders by overdue relative to the gap, and filters by node segment-aware", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    const sec2 = item(db, { node_keys: ["node:chem_topic:2:atoms"], tests_error: "x" });
    const sec24 = item(db, { node_keys: ["node:chem_topic:2.4:weights"], tests_error: "y" });
    // Gap 1 of 0.3 days (a 1-day target) vs. 4.2 days (a 14-day target).
    setRetentionTarget(db, { identity_key: "node:chem_topic:2:atoms", retention_target: "quiz", target_source: "engine", needs_last_until: sqlTime(1) }, at(0));
    setRetentionTarget(db, { identity_key: "node:chem_topic:2.4:weights", retention_target: "test", target_source: "engine", needs_last_until: sqlTime(14) }, at(0));

    // At day 5: the short gap is 4.7 days late on 0.3 → far more overdue than
    // 0.8 days late on 4.2, though both are due.
    const { items } = getDueItems(db, { now: at(5) });
    expect(items.map((i) => i.lineage_id)).toEqual([sec2.lineage_id, sec24.lineage_id]);
    expect(items[0]).toMatchObject({ identity_key: "node:chem_topic:2:atoms", last_result: "never_attempted", retention_target: null });

    expect(getDueItems(db, { now: at(5), node_key: "node:chem_topic:2" }).items.map((i) => i.lineage_id)).toEqual([sec2.lineage_id]);
    expect(getDueItems(db, { now: at(5), before: sqlTime(0.5) }).items.map((i) => i.lineage_id)).toEqual([sec2.lineage_id]);
  });
});

describe("selection", () => {
  // Real clock: the target was set 40 days ago, gap 1 has long passed, so the
  // draw is due and the reserve is held.
  function scheduledBank(db: DatabaseSync) {
    const nodeItems = closedNode(db);
    insertTag(db, "chem:other");
    const unscheduled = item(db, { node_keys: [] });
    refreshRetention(db);
    return { ...nodeItems, unscheduled };
  }

  it("gate: a homework or review set takes only due items, most overdue first", () => {
    const db = openTestDb();
    const { d1, d2, t1 } = scheduledBank(db);
    const draw = resolveDrawFromParams(db, { tag_query: { all: ["chem"] }, question_count: 10, due_mode: "gate" });
    expect(draw.questions.map((q) => q.lineage_id).sort()).toEqual([d1.lineage_id, d2.lineage_id, t1.lineage_id].sort());
    expect(draw.short_draw).toBe(true);

    const two = resolveDrawFromParams(db, { tag_query: { all: ["chem"] }, question_count: 2, due_mode: "gate" });
    expect(two.questions).toHaveLength(2);
  });

  it("weight: casual draws keep everything eligible; off draws as before", () => {
    const db = openTestDb();
    scheduledBank(db);
    for (const due_mode of ["weight", "off"] as const) {
      const draw = resolveDrawFromParams(db, { tag_query: { all: ["chem"] }, question_count: 6, due_mode });
      expect(draw.questions).toHaveLength(6);
    }
  });

  it("present_item gate picks a due item or refuses; the default still picks from the whole pool", () => {
    const db = openTestDb();
    const { d1, d2, t1 } = scheduledBank(db);
    const gated = presentItem(db, { node_id: "test", tag_query: { all: ["chem"] }, due_mode: "gate" });
    const lineage = (db.prepare("SELECT lineage_id FROM question WHERE id = ?").get(gated.question.id as string) as { lineage_id: string }).lineage_id;
    expect([d1.lineage_id, d2.lineage_id, t1.lineage_id]).toContain(lineage);

    insertTag(db, "math");
    item(db, { node_keys: [], tags: ["math"] });
    expect(() => presentItem(db, { node_id: "test", tag_query: { all: ["math"] }, due_mode: "gate" })).toThrow(/due/);
    expect(presentItem(db, { node_id: "test", tag_query: { all: ["math"] } }).question).toBeTruthy();
  });
});

describe("the loop over MCP", () => {
  it("set_retention_target → get_due_items → present_item(gate) and a gated template", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { registerTools } = await import("../src/mcp/tools.js");

    const db = openTestDb();
    insertTag(db, "chem");
    const d1 = item(db, { node_keys: [NODE], tests_error: "moles confused with mass" });
    item(db, { node_keys: [NODE] });
    const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
    registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { body: JSON.parse(result.content[0].text), isError: result.isError === true };
    };

    const refused = await call("set_retention_target", {
      identity_key: "chem",
      retention_target: "x",
      target_source: "engine",
      needs_last_until: "2026-01-01",
    });
    expect(refused.isError).toBe(true);

    // A target already at hand: gap 1 is now, so the draw is taken on the next read.
    const set = await call("set_retention_target", {
      identity_key: NODE,
      retention_target: "quiz",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() - DAY).toISOString(),
    });
    expect(set.body).toMatchObject({ node_key: NODE, node_items: 2 });

    const listed = await call("get_due_items", { node_key: "node:chemistry:stoichiometry" });
    expect(listed.body.items.map((i: { lineage_id: string }) => i.lineage_id)).toEqual([d1.lineage_id]);
    expect(listed.body.items[0]).toMatchObject({ reason: "never_demonstrated", identity_key: NODE });

    const presented = await call("present_item", { tag_query: { all: [NODE] }, due_mode: "gate" });
    expect(presented.body.question.node_key).toBe(NODE);
    expect(presented.body.question.id).toBe(liveId(db, d1.lineage_id));

    const template = await call("create_template", {
      name: "review",
      tag_query: { all: ["chem"] },
      question_count: 5,
      due_mode: "gate",
    });
    expect(template.isError).toBe(false);
    expect((db.prepare("SELECT due_mode FROM template WHERE id = ?").get(template.body.id) as { due_mode: string }).due_mode).toBe("gate");
  });
});
