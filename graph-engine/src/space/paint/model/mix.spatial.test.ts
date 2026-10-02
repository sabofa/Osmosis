import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import type { Oklab, Role } from '../types'
import { lchToLab } from './colour'
import { biased, isSpatialRole, LoadMixer } from './mix'
import { cellId } from './particles'

const TERRACOTTA: Oklab = lchToLab(0.55, 0.12, 40)

// A spatial mix of one stroke: a pure function of (role, cell, seed), so a fresh
// mixer, or a busy one, gives the same colour for the same arguments.
const mixOne = (params: PaintParams, role: Role, cell: number, seed = 1, x = 0, y = 0, jitter = 0) =>
  new LoadMixer(params).mix({ role, cell, u: 0.6, x, y, lab: TERRACOTTA, colormapped: false, seed, jitter })

describe('the spatial brush-load mix (surface strokes ride the surface)', () => {
  it('serves the surface roles, and leaves the lines and edges to the sequential mixer', () => {
    for (const role of ['block', 'form', 'scumble', 'glaze', 'reflected', 'dab'] as const) expect(isSpatialRole(role), role).toBe(true)
    expect(isSpatialRole('edge')).toBe(false)
    expect(isSpatialRole('line')).toBe(false)
  })

  it('is a pure function of (role, cell, seed): where the stroke lands on screen, and what came before, change nothing', () => {
    const cell = cellId(3, -2, 5)
    const a = mixOne(DEFAULT_PAINT_PARAMS, 'block', cell, 77, 10, 10)
    const busy = new LoadMixer(DEFAULT_PAINT_PARAMS)
    for (let i = 0; i < 40; i++) busy.mix({ role: 'block', cell: cellId(i, 1, 2), u: 0.4, x: 900 * i, y: 3, lab: TERRACOTTA, colormapped: false, seed: i })
    const b = busy.mix({ role: 'block', cell, u: 0.6, x: 600, y: 500, lab: TERRACOTTA, colormapped: false, seed: 77, jitter: 0 })
    expect(b.lab).toEqual(a.lab)
    // another cell, another seed, another role: another colour
    expect(mixOne(DEFAULT_PAINT_PARAMS, 'block', cellId(4, -2, 5), 77).lab).not.toEqual(a.lab)
    expect(mixOne(resolvePaintParams({ seed: 5 }), 'block', cell, 77).lab).not.toEqual(a.lab)
  })

  it('gives each role its own offset in a cell (the role is in the seed), even at the same strength', () => {
    const level = resolvePaintParams({ mix: { roleBlock: 1, roleForm: 1 } })
    const cell = cellId(3, -2, 5)
    const block = mixOne(level, 'block', cell, 77)
    const form = mixOne(level, 'form', cell, 77)
    // the same cell parity gives the same sign, the role's own draws a different size
    expect(Math.sign(form.hueOffset)).toBe(Math.sign(block.hueOffset))
    expect(Math.abs(form.hueOffset - block.hueOffset)).toBeGreaterThan(0.01)
    expect(mixOne(level, 'block', cell, 77).hueOffset).toBe(block.hueOffset)
  })

  it('gives neighbouring cells opposite hue signs (the parity of ci + cj + ck), and a second parity the chroma direction', () => {
    let opposite = 0
    let chromaOpposite = 0
    let n = 0
    for (let ci = -6; ci <= 6; ci++) {
      for (let cj = -6; cj <= 6; cj++) {
        const here = mixOne(DEFAULT_PAINT_PARAMS, 'block', cellId(ci, cj, 1))
        const nextI = mixOne(DEFAULT_PAINT_PARAMS, 'block', cellId(ci + 1, cj, 1))
        const nextJ = mixOne(DEFAULT_PAINT_PARAMS, 'block', cellId(ci, cj + 1, 1))
        if (Math.sign(here.hueOffset) !== Math.sign(nextI.hueOffset)) opposite++
        if (Math.sign(here.hueOffset) !== Math.sign(nextJ.hueOffset)) opposite++
        // the chroma direction flips with cj, and is the same across ci
        if (Math.sign(here.chromaOffset) !== Math.sign(nextJ.chromaOffset)) chromaOpposite++
        n++
      }
    }
    expect(opposite).toBe(2 * n)
    expect(chromaOpposite).toBe(n)
  })

  it('has the + hue and chroma directions come up (1 + bias)/2 of the time, by a threshold on the cell’s own draw', () => {
    const share = (bias: number, pick: (r: ReturnType<typeof mixOne>) => number): number => {
      const p = resolvePaintParams({ mix: { hueBias: bias, chromaBias: bias, valueBias: bias } })
      let up = 0
      let n = 0
      for (let ci = 0; ci < 60; ci++) {
        for (let cj = 0; cj < 60; cj++) {
          up += pick(mixOne(p, 'block', cellId(ci, cj, 0))) > 0 ? 1 : 0
          n++
        }
      }
      return up / n
    }
    const hue = (r: ReturnType<typeof mixOne>) => r.hueOffset
    const chroma = (r: ReturnType<typeof mixOne>) => r.chromaOffset
    expect(share(0, hue)).toBeCloseTo(0.5, 2)
    expect(share(0.5, hue)).toBeGreaterThan(0.72)
    expect(share(0.5, hue)).toBeLessThan(0.78)
    expect(share(-0.5, hue)).toBeGreaterThan(0.22)
    expect(share(-0.5, hue)).toBeLessThan(0.28)
    expect(share(0.5, chroma)).toBeGreaterThan(0.72)
    expect(share(0.5, chroma)).toBeLessThan(0.78)
    expect(share(1, hue)).toBe(1)
    expect(share(-1, chroma)).toBe(0)
  })

  it('biased() turns the minority sign over by the draw and leaves the majority alone', () => {
    expect(biased(1, 0.5, 0.1)).toBe(1)
    expect(biased(-1, 0.5, 0.4)).toBe(1) // a draw under the bias turns a - into a +
    expect(biased(-1, 0.5, 0.6)).toBe(-1)
    expect(biased(1, -0.25, 0.2)).toBe(-1)
    expect(biased(1, -0.25, 0.3)).toBe(1)
    expect(biased(-1, -0.25, 0.1)).toBe(-1)
    expect(biased(1, 0, 0.0001)).toBe(1)
  })

  it('holds lightness within ±0.012, takes a value step in about a quarter of the cells, and drifts by a seeded fraction', () => {
    let plainMax = 0
    let steps = 0
    let n = 0
    let kdMin = 1
    let kdMax = 0
    for (let ci = 0; ci < 50; ci++) {
      for (let cj = 0; cj < 50; cj++) {
        const cell = cellId(ci, cj, 2)
        const r = mixOne(DEFAULT_PAINT_PARAMS, 'block', cell, ci * 50 + cj)
        n++
        kdMin = Math.min(kdMin, r.kd)
        kdMax = Math.max(kdMax, r.kd)
        // a plain cell moves L by its draw times the drift (within the hold); a value step is ±0.03 times the drift
        if (r.step === 0) plainMax = Math.max(plainMax, Math.abs(r.lab[0] - TERRACOTTA[0]))
        else {
          steps++
          expect(Math.abs(r.lab[0] - TERRACOTTA[0])).toBeCloseTo(0.03 * r.kd, 9)
        }
      }
    }
    expect(plainMax).toBeLessThanOrEqual(0.012 + 1e-9)
    expect(steps / n).toBeGreaterThan(0.22)
    expect(steps / n).toBeLessThan(0.28)
    // the drift runs from `drift` (0.45) at the end of a cell to the whole offset at its start
    expect(kdMin).toBeGreaterThanOrEqual(0.45 - 1e-9)
    expect(kdMax).toBeLessThanOrEqual(1)
    expect(kdMin).toBeLessThan(0.5)
    expect(kdMax).toBeGreaterThan(0.95)
  })

  it('counts one load per (role, cell), however many strokes land in it', () => {
    const m = new LoadMixer(DEFAULT_PAINT_PARAMS)
    const cell = cellId(1, 2, 3)
    for (let i = 0; i < 9; i++) m.mix({ role: 'block', cell, u: 0.6, x: i * 400, y: 0, lab: TERRACOTTA, colormapped: false, seed: i })
    expect(m.loads).toBe(1)
    m.mix({ role: 'form', cell, u: 0.6, x: 0, y: 0, lab: TERRACOTTA, colormapped: false, seed: 1 })
    m.mix({ role: 'block', cell: cellId(2, 2, 3), u: 0.6, x: 0, y: 0, lab: TERRACOTTA, colormapped: false, seed: 1 })
    expect(m.loads).toBe(3)
  })

  it('keeps a colormapped surface true: a third of the offsets, lightness within 0.004', () => {
    const plain = mixOne(DEFAULT_PAINT_PARAMS, 'block', cellId(5, 5, 5))
    const cm = new LoadMixer(DEFAULT_PAINT_PARAMS).mix({ role: 'block', cell: cellId(5, 5, 5), u: 0.6, x: 0, y: 0, lab: TERRACOTTA, colormapped: true, seed: 1, jitter: 0 })
    expect(cm.hueOffset).toBeCloseTo(plain.hueOffset / 3, 9)
    expect(cm.chromaOffset).toBeCloseTo(plain.chromaOffset / 3, 9)
    expect(Math.abs(cm.lab[0] - TERRACOTTA[0])).toBeLessThanOrEqual(0.004 + 1e-9)
    expect(cm.step).toBe(0)
  })
})

describe('the cell id a surface cell carries (particles.ts)', () => {
  it('is a hash with the cell’s parities in its low four bits, so neighbours differ in them', () => {
    expect(cellId(0, 0, 0) & 15).toBe(0)
    expect(cellId(1, 0, 0) & 1).toBe(1)
    expect(cellId(0, 1, 0) & 3).toBe(1 | 2) // ci + cj + ck odd, cj odd
    expect((cellId(0, 1, 0) >> 2) & 3).toBe(2) // (ci + 2 cj + 3 ck) mod 4
    expect((cellId(1, 0, 0) >> 2) & 3).toBe(1)
    expect((cellId(0, 0, 1) >> 2) & 3).toBe(3)
    // negative cells keep their parities
    expect(cellId(-1, 0, 0) & 1).toBe(1)
    expect(cellId(-1, -1, 0) & 1).toBe(0)
    // and distinct cells keep distinct ids
    const ids = new Set<number>()
    for (let i = -8; i < 8; i++) for (let j = -8; j < 8; j++) for (let k = -8; k < 8; k++) ids.add(cellId(i, j, k))
    expect(ids.size).toBeGreaterThan(3500) // 4096 cells; the hash is not perfect
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(0)
  })
})
