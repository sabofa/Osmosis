import { mix, parseColour, toHex, contrast, type Oklch } from '../colour.js'
import type { Dials, FontRef, FontRole, Mode } from '../manifest.js'

export type TokenType = 'color' | 'length' | 'number' | 'font' | 'shadow' | 'duration' | 'easing' | 'string'
export type Tier = 'semantic' | 'component'
export type Group =
  | 'colour' | 'type' | 'shape' | 'space' | 'elevation' | 'motion'
  | 'surface' | 'graph' | 'document' | 'component'
export type SeedKey = 'canvas' | 'surface' | 'ink' | 'accent' | 'secondary' | 'good' | 'bad' | 'warn' | 'info'

export interface DeriveCtx {
  mode: Mode
  dials: Dials
  fonts: Record<FontRole, FontRef>
  /** canvas/ink/accent always present; for the others call hasSeed(k) first (throws if absent). */
  seed(k: SeedKey): Oklch
  hasSeed(k: SeedKey): boolean
  /** i is 0-based */
  seriesSeed(i: number): Oklch | null
  /** Final value of another token (override-aware, memoised). Throws on unknown name or cycle. */
  get(name: string): string
  col(name: string): Oklch
}

export interface TokenDef {
  name: string
  tier: Tier
  group: Group
  type: TokenType
  modeDependent: boolean
  meaning: string
  derive(ctx: DeriveCtx): string
}

export function def(
  name: string,
  group: Group,
  type: TokenType,
  meaning: string,
  derive: (ctx: DeriveCtx) => string,
  opts: { tier?: Tier; modeDependent?: boolean } = {},
): TokenDef {
  return {
    name, group, type, meaning, derive,
    tier: opts.tier ?? 'semantic',
    modeDependent: opts.modeDependent ?? type === 'color',
  }
}

export function parseTokenValue(type: TokenType, v: string): boolean {
  if (typeof v !== 'string') return false
  switch (type) {
    case 'color':
      try { parseColour(v); return true } catch { return false }
    case 'length':
      return /^-?\d*\.?\d+(px|rem|em|%|ch)$|^0$/.test(v)
    case 'number':
      return v.trim() !== '' && Number.isFinite(Number(v))
    case 'duration':
      return /^\d*\.?\d+(ms|s)$/.test(v)
    default:
      return v.trim() !== ''
  }
}

export function mixTo(a: Oklch, b: Oklch, t: number): Oklch { return mix(a, b, t) }

const NEAR_BLACK: Oklch = { l: 0.2, c: 0.01, h: 90, a: 1 }
const WHITE: Oklch = { l: 1, c: 0, h: 0, a: 1 }
export function onColour(bg: Oklch): Oklch {
  return contrast(NEAR_BLACK, bg) >= contrast(WHITE, bg) ? NEAR_BLACK : WHITE
}

export function hex(c: Oklch): string { return toHex(c) }
