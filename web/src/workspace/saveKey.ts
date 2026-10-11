// Ctrl/Cmd-S in the markdown file view. The editor does not bind Mod-s, so the
// keydown reaches the wrapper; this is the one place that decides it is a save.
export function isSaveKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's'
}

// A save is only worth attempting with unsaved changes, no save in flight and
// no unresolved conflict.
export function canSave(s: { dirty: boolean; busy: boolean; conflict: boolean }): boolean {
  return s.dirty && !s.busy && !s.conflict
}
