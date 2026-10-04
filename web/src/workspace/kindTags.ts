// The kind tag says what a file is for. The vocabulary is open (the server takes
// any tag matching the pattern below, so a new one needs no migration); these
// are only the five the menus suggest, in the order they are shown. The checks
// here are for the UI to say no before asking: the server's refusal of a tag is
// the same rule, applied as given with no trimming or case-folding.

export const SUGGESTED_KIND_TAGS = ['source', 'resource', 'homework', 'test', 'flowchart'] as const

export const KIND_TAG_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

export const isKindTag = (s: string): boolean => KIND_TAG_PATTERN.test(s)

export type TagInput = { kind: 'tag'; tag: string } | { kind: 'refused'; message: string }

// What was typed into the Tag menu's "Other…". Spaces around it are dropped, but
// the case is not folded: "Quiz" is refused, like the server would, instead of
// quietly becoming a tag nobody typed.
export function parseTagInput(raw: string): TagInput {
  const tag = raw.trim()
  if (isKindTag(tag)) return { kind: 'tag', tag }
  return { kind: 'refused', message: 'A tag is made of lowercase letters, digits, "_" and "-", starts with a letter, and is at most 32 characters.' }
}

// The entries of the Tag menu for one file: the suggestions, the file's own tag
// when it is not one of them (so the menu shows what the file has, ticked), then
// None. "Other…" is the menu's own entry and not in this list.
export function tagChoices(current: string | null): (string | null)[] {
  const own = current !== null && !(SUGGESTED_KIND_TAGS as readonly string[]).includes(current) ? [current] : []
  return [...SUGGESTED_KIND_TAGS, ...own, null]
}

// The partition chips of a workspace: the five suggestions always, then every
// other tag in use there, once each, alphabetically.
export function chipTags(inUse: Iterable<string | null>): string[] {
  const suggested: readonly string[] = SUGGESTED_KIND_TAGS
  const others = new Set<string>()
  for (const tag of inUse) if (tag !== null && !suggested.includes(tag)) others.add(tag)
  return [...suggested, ...[...others].sort()]
}
