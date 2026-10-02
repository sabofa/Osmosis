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

// Points to test inside [lo, hi]: both ends and `count` interior points (kept
// inside the box: lo + width * r can round one ulp past hi).
export function pointsIn(lo: number, hi: number, rand: () => number, count: number): number[] {
  const out = [lo, hi]
  for (let i = 0; i < count; i++) out.push(Math.min(hi, lo + (hi - lo) * rand()))
  return out
}

// Whether the scalar value y at a point of the box is allowed by the twin's
// answer `r` (the soundness contract in the plan's Global Constraints).
export function admits(r: Iv, y: number): boolean {
  if (Number.isNaN(y)) return r.v <= PARTIAL
  if (y === Infinity) return r.v <= PARTIAL || r.hi === Infinity
  if (y === -Infinity) return r.v <= PARTIAL || r.lo === -Infinity
  return r.lo <= y && y <= r.hi
}
