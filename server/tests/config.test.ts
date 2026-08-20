import { describe, it, expect } from "vitest";
import { getConfig, setConfig } from "../src/domain/config.js";
import { openTestDb } from "./helpers.js";

describe("model_grader_daily_limit config key", () => {
  it("is seeded to 20 by the migration and is settable over the normal config API", () => {
    const db = openTestDb();
    expect(getConfig(db).model_grader_daily_limit).toBe(20);

    setConfig(db, "model_grader_daily_limit", 5);
    expect(getConfig(db).model_grader_daily_limit).toBe(5);
  });
});

describe("written_grader default correction", () => {
  it("defaults to self_only, not the old inert model_when_online seed", () => {
    const db = openTestDb();
    expect(getConfig(db).written_grader).toBe("self_only");
  });
});
