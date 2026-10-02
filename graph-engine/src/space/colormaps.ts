// Space's colormaps (plan E1, E2; spec SP5 "Colormaps"). Pure.
//
// Every map is a list of anchor colours at evenly spaced t, interpolated in
// Oklab (oklab.ts), so equal steps in t are roughly equal steps in perceived
// colour. The sequential maps' anchors are their published 9-step samples;
// `balance` is built per theme, because its neutral centre is the theme's
// background brought to a fixed lightness.
//
// A map becomes a 256-entry RGBA8 table (colormapTable), which the GL layer
// uploads as a 256 x 1 texture and the colorbar samples for its gradient.
//
// normalise() takes a value to t in [0, 1] for a scale. Its formula is
// written once, generically (NormaliseOps), and instantiated twice: over
// numbers for the CPU (the colorbar, readouts) and over GLSL source text for
// the mesh shader, so the two cannot drift apart.

import { mixLab, oklabToSrgb, srgbToOklab, type Lab } from './oklab'
import type { ColormapName, ColorScale, Range } from './scene/types'
import { hexToRgb, type Rgb } from './theme'

// The published 9-step samples of each sequential map, t = 0, 1/8, ..., 1.
export const SEQUENTIAL_ANCHORS: Record<Exclude<ColormapName, 'balance'>, readonly number[]> = {
  viridis: [0x440154, 0x472d7b, 0x3b528b, 0x2c728e, 0x21908c, 0x27ad81, 0x5dc863, 0xaadc32, 0xfde725],
  magma: [0x000004, 0x1d1147, 0x51127c, 0x822681, 0xb63679, 0xe65164, 0xfb8861, 0xfec287, 0xfcfdbf],
  plasma: [0x0d0887, 0x4c02a1, 0x7e03a8, 0xa92395, 0xcc4778, 0xe66c5c, 0xf89540, 0xfdc328, 0xf0f921],
  cividis: [0x00204d, 0x00336f, 0x39486b, 0x575c6d, 0x707173, 0x8a8779, 0xa69d75, 0xc4b56c, 0xe4cf5b],
  gray: [0x1a1a1a, 0xf2f2f2],
}

// balance: blue, a neutral centre, red.
export const BALANCE_BLUE = 0x2f5aa8
export const BALANCE_RED = 0xb8322a
// The neutral centre's Oklab lightness: the background, lightened or
// darkened to this. S6 plan V7: dark was 0.3, close enough to the dark
// background's own lightness (render/palette.ts DARK_PALETTE.background is
// Oklab L ~0.23) that the centre nearly vanished against it (S3, parked);
// 0.62 lightens it well clear. Light darkens only slightly, 0.975 (the
// light background) to 0.92, since the warm paper background already sits
// near the top of the scale.
export const BALANCE_NEUTRAL_L: Record<'light' | 'dark', number> = { light: 0.92, dark: 0.62 }

export const TABLE_SIZE = 256

// What a map needs from the theme: which one, and its background (balance's
// neutral is made from it). A SpaceColors is one.
export interface ColormapTheme {
  theme: 'light' | 'dark'
  background: Rgb
}

export function isDiverging(name: ColormapName): boolean {
  return name === 'balance'
}

// The anchors of a map, in Oklab, evenly spaced in t.
//
// balance: the two ends keep their hue and chroma (a, b) but take the mean of
// their two lightnesses, so each half runs between the same two L values and
// the map is symmetric in lightness about its centre (blue #2F5AA8 is L 0.48
// and red #B8322A is L 0.52 as published: left alone, a value and its
// negative would read as different magnitudes).
export function colormapAnchors(name: ColormapName, theme: ColormapTheme): Lab[] {
  if (name !== 'balance') return SEQUENTIAL_ANCHORS[name].map((hex) => srgbToOklab(hexToRgb(hex)))
  const blue = srgbToOklab(hexToRgb(BALANCE_BLUE))
  const red = srgbToOklab(hexToRgb(BALANCE_RED))
  const background = srgbToOklab(theme.background)
  const neutral: Lab = [BALANCE_NEUTRAL_L[theme.theme], background[1], background[2]]
  const ends = (blue[0] + red[0]) / 2
  return [[ends, blue[1], blue[2]], neutral, [ends, red[1], red[2]]]
}

function sampleAnchors(anchors: readonly Lab[], t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t))
  const segments = anchors.length - 1
  const x = clamped * segments
  const i = Math.min(segments - 1, Math.floor(x))
  return oklabToSrgb(mixLab(anchors[i], anchors[i + 1], x - i))
}

// The map's colour at t in [0, 1] (clamped), unrounded.
export function colormapAt(name: ColormapName, theme: ColormapTheme, t: number): Rgb {
  return sampleAnchors(colormapAnchors(name, theme), t)
}

// The byte triple nearest `c` in Oklab among the 8 floor/ceil choices of its
// channels, never darker than `minL` when a choice allows it. Rounding each
// channel on its own can dip a smooth ramp's lightness by ~4e-4 between
// neighbours (viridis at entries 86 and 112), which a lightness-monotone map
// must not do.
function quantise(c: Rgb, minL: number): { bytes: [number, number, number]; L: number } {
  const target = srgbToOklab(c)
  const choices = c.map((v) => {
    const x = v * 255
    return Math.floor(x) === Math.ceil(x) ? [x] : [Math.floor(x), Math.ceil(x)]
  })
  let best: { bytes: [number, number, number]; L: number; d: number; ok: boolean } | null = null
  for (const r of choices[0]) {
    for (const g of choices[1]) {
      for (const b of choices[2]) {
        const lab = srgbToOklab([r / 255, g / 255, b / 255])
        const d = (lab[0] - target[0]) ** 2 + (lab[1] - target[1]) ** 2 + (lab[2] - target[2]) ** 2
        const ok = lab[0] >= minL
        if (!best || (ok && !best.ok) || (ok === best.ok && d < best.d)) best = { bytes: [r, g, b], L: lab[0], d, ok }
      }
    }
  }
  return best!
}

