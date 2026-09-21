export const PROTOCOL_VERSION = 1;

// Bumped whenever a tool is added, removed, or changes shape. The tutor's
// health check compares it against what it was written for and names a
// mismatch, instead of failing on the first present_item (spec §3.8).
export const TOOLS_VERSION = 4;

// Filled in by registerTools as it registers each tool, so readme()'s list is
// the registration itself rather than a hand-kept copy that can drift. Only
// the FULL registration records here — a presenter-scoped registration passes
// its own (shorter) list straight to readme(), so one process serving both
// surfaces never leaks one scope's inventory into the other's readme.
const registeredToolNames = new Set<string>();

export function recordToolName(name: string): void {
  registeredToolNames.add(name);
}

export function listToolNames(): string[] {
  return [...registeredToolNames].sort();
}
