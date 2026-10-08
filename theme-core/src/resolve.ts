import type { Oklch } from './colour.js'
import { parseColour } from './colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, type ColourSeeds, type Dials, type Mode, type ThemeManifest } from './manifest.js'
import { TOKENS, createResolver, type ModeSeeds, type Tier } from './registry/index.js'

export type TokenMap = Record<string, string>
export type Provenance = { source: 'default' | 'seed' | 'dial' | 'override'; tier: Tier; from?: string }
export interface ResolvedTheme {
  id: string
  light: TokenMap
  dark: TokenMap
  provenance: { light: Record<string, Provenance>; dark: Record<string, Provenance> }
  key: string
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function mirrorSeed(role: keyof ColourSeeds, c: Oklch, to: Mode): Oklch {
  if (role === 'canvas' || role === 'surface' || role === 'ink') {
    return { ...c, l: clamp(1 - c.l, 0.17, 0.97), c: c.c * 0.8 }
  }
  const dark = to === 'dark'
  return { ...c, l: clamp(c.l + (dark ? 0.08 : -0.08), 0.35, 0.85), c: c.c * (dark ? 0.95 : 1.05) }
}

type Field = 'canvas' | 'surface' | 'ink' | 'accent' | 'secondary' | 'good' | 'bad' | 'warn' | 'info'
const FIELDS: Field[] = ['canvas', 'surface', 'ink', 'accent', 'secondary', 'good', 'bad', 'warn', 'info']

// seed-bearing token -> seed key
const PASS_THROUGH: Record<string, Field> = {
  'color-canvas': 'canvas', 'color-text': 'ink', 'color-accent': 'accent', 'color-surface': 'surface',
  'color-secondary': 'secondary', 'color-good': 'good', 'color-bad': 'bad', 'color-warn': 'warn', 'color-info': 'info',
}

function buildSeeds(m: ThemeManifest, mode: Mode): { seeds: ModeSeeds; present: Set<Field> } {
  const other: Mode = mode === 'light' ? 'dark' : 'light'
  const mine = m.seeds[mode] ?? {}
  const theirs = m.seeds[other] ?? {}
  const pick = (f: Field): Oklch | undefined => {
    if (mine[f] !== undefined) return parseColour(mine[f]!)
    if (theirs[f] !== undefined) return mirrorSeed(f, parseColour(theirs[f]!), mode)
    return undefined
  }
  const v: Partial<Record<Field, Oklch>> = {}
  for (const f of FIELDS) v[f] = pick(f)
  const canvasSupplied = v.canvas !== undefined
  const def = DEFAULT_SEEDS[mode]
  const present = new Set<Field>()
  for (const f of FIELDS) if (v[f] !== undefined) present.add(f)
  const canvas = v.canvas ?? parseColour(def.canvas)
  const ink = v.ink ?? parseColour(def.ink)
  const accent = v.accent ?? parseColour(def.accent)
  const surface = v.surface ?? (canvasSupplied ? undefined : parseColour(def.surface))
  const seeds: ModeSeeds = { canvas, ink, accent }
  if (surface) seeds.surface = surface
  for (const f of ['secondary', 'good', 'bad', 'warn', 'info'] as const) {
    const c = v[f]
    if (c) seeds[f] = c
  }
  if (mine.series) seeds.series = mine.series.map((s) => parseColour(s))
  else if (theirs.series) seeds.series = theirs.series.map((s) => mirrorSeed('accent', parseColour(s), mode))
  return { seeds, present }
}

function run(m: ThemeManifest, mode: Mode, dials: Dials, seeds: ModeSeeds, overrides: Record<string, string>) {
  return createResolver({ mode, defs: TOKENS, seeds, dials, fonts: { ...DEFAULT_FONTS, ...m.fonts }, overrides })
}

export function resolveMode(m: ThemeManifest, mode: Mode): { tokens: TokenMap; provenance: Record<string, Provenance> } {
  const { seeds, present } = buildSeeds(m, mode)
  const overrides = { ...m.overrides?.any, ...m.overrides?.[mode] }
  const dials: Dials = { ...DEFAULT_DIALS, ...m.dials }
  const tokens = run(m, mode, dials, seeds, overrides).all()
  const baseline = run(m, mode, DEFAULT_DIALS, seeds, overrides).all()
  const provenance: Record<string, Provenance> = {}
  for (const d of TOKENS) {
    const name = d.name
    let p: Provenance
    if (name in overrides) {
      p = { source: 'override', tier: d.tier, from: m.overrides?.[mode] && name in m.overrides[mode]! ? mode : 'any' }
    } else {
      const f = PASS_THROUGH[name]
      if (f && present.has(f)) p = { source: 'seed', tier: d.tier, from: f }
      else if (tokens[name] !== baseline[name]) p = { source: 'dial', tier: d.tier }
      else p = { source: 'default', tier: d.tier }
    }
    provenance[name] = p
  }
  return { tokens, provenance }
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function resolve(m: ThemeManifest): ResolvedTheme {
  const l = resolveMode(m, 'light'), d = resolveMode(m, 'dark')
  return {
    id: m.id,
    light: l.tokens,
    dark: d.tokens,
    provenance: { light: l.provenance, dark: d.provenance },
    key: fnv1a(JSON.stringify([l.tokens, d.tokens])),
  }
}
