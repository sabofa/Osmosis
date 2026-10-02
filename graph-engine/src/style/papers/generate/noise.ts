// Tileable noise for the paper generator: periodic gradient (Perlin) lattices
// summed into fractional Brownian motion, with an optional domain warp. Every
// lattice WRAPS, so a field is seamless across the tile's edges by
// construction. Ported from the approved mockup's core.js; the structure is
// the same, the inner loops are precomputed per axis so a 1024^2 field costs
// a few tens of milliseconds.
//
// All randomness comes from a `Random` (style/random.ts: FNV-1a into
// mulberry32), keyed by the caller on the paper's type, seed and stage, so a
// field is a pure function of its identity.

import type { Random } from '../../random'

const TAU = Math.PI * 2

// The mockup's feature counts are "cells across a 1024-texel tile". For another
// tile size the counts scale with it, so the feature SIZE in texels stays put.
export function scaleCells(cells: number, size: number): number {
  return Math.max(1, Math.round((cells * size) / 1024))
}

// Quintic fade, as in Perlin's improved noise.
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

interface Lattice {
  nx: number
  ny: number
  gx: Float32Array
  gy: Float32Array
}

function makeLattice(random: Random, nx: number, ny: number): Lattice {
  const n = nx * ny
  const gx = new Float32Array(n)
  const gy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = random.next() * TAU
    gx[i] = Math.cos(a)
    gy[i] = Math.sin(a)
  }
  return { nx, ny, gx, gy }
}

interface Octaves {
  lattices: Lattice[]
  amps: number[]
  norm: number
}

function makeOctaves(random: Random, cx: number, cy: number, octaves: number, gain: number): Octaves {
  const lattices: Lattice[] = []
  const amps: number[] = []
  let amp = 1
  let sum = 0
  for (let k = 0; k < octaves; k++) {
    const f = 1 << k
    lattices.push(makeLattice(random, cx * f, cy * f))
    amps.push(amp)
    sum += amp
    amp *= gain
  }
  // 1.41 is the nominal peak of one octave of 2D gradient noise: the sum spans about -1.4..1.4.
  return { lattices, amps, norm: 1.41 / sum }
}

// One axis of the separable (unwarped) evaluation: for each of `n` sample
// positions, the lattice cell, its wrapped neighbour, the fraction inside the
// cell and the faded fraction.
function axisTable(n: number, cells: number) {
  const c0 = new Int32Array(n)
  const c1 = new Int32Array(n)
  const f = new Float64Array(n)
  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = ((i + 0.5) / n) * cells
    const cell = Math.floor(p)
    c0[i] = cell % cells
    c1[i] = c0[i] + 1 === cells ? 0 : c0[i] + 1
    f[i] = p - cell
    u[i] = fade(f[i])
  }
  return { c0, c1, f, u }
}

// A w x h evaluation grid over the whole tile.
function evalSeparable(o: Octaves, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let k = 0; k < o.lattices.length; k++) {
    const L = o.lattices[k]
    const amp = o.amps[k] * o.norm
    const ax = axisTable(w, L.nx)
    const ay = axisTable(h, L.ny)
    const { gx, gy, nx } = L
    for (let y = 0; y < h; y++) {
      const r0 = ay.c0[y] * nx
      const r1 = ay.c1[y] * nx
      const fy = ay.f[y]
      const vy = ay.u[y]
      const row = y * w
      for (let x = 0; x < w; x++) {
        const fx = ax.f[x]
        const i00 = r0 + ax.c0[x]
        const i10 = r0 + ax.c1[x]
        const i01 = r1 + ax.c0[x]
        const i11 = r1 + ax.c1[x]
        const d00 = gx[i00] * fx + gy[i00] * fy
        const d10 = gx[i10] * (fx - 1) + gy[i10] * fy
        const d01 = gx[i01] * fx + gy[i01] * (fy - 1)
        const d11 = gx[i11] * (fx - 1) + gy[i11] * (fy - 1)
        const ux = ax.u[x]
        const a = d00 + ux * (d10 - d00)
        const b = d01 + ux * (d11 - d01)
        out[row + x] += amp * (a + vy * (b - a))
      }
    }
  }
  return out
}

