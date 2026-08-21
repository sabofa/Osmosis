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

  // Regression: a live authoring session (2026-08-20 MCP stress test)
  // burned a full failed 22-call create_tag batch because the slug grammar
  // (colon-separated hierarchy segments, underscore-separated words, no
  // hyphens) was nowhere in readme/bootstrap — only discoverable by
  // tripping create_tag's invalid_slug_format validator. tag_conventions
  // states the grammar up front, with the same example the validator uses.
  it("states the tag slug grammar up front, matching create_tag's own validation rule", () => {
    const db = openTestDb();
    const result = readme(db);
    expect(result.tag_conventions).toContain(":");
    expect(result.tag_conventions).toContain("_");
    expect(result.tag_conventions.toLowerCase()).toContain("lowercase");
    expect(result.tag_conventions).toContain("math:functions:quadratic");
    expect(result.tag_conventions.toLowerCase()).toContain("hyphen");
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

  // Regression: the 2026-08-20 MCP stress test misread "may end with
  // color:/name:" as a separate directive line (like the @key: value config
  // directives below it) and hit a parse error. The reference must state
  // explicitly that color:/name: are same-line trailing clauses, with an
  // inline example.
  it("states that color:/name: are same-line trailing clauses, with an inline example", () => {
    const db = openTestDb();
    const ref = bootstrap(db, "math").graph_dsl_reference as string;
    expect(ref.toLowerCase()).toContain("same line");
    expect(ref).toContain("y = x^2 color: blue name: parabola1");
  });

  // Regression: the same session wrote "2 = (2, 3)" for a point label and
  // got a bare "Expected )" — the reference never states that a point
  // label must be letters only (graph-engine's parser falls through to the
  // named-constant grammar on a digit/underscore-containing lhs, which then
  // fails elsewhere with a confusing error, per
  // graph-engine/src/parser/parseStatement.ts's point-vs-named-constant
  // branching).
  it("states that a point statement's label must be letters only", () => {
    const db = openTestDb();
    const ref = bootstrap(db, "math").graph_dsl_reference as string;
    expect(ref.toLowerCase()).toContain("letters only");
  });
});
