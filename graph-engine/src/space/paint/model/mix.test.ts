import { describe, expect, it } from 'vitest'
import { resolvePaintParams, type PaintParams } from '../params'
import type { Oklab } from '../types'
import { labToLch, lchToLab } from './colour'
import { GREY_FAMILIES, LoadMixer, type MixResult } from './mix'

const TERRACOTTA: Oklab = lchToLab(0.55, 0.12, 40)
const GREY: Oklab = [0.5, 0, 0]

// The sequential mixer (loads in painting order) serves the roles that are re-traced
// as the camera moves, the edges and the lines; an edge is damped to half, so these
// tests run it at full strength, as a block stroke would be.
const SEQUENTIAL = resolvePaintParams({ mix: { roleEdge: 1 } })

// Feed strokes of one role to a fresh mixer until it has opened `loads` loads.
function runLoads(params: PaintParams, loads: number, base: Oklab = TERRACOTTA, opts: { colormapped?: boolean; jitter?: number; role?: 'edge' | 'line' } = {}) {
  const mixer = new LoadMixer(params)
  const out: { r: MixResult; lab: Oklab }[] = []
  for (let i = 0; ; i++) {
    const r = mixer.mix({ role: opts.role ?? 'edge', cell: i, u: 0.6, x: 50, y: 50, lab: base, colormapped: !!opts.colormapped, seed: i, jitter: opts.jitter })
    // the stroke that opens load number `loads` + 1 ends the run: every load kept is complete
    if (mixer.loads > loads) break
    out.push({ r, lab: r.lab })
  }
  return out
}

const byLoad = (xs: ReturnType<typeof runLoads>): ReturnType<typeof runLoads>[] => {
  const groups = new Map<number, ReturnType<typeof runLoads>>()
  for (const x of xs) {
    const g = groups.get(x.r.load) ?? []
    g.push(x)
    groups.set(x.r.load, g)
  }
  return [...groups.values()]
}

