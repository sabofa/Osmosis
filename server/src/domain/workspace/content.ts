import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";
import type { Author, ContentRow } from "./types.js";

// Placeholder for the content task (the first design's revisions are gone with
// the migration it was built on). These are the contract's signatures, so the
// rest of the domain compiles and loads; the real versions are written there.
const pending = (): never => {
  throw new DomainError("not_implemented", "Workspace content is not implemented yet.");
};

export function readContent(_db: DatabaseSync, _nodeId: string): ContentRow {
  return pending();
}

export function saveContent(
  _db: DatabaseSync,
  _nodeId: string,
  _input: { body: string | null; base_version: number; author: Author }
): { version: number; saved_at: string } {
  return pending();
}

export function appendContent(_db: DatabaseSync, _nodeId: string, _input: { text: string; author: Author }): { version: number } {
  return pending();
}

export function listVersions(_db: DatabaseSync, _nodeId: string): { version: number; author: Author; saved_at: string }[] {
  return pending();
}