// Tables made so far, by (map, theme, background): a table is never
// modified after it is made, so every caller shares it.
const TABLES = new Map<string, Uint8Array>()

// The map as 256 RGBA8 entries, entry i at t = i / 255, alpha 255. A
// sequential map's entries never decrease in Oklab lightness (quantise).
// Shared and read-only: callers must not write into it.
export function colormapTable(name: ColormapName, theme: ColormapTheme): Uint8Array {
  const key = `${name}|${theme.theme}|${theme.background.join(',')}`
  let table = TABLES.get(key)
  if (!table) {
    table = buildTable(name, theme)
    TABLES.set(key, table)
  }
  return table
}

function buildTable(name: ColormapName, theme: ColormapTheme): Uint8Array {
  const anchors = colormapAnchors(name, theme)
  const monotone = !isDiverging(name)
  const out = new Uint8Array(TABLE_SIZE * 4)
  let previous = -Infinity
  for (let i = 0; i < TABLE_SIZE; i++) {
    const { bytes, L } = quantise(sampleAnchors(anchors, i / (TABLE_SIZE - 1)), monotone ? previous : -Infinity)
    out.set([...bytes, 255], i * 4)
    previous = L
  }
  return out
}

// Entry i of a table as 0..1 floats.
export function tableEntry(table: Uint8Array, i: number): Rgb {
  return [table[i * 4] / 255, table[i * 4 + 1] / 255, table[i * 4 + 2] / 255]
}

// ---------------------------------------------------------------------------
// Normalising a value (E2)

// A domain of zero width, or zero magnitude, would divide by zero: the
// divisor is floored at this, far below any real span.
export const NORMALISE_TINY = 1e-30

// The arithmetic the formula is written in, so one formula serves the CPU
// (T = number) and the shader (T = GLSL source).
export interface NormaliseOps<T> {
  num(value: number): T
  add(a: T, b: T): T
  sub(a: T, b: T): T
  mul(a: T, b: T): T
  div(a: T, b: T): T
  abs(a: T): T
  max(a: T, b: T): T
}

// (v - min) / (max - min)
export function sequentialFormula<T>(o: NormaliseOps<T>, v: T, lo: T, hi: T): T {
  return o.div(o.sub(v, lo), o.max(o.sub(hi, lo), o.num(NORMALISE_TINY)))
}

// 0.5 + v / (2 max(|min|, |max|)): zero is the centre of the map.
export function divergingFormula<T>(o: NormaliseOps<T>, v: T, lo: T, hi: T): T {
  return o.add(o.num(0.5), o.div(v, o.mul(o.num(2), o.max(o.max(o.abs(lo), o.abs(hi)), o.num(NORMALISE_TINY)))))
}

const CPU: NormaliseOps<number> = {
  num: (v) => v,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  abs: Math.abs,
  max: Math.max,
}

// A GLSL float literal: always with a decimal point or an exponent.
export function glslFloat(value: number): string {
  const text = String(value)
  return /[.e]/.test(text) ? text.replace(/^(\d+)e/, '$1.0e') : `${text}.0`
}

const GLSL: NormaliseOps<string> = {
  num: glslFloat,
  add: (a, b) => `(${a} + ${b})`,
  sub: (a, b) => `(${a} - ${b})`,
  mul: (a, b) => `(${a} * ${b})`,
  div: (a, b) => `(${a} / ${b})`,
  abs: (a) => `abs(${a})`,
  max: (a, b) => `max(${a}, ${b})`,
}

// The two formulas as GLSL expressions over `v`, `lo` and `hi`.
export const NORMALISE_GLSL = {
  sequential: sequentialFormula(GLSL, 'v', 'lo', 'hi'),
  diverging: divergingFormula(GLSL, 'v', 'lo', 'hi'),
}

// normaliseScalar(v, lo, hi, diverging) for the mesh shader, clamped to [0, 1].
// A non-finite scalar is "no data" and never reaches it (the shader tests it
// first, as normalise() does).
export const NORMALISE_GLSL_FUNCTION = /* glsl */ `
float normaliseScalar(float v, float lo, float hi, bool diverging) {
  float t = diverging ? ${NORMALISE_GLSL.diverging} : ${NORMALISE_GLSL.sequential};
  return clamp(t, 0.0, 1.0);
}
`

export interface NormaliseScale {
  domain: Range
  diverging: boolean
}

// A value's position on a scale's map, in [0, 1], or null for "no data" (a
// non-finite value), which draws in the palette's grid colour.
export function normalise(v: number, scale: NormaliseScale): number | null {
  if (!Number.isFinite(v)) return null
  const { min, max } = scale.domain
  const t = scale.diverging ? divergingFormula(CPU, v, min, max) : sequentialFormula(CPU, v, min, max)
  return Math.min(1, Math.max(0, t))
}

// The colour a value takes on a scale: the table entry nearest its t, or
// `noData` for a non-finite value.
export function colorOf(v: number, scale: Pick<ColorScale, 'domain' | 'diverging'>, table: Uint8Array, noData: Rgb): Rgb {
  const t = normalise(v, scale)
  if (t === null) return noData
  return tableEntry(table, Math.round(t * (TABLE_SIZE - 1)))
}
