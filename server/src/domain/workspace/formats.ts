import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";

// Format hooks (Learn spec/osmosis/workspace/02-data-layer.md §7), which
// replace the first design's server-side file-type registry.
//
// A file's `format` is an opaque identifier and the layer never interprets it
// or the body stored under it. Whoever owns a format (the document engine, the
// graph engine, the agent building item files and USERNOTES) may register
// hooks for it, and all of them are optional:
//
//   searchText  the plain text the layer stores as the version's search_text
//   validate    a refusal message, or null to accept
//   append      present means the format is appendable; returns the new body
//
// A format with no hooks is stored and returned verbatim: unsearchable by
// content, not appendable, never validated. Hooks run only on writes. They
// never run during a read, so one bad body can't break a listing; search
// reads the search_text that was stored when the version was written.
export interface FormatHooks {
  format: string;
  searchText?(body: string | null): string;
  validate?(body: string | null): string | null;
  append?(body: string | null, text: string): string;
}

const FORMAT_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function isFormatName(name: unknown): name is string {
  return typeof name === "string" && FORMAT_NAME.test(name);
}

const registry = new Map<string, FormatHooks>();

// Registration is a startup-time programming act, so a mistake here is a plain
// Error, not a DomainError that a route could turn into a 400.
export function registerFormat(hooks: FormatHooks): void {
  if (!isFormatName(hooks.format)) {
    throw new Error(`format "${String(hooks.format)}" must be lowercase a-z, 0-9 and "-", starting with a letter, at most 40 characters`);
  }
  if (registry.has(hooks.format)) throw new Error(`format "${hooks.format}" is already registered`);
  registry.set(hooks.format, hooks);
}

// Null means the format has no hooks, which is allowed: the layer stores any
// format that matches the grammar, registered or not.
export function formatHooks(format: string): FormatHooks | null {
  return registry.get(format) ?? null;
}

export function listFormats(): { format: string; searchable: boolean; appendable: boolean; validated: boolean }[] {
  return [...registry.values()].map((h) => ({
    format: h.format,
    searchable: h.searchText !== undefined,
    appendable: h.append !== undefined,
    validated: h.validate !== undefined,
  }));
}

// The text a format's searchText hook is given. For every format but one it is
// the body. An upload has no body (its content is an asset the layer never
// copies), so the hook is handed the asset's extracted text instead, which is
// what makes an upload findable by what is in it. A missing asset, or one that
// had nothing to extract, is null. This is the one place that rule lives:
// createNode, saveContent and the uploads sync all ask here, so an upload's
// search_text can't come out empty on one path and full on another. It is a
// read of the asset row, not a hook call, and only writes use it.
export function searchSourceFor(db: DatabaseSync, format: string, body: string | null, assetId: string | null): string | null {
  if (format !== "upload") return body;
  if (assetId === null) return null;
  const asset = db.prepare("SELECT extracted_text FROM asset WHERE id = ?").get(assetId) as { extracted_text: string | null } | undefined;
  return asset?.extracted_text ?? null;
}

// What a write does with a format's hooks: refuse the content, or work out the
// search_text to store alongside it. Every hook is someone else's code, so one
// that refuses, throws, or returns the wrong kind of value fails this one
// write with invalid_content. `searchSource` is what searchText is given, from
// searchSourceFor above.
export function checkContent(format: string, body: string | null, searchSource: string | null = body): { search_text: string | null } {
  const hooks = formatHooks(format);
  if (!hooks) return { search_text: null };
  if (hooks.validate) {
    let problem: string | null;
    try {
      problem = hooks.validate(body);
    } catch (err) {
      throw new DomainError("invalid_content", `The "${format}" format could not check this content: ${errorText(err)}`);
    }
    if (problem) throw new DomainError("invalid_content", String(problem));
  }
  if (!hooks.searchText) return { search_text: null };
  let text: unknown;
  try {
    text = hooks.searchText(searchSource);
  } catch (err) {
    throw new DomainError("invalid_content", `The "${format}" format could not read this content for search: ${errorText(err)}`);
  }
  if (typeof text !== "string") throw new DomainError("invalid_content", `The "${format}" format's searchText did not return text.`);
  return { search_text: text };
}

// The new body for an append: the format's own joining of what is there and
// what is new. Only a format with an append hook has one (not_appendable
// otherwise). Like every hook it is someone else's code, so one that throws or
// returns something that is not text fails this one write with invalid_content.
export function appendBody(format: string, body: string | null, text: string): string {
  const hooks = formatHooks(format);
  if (!hooks?.append) throw new DomainError("not_appendable", `A "${format}" file can't be appended to.`);
  let joined: unknown;
  try {
    joined = hooks.append(body, text);
  } catch (err) {
    throw new DomainError("invalid_content", `The "${format}" format could not append to this content: ${errorText(err)}`);
  }
  if (typeof joined !== "string") throw new DomainError("invalid_content", `The "${format}" format's append did not return text.`);
  return joined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Built-ins. markdown is a text document: its search text is the body, and
// appending adds a blank line between what is there and what is new (the
// joining is the format's, because joining is interpretation). graph is the
// graph engine's text DSL, searchable the same way. upload wraps an asset
// without copying it; its search text is the asset's extracted text, so the
// hook is the identity and searchSourceFor hands it that text.
registerFormat({
  format: "markdown",
  searchText: (body) => body ?? "",
  append: (body, text) => (body ? `${body}\n\n${text}` : text),
});
registerFormat({ format: "graph", searchText: (body) => body ?? "" });
registerFormat({ format: "upload", searchText: (extracted) => extracted ?? "" });