describe('brush-load mix', () => {
  it('holds lightness within ±0.012 of the target, and a value-step load within 0.012 + 0.03', () => {
    const xs = runLoads(SEQUENTIAL, 600)
    let plainMax = 0
    let stepMax = 0
    let steps = 0
    for (const { r, lab } of xs) {
      const dL = Math.abs(lab[0] - TERRACOTTA[0])
      if (r.step === 0) plainMax = Math.max(plainMax, dL)
      else {
        stepMax = Math.max(stepMax, dL)
        steps++
      }
    }
    expect(plainMax).toBeLessThanOrEqual(0.012 + 1e-9)
    expect(plainMax).toBeGreaterThan(0.001) // there is variation, not a constant
    expect(steps).toBeGreaterThan(50)
    expect(stepMax).toBeLessThanOrEqual(0.012 + 0.03)
    // a value step really steps: ±0.03 on the first stroke of a load (drift fades it)
    const firstSteps = xs.filter((x) => x.r.step !== 0 && x.r.index === 0)
    expect(firstSteps.length).toBeGreaterThan(10)
    for (const { r, lab } of firstSteps) expect(lab[0] - TERRACOTTA[0]).toBeCloseTo(r.step * 0.03, 9)
  })

  it('takes a value step in about 25% of 2,000 loads (±3%)', () => {
    const xs = runLoads(SEQUENTIAL, 2000)
    const groups = byLoad(xs)
    expect(groups.length).toBe(2000)
    const stepped = groups.filter((g) => g[0].r.step !== 0).length
    expect(stepped / groups.length).toBeGreaterThan(0.22)
    expect(stepped / groups.length).toBeLessThan(0.28)
    // value steps alternate in sign when they come back to back
    const signs = groups.map((g) => g[0].r.step)
    let backToBack = 0
    let alternated = 0
    for (let i = 1; i < signs.length; i++) {
      if (signs[i] !== 0 && signs[i - 1] !== 0) {
        backToBack++
        if (signs[i] === -signs[i - 1]) alternated++
      }
    }
    expect(backToBack).toBeGreaterThan(30)
    expect(alternated).toBe(backToBack)
  })

  it('flips the hue sign between neighbouring loads 80% of the time (±3%), the chroma direction 75%', () => {
    const groups = byLoad(runLoads(SEQUENTIAL, 2000))
    let hueFlips = 0
    let chromaFlips = 0
    for (let i = 1; i < groups.length; i++) {
      if (Math.sign(groups[i][0].r.hueOffset) !== Math.sign(groups[i - 1][0].r.hueOffset)) hueFlips++
      if (Math.sign(groups[i][0].r.chromaOffset) !== Math.sign(groups[i - 1][0].r.chromaOffset)) chromaFlips++
    }
    const n = groups.length - 1
    expect(hueFlips / n).toBeGreaterThan(0.77)
    expect(hueFlips / n).toBeLessThan(0.83)
    expect(chromaFlips / n).toBeGreaterThan(0.72)
    expect(chromaFlips / n).toBeLessThan(0.78)
  })

  it('sizes a load 3..8 strokes and fades the offset to 45% by its last stroke', () => {
    const groups = byLoad(runLoads(SEQUENTIAL, 400, TERRACOTTA, { jitter: 0 }))
    const sizes = new Set<number>()
    for (const g of groups) {
      sizes.add(g.length)
      expect(g.length).toBeGreaterThanOrEqual(3)
      expect(g.length).toBeLessThanOrEqual(8)
      expect(g[0].r.kd).toBe(1)
      expect(g[g.length - 1].r.kd).toBeCloseTo(0.45, 12)
      // and the hue shift really fades: the last stroke carries 45% of the first's hue offset
      const hue = (lab: Oklab) => ((labToLch(lab)[2] - 40 + 540) % 360) - 180
      const first = hue(g[0].lab)
      const last = hue(g[g.length - 1].lab)
      if (Math.abs(first) > 3) expect(last / first).toBeCloseTo(0.45, 3)
    }
    // every size occurs
    expect([...sizes].sort()).toEqual([3, 4, 5, 6, 7, 8])
  })

  it('gives a grey an a/b offset of 0.012–0.026 toward one of four families', () => {
    const groups = byLoad(runLoads(SEQUENTIAL, 500, GREY))
    const famAngles = new Set<number>()
    for (const g of groups) {
      const lab = g[0].lab // first stroke: no drift
      const c = Math.hypot(lab[1], lab[2])
      expect(c).toBeGreaterThanOrEqual(0.012 - 1e-9)
      expect(c).toBeLessThanOrEqual(0.026 + 1e-9)
      expect(lab[0] - GREY[0]).toBeLessThanOrEqual(0.012 + 0.03)
      const deg = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI
      famAngles.add(Math.round((((deg % 360) + 360) % 360) / 60))
    }
    // the four families (62°, 255°, 135°, 315°, each ±18°) all turn up
    expect(famAngles.size).toBeGreaterThanOrEqual(4)
    // and at the last stroke the offset has faded to 45% of it
    const g = groups[0]
    const lastC = Math.hypot(g[g.length - 1].lab[1], g[g.length - 1].lab[2])
    expect(lastC / Math.hypot(g[0].lab[1], g[0].lab[2])).toBeCloseTo(0.45, 6)
  })

  it('steps a grey to the OPPOSITE family in turn: warm to cool, green-grey to violet-grey', () => {
    // the list is warm, green-grey, cool, violet-grey, so `fam + 2` is the opposite one (the first order, warm, cool, green,
    // violet, stepped warm to green-grey, 73 degrees away, and never from warm to cool)
    expect(GREY_FAMILIES).toEqual([62, 135, 255, 315])
    for (let i = 0; i < 4; i++) {
      const turn = Math.abs(GREY_FAMILIES[i] - GREY_FAMILIES[(i + 2) % 4])
      expect(Math.min(turn, 360 - turn), `family ${i}`).toBeGreaterThanOrEqual(165) // 167 and 180 degrees apart
    }
    // and the loads do it: three in five (the other two step to a neighbour) of consecutive loads of a grey point away from
    // each other, by at least 150 degrees (the family's own turn is +-18 degrees)
    const groups = byLoad(runLoads(SEQUENTIAL, 300, GREY))
    const angle = (lab: Oklab) => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI
    let opposite = 0
    for (let i = 1; i < groups.length; i++) {
      const d = Math.abs(angle(groups[i].at(0)!.lab) - angle(groups[i - 1].at(0)!.lab)) % 360
      if (Math.min(d, 360 - d) >= 150) opposite++
    }
    expect(opposite / (groups.length - 1)).toBeGreaterThan(0.5)
    expect(opposite / (groups.length - 1)).toBeLessThan(0.75)
  })

  it('keeps every offset inside the sliders even at strength 1.5 with the personal jitter at three sigma: chroma x0.7..x1.35, the value step at most 0.03', () => {
    const strong = resolvePaintParams({ mix: { roleEdge: 1, strength: 1.5 } })
    const mixer = new LoadMixer(strong)
    let chromaMax = 0
    let chromaMin = Infinity
    let stepMax = 0
    for (let i = 0; i < 1500; i++) {
      for (const [j0, j1] of [[3, 3], [3, -3], [-3, 3], [-3, -3]] as const) {
        const r = mixer.mix({ role: 'edge', cell: i, u: 0.6, x: 50, y: 50, lab: TERRACOTTA, colormapped: false, seed: i, jit0: j0, jit1: j1 })
        const lch = labToLch(r.lab)
        // the first stroke of a load has no drift: the whole offset
        if (r.index === 0) {
          chromaMax = Math.max(chromaMax, lch[1] / 0.12)
          chromaMin = Math.min(chromaMin, lch[1] / 0.12)
          if (r.step !== 0) stepMax = Math.max(stepMax, Math.abs(r.lab[0] - TERRACOTTA[0]))
        }
      }
    }
    expect(chromaMax).toBeLessThanOrEqual(1.35 + 1e-6)
    expect(chromaMin).toBeGreaterThanOrEqual(0.7 - 1e-6)
    // (it reached them: the clamp is what holds it)
    expect(chromaMax).toBeGreaterThan(1.3)
    expect(chromaMin).toBeLessThan(0.75)
    // a value step is valueStep (0.03) at most, plus the held noise of 0 for a stepped load
    expect(stepMax).toBeLessThanOrEqual(0.03 + 1e-9)
    expect(stepMax).toBeGreaterThan(0.025)
  })

  it('turns a coloured base by the load’s hue and scales its chroma, never leaving the hue range', () => {
    const groups = byLoad(runLoads(SEQUENTIAL, 400, TERRACOTTA, { jitter: 0 }))
    let up = 0
    let down = 0
    for (const g of groups) {
      const first = g[0]
      const lch = labToLch(first.lab)
      // |hue turn| is 12..25 degrees on the first stroke, whatever the sign
      const turn = Math.abs(((lch[2] - 40 + 540) % 360) - 180)
      expect(turn).toBeGreaterThanOrEqual(12 - 1e-6)
      expect(turn).toBeLessThanOrEqual(25 + 1e-6)
      // chroma goes x0.7 .. x1.35 of the base (when it fits the gamut)
      const ratio = lch[1] / 0.12
      expect(ratio).toBeGreaterThanOrEqual(0.7 - 1e-6)
      expect(ratio).toBeLessThanOrEqual(1.35 + 1e-6)
      if (ratio > 1) up++
      else down++
    }
    expect(up).toBeGreaterThan(80)
    expect(down).toBeGreaterThan(80)
  })

  it('keeps a colormapped surface true: a third of the hue and chroma offsets, lightness within 0.004', () => {
    const plain = runLoads(SEQUENTIAL, 100, TERRACOTTA, { jitter: 0 })
    const cm = runLoads(SEQUENTIAL, 100, TERRACOTTA, { jitter: 0, colormapped: true })
    for (let i = 0; i < Math.min(plain.length, cm.length); i++) {
      expect(cm[i].r.hueOffset).toBeCloseTo(plain[i].r.hueOffset / 3, 9)
      expect(cm[i].r.chromaOffset).toBeCloseTo(plain[i].r.chromaOffset / 3, 9)
      expect(Math.abs(cm[i].lab[0] - TERRACOTTA[0])).toBeLessThanOrEqual(0.004 + 1e-9)
      expect(cm[i].r.step).toBe(0) // no value steps on data colour
    }
  })

  it('scales with the master strength and the role multiplier, and a strength of zero is no mix', () => {
    const one = runLoads(SEQUENTIAL, 20, TERRACOTTA, { jitter: 0 })
    const two = runLoads(resolvePaintParams({ mix: { strength: 2, roleEdge: 1 } }), 20, TERRACOTTA, { jitter: 0 })
    for (let i = 0; i < 30; i++) expect(two[i].r.hueOffset).toBeCloseTo(2 * one[i].r.hueOffset, 9)
    const half = runLoads(resolvePaintParams({ mix: { roleEdge: 0.5 } }), 20, TERRACOTTA, { jitter: 0 })
    for (let i = 0; i < 30; i++) expect(half[i].r.hueOffset).toBeCloseTo(0.5 * one[i].r.hueOffset, 9)
    const off = new LoadMixer(resolvePaintParams({ mix: { strength: 0 } }))
    const r = off.mix({ role: 'edge', cell: 1, u: 0.6, x: 0, y: 0, lab: TERRACOTTA, colormapped: false, seed: 1 })
    expect(r.lab).toEqual(TERRACOTTA)
    expect(off.loads).toBe(0)
  })

  it('starts a new load when the next stroke is more than loadBreakPx away', () => {
    const m = new LoadMixer(SEQUENTIAL)
    const at = (x: number, cell: number) => m.mix({ role: 'edge', cell, u: 0.6, x, y: 0, lab: TERRACOTTA, colormapped: false, seed: cell, jitter: 0 })
    const a = at(0, 1)
    const b = at(100, 2) // 100 px: same load
    const c = at(300, 3) // 200 px on: a jump, a new load
    expect(b.load).toBe(a.load)
    expect(c.load).not.toBe(a.load)
    expect(c.index).toBe(0)
    // roles keep separate loads
    const d = m.mix({ role: 'line', cell: 9, u: 0.6, x: 300, y: 0, lab: TERRACOTTA, colormapped: false, seed: 9, jitter: 0 })
    expect(d.index).toBe(0)
    expect(m.loads).toBe(3)
  })

  it('keys a load to the cell of its first stroke', () => {
    const first = (cell: number, x: number, seed: number, p: PaintParams = SEQUENTIAL) =>
      new LoadMixer(p).mix({ role: 'edge', cell, u: 0.6, x, y: 7, lab: TERRACOTTA, colormapped: false, seed, jitter: 0 })
    const a = first(77, 10, 1)
    const b = first(77, 400, 99)
    expect(b.lab).toEqual(a.lab) // same cell: same offset, wherever it lands on screen
    expect(first(78, 10, 1).lab).not.toEqual(a.lab)
    // another seed rerolls every load
    expect(first(77, 10, 1, resolvePaintParams({ seed: 5 })).lab).not.toEqual(a.lab)
  })

  it('is deterministic: the same strokes in the same order give the same colours', () => {
    const a = runLoads(SEQUENTIAL, 50)
    const b = runLoads(SEQUENTIAL, 50)
    expect(a.map((x) => x.lab)).toEqual(b.map((x) => x.lab))
  })

  it('gives each stroke its own small jitter on top of the load', () => {
    const jittered = runLoads(SEQUENTIAL, 20)
    const clean = runLoads(SEQUENTIAL, 20, TERRACOTTA, { jitter: 0 })
    let differing = 0
    for (let i = 0; i < 30; i++) if (jittered[i].lab[1] !== clean[i].lab[1]) differing++
    expect(differing).toBeGreaterThan(25)
    // but only a little: a couple of degrees of hue
    const hue = (lab: Oklab) => ((labToLch(lab)[2] + 540) % 360) - 180
    for (let i = 0; i < 30; i++) expect(Math.abs(hue(jittered[i].lab) - hue(clean[i].lab))).toBeLessThan(10)
  })
})

