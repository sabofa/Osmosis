// The named colours a spec may write, shared by a statement's "color:" clause
// (parser/colors.ts) and the style's colour settings ("@style-ink: navy" is
// not one of them; "@style-ink: blue" is). Kept here, in the dependency-free
// style module, so both sides read one table.
//
// Kept intentionally small: a short, memorable palette an LLM (or a person)
// can name without guessing.
export const COLOR_NAMES: Record<string, number> = {
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
