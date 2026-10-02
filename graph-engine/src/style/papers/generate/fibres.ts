// Loose fibres: faint, short, slightly curling strands lying on the weave.
// The mockup drew them with canvas 2D; this rasterises the same thing in plain
// code so the generator runs in node. Each strand blends its colour offset into
// the tile's OKLab offsets at a low alpha, with wrap-around so strands cross
// the tile's edges.

import type { Random } from '../../random'
import type { Vec3 } from './oklab'

export interface FibreSpec {
  count: number // for a 1024 tile; scaled by area for another size
  len: [number, number] // texels
  curl: number // radians of direction change per segment
  wid: [number, number] // texels
  alpha: [number, number]
  // Colour of a strand as an OKLab OFFSET from the tile's base, picked by weight.
  colours: Array<{ delta: Vec3; weight: number }>
}

interface Strand {
  pts: number[] // x0, y0, x1, y1, ...
  w: number
  a: number
  colour: Vec3
}

function makeStrands(random: Random, size: number, spec: FibreSpec): Strand[] {
  const count = Math.round((spec.count * size * size) / (1024 * 1024))
  let totalWeight = 0
  for (const c of spec.colours) totalWeight += c.weight
  const strands: Strand[] = []
  for (let n = 0; n < count; n++) {
    const len = random.range(spec.len[0], spec.len[1])
    let ang = random.next() * Math.PI * 2
    let x = random.next() * size
    let y = random.next() * size
    const seg = Math.max(3, Math.round(len / 7))
    const step = len / seg
    const curl = spec.curl * (0.6 + random.next() * 0.8)
    const pts = [x, y]
    for (let s = 0; s < seg; s++) {
      ang += random.gauss() * curl
      x += Math.cos(ang) * step
      y += Math.sin(ang) * step
      pts.push(x, y)
    }
    let pick = random.next() * totalWeight
    let ci = 0
    while (ci < spec.colours.length - 1 && pick > spec.colours[ci].weight) {
      pick -= spec.colours[ci].weight
      ci++
    }
    strands.push({ pts, w: random.range(spec.wid[0], spec.wid[1]), a: random.range(spec.alpha[0], spec.alpha[1]), colour: spec.colours[ci].delta })
  }
  return strands
}

export function fibrePass(off: Float32Array, size: number, random: Random, spec: FibreSpec): void {
  const strands = makeStrands(random, size, spec)
  // Coverage of the strand being drawn, so a joint between two segments is not counted twice.
  const cover = new Float32Array(size * size)
  const touched: number[] = []
  const wrap = (v: number) => (v >= 0 && v < size ? v : ((v % size) + size) % size)
  for (const s of strands) {
    const half = s.w / 2
    for (let p = 0; p + 3 < s.pts.length; p += 2) {
      const ax = s.pts[p]
      const ay = s.pts[p + 1]
      const bx = s.pts[p + 2]
      const by = s.pts[p + 3]
      const dx = bx - ax
      const dy = by - ay
      const invL2 = 1 / (dx * dx + dy * dy || 1)
      // A texel centre further than half a strand width plus half a texel from the segment is not covered.
      const reach = half + 0.5
      const reach2 = reach * reach
      const x0 = Math.floor(Math.min(ax, bx) - reach)
      const x1 = Math.ceil(Math.max(ax, bx) + reach)
      const y0 = Math.floor(Math.min(ay, by) - reach)
      const y1 = Math.ceil(Math.max(ay, by) + reach)
      for (let yy = y0; yy <= y1; yy++) {
        const row = wrap(yy) * size
        const py = yy + 0.5 - ay
        for (let xx = x0; xx <= x1; xx++) {
          const px = xx + 0.5 - ax
          const t = Math.min(1, Math.max(0, (px * dx + py * dy) * invL2))
          const ex = px - t * dx
          const ey = py - t * dy
          const d2 = ex * ex + ey * ey
          if (d2 >= reach2) continue
          const c = Math.min(1, reach - Math.sqrt(d2))
          const i = row + wrap(xx)
          if (cover[i] === 0) touched.push(i)
          if (c > cover[i]) cover[i] = c
        }
      }
    }
    for (const i of touched) {
      const a = s.a * cover[i]
      const o = i * 3
      off[o] += (s.colour[0] - off[o]) * a
      off[o + 1] += (s.colour[1] - off[o + 1]) * a
      off[o + 2] += (s.colour[2] - off[o + 2]) * a
      cover[i] = 0
    }
    touched.length = 0
  }
}
