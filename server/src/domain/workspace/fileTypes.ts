import { DomainError } from "../errors.js";

// The server half of the file-type registry (spec §17). A type says how its
// content is stored, which page kinds it holds (for class), whether an
// agent may append to it, and optionally how to validate it and what search
// should read. Adding a special type — an item file, USERNOTES — is one
// registerFileType call here and one registration in web/src/workspace/
// fileTypes.tsx; see docs/workspace/FILE-TYPES.md.
export interface FileTypeSpec {
  type: string;
  storage: "text" | "json" | "asset";
  appendable: boolean;
  kinds(body: string | null): string[];
  validate?(body: string | null): string | null;
  searchText?(body: string | null): string;
}

const registry = new Map<string, FileTypeSpec>();

export function registerFileType(spec: FileTypeSpec): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(spec.type)) throw new Error(`file type "${spec.type}" must be lowercase a-z, 0-9, "-"`);
  if (registry.has(spec.type)) throw new Error(`file type "${spec.type}" is already registered`);
  registry.set(spec.type, spec);
}

export function getFileType(type: string): FileTypeSpec {
  const spec = registry.get(type);
  if (!spec) throw new DomainError("unknown_file_type", `No file type "${type}" is registered.`);
  return spec;
}

export function listFileTypes(): FileTypeSpec[] {
  return [...registry.values()];
}

type Family = "document" | "graph" | "flowchart" | "spreadsheet" | "code";
type PageClass = Family | "mixed" | "empty";

const FAMILY: Record<string, Family> = { text: "document", plot: "graph", space: "graph", figure: "graph", flow: "flowchart", sheet: "spreadsheet", code: "code" };

// graph-engine spec, Classification: one family is that family's class,
// more than one is mixed. "empty" is a file whose type holds no pages (an
// asset, or a special type that declares none). A page kind that is not a
// known family counts as its own, so it makes the file mixed. hasOwn, not a
// plain lookup: a kind named "constructor" or "toString" must not find
// something on Object.prototype.
export function classOf(kinds: string[]): PageClass {
  const families = new Set<Family | "mixed">(kinds.map((k) => (Object.hasOwn(FAMILY, k) ? FAMILY[k] : "mixed")));
  if (families.size === 0) return "empty";
  if (families.size > 1) return "mixed";
  return [...families][0];
}

// Built-ins. A bare one-page document is "the text is the document"
// (graph-engine spec, Container format): markdown is a text page, graph is a
// plot page in the graph_spec DSL. asset wraps an upload without copying it.
registerFileType({ type: "markdown", storage: "text", appendable: true, kinds: () => ["text"], searchText: (b) => b ?? "" });
registerFileType({ type: "graph", storage: "text", appendable: false, kinds: () => ["plot"], searchText: (b) => b ?? "" });
registerFileType({ type: "asset", storage: "asset", appendable: false, kinds: () => [] });