// Warped evaluation on a w x h grid: the sample point of every texel is moved
// by (wx, wy) times (warpX, warpY) grid texels first, so the lattice lookup is
// per texel. The warp is smaller than half a tile, so wrapping a cell is one
// conditional add.
function evalWarped(o: Octaves, w: number, h: number, wx: Float32Array, wy: Float32Array, warpX: number, warpY: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let k = 0; k < o.lattices.length; k++) {
    const { gx, gy, nx, ny } = o.lattices[k]
    const amp = o.amps[k] * o.norm
    const kx = nx / w
    const ky = ny / h
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        const i = row + x
        const u = (x + 0.5 + wx[i] * warpX) * kx
        const v = (y + 0.5 + wy[i] * warpY) * ky
        const fu = Math.floor(u)
        const fv = Math.floor(v)
        const fx = u - fu
        const fy = v - fv
        let x0 = fu
        let y0 = fv
        if (x0 >= nx) x0 -= nx
        else if (x0 < 0) x0 += nx
        if (y0 >= ny) y0 -= ny
        else if (y0 < 0) y0 += ny
        const x1 = x0 + 1 === nx ? 0 : x0 + 1
        const y1 = y0 + 1 === ny ? 0 : y0 + 1
        const i00 = y0 * nx + x0
        const i10 = y0 * nx + x1
        const i01 = y1 * nx + x0
        const i11 = y1 * nx + x1
        const d00 = gx[i00] * fx + gy[i00] * fy
        const d10 = gx[i10] * (fx - 1) + gy[i10] * fy
        const d01 = gx[i01] * fx + gy[i01] * (fy - 1)
        const d11 = gx[i11] * (fx - 1) + gy[i11] * (fy - 1)
        const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        const vy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        const a = d00 + ux * (d10 - d00)
        const b = d01 + ux * (d11 - d01)
        out[i] += amp * (a + vy * (b - a))
      }
    }
  }
  return out
}

// Bilinear sampling tables for resampling `from` samples to `to`, periodic.
export interface ResampleAxis {
  i0: Int32Array
  i1: Int32Array
  f: Float64Array
}

export function resampleAxis(from: number, to: number): ResampleAxis {
  const i0 = new Int32Array(to)
  const i1 = new Int32Array(to)
  const f = new Float64Array(to)
  for (let i = 0; i < to; i++) {
    const p = ((i + 0.5) * from) / to - 0.5
    const cell = Math.floor(p)
    f[i] = p - cell
    i0[i] = ((cell % from) + from) % from
    i1[i] = i0[i] + 1 === from ? 0 : i0[i] + 1
  }
  return { i0, i1, f }
}

// Periodic bilinear resample of a field of fw x fh samples to tw x th.
export function upsamplePeriodic(src: Float32Array, fw: number, fh: number, tw: number, th: number): Float32Array {
  if (fw === tw && fh === th) return src
  const ax = resampleAxis(fw, tw)
  const ay = resampleAxis(fh, th)
  const out = new Float32Array(tw * th)
  for (let y = 0; y < th; y++) {
    const r0 = ay.i0[y] * fw
    const r1 = ay.i1[y] * fw
    const fy = ay.f[y]
    const row = y * tw
    for (let x = 0; x < tw; x++) {
      const a = src[r0 + ax.i0[x]]
      const b = src[r0 + ax.i1[x]]
      const c = src[r1 + ax.i0[x]]
      const d = src[r1 + ax.i1[x]]
      const top = a + (b - a) * ax.f[x]
      out[row + x] = top + (c + (d - c) * ax.f[x] - top) * fy
    }
  }
  return out
}

// A field that has not been upsampled to the tile yet: w x h samples spanning it.
export interface Field {
  data: Float32Array
  w: number
  h: number
}

// Sums fields of different grids into one on the finest of their grids, so a
// slow mottle and a finer grain become a single field to resample once.
export function mixFields(parts: Array<{ field: Field; amount: number }>): Field {
  const w = Math.max(...parts.map((p) => p.field.w))
  const h = Math.max(...parts.map((p) => p.field.h))
  const data = new Float32Array(w * h)
  for (const { field, amount } of parts) {
    const up = upsamplePeriodic(field.data, field.w, field.h, w, h)
    for (let i = 0; i < data.length; i++) data[i] += amount * up[i]
  }
  return { data, w, h }
}

