import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../../parser/config'
import { frameTicks, labelAnchors, type FrameView } from './ticks'

const view = (xMin: number, xMax: number, yMin: number, yMax: number, widthPx = 800, heightPx = 480): FrameView => ({
  bounds: { xMin, xMax, yMin, yMax },
  widthPx,
  heightPx,
})

const cfg = (patch: Record<string, unknown> = {}) => ({ ...defaultConfig(), ...patch }) as ReturnType<typeof defaultConfig>
const withPi = (num: number, den: number, axis: 'x' | 'y' = 'x') => {
  const c = defaultConfig()
  c.space.ticks[axis] = { value: (num / den) * Math.PI, pi: { num, den } }
  return c
}

// First-principles hand run of the grid algorithm: nice step with 6 target divisions, walk from ceil(min/step).
function handRun(min: number, max: number): number[] {
  const rough = (max - min) / 6
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const r = rough / mag
  const step = (r >= 8 ? 5 : r >= 5 ? 2 : 1) * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

describe('frameTicks linear', () => {
  it('matches the grid algorithm values and labels them', () => {
    const t = frameTicks(view(-10, 10, -6, 6), cfg())
    expect(t.x.map((k) => k.value)).toEqual(handRun(-10, 10))
    expect(t.y.map((k) => k.value)).toEqual(handRun(-6, 6))
    expect(t.x.slice(0, 3).map((k) => k.label)).toEqual(['−10', '−9', '−8'])
    expect(t.x.every((k) => k.kind === 'major')).toBe(true)
  })

  it('@labels: none blanks every label', () => {
    const t = frameTicks(view(-10, 10, -6, 6), cfg({ labels: 'none' }))
    expect(t.x.length).toBeGreaterThan(0)
    expect(t.x.every((k) => k.label === '')).toBe(true)
    expect(t.y.every((k) => k.label === '')).toBe(true)
  })

  it('@label-every: 2 labels every second tick', () => {
    const t = frameTicks(view(-10, 10, -6, 6), cfg({ labelEvery: 2 }))
    t.x.forEach((k, i) => expect(k.label !== '').toBe(i % 2 === 0))
  })
})

describe('frameTicks pi', () => {
  it('pi/2 steps label as multiples of pi', () => {
    const t = frameTicks(view(0, 2 * Math.PI, -1.2, 1.2), withPi(1, 2))
    expect(t.x.map((k) => k.label)).toEqual(['0', 'π/2', 'π', '3π/2', '2π'])
    expect(t.x[2].value).toBeCloseTo(Math.PI, 12)
    // y stays linear
    expect(t.y.length).toBeGreaterThan(0)
  })

  it('labels negatives and a wider span', () => {
    const t = frameTicks(view(-Math.PI, Math.PI, -1, 1), withPi(1, 2))
    expect(t.x.map((k) => k.label)).toEqual(['−π', '−π/2', '0', 'π/2', 'π'])
  })

  it('falls back to a ladder step when the configured one is far off', () => {
    const t = frameTicks(view(0, 200 * Math.PI, -1, 1), withPi(1, 2))
    expect(t.x.length).toBeLessThanOrEqual(15)
    expect(t.x[1].label).toMatch(/π/)
  })
})

describe('frameTicks huge pi span and resolved step', () => {
  it('a pi axis over a huge span falls back to the nice step', () => {
    const t = frameTicks(view(0, 1e5, -1, 1), withPi(1, 2))
    expect(t.x.length).toBeLessThanOrEqual(15)
    expect(t.step.x).toBe(10000)
    expect(t.x[1].label).not.toMatch(/π/)
  })
  it('exposes the resolved step', () => {
    const t = frameTicks(view(-10, 10, -6, 6), cfg())
    expect(t.step).toEqual({ x: 1, y: 1 })
    expect(frameTicks(view(0, 2 * Math.PI, -1, 1), withPi(1, 2)).step.x).toBeCloseTo(Math.PI / 2, 12)
  })
})

describe('frameTicks log', () => {
  it('log y 1..1e4 has decade majors and minors', () => {
    const c = defaultConfig()
    c.scales.y = 'log'
    const t = frameTicks(view(0, 10, 1, 1e4), c)
    expect(t.y.filter((k) => k.kind === 'major').map((k) => k.label)).toEqual(['1', '10', '10²', '10³', '10⁴'])
    expect(t.y.some((k) => k.kind === 'minor')).toBe(true)
    expect(t.x.length).toBeGreaterThan(0)
  })

  it('a non-positive log bound gives no ticks on that axis', () => {
    const c = defaultConfig()
    c.scales.y = 'log'
    const t = frameTicks(view(0, 10, 0, 100), c)
    expect(t.y).toEqual([])
  })
})

describe('frameTicks degenerate', () => {
  it('never throws and returns empty lists', () => {
    const badX = [view(0, 0, 0, 1), view(NaN, 1, 0, 1), view(1, 0, 0, 1), view(0, 1, 0, 1, 0, 480), view(0, 1, 0, 1, NaN, 480)]
    for (const v of badX) {
      const t = frameTicks(v, cfg())
      expect(t.x).toEqual([])
      expect(t.y.length).toBeGreaterThan(0)
    }
    const t = frameTicks(view(0, 1, 0, 1, 0, 0), cfg())
    expect(t).toMatchObject({ x: [], y: [] })
    expect(frameTicks(view(Infinity, -Infinity, NaN, NaN), cfg())).toMatchObject({ x: [], y: [] })
  })
})

describe('labelAnchors', () => {
  const m = { x: 0.5, y: 0.25 }
  const anchors = (v: FrameView, c = cfg()) => labelAnchors(frameTicks(v, c), v, m, c.scales)

  it('sits on the axes when 0 is inside the view', () => {
    const a = anchors(view(-10, 10, -6, 6))
    expect(a.x.every((l) => l.at.y === 0)).toBe(true)
    expect(a.y.every((l) => l.at.x === 0)).toBe(true)
    expect(a.x[0].at.x).toBe(a.x[0].value)
    expect(a.y[0].at.y).toBe(a.y[0].value)
  })

  it('pins y labels to the left edge when the y-axis is off-screen to the left', () => {
    const a = anchors(view(20, 30, -5, 5))
    expect(a.y.length).toBeGreaterThan(0)
    expect(a.y.every((l) => l.at.x === 20 + 0.5)).toBe(true)
    expect(a.x.every((l) => l.at.y === 0)).toBe(true)
  })

  it('pins to the right edge when the view is entirely negative in x', () => {
    const a = anchors(view(-30, -20, -5, 5))
    expect(a.y.every((l) => l.at.x === -20 - 0.5)).toBe(true)
  })

  it('pins x labels to the bottom or top edge when y=0 is off-screen', () => {
    expect(anchors(view(-5, 5, 10, 20)).x.every((l) => l.at.y === 10 + 0.25)).toBe(true)
    expect(anchors(view(-5, 5, -20, -10)).x.every((l) => l.at.y === -10 - 0.25)).toBe(true)
  })

  it('an axis exactly on the edge is held inside by the margin', () => {
    const a = anchors(view(0, 10, 0, 10))
    expect(a.y.every((l) => l.at.x === 0.5)).toBe(true)
    expect(a.x.every((l) => l.at.y === 0.25)).toBe(true)
  })

  it('log axes pin to the lower edge', () => {
    const c = defaultConfig()
    c.scales.y = 'log'
    c.scales.x = 'log'
    const a = anchors(view(1, 1e3, 1, 1e4), c)
    expect(a.x.every((l) => l.at.y === 1 + 0.25)).toBe(true)
    expect(a.y.every((l) => l.at.x === 1 + 0.5)).toBe(true)
  })
})
