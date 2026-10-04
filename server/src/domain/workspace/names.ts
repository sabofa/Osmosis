import { DomainError } from "../errors.js";

// The text-encoding standard both engines obey (NFC on ingest), plus what a
// folder export needs: no "/", no control characters, and a length a
// filesystem accepts. Length counts codepoints, not UTF-16 units.
export function normalizeName(raw: string): string {
  const name = (raw ?? "").normalize("NFC").trim();
  const length = [...name].length;
  if (length === 0) throw new DomainError("invalid_name", "A name can't be empty.");
  if (length > 200) throw new DomainError("invalid_name", "A name is at most 200 characters.");
  if (name.includes("/")) throw new DomainError("invalid_name", 'A name can\'t contain "/".');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new DomainError("invalid_name", "A name can't contain control characters.");
  return name;
}

// Case-insensitive the way Windows and macOS are, so a folder export never
// produces two paths that collide on disk. SQLite's NOCASE folds ASCII only.
export function sameName(a: string, b: string): boolean {
  return a.normalize("NFC").trim().toLocaleLowerCase("en") === b.normalize("NFC").trim().toLocaleLowerCase("en");
}

// The kind tag says what a file is for. The vocabulary is open, so a new tag
// needs no migration, but it has a grammar: lowercase, starting with a letter,
// at most 32 characters (spec §4.3). It is checked as given, with no trimming
// or case-folding on the way in, so what a caller sends is what is stored and
// a typo is refused rather than quietly turned into a different tag. Null
// clears a tag. Whether a node may carry one at all (files only) is the
// graph's rule, because it depends on the node.
const KIND_TAG = /^[a-z][a-z0-9_-]{0,31}$/;

export function normalizeKindTag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !KIND_TAG.test(raw)) {
    throw new DomainError("invalid_input", "A kind tag is lowercase letters, digits, \"_\" and \"-\", starting with a letter, at most 32 characters.");
  }
  return raw;
}
