import { describe, it, expect } from 'vitest'
import { gridPlan, niceStep, resolveStep, shouldLabel } from './grid'
import { defaultConfig } from '../parser/config'

describe('resolveStep', () => {
  it('keeps the author’s step while it draws a readable number of lines', () => {
    expect(resolveStep(0.25, 1.1, 6)).toBe(0.25) // ~4 divisions, as written
    expect(resolveStep(7, 63, 6)).toBe(7)
  })

  it('compresses a fixed step when zoomed far out', () => {
    // 0.25 over a span of 200 would be 800 lines; fall back to the nice step.
    expect(resolveStep(0.25, 200, 6)).toBe(niceStep(200, 6))
    expect(niceStep(200, 6)).toBe(10)
    expect(resolveStep(0.25, 2000, 6)).toBe(100)
  })

  it('expands a fixed step when zoomed far in', () => {
    // 0.25 over a span of 0.3 would be one line; fall back to a finer nice step.
    expect(resolveStep(0.25, 0.3, 6)).toBe(niceStep(0.3, 6))
    expect(niceStep(0.3, 6)).toBeLessThanOrEqual(0.05)
  })

  it('uses the nice step when no step is fixed', () => {
    expect(resolveStep(null, 10, 6)).toBe(niceStep(10, 6))
  })
})


