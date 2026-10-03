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