describe('brush-load mix: a stroke that rides a load (mixFollow)', () => {
  const input = (i: number, lab: Oklab = TERRACOTTA) => ({ role: 'edge' as const, cell: i, u: 0.6, x: 10 * i, y: 0, lab, colormapped: false, seed: 1000 + i, jit0: 0.3, jit1: -0.2 })

  it('takes the offset of the load of the stroke before it, at the place in it that stroke has: the same colour as that stroke for the same input', () => {
    const mixer = new LoadMixer(SEQUENTIAL)
    for (let i = 0; i < 30; i++) {
      const member = mixer.mix(input(i))
      const rider = mixer.mixFollow(input(i))
      expect(rider.lab).toEqual(member.lab)
      expect(rider.load).toBe(member.load)
      expect(rider.index).toBe(member.index)
    }
  })

  it('takes no place of its own in the load: the strokes of the chain are mixed as if the riders were not there', () => {
    const plain = new LoadMixer(SEQUENTIAL)
    const withRiders = new LoadMixer(SEQUENTIAL)
    for (let i = 0; i < 60; i++) {
      const a = plain.mix(input(i))
      const b = withRiders.mix(input(i))
      // (riders of other colours, a good many of them, between the members)
      for (let k = 0; k < 1 + (i % 4); k++) withRiders.mixFollow({ ...input(1000 + 7 * i + k, lchToLab(0.7, 0.05, 200)), x: 5000 })
      expect(b.lab).toEqual(a.lab)
      expect(b.load).toBe(a.load)
      expect(b.index).toBe(a.index)
    }
    expect(withRiders.loads).toBe(plain.loads)
  })

  it('rides the offset on its own colour: a rider of another colour is that colour moved by a hue, not the member’s colour', () => {
    const mixer = new LoadMixer(SEQUENTIAL)
    mixer.mix(input(0))
    const other = lchToLab(0.7, 0.1, 250)
    const rider = mixer.mixFollow(input(0, other))
    expect(rider.lab[0]).toBeCloseTo(other[0], 1)
    const [, c0, h0] = labToLch(other)
    const [, c1, h1] = labToLch(rider.lab)
    expect(Math.abs(h1 - h0)).toBeGreaterThan(0.1)
    expect(Math.abs(h1 - h0)).toBeLessThan(40)
    expect(c1).toBeGreaterThan(0.5 * c0)
  })

  it('mixes as `mix` does where there is no load to ride: the first stroke of a role, and a role that is mixed by cell', () => {
    const a = new LoadMixer(SEQUENTIAL).mixFollow(input(3))
    const b = new LoadMixer(SEQUENTIAL).mix(input(3))
    expect(a.lab).toEqual(b.lab)
    expect(a.index).toBe(0)
    const block = { ...input(3), role: 'block' as const }
    expect(new LoadMixer(SEQUENTIAL).mixFollow(block).lab).toEqual(new LoadMixer(SEQUENTIAL).mix(block).lab)
  })

  it('is no mix at a strength of zero, like a stroke of the chain', () => {
    const none = resolvePaintParams({ mix: { strength: 0 } })
    const mixer = new LoadMixer(none)
    mixer.mix(input(0))
    expect(mixer.mixFollow(input(0)).lab).toEqual(TERRACOTTA)
  })
})
