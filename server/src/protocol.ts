export const PROTOCOL_VERSION = 1;

// Bumped whenever a tool is added, removed, or changes shape. The tutor's
// health check compares it against what it was written for and names a
// mismatch, instead of failing on the first present_item (spec §3.8).
export const TOOLS_VERSION = 2;

// Filled in by registerTools as it registers each tool, so readme()'s list is
// the registration itself rather than a hand-kept copy that can drift.
const registeredToolNames = new Set<string>();

export function recordToolName(name: string): void {
  registeredToolNames.add(name);
}

export function listToolNames(): string[] {
  return [...registeredToolNames].sort();
}
