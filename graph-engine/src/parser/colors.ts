// Named colors accepted by a statement's trailing "color: <value>" clause
// (see parseStatement.ts), plus "#rrggbb" hex. Kept intentionally small — a
// short, memorable palette an LLM (or a person) can name without guessing.
const NAMED_COLORS: Record<string, number> = {
  red: 0xd23f38,
  orange: 0xe07b28,
  yellow: 0xd4b21e,
  green: 0x1f8f5f,
  teal: 0x1f9a92,
  blue: 0x2f5fd0,
  purple: 0x7a4fd1,
  pink: 0xd1509d,
  brown: 0x8a5a34,
  black: 0x1c1c22,
  gray: 0x888891,
  grey: 0x888891,
  cyan: 0x22a5c4,
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export function isValidColor(value: string): boolean {
  return value.toLowerCase() in NAMED_COLORS || HEX_PATTERN.test(value)
}

export function resolveColor(value: string): number {
  const lower = value.toLowerCase()
  if (lower in NAMED_COLORS) return NAMED_COLORS[lower]
  if (HEX_PATTERN.test(value)) return Number.parseInt(value.slice(1), 16)
  return 0x888891
}
