import { describe, expect, it } from 'vitest'
import { contrast, fitLightness, isHex, mix, parseColour, toHex } from './colour.js'

describe('colour', () => {
  it('hex round-trips for 8-bit colours', () => {
    for (const h of ['#000000', '#ffffff', '#c65d22', '#17170f', '#eef1e5', '#2f7a4f', '#6fbf8a', '#ff8a3d'])
      expect(toHex(parseColour(h))).toBe(h)
  })
  it('white vs black contrast is 21', () => expect(contrast(parseColour('#fff'), parseColour('#000'))).toBeCloseTo(21, 1))
  it('mix endpoints', () => {
    const a = parseColour('#c65d22'), b = parseColour('#eef1e5')
    expect(toHex(mix(a, b, 0))).toBe('#c65d22')
    expect(toHex(mix(a, b, 1))).toBe('#eef1e5')
  })
  it('out-of-gamut oklch comes back in gamut', () =>
    expect(toHex(parseColour('oklch(0.7 0.4 140)'))).toMatch(/^#[0-9a-f]{6}$/))
  it('fitLightness reaches the target ratio', () => {
    const bg = parseColour('#fbfcf8')
    const f = fitLightness(parseColour('#9aa09a'), bg, 4.5)
    expect(contrast(f, bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('8-digit hex carries alpha', () => expect(parseColour('#00000080').a).toBeCloseTo(0.502, 2))
  it('throws on junk', () => expect(() => parseColour('nope')).toThrow())
  it('parses oklch with percent and alpha', () => {
    const c = parseColour('oklch(70% 0.1 140 / 0.5)')
    expect(c.l).toBeCloseTo(0.7, 6)
    expect(c.a).toBeCloseTo(0.5, 6)
    expect(c.h).toBeCloseTo(140, 6)
  })
  it('toHex emits 8 digits when a<1', () => {
    expect(toHex(parseColour('#00000080'))).toBe('#00000080')
    expect(toHex(parseColour('#abc'))).toBe('#aabbcc')
  })
  it('fitLightness lightens on a dark background', () => {
    const bg = parseColour('#17170f')
    const c = parseColour('#3a3a30')
    const f = fitLightness(c, bg, 4.5)
    expect(f.l).toBeGreaterThan(c.l)
    expect(contrast(f, bg)).toBeGreaterThanOrEqual(4.5)
    expect(f.c).toBe(c.c)
    expect(f.h).toBe(c.h)
  })
  it('fitLightness leaves passing colours alone', () => {
    const c = parseColour('#000000')
    expect(fitLightness(c, parseColour('#fff'), 4.5)).toBe(c)
  })
  it('fitLightness returns the extreme when impossible', () => {
    expect(fitLightness(parseColour('#808080'), parseColour('#fff'), 30).l).toBe(0)
  })
  it('isHex table', () => {
    for (const s of ['#abc', '#aabbcc', '#AABBCC80']) expect(isHex(s)).toBe(true)
    for (const s of ['abc', '#abcd', '#ggg', 'oklch(1 0 0)', '']) expect(isHex(s)).toBe(false)
  })
})
