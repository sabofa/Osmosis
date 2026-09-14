import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { setRetentionTarget, getDueItems, getNextDueForIdentity } from "../src/domain/retention.js";

describe("setRetentionTarget", () => {
  it("computes a first_gap within the Cepeda ratio for a two-week target", () => {
    const db = openTestDb();
    const needsLastUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = setRetentionTarget(db, {
      identity_key: "calc101:chain-rule",
      retention_target: "chapter-test-2026-09-16",
      target_source: "tutor_direct",
      needs_last_until: needsLastUntil,
    });
    // 20-40% of 14 days = 2.8 to 5.6 days
    expect(result.first_gap_days).toBeGreaterThanOrEqual(2.8);
    expect(result.first_gap_days).toBeLessThanOrEqual(5.6);
  });

  it("accepts a sub-1-day gap for a same-day target without a floor constraint blocking it", () => {
    const db = openTestDb();
    const needsLastUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const result = setRetentionTarget(db, {
      identity_key: "calc101:chain-rule",
      retention_target: "quiz-tonight",
      target_source: "tutor_direct",
      needs_last_until: needsLastUntil,
    });
    expect(result.first_gap_days).toBeLessThan(1);
  });

  it("creates the row with last_result never_attempted, not fail", () => {
    const db = openTestDb();
    setRetentionTarget(db, {
      identity_key: "calc101:chain-rule",
      retention_target: "t1",
      target_source: "engine",
      needs_last_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const row = db.prepare("SELECT last_result FROM retention_schedule WHERE identity_key = ?").get("calc101:chain-rule") as { last_result: string };
    expect(row.last_result).toBe("never_attempted");
  });
});

describe("getNextDueForIdentity — multiple targets", () => {
  it("returns the minimum due_at across an identity's open targets (the near target's extra pass)", () => {
    const db = openTestDb();
    const near = setRetentionTarget(db, {
      identity_key: "calc101:chain-rule",
      retention_target: "thursday-quiz",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const far = setRetentionTarget(db, {
      identity_key: "calc101:chain-rule",
      retention_target: "december-final",
      target_source: "engine",
      needs_last_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const nextDue = getNextDueForIdentity(db, "calc101:chain-rule");
    const nearDue = db.prepare("SELECT due_at FROM retention_schedule WHERE id = ?").get(near.id) as { due_at: string };
    const farDue = db.prepare("SELECT due_at FROM retention_schedule WHERE id = ?").get(far.id) as { due_at: string };
    // The near target's gap is smaller in absolute days (3-day target vs 90-day),
    // so its due_at should be sooner — confirm getNextDueForIdentity picks it.
    expect(nextDue).toBe(nearDue.due_at < farDue.due_at ? nearDue.due_at : farDue.due_at);
    expect(new Date(nextDue!).getTime()).toBeLessThanOrEqual(new Date(farDue.due_at).getTime());
  });
});

describe("getDueItems", () => {
  it("returns items whose due_at has passed, paginated", () => {
    const db = openTestDb();
    const past = setRetentionTarget(db, {
      identity_key: "calc101:overdue",
      retention_target: "t1",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    // Force it into the past for this test.
    db.prepare("UPDATE retention_schedule SET due_at = datetime('now', '-1 hour') WHERE id = ?").run(past.id);

    const result = getDueItems(db);
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect((result.items as any[]).some((i) => i.identity_key === "calc101:overdue")).toBe(true);
  });

  it("does not return an item whose due_at is still in the future", () => {
    const db = openTestDb();
    setRetentionTarget(db, {
      identity_key: "calc101:not-yet",
      retention_target: "t1",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = getDueItems(db);
    expect((result.items as any[]).some((i) => i.identity_key === "calc101:not-yet")).toBe(false);
  });
});
