import { describe, it, expect } from "vitest";
import { normalizeName, sameName } from "../src/domain/workspace/names.js";
import { getFileType, registerFileType, classOf } from "../src/domain/workspace/fileTypes.js";
import { DomainError } from "../src/domain/errors.js";

describe("names", () => {
  it("normalizes to NFC and trims", () => {
    expect(normalizeName("  Café notes ")).toBe("Café notes");
  });
  it("refuses empty, slash, control characters and over-long names", () => {
    for (const bad of ["", "   ", "a/b", "a\u0007b", "x".repeat(201)]) {
      expect(() => normalizeName(bad)).toThrow(DomainError);
    }
    expect(normalizeName("x".repeat(200))).toHaveLength(200);
  });
  it("compares case-insensitively beyond ASCII", () => {
    expect(sameName("Ελαστικότητα", "ΕΛΑΣΤΙΚΌΤΗΤΑ")).toBe(true);
    expect(sameName("notes", "Notes ")).toBe(true);
    expect(sameName("notes", "note")).toBe(false);
  });
});

describe("file types", () => {
  it("has the three built-ins", () => {
    expect(getFileType("markdown")).toMatchObject({ storage: "text", appendable: true });
    expect(getFileType("markdown").kinds("# hi")).toEqual(["text"]);
    expect(getFileType("graph").kinds("y = x^2")).toEqual(["plot"]);
    expect(getFileType("asset").storage).toBe("asset");
  });
  it("refuses an unknown type and a duplicate registration", () => {
    expect(() => getFileType("nope")).toThrow(DomainError);
    expect(() => registerFileType({ type: "markdown", storage: "text", appendable: true, kinds: () => ["text"] })).toThrow();
  });
  it("derives class from page kinds (graph-engine spec, Classification)", () => {
    expect(classOf(["text"])).toBe("document");
    expect(classOf(["plot"])).toBe("graph");
    expect(classOf(["space", "figure"])).toBe("graph");
    expect(classOf(["flow"])).toBe("flowchart");
    expect(classOf(["sheet"])).toBe("spreadsheet");
    expect(classOf(["code"])).toBe("code");
    expect(classOf(["text", "flow"])).toBe("mixed");
    expect(classOf([])).toBe("empty");
  });
});