describe('shouldLabel', () => {
  it('labels every gridline by default', () => {
    const config = defaultConfig()
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(true)
    expect(shouldLabel(7, config)).toBe(true)
  })

  it('labels nothing when @labels is none', () => {
    const config = { ...defaultConfig(), labels: 'none' as const }
    expect(shouldLabel(0, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(false)
  })

  it('labels only every 5th line under @label-every: 5', () => {
    const config = { ...defaultConfig(), labelEvery: 5 }
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(true)
    expect(shouldLabel(10, config)).toBe(true)
  })

  // "coarse" means the major gridlines, which grid.ts already draws every
  // 5th step — so it is exactly @label-every: 5 without having to say so.
  it('coarse labels the major gridlines', () => {
    const config = { ...defaultConfig(), labels: 'coarse' as const }
    expect(shouldLabel(0, config)).toBe(true)
    expect(shouldLabel(1, config)).toBe(false)
    expect(shouldLabel(5, config)).toBe(true)
  })

  it('label-every wins over coarse when both are set', () => {
    const config = { ...defaultConfig(), labels: 'coarse' as const, labelEvery: 2 }
    expect(shouldLabel(2, config)).toBe(true)
    expect(shouldLabel(5, config)).toBe(false)
  })
})

describe('resolveStep in geometric mode', () => {
  // The author's step doubles as the view grows, instead of being replaced by
  // the universal 1-2-5 ladder and instead of jumping straight to higher
  // powers of the base. A spec written in 8s shows 8s, then 16s, then 32s,
  // then 64s — every rung a whole multiple of 8, never a jump to 64.
  it('doubles the step when zooming out', () => {
    expect(resolveStep(8, 60, 6, 'geometric')).toBe(8)
    expect(resolveStep(8, 150, 6, 'geometric')).toBe(32)
    expect(resolveStep(8, 500, 6, 'geometric')).toBe(64)
    expect(resolveStep(8, 4000, 6, 'geometric')).toBe(512)
  })

  // The base is a floor, not a rung to subdivide past. @xstep: 8 means 8 is
  // the finest grid ever drawn — the whole point of geometric mode is to
  // withhold coordinates finer than the author's base, so zooming in must
  // never hand the learner a sub-base line. This holds across several
  // successive zoom-in factors, not just the first one past the base.
  it('never drops the step below the base when zooming in', () => {
    expect(resolveStep(8, 6, 6, 'geometric')).toBe(8)
    expect(resolveStep(8, 0.7, 6, 'geometric')).toBe(8)
    expect(resolveStep(8, 0.07, 6, 'geometric')).toBe(8)
    expect(resolveStep(8, 0.007, 6, 'geometric')).toBe(8)
  })

  it('doubles from a base of 10 (which no longer lands on 100)', () => {
    expect(resolveStep(10, 70, 6, 'geometric')).toBe(10)
    expect(resolveStep(10, 700, 6, 'geometric')).toBe(160)
    expect(resolveStep(10, 7000, 6, 'geometric')).toBe(1280)
  })

  it('doubles from a base of 5', () => {
    expect(resolveStep(5, 35, 6, 'geometric')).toBe(5)
    expect(resolveStep(5, 175, 6, 'geometric')).toBe(40)
    expect(resolveStep(5, 875, 6, 'geometric')).toBe(160)
  })

  it('falls back to nice when no fixed step was given', () => {
    expect(resolveStep(null, 10, 6, 'geometric')).toBe(niceStep(10, 6))
  })
})

describe('resolveStep in fixed mode', () => {
  it('never rescales while the division count stays sane', () => {
    expect(resolveStep(0.25, 200, 6, 'fixed')).toBe(0.25)
  })

  // Without a guard this would ask for 40,000 gridlines and lock the tab.
  it('falls back to nice rather than drawing a pathological number of lines', () => {
    expect(resolveStep(0.25, 100000, 6, 'fixed')).toBe(niceStep(100000, 6))
  })
})

describe('gridPlan', () => {
  const SIZE = { widthPx: 800, heightPx: 480 }
  const MARGINS = { x: 0.7, y: 0.4 }
  const OFFSET = { x: 0.5, y: 0.5 }
  const bounds = (xMin: number, xMax: number, yMin: number, yMax: number) => ({ xMin, xMax, yMin, yMax })

  // The step loops GridRenderer.draw used before frameTicks, run by hand.
  const oldWalk = (min: number, max: number, step: number) => {
    const out: number[] = []
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
    return out
  }

  it('reproduces the linear step loops exactly', () => {
    const plan = gridPlan(bounds(-10, 10, -6, 6), defaultConfig(), SIZE, MARGINS, OFFSET)
    const stepX = resolveStep(null, 20, 6)
    const stepY = resolveStep(null, 12, 6)
    expect(plan.faintX).toEqual(oldWalk(-10, 10, stepX))
    expect(plan.faintY).toEqual(oldWalk(-6, 6, stepY))
    expect(plan.strongX).toEqual(oldWalk(-10, 10, stepX * 5))
    expect(plan.strongY).toEqual(oldWalk(-6, 6, stepY * 5))
    expect(plan.strongX).toEqual([-10, -5, 0, 5, 10])
  })

  it('labels linear ticks with the precise formatter, "0" only on the y pass', () => {
    const plan = gridPlan(bounds(-10, 10, -6, 6), defaultConfig(), SIZE, MARGINS, OFFSET)
    expect(plan.labelsX.map((l) => l.label)).toEqual(
      ['−10', '−9', '−8', '−7', '−6', '−5', '−4', '−3', '−2', '−1', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    )
    expect(plan.labelsX[0].at).toEqual({ x: -10, y: -OFFSET.y })
    expect(plan.labelsY.map((l) => l.label)).toContain('0')
    expect(plan.labelsY[0].at).toEqual({ x: -OFFSET.x, y: -6 })
  })

  it('draws a log axis: decades strong with power labels, 2..9 faint', () => {
    const config = defaultConfig()
    config.scales.y = 'log'
    const plan = gridPlan(bounds(-10, 10, 0, 4), config, SIZE, MARGINS, OFFSET)
    expect(plan.strongY).toEqual([0, 1, 2, 3, 4])
    expect(plan.labelsY.map((l) => l.label)).toEqual(['1', '10', '10²', '10³', '10⁴'])
    const minors: number[] = []
    for (let k = 0; k < 4; k++) for (let m = 2; m <= 9; m++) minors.push(Math.log10(m) + k)
    expect(plan.faintY).toHaveLength(minors.length)
    plan.faintY.forEach((v, i) => expect(v).toBeCloseTo(minors[i], 12))
    // labels are drawn at forward(value): 1 sits at v = 0
    expect(plan.labelsY[0].at.y).toBeCloseTo(0, 12)
  })

  it('walks pi steps with pi labels', () => {
    const config = defaultConfig()
    config.space.ticks.x = { value: Math.PI / 2, pi: { num: 1, den: 2 } }
    const plan = gridPlan(bounds(0, 2 * Math.PI, -2, 2), config, SIZE, MARGINS, OFFSET)
    expect(plan.faintX).toHaveLength(5)
    plan.faintX.forEach((v, k) => expect(v).toBeCloseTo((k * Math.PI) / 2, 12))
    // 0 is skipped on the x pass (the y pass owns it), the rest are pi labels
    expect(plan.labelsX.map((l) => l.label)).toEqual(['π/2', 'π', '3π/2', '2π'])
  })

  it('pins y labels to the left edge when the y-axis is off-screen', () => {
    const plan = gridPlan(bounds(20, 30, -6, 6), defaultConfig(), SIZE, MARGINS, OFFSET)
    expect(plan.labelsY.length).toBeGreaterThan(0)
    for (const l of plan.labelsY) expect(l.at.x).toBeCloseTo(20 + MARGINS.x, 12)
    // x labels keep riding the on-screen x-axis
    for (const l of plan.labelsX) expect(l.at.y).toBe(-OFFSET.y)
  })
})

describe('resolveStep defaults', () => {
  it('behaves exactly as before when no mode is passed', () => {
    expect(resolveStep(0.25, 200, 6)).toBe(resolveStep(0.25, 200, 6, 'nice'))
  })
})

describe('gridPlan titles', () => {
  const SIZE = { widthPx: 800, heightPx: 480 }
  const view = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }
  const withTitles = (x: string, y: string) => {
    const c = defaultConfig()
    return { ...c, space: { ...c.space, titles: { x, y, z: '' } } }
  }

  it('carries the @titles of the space config as placements', () => {
    const plan = gridPlan(view, withTitles('t (s)', 'v (m/s)'), SIZE, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.5 })
    expect(plan.titles.map((t) => [t.axis, t.text])).toEqual([['x', 't (s)'], ['y', 'v (m/s)']])
  })

  it('has none for empty titles or with the axes off', () => {
    expect(gridPlan(view, withTitles('', ''), SIZE, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.5 }).titles).toEqual([])
    const off = { ...withTitles('t', 'v'), axes: false }
    expect(gridPlan(view, off, SIZE, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.5 }).titles).toEqual([])
  })
})
