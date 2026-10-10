export type IconSheetRef = { kind: 'default' } | { kind: 'builtin'; slug: string } | { kind: 'asset'; hash: string }

const BUILTIN_RE = /^builtin:([a-z0-9][a-z0-9_-]{0,31})$/
const ASSET_RE = /^asset:([0-9a-f]{16,64})$/

/** Parses the `icon-sheet` token value. Never throws: anything unrecognised means the default sheet. */
export function parseIconSheetRef(value: string): IconSheetRef {
  if (typeof value !== 'string') return { kind: 'default' }
  const b = BUILTIN_RE.exec(value)
  if (b) return { kind: 'builtin', slug: b[1]! }
  const a = ASSET_RE.exec(value)
  if (a) return { kind: 'asset', hash: a[1]! }
  return { kind: 'default' }
}
