// What the paper structures share: seeded randomness by stage, adding a noise layer to the OKLab
// offsets, soft specks and strokes stamped on a PERIODIC tile (anything that crosses an edge comes in
// on the other side, so a tile never shows its seam), and a periodic blur.
//
// A structure is colour-free: per-texel OKLab offsets (dL, da, db) and a height, around whatever base
// tone the theme gives the tile (colourise.ts). So a lightness offset of 0.01 is the same amount of
// "a little lighter" on cream, kraft, slate or white.

import { randomFor } from '../../../random'
import type { Random } from '../../../random'
import { upsamplePeriodic } from '../noise'
import type { Field } from '../noise'
import type { Vec3 } from '../oklab'

// One stage of one paper's randomness: the same type, seed and stage always give the same stream.
export const stageOf = (type: string, seed: string, stage: string): Random => randomFor(`paper/${type}/${seed}/${stage}`)

// How a lightness change comes with a little warm/cool drift, in the direction a brighter cream goes
// (structure.ts's BRIGHTNESS, scaled to a unit of dL): lighter is a touch yellower.
export const WARM: Vec3 = [1, 0.002, 0.035]
// A change of lightness alone.
export const NEUTRAL: Vec3 = [1, 0, 0]

// `field` (unit variance, on its own grid) times `amount` times `sensitivity`, added to `off` (3 per texel).
export function addLayer(off: Float32Array, size: number, field: Field, amount: number, sensitivity: Vec3): void {
  if (amount === 0) return
  const full = upsamplePeriodic(field.data, field.w, field.h, size, size)
  const s0 = amount * sensitivity[0]
  const s1 = amount * sensitivity[1]
  const s2 = amount * sensitivity[2]
  for (let i = 0, o = 0; i < full.length; i++, o += 3) {
    const v = full[i]
    off[o] += s0 * v
    off[o + 1] += s1 * v
    off[o + 2] += s2 * v
  }
}

// Every channel of `off` given a mean of zero: a paper tile is structure AROUND its base tone, so the
// tone the theme gives is the tone the tile has on average.
export function centreOffsets(off: Float32Array): void {
  const n = off.length / 3
  for (let c = 0; c < 3; c++) {
    let sum = 0
    for (let i = c; i < off.length; i += 3) sum += off[i]
    const mean = sum / n
    for (let i = c; i < off.length; i += 3) off[i] -= mean
  }
}

export const smoothstep = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

const wrap = (v: number, size: number) => (v >= 0 && v < size ? v : ((v % size) + size) % size)

export interface SpeckSpec {
  count: number // for a 1024 tile; scaled by area for another size
  radius: [number, number] // texels (the semi-major axis)
  stretch: [number, number] // semi-minor over semi-major: 1 a round speck, less a sliver
  alpha: [number, number]
  // The OKLab OFFSET a full-strength speck blends toward (so a dark fleck is a negative dL).
  delta: [Vec3, Vec3] // picked between the two by a random amount
}

// Soft elliptical specks stamped at random places and angles, blended toward their colour offset by
// their alpha. Wraps around the tile's edges.
export function speckPass(off: Float32Array, size: number, random: Random, spec: SpeckSpec): void {
  const count = Math.round((spec.count * size * size) / (1024 * 1024))
  for (let n = 0; n < count; n++) {
    const x = random.next() * size
    const y = random.next() * size
    const rx = random.range(spec.radius[0], spec.radius[1])
    const ry = rx * random.range(spec.stretch[0], spec.stretch[1])
    const angle = random.next() * Math.PI
    const alpha = random.range(spec.alpha[0], spec.alpha[1])
    const mix = random.next()
    const target: Vec3 = [
      spec.delta[0][0] + (spec.delta[1][0] - spec.delta[0][0]) * mix,
      spec.delta[0][1] + (spec.delta[1][1] - spec.delta[0][1]) * mix,
      spec.delta[0][2] + (spec.delta[1][2] - spec.delta[0][2]) * mix,
    ]
    stampSpeck(off, size, x, y, rx, ry, angle, target, alpha)
  }
}

export function stampSpeck(off: Float32Array, size: number, x: number, y: number, rx: number, ry: number, angle: number, target: Vec3, alpha: number): void {
  const reach = Math.ceil(Math.max(rx, ry) + 1)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const px = x0 + dx + 0.5 - x
      const py = y0 + dy + 0.5 - y
      const u = (px * cos + py * sin) / rx
      const v = (-px * sin + py * cos) / ry
      const d2 = u * u + v * v
      if (d2 >= 1) continue
      const a = alpha * (1 - d2) * (1 - d2)
      const o = (wrap(y0 + dy, size) * size + wrap(x0 + dx, size)) * 3
      off[o] += (target[0] - off[o]) * a
      off[o + 1] += (target[1] - off[o + 1]) * a
      off[o + 2] += (target[2] - off[o + 2]) * a
    }
  }
}

// The coverage (0..1) of polylines of width `width` on a periodic tile: 1 on the line, falling to 0 over a
// texel at its edge. `lines` are flat x, y, x, y, ... lists (they may run past the tile; they wrap).
export function strokeMask(size: number, lines: readonly (readonly number[])[], width: number): Float32Array {
  const mask = new Float32Array(size * size)
  const reach = width / 2 + 0.5
  const reach2 = reach * reach
  for (const pts of lines) {
    for (let p = 0; p + 3 < pts.length; p += 2) {
      const ax = pts[p]
      const ay = pts[p + 1]
      const bx = pts[p + 2]
      const by = pts[p + 3]
      const dx = bx - ax
      const dy = by - ay
      const inv = 1 / (dx * dx + dy * dy || 1)
      const x0 = Math.floor(Math.min(ax, bx) - reach)
      const x1 = Math.ceil(Math.max(ax, bx) + reach)
      const y0 = Math.floor(Math.min(ay, by) - reach)
      const y1 = Math.ceil(Math.max(ay, by) + reach)
      for (let yy = y0; yy <= y1; yy++) {
        const row = wrap(yy, size) * size
        const py = yy + 0.5 - ay
        for (let xx = x0; xx <= x1; xx++) {
          const px = xx + 0.5 - ax
          const t = Math.min(1, Math.max(0, (px * dx + py * dy) * inv))
          const ex = px - t * dx
          const ey = py - t * dy
          const d2 = ex * ex + ey * ey
          if (d2 >= reach2) continue
          const c = Math.min(1, reach - Math.sqrt(d2))
          const i = row + wrap(xx, size)
          if (c > mask[i]) mask[i] = c
        }
      }
    }
  }
  return mask
}

// A periodic box blur: `passes` runs of a window of 2 * radius + 1 texels, along x and then along y.
export function blurPeriodic(a: Float32Array, size: number, radius: number, passes = 1): Float32Array {
  const width = 2 * radius + 1
  let src = a
  for (let pass = 0; pass < passes; pass++) {
    const across = new Float32Array(a.length)
    for (let y = 0; y < size; y++) {
      const row = y * size
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += src[row + wrap(k, size)]
      for (let x = 0; x < size; x++) {
        across[row + x] = sum / width
        sum += src[row + wrap(x + radius + 1, size)] - src[row + wrap(x - radius, size)]
      }
    }
    const down = new Float32Array(a.length)
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += across[wrap(k, size) * size + x]
      for (let y = 0; y < size; y++) {
        down[y * size + x] = sum / width
        sum += across[wrap(y + radius + 1, size) * size + x] - across[wrap(y - radius, size) * size + x]
      }
    }
    src = down
  }
  return src
}
