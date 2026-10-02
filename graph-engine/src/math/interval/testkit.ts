// Test helpers for the interval twin: a seeded generator (math/ never uses
// Math.random) and the soundness check every twin is held to.

import type { Iv } from './core'
import { PARTIAL } from './core'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A random box: a centre on a log-ish scale up to ±1e3, a width from 1e-9 to
// 40, sometimes degenerate, sometimes touching an integer or zero.
export function randomBox(rand: () => number): [number, number] {
  const r = rand()
  const sign = rand() < 0.5 ? -1 : 1
  const centre = r < 0.15 ? Math.round(sign * rand() * 6) : sign * Math.pow(10, rand() * 4 - 1) * rand()
  const width = rand() < 0.08 ? 0 : Math.pow(10, rand() * 10.6 - 9)
  const lo = rand() < 0.1 ? centre : centre - width * rand()
  return [lo, lo + width]
}

// The zeros a box holds: a box end that is a zero is that signed zero; a zero
// strictly inside may be either sign (the scalar compile can be asked for both
// and 1 / +0 and 1 / -0 differ).
export function zerosIn(lo: number, hi: number): number[] {
  if (lo < 0 && hi > 0) return [0, -0]
  const out: number[] = []
  if (lo === 0) out.push(lo)
  if (hi === 0 && !(lo === 0 && Object.is(lo, hi))) out.push(hi)
  return out
}

// Points to test inside [lo, hi]: both ends, the signed zeros the box holds, and
// `count` interior points (kept inside the box: lo + width * r can round one ulp
// past hi, and the width of a very wide box overflows).
export function pointsIn(lo: number, hi: number, rand: () => number, count: number): number[] {
  const out = [lo, hi]
  for (const z of zerosIn(lo, hi)) if (!Object.is(z, lo) && !Object.is(z, hi)) out.push(z)
  const width = hi - lo
  for (let i = 0; i < count; i++) {
    const r = rand()
    const x = Number.isFinite(width) ? lo + width * r : lo * (1 - r) + hi * r
    out.push(x !== x ? lo : Math.max(lo, Math.min(hi, x)))
  }
  return out
}

// Whether the scalar value y at a point of the box is allowed by the twin's
// answer `r` (the soundness contract in the plan's Global Constraints): a finite
// value lies inside the bounds; a NaN needs a partial or unknown verdict; an
// infinity needs the bound on its side to be that infinity, whatever the verdict
// (a later operation may map an infinity back to a finite value, c / inf = 0, so
// an excused infinity becomes a wrong finite answer downstream). An empty answer
// has no infinite bound, so it admits only a NaN.
export function admits(r: Iv, y: number): boolean {
  if (Number.isNaN(y)) return r.v <= PARTIAL
  if (y === Infinity) return r.hi === Infinity
  if (y === -Infinity) return r.lo === -Infinity
  return r.lo <= y && y <= r.hi
}
