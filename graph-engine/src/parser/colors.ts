import { COLOR_NAMES as NAMED_COLORS } from '../style/colorNames'

// Named colors accepted by a statement's trailing "color: <value>" clause
// (see parseStatement.ts), plus hex. The names live in style/colorNames.ts,
// shared with the style's colour settings.
//
// Hex is "#rrggbb" — which a spec cannot actually carry, since "#" starts a
// comment there — or, since figure styles part 1, the same six digits bare
// ("color: d03030"). parseStatement normalises the bare form to "#rrggbb", so
// everything downstream sees one spelling.
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/
const BARE_HEX_PATTERN = /^[0-9a-fA-F]{6}$/

export function isValidColor(value: string): boolean {
  return value.toLowerCase() in NAMED_COLORS || HEX_PATTERN.test(value) || BARE_HEX_PATTERN.test(value)
}

// A colour as the rest of the engine reads it: a name as written, hex as
// "#rrggbb" whichever way it was written.
export function normaliseColor(value: string): string {
  return BARE_HEX_PATTERN.test(value) ? `#${value.toLowerCase()}` : value
}

export function resolveColor(value: string): number {
  const lower = value.toLowerCase()
  if (lower in NAMED_COLORS) return NAMED_COLORS[lower]
  if (HEX_PATTERN.test(value)) return Number.parseInt(value.slice(1), 16)
  return 0x888891
}