export interface FbmSpec {
  // Lattice cells across the tile of the first octave; octave k has 2^k times as many.
  cx: number
  cy?: number // default cx
  octaves?: number // default 4
  gain?: number // default 0.5
  // Domain warp: the sample point moves by two smaller fBm fields times `amp`
  // texels of the OUTPUT size (under half a tile). The warp is smooth, so it
  // is evaluated coarsely.
  warp?: { amp: number; cx: number; cy?: number; octaves?: number }
  // Evaluate on a coarser grid and upsample, for fields with no detail finer
  // than a few texels: a number for a square grid, or [width, height] for a
  // field that is smooth along one axis only (long streaks).
  grid?: number | [number, number]
}

function gridOf(grid: FbmSpec['grid'], size: number): [number, number] {
  const clamp = (n: number) => Math.min(size, Math.max(8, Math.round(n)))
  if (grid === undefined) return [size, size]
  return typeof grid === 'number' ? [clamp(grid), clamp(grid)] : [clamp(grid[0]), clamp(grid[1])]
}

// Tileable fBm on the spec's evaluation grid (the whole tile unless `grid`
// says coarser). Amplitude is roughly -1.4..1.4 before `normStd`; the mean is
// near zero.
export function fbmField(random: Random, size: number, spec: FbmSpec): Field {
  const [gw, gh] = gridOf(spec.grid, size)
  const o = makeOctaves(random, spec.cx, spec.cy ?? spec.cx, spec.octaves ?? 4, spec.gain ?? 0.5)
  if (!spec.warp) return { data: evalSeparable(o, gw, gh), w: gw, h: gh }
  const w = spec.warp
  // The warp is made of low-frequency fields, so a coarse grid carries it exactly enough.
  const ws = Math.min(gw, gh, 128)
  const warpField = () => {
    const f = evalSeparable(makeOctaves(random, w.cx, w.cy ?? w.cx, w.octaves ?? 2, 0.5), ws, ws)
    return upsamplePeriodic(f, ws, ws, gw, gh)
  }
  const wx = warpField()
  const wy = warpField()
  return { data: evalWarped(o, gw, gh, wx, wy, (w.amp * gw) / size, (w.amp * gh) / size), w: gw, h: gh }
}

// The same, upsampled to the full tile.
export function fbm(random: Random, size: number, spec: FbmSpec): Float32Array {
  const f = fbmField(random, size, spec)
  return upsamplePeriodic(f.data, f.w, f.h, size, size)
}

// Zero mean and standard deviation `sd` (1 unless said), in place.
export function normStd(a: Float32Array, sd = 1): Float32Array {
  const n = a.length
  let sum = 0
  let sq = 0
  for (let i = 0; i < n; i++) {
    const v = a[i]
    sum += v
    sq += v * v
  }
  const mean = sum / n
  const inv = sd / (Math.sqrt(Math.max(0, sq / n - mean * mean)) || 1)
  for (let i = 0; i < n; i++) a[i] = (a[i] - mean) * inv
  return a
}

export const fbmN = (random: Random, size: number, spec: FbmSpec): Float32Array => normStd(fbm(random, size, spec))

// Unit-variance fBm left on its evaluation grid, to be mixed and resampled once.
export const fbmFieldN = (random: Random, size: number, spec: FbmSpec): Field => {
  const f = fbmField(random, size, spec)
  normStd(f.data)
  return f
}

// Smooth periodic 1D noise of `len` samples with `cells` lattice cells: the
// last sample runs into the first. Quintic-joined random values in [-1, 1].
export function periodic1D(random: Random, cells: number, len: number): Float32Array {
  const v = new Float32Array(cells + 1)
  for (let i = 0; i < cells; i++) v[i] = random.next() * 2 - 1
  v[cells] = v[0] // the wrap, so the loop below needs no modulo
  const out = new Float32Array(len)
  const step = cells / len
  for (let x = 0; x < len; x++) {
    const p = x * step
    const i0 = p | 0
    const f = p - i0
    const a = v[i0]
    out[x] = a + (v[i0 + 1] - a) * fade(f)
  }
  return out
}
