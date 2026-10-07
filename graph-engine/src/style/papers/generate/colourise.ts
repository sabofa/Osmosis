// Colourising a paper tile: the theme's base tone plus the tile's OKLab
// offsets, lit at a grazing angle by the tile's height. This is the cheap
// per-texel pass that recolours a tile when the theme or a custom tint changes;
// the structure itself is never regenerated.
//
// `texture` scales the relief lighting (and the dither), so 0 is flat colour, 1 the
// type's default lighting and 2 strong. The tile's own height was ALREADY scaled
// by the texture it was generated at, so the two multiply: a tile generated at
// texture t and coloured at t is lit t-squared. Pass 1 here for a tile generated
// at the texture you want, or generate at 1 and pass the live texture here.
//
// The relief follows the mockup's shadeEmit: the surface slope (central
// differences of the height, wrapping at the tile's edge) against a light
// near the horizon scales the encoded colour, with a little occlusion in the
// low spots and a deterministic dither so a faint gradient does not band.

import type { ColourisePaper, GeneratedPaperType } from './types'

// The relief light. Azimuth is measured counter-clockwise from +x in a y-UP
// frame, so 135 degrees lights the paper from the upper left, as in the mockup.
const AZIMUTH = (135 * Math.PI) / 180
const ELEVATION = (23 * Math.PI) / 180
const LX = Math.cos(AZIMUTH) * Math.cos(ELEVATION)
const LY = -Math.sin(AZIMUTH) * Math.cos(ELEVATION) // texel rows run DOWN
const LZ = Math.sin(ELEVATION)

// How hard each paper's height is lit at texture 1, and how much its low spots darken.
const SHADING: Record<GeneratedPaperType, { gain: number; ao: number }> = {
  linen: { gain: 0.3, ao: 0.03 },
  canvas: { gain: 0.32, ao: 0.1 },
  // The grain papers: the tooth catches the light, a little on writing paper and its ruled kin, more on
  // rough paper and kraft.
  paperFine: { gain: 0.35, ao: 0.04 },
  paperRough: { gain: 0.5, ao: 0.08 },
  kraft: { gain: 0.45, ao: 0.08 },
  notebook: { gain: 0.3, ao: 0.03 },
  graphPaper: { gain: 0.32, ao: 0.03 },
  dotted: { gain: 0.3, ao: 0.03 },
  // Slate has a fine tooth the light finds; a whiteboard is smooth, and a glossy sheet is not lit by slope.
  blackboard: { gain: 0.35, ao: 0.05 },
  greenboard: { gain: 0.35, ao: 0.05 },
  whiteboard: { gain: 0.05, ao: 0 },
}

// Linear light (0..1) to an sRGB channel (0..255), by table with linear interpolation.
const STEPS = 4096
const ENCODE = new Float32Array(STEPS + 2)
for (let i = 0; i <= STEPS + 1; i++) {
  const v = Math.min(1, i / STEPS)
  ENCODE[i] = 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
}
function encode(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v
  const t = c * STEPS
  const i = t | 0
  return ENCODE[i] + (ENCODE[i + 1] - ENCODE[i]) * (t - i)
}

export const colourisePaper: ColourisePaper = (tile, base, texture) => {
  const size = tile.size
  const n = size * size
  if (tile.offsets.length !== 3 * n || tile.height.length !== n) {
    throw new RangeError(`paper tile of size ${size} needs ${3 * n} offsets and ${n} heights`)
  }
  const strength = Number.isFinite(texture) ? Math.max(0, texture) : 1
  const shade = SHADING[tile.type]
  const gain = shade.gain * strength
  const ao = shade.ao * strength
  const dither = 0.9 * Math.min(1, strength)
  const H = tile.height
  const off = tile.offsets
  const out = new Uint8ClampedArray(4 * n)
  for (let y = 0; y < size; y++) {
    const up = (y === 0 ? size - 1 : y - 1) * size
    const down = (y === size - 1 ? 0 : y + 1) * size
    const row = y * size
    for (let x = 0; x < size; x++) {
      const left = x === 0 ? size - 1 : x - 1
      const right = x === size - 1 ? 0 : x + 1
      const i = row + x
      const hx = (H[row + right] - H[row + left]) * 0.5
      const hy = (H[down + x] - H[up + x]) * 0.5
      const f = (1 - (gain * (hx * LX + hy * LY)) / LZ) * (1 - ao * (0.5 - H[i]))

      const o = i * 3
      const L = base[0] + off[o]
      const a = base[1] + off[o + 1]
      const b = base[2] + off[o + 2]
      const l = L + 0.3963377774 * a + 0.2158037573 * b
      const m = L - 0.1055613458 * a - 0.0638541728 * b
      const s = L - 0.0894841775 * a - 1.291485548 * b
      const l3 = l * l * l
      const m3 = m * m * m
      const s3 = s * s * s

      // A cheap integer hash of the texel, split into two uniforms: triangular dither.
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
      h ^= h >>> 13
      h = Math.imul(h, 0xc2b2ae35)
      h ^= h >>> 16
      const dd = ((h & 0xffff) / 65536 + ((h >>> 16) / 65536) - 1) * dither

      const o4 = i * 4
      out[o4] = encode(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3) * f + dd
      out[o4 + 1] = encode(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3) * f + dd
      out[o4 + 2] = encode(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3) * f + dd
      out[o4 + 3] = 255
    }
  }
  return out
}
