import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { readme } from "../src/domain/readme.js";
import { bootstrap } from "../src/domain/bootstrap.js";

describe("readme", () => {
  it("returns universal conventions independent of any subject", () => {
    const db = openTestDb();
    const result = readme(db);
    expect(result.node.bank_size).toBe(0);
    expect(result.prompt_conventions.difficulty_scale).toContain("1 =");
    expect(result.calculator_conventions).toContain("calculator_policy");
    expect(result.calculator_conventions).toContain("desmos_allowed");
  });
});

describe("bootstrap graph_dsl_reference gating", () => {
  it("omits the DSL reference with no subject", () => {
    const db = openTestDb();
    expect(bootstrap(db, null).graph_dsl_reference).toBeNull();
  });

  it("omits the DSL reference for a non-graph-capable subject", () => {
    const db = openTestDb();
    expect(bootstrap(db, "english").graph_dsl_reference).toBeNull();
  });

  it("includes the DSL reference for a graph-capable top-level subject", () => {
    const db = openTestDb();
    const result = bootstrap(db, "math");
    expect(result.graph_dsl_reference).not.toBeNull();
    expect(result.graph_dsl_reference).toContain("y = <expr(x)>");
  });

  it("includes the DSL reference for a graph-capable subtree, not just the top-level slug", () => {
    const db = openTestDb();
    const result = bootstrap(db, "math:functions:quadratic");
    expect(result.graph_dsl_reference).not.toBeNull();
  });

  it("no longer returns the retired conventions/calculator_convention fields", () => {
    const db = openTestDb();
    const result = bootstrap(db, null) as unknown as Record<string, unknown>;
    expect(result.conventions).toBeUndefined();
    expect(result.calculator_convention).toBeUndefined();
  });
});
