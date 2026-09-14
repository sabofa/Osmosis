import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { setRetentionTarget, recordRetentionResult, getDueItems } from "../src/domain/retention.js";

describe("get_due_items reason", () => {
  it("derives never_demonstrated / decayed / lapsed from last_result", () => {
    const db = openTestDb();
    for (const key of ["k-never", "k-pass", "k-fail"]) {
      setRetentionTarget(db, { identity_key: key, retention_target: "t", target_source: "tutor_direct", needs_last_until: "2020-01-01" });
    }
    recordRetentionResult(db, "k-pass", "t", true);
    recordRetentionResult(db, "k-fail", "t", false);

    const { items } = getDueItems(db, { before: "2100-01-01" }) as { items: { identity_key: string; reason: string }[] };
    const byKey = Object.fromEntries(items.map((i) => [i.identity_key, i.reason]));
    expect(byKey["k-never"]).toBe("never_demonstrated");
    expect(byKey["k-pass"]).toBe("decayed");
    expect(byKey["k-fail"]).toBe("lapsed");
  });
});
