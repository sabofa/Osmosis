import { describe, expect, it } from 'vitest'
import { parseColour } from './colour.js'
import { blendMaps, modeAt } from './mode.js'
import { sunTimes } from './sun.js'

const CH = { lat: 40.1164, lon: -88.2434 }

describe('modeAt', () => {
  it('fixed sources', () => {
    const now = new Date('2026-06-21T18:00:00Z')
    expect(modeAt('light', now, CH, true, true)).toEqual({ mode: 'light', blend: 0, effectiveSource: 'light' })
    expect(modeAt('dark', now, CH, false, true)).toEqual({ mode: 'dark', blend: 1, effectiveSource: 'dark' })
    expect(modeAt('system', now, null, true, true)).toEqual({ mode: 'dark', blend: 1, effectiveSource: 'system' })
    expect(modeAt('system', now, null, false, true)).toEqual({ mode: 'light', blend: 0, effectiveSource: 'system' })
  })
  it('sun without location acts as system', () => {
    const now = new Date('2026-06-21T18:00:00Z')
    expect(modeAt('sun', now, null, true, true)).toEqual({ mode: 'dark', blend: 1, effectiveSource: 'system' })
    expect(modeAt('sun', now, null, false, false)).toEqual({ mode: 'light', blend: 0, effectiveSource: 'system' })
  })
  it('sun: noon light, night dark', () => {
    for (const tw of [false, true]) {
      expect(modeAt('sun', new Date('2026-06-21T18:00:00Z'), CH, true, tw)).toEqual({ mode: 'light', blend: 0, effectiveSource: 'sun' })
      expect(modeAt('sun', new Date('2026-12-21T03:00:00Z'), CH, false, tw)).toEqual({ mode: 'dark', blend: 1, effectiveSource: 'sun' })
    }
  })
  it('twilight blend is monotonic through dusk', () => {
    const st = sunTimes(new Date('2026-03-20T18:00:00Z'), CH)
    const sunset = st.sunset!.getTime()
    const end = st.civilDusk!.getTime() + 3600000
    const blends: number[] = []
    const stepped: number[] = []
    for (let t = sunset - 3600000; t <= end; t += 300000) {
      blends.push(modeAt('sun', new Date(t), CH, false, true).blend)
      stepped.push(modeAt('sun', new Date(t), CH, false, false).blend)
    }
    for (let i = 1; i < blends.length; i++) expect(blends[i]!).toBeGreaterThanOrEqual(blends[i - 1]!)
    expect(blends[0]).toBe(0)
    expect(blends[blends.length - 1]).toBe(1)
    expect(blends.some((b) => b > 0 && b < 1)).toBe(true)
    expect(stepped.every((b) => b === 0 || b === 1)).toBe(true)
  })
})

describe('blendMaps', () => {
  const l = { 'color-canvas': '#eef1e5', 'radius-md': '12px', font: 'serif', only: 'x' }
  const d = { 'color-canvas': '#17160f', 'radius-md': '12px', font: 'sans' }
  it('endpoints are exact', () => {
    expect(blendMaps(l, d, 0)).toEqual(l)
    expect(blendMaps(l, d, 1)).toEqual(d)
    expect(blendMaps(l, d, 0)).not.toBe(l)
  })
  it('mixes colours', () => {
    const m = blendMaps(l, d, 0.5)
    const L = parseColour(m['color-canvas']!).l
    expect(L).toBeGreaterThan(parseColour('#17160f').l)
    expect(L).toBeLessThan(parseColour('#eef1e5').l)
    expect(m['radius-md']).toBe('12px')
  })
  it('switches non-colours at 0.5', () => {
    expect(blendMaps(l, d, 0.49).font).toBe('serif')
    expect(blendMaps(l, d, 0.5).font).toBe('sans')
    expect(blendMaps(l, d, 0.2).only).toBe('x')
    expect(blendMaps(l, d, 0.8).only).toBe('x')
  })
  it('clamps t', () => {
    expect(blendMaps(l, d, -3)).toEqual(l)
    expect(blendMaps(l, d, 7)).toEqual(d)
  })
})
