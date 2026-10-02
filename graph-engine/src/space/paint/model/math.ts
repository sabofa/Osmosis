// Small numeric helpers shared by the paint model (spec 2026-10-02-painted-
// figures-design.md §3). Pure; nothing here knows about scenes or strokes.

export type V3 = [number, number, number]

export const TAU = Math.PI * 2
export const D2R = Math.PI / 180

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// Hermite smoothstep from a to b. A reversed pair (a > b) runs the other way.
export function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const vadd = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const vsub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const vmul = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const vdot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const vcross = (a: readonly number[], b: readonly number[]): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const vlen = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2])
export function vnorm(a: readonly number[]): V3 {
  const l = vlen(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

// A 32-bit hash of three integers (a surface cell, a quantised position).
// Deterministic and platform independent: only Math.imul and shifts.
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// hash3 as a uniform number in [0, 1).
export const hash01 = (a: number, b: number, c: number): number => hash3(a, b, c) / 4294967296

// A 32-bit mix of two unsigned integers.
export function mix2(a: number, b: number): number {
  return hash3(a, b, 0x51ed270b)
}

// Smooth value noise in 3D, in [-1, 1]: a hashed value at each lattice corner, joined by a smoothstep fade. A pure function
// of the position and the seed, so noise keyed on a point of a SURFACE is the same whichever way the camera looks at it.
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const corner = (a: number, b: number, c: number): number => hash01(ix + a, iy + b, mix2(iz + c, seed)) * 2 - 1
  const x00 = corner(0, 0, 0) + (corner(1, 0, 0) - corner(0, 0, 0)) * ux
  const x10 = corner(0, 1, 0) + (corner(1, 1, 0) - corner(0, 1, 0)) * ux
  const x01 = corner(0, 0, 1) + (corner(1, 0, 1) - corner(0, 0, 1)) * ux
  const x11 = corner(0, 1, 1) + (corner(1, 1, 1) - corner(0, 1, 1)) * ux
  const y0 = x00 + (x10 - x00) * uy
  const y1 = x01 + (x11 - x01) * uy
  return y0 + (y1 - y0) * uz
}

// Rotate d about the unit axis n by `angle` (Rodrigues, d ⟂ n assumed).
export function rotateAbout(d: readonly number[], n: readonly number[], angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = vcross(n, d)
  return [d[0] * c + k[0] * s, d[1] * c + k[1] * s, d[2] * c + k[2] * s]
}

// Reusable typed arrays for the per-frame analysis (a 1280×800 view is a
// 640×400 G-buffer, a dozen arrays a frame). A scratch array lives until the
// next call under the same name asks for a different length, and is NOT
// cleared: the caller writes every element, or fills it itself. Arrays that
// leave paintFrame inside its result are never scratch.
const scratchPool = new Map<string, ArrayBufferView>()
function scratch<T extends ArrayBufferView & { length: number }>(name: string, length: number, make: (n: number) => T): T {
  const have = scratchPool.get(name) as T | undefined
  if (have && have.length === length) return have
  const next = make(length)
  scratchPool.set(name, next)
  return next
}
export const scratchF32 = (name: string, n: number): Float32Array => scratch(name, n, (k) => new Float32Array(k))
export const scratchU8 = (name: string, n: number): Uint8Array => scratch(name, n, (k) => new Uint8Array(k))
export const scratchI32 = (name: string, n: number): Int32Array => scratch(name, n, (k) => new Int32Array(k))
