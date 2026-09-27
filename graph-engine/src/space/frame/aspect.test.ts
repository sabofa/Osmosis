import { describe, expect, it } from 'vitest'
import type { Box3 } from '../scene/types'
import { graphMesh, parametricMesh, scene } from '../testing/marks'
import { boxHalfExtents } from './aspect'

const box = (sx: number, sy: number, sz: number): Box3 => ({
  x: { min: 0, max: sx },
  y: { min: 0, max: sy },
  z: { min: 0, max: sz },
})

const EMPTY = scene([])
const SADDLE = scene([graphMesh((x, y) => x * x - y * y, (x) => 2 * x, (_x, y) => -2 * y, -1, 1, -1, 1, 4)])
const SPHERE = scene([
  parametricMesh(
    (u, v) => [Math.sin(v) * Math.cos(u), Math.sin(v) * Math.sin(u), Math.cos(v)],
    (u, v) => [Math.sin(v) * Math.cos(u), Math.sin(v) * Math.sin(u), Math.cos(v)],
    0,
    2 * Math.PI,
    0,
    Math.PI,
    8,
    4,
  ),
])

describe('boxHalfExtents', () => {
  it('equal: proportional to the spans, max 1 — spans (4, 2, 1) give (1, 0.5, 0.25)', () => {
    expect(boxHalfExtents(box(4, 2, 1), { kind: 'equal' }, EMPTY)).toEqual([1, 0.5, 0.25])
  })

  it('auto: (1, 1, 0.7) whatever the spans', () => {
    expect(boxHalfExtents(box(4, 2, 1), { kind: 'auto' }, EMPTY)).toEqual([1, 1, 0.7])
  })

  it('a ratio 1:1:0.5 gives (1, 1, 0.5); a ratio is normalised to max 1', () => {
    expect(boxHalfExtents(box(4, 2, 1), { kind: 'ratio', x: 1, y: 1, z: 0.5 }, EMPTY)).toEqual([1, 1, 0.5])
    expect(boxHalfExtents(box(4, 2, 1), { kind: 'ratio', x: 2, y: 4, z: 1 }, EMPTY)).toEqual([0.5, 1, 0.25])
  })

  it('null with a graph surface (z = f) gives auto', () => {
    expect(boxHalfExtents(box(2, 2, 2), null, SADDLE)).toEqual([1, 1, 0.7])
  })

  it('null with only a parametric sphere, spans (2, 2, 2), gives equal (1, 1, 1)', () => {
    expect(boxHalfExtents(box(2, 2, 2), null, SPHERE)).toEqual([1, 1, 1])
  })

  it('null with spans (10, 1, 1) and no graph surface gives auto; (4, 1, 2) is within the factor of 4', () => {
    expect(boxHalfExtents(box(10, 1, 1), null, SPHERE)).toEqual([1, 1, 0.7])
    expect(boxHalfExtents(box(4, 1, 2), null, SPHERE)).toEqual([1, 0.25, 0.5])
  })

  it('V1: a flat z reads 0.15 under auto, not 0.7', () => {
    expect(boxHalfExtents(box(4, 2, 0.2), null, EMPTY, { z: true })).toEqual([1, 1, 0.15])
  })

  it('V1: an unflagged axis keeps 0.7 even when another axis is flat', () => {
    expect(boxHalfExtents(box(4, 2, 0.2), { kind: 'auto' }, EMPTY, { z: true })).toEqual([1, 1, 0.15])
  })

  it('V1: flat has no effect on equal or an explicit ratio', () => {
    expect(boxHalfExtents(box(4, 2, 1), { kind: 'equal' }, EMPTY, { z: true })).toEqual([1, 0.5, 0.25])
    expect(boxHalfExtents(box(4, 2, 1), { kind: 'ratio', x: 1, y: 1, z: 0.5 }, EMPTY, { z: true })).toEqual([1, 1, 0.5])
  })
})
