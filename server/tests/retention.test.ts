import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { setRetentionTarget, getDueItems, getNextDueForIdentity, recordRetentionResult } from "../src/domain/retention.js";
import { DomainError } from "../src/domain/errors.js";

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

  it("correctly handles ISO-8601-with-T format before parameter, comparing correctly against stored due_at", () => {
    const db = openTestDb();
    const now = new Date();
    const pastMs = now.getTime() - 60 * 60 * 1000; // 1 hour ago
    const futureMs = now.getTime() + 60 * 60 * 1000; // 1 hour in future

    // Create an item with past due_at
    const past = setRetentionTarget(db, {
      identity_key: "test-iso-past",
      retention_target: "past-item",
      target_source: "tutor_direct",
      needs_last_until: new Date(pastMs).toISOString(),
    });

    // Create an item with future due_at
    const future = setRetentionTarget(db, {
      identity_key: "test-iso-future",
      retention_target: "future-item",
      target_source: "tutor_direct",
      needs_last_until: new Date(futureMs).toISOString(),
    });

    // Force past item even further into the past
    db.prepare("UPDATE retention_schedule SET due_at = datetime('now', '-2 hours') WHERE id = ?").run(past.id);

    // Call getDueItems with an ISO-8601 format before parameter (with T separator)
    const cutoffTime = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30 minutes ago
    const result = getDueItems(db, { before: cutoffTime });

    // Should include the past item (due_at is 1 hour ago, cutoff is 30 min ago)
    expect((result.items as any[]).some((i) => i.identity_key === "test-iso-past")).toBe(true);
    // Should NOT include the future item (due_at is 1 hour in future, cutoff is 30 min ago)
    expect((result.items as any[]).some((i) => i.identity_key === "test-iso-future")).toBe(false);
  });
});

describe("getDueItems — before parameter parsing (final review fix)", () => {
  // Whole-branch review finding: getDueItems' `before` (and setRetentionTarget's
  // needs_last_until) funneled through `new Date(input)`, which parses a bare
  // "YYYY-MM-DD HH:MM:SS" string as LOCAL time rather than UTC — exactly the
  // format due_at is stored/returned in, so the natural caller flow (read a
  // due_at value, pass it back as `before`) broke on any non-UTC host. This
  // confirms inclusion/exclusion by actual time is correct for that format,
  // not merely that the call doesn't throw.
  it("correctly includes/excludes items by real time for a space-separated before value (the stored due_at format)", () => {
    const db = openTestDb();
    const past = setRetentionTarget(db, {
      identity_key: "space-fmt-past",
      retention_target: "t1",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const future = setRetentionTarget(db, {
      identity_key: "space-fmt-future",
      retention_target: "t1",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    db.prepare("UPDATE retention_schedule SET due_at = datetime('now', '-2 hours') WHERE id = ?").run(past.id);
    db.prepare("UPDATE retention_schedule SET due_at = datetime('now', '+2 hours') WHERE id = ?").run(future.id);

    // A space-separated "YYYY-MM-DD HH:MM:SS" cutoff, exactly what a caller
    // gets back from due_at — 1 hour from now, i.e. between the two items.
    const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
    const result = getDueItems(db, { before: cutoff });

    expect((result.items as any[]).some((i) => i.identity_key === "space-fmt-past")).toBe(true);
    expect((result.items as any[]).some((i) => i.identity_key === "space-fmt-future")).toBe(false);
  });

  it("throws DomainError (not a raw RangeError) when `before` is unparseable", () => {
    const db = openTestDb();
    expect(() => getDueItems(db, { before: "not-a-date" })).toThrow(DomainError);
    try {
      getDueItems(db, { before: "not-a-date" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("invalid_date");
    }
  });

  it("throws DomainError (not a raw RangeError) when needs_last_until is unparseable", () => {
    const db = openTestDb();
    expect(() =>
      setRetentionTarget(db, {
        identity_key: "bad-date",
        retention_target: "t1",
        target_source: "tutor_direct",
        needs_last_until: "not-a-date",
      })
    ).toThrow(DomainError);
    try {
      setRetentionTarget(db, {
        identity_key: "bad-date",
        retention_target: "t1",
        target_source: "tutor_direct",
        needs_last_until: "not-a-date",
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("invalid_date");
    }
  });
});

describe("recordRetentionResult", () => {
  it("correctly updates last_result to pass or fail for an existing target", () => {
    const db = openTestDb();
    const target = setRetentionTarget(db, {
      identity_key: "calc101:test-result",
      retention_target: "assignment-1",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Record a pass
    recordRetentionResult(db, "calc101:test-result", "assignment-1", true);
    let row = db.prepare("SELECT last_result FROM retention_schedule WHERE id = ?").get(target.id) as { last_result: string };
    expect(row.last_result).toBe("pass");

    // Record a fail
    recordRetentionResult(db, "calc101:test-result", "assignment-1", false);
    row = db.prepare("SELECT last_result FROM retention_schedule WHERE id = ?").get(target.id) as { last_result: string };
    expect(row.last_result).toBe("fail");
  });

  it("throws DomainError with code 'not_found' when called with non-existent identity/target pair", () => {
    const db = openTestDb();

    expect(() => {
      recordRetentionResult(db, "nonexistent:key", "nonexistent-target", true);
    }).toThrow(DomainError);

    try {
      recordRetentionResult(db, "nonexistent:key", "nonexistent-target", true);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("not_found");
    }
  });
});

describe("setRetentionTarget — rescheduling after failure", () => {
  it("resets last_result to never_attempted when rescheduling a previously failed target", () => {
    const db = openTestDb();

    // Create initial target
    const target = setRetentionTarget(db, {
      identity_key: "calc101:reschedule-test",
      retention_target: "quiz-2",
      target_source: "tutor_direct",
      needs_last_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Mark it as failed
    recordRetentionResult(db, "calc101:reschedule-test", "quiz-2", false);
    let row = db.prepare("SELECT last_result FROM retention_schedule WHERE id = ?").get(target.id) as { last_result: string };
    expect(row.last_result).toBe("fail");

    // Verify it's excluded from getNextDueForIdentity (excluded because last_result = 'fail')
    const beforeReschedule = getNextDueForIdentity(db, "calc101:reschedule-test");
    expect(beforeReschedule).toBeNull();

    // Reschedule the same target with new needs_last_until
    const newNeeds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const rescheduled = setRetentionTarget(db, {
      identity_key: "calc101:reschedule-test",
      retention_target: "quiz-2",
      target_source: "tutor_direct",
      needs_last_until: newNeeds,
    });

    // Verify last_result was reset to never_attempted
    row = db.prepare("SELECT last_result FROM retention_schedule WHERE id = ?").get(rescheduled.id) as { last_result: string };
    expect(row.last_result).toBe("never_attempted");

    // Verify it's now included in getNextDueForIdentity (no longer excluded)
    const afterReschedule = getNextDueForIdentity(db, "calc101:reschedule-test");
    expect(afterReschedule).not.toBeNull();
    expect(afterReschedule).toBe(rescheduled.due_at);
  });
});
