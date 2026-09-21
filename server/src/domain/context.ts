import { DomainError } from "./errors.js";

// ----------------------------------------------------------------------------
// The tutor's breadcrumb (spec §5.1) — where in the course this item or show
// came from, and how long it means the learner to spend on it. Every field is
// optional: the tutor supplies what it knows, and the app's banner renders
// whatever is there.
//
// It is stored as JSON and never queried, so the object is kept verbatim
// rather than normalised into columns. What is checked is the shape of the
// keys we document, so a `timer_s: "90"` is a legible rejection at the tool
// boundary rather than a banner that counts down from NaN.
// ----------------------------------------------------------------------------

export interface ItemContext {
  course?: string;
  unit?: string;
  node?: string;
  step?: string;
  timer_s?: number;
  [key: string]: unknown;
}

const STRING_KEYS = ["course", "unit", "node", "step"] as const;

// Returns the JSON to store, or null when there is nothing to store. Throws a
// DomainError for a context that is present but malformed — silently dropping
// a mistyped breadcrumb would leave the tutor believing the app is showing
// something it isn't.
export function serializeContext(context: unknown): string | null {
  if (context === undefined || context === null) return null;
  if (typeof context !== "object" || Array.isArray(context)) {
    throw new DomainError("invalid_context", "context must be an object.");
  }
  const obj = context as Record<string, unknown>;
  for (const key of STRING_KEYS) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new DomainError("invalid_context", `context.${key} must be a string.`);
    }
  }
  if (obj.timer_s !== undefined && obj.timer_s !== null) {
    if (typeof obj.timer_s !== "number" || !Number.isFinite(obj.timer_s) || obj.timer_s <= 0) {
      throw new DomainError("invalid_context", "context.timer_s must be a positive number of seconds.");
    }
  }
  // An object with nothing in it is nothing said.
  if (Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

// The other direction, for every read path. A row written by an older build
// (or corrupted by hand) reads as "no context" rather than throwing halfway
// through rendering a stream.
export function parseContext(json: string | null | undefined): ItemContext | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as ItemContext;
  } catch {
    return null;
  }
}
