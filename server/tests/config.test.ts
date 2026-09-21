import { describe, it, expect } from "vitest";
import { getConfig, setConfig } from "../src/domain/config.js";
import { openTestDb } from "./helpers.js";

describe("the model grader's config keys are gone", () => {
  it("get_config no longer carries written_grader or model_grader_daily_limit", () => {
    const db = openTestDb();
    const config = getConfig(db);
    expect(config).not.toHaveProperty("written_grader");
    expect(config).not.toHaveProperty("model_grader_daily_limit");
  });

  it("set_config refuses them as unknown keys", () => {
    const db = openTestDb();
    expect(() => setConfig(db, "model_grader_daily_limit", 5)).toThrow(/not a known/);
    expect(() => setConfig(db, "written_grader", "self_only")).toThrow(/not a known/);
  });
});
