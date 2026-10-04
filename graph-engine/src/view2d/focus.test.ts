import { describe, expect, it } from 'vitest'
import { focusCamera, formatFocus, parseFocus, type AuthorMapping, type FocusSpec } from './focus'

describe('parseFocus', () => {
  it('reads a plane point', () => {
    expect(parseFocus('(3, 2)')).toEqual({ target: { kind: 'plane', x: 3, y: 2 }, zoom: 1 })
  })
  it('reads a space point', () => {
    expect(parseFocus('(1, -2.5, 3)')).toEqual({ target: { kind: 'space', x: 1, y: -2.5, z: 3 }, zoom: 1 })
  })
  it('reads a view point', () => {
    expect(parseFocus('view (10, 20)')).toEqual({ target: { kind: 'view', u: 10, v: 20 }, zoom: 1 })
  })
  it('reads an explicit zoom, case-insensitively', () => {
    expect(parseFocus('(3, 2) zoom 4').zoom).toBe(4)
    expect(parseFocus('(3,2) ZOOM 0.5').zoom).toBe(0.5)
    expect(parseFocus('view(1,2)   Zoom   2').zoom).toBe(2)
  })
  it('reads signed decimals and exponents', () => {
    expect(parseFocus('(+1.5, -.5)').target).toEqual({ kind: 'plane', x: 1.5, y: -0.5 })
    expect(parseFocus('(1e3, 2.5E-1) zoom 1e1')).toEqual({ target: { kind: 'plane', x: 1000, y: 0.25 }, zoom: 10 })
  })
  it('refuses a malformed target, naming the valid forms', () => {
    for (const bad of ['(1)', '(a, b)', 'view 1, 2', '', '(1, 2, 3, 4)', '(1, 2) zoom', '(1, 2) zoom x']) {
      expect(() => parseFocus(bad), bad).toThrow(
        `@focus must be "(x, y)", "(x, y, z)" or "view (u, v)", optionally followed by "zoom <k>" — got "${bad}"`
      )
    }
  })
  it('refuses a zoom of zero or less', () => {
    expect(() => parseFocus('(1, 2) zoom 0')).toThrow('@focus zoom must be greater than 0 — got "0"')
    expect(() => parseFocus('(1, 2) zoom -2')).toThrow('@focus zoom must be greater than 0 — got "-2"')
  })
})

describe('formatFocus', () => {
  it('writes the value only, omitting zoom 1', () => {
    expect(formatFocus({ target: { kind: 'plane', x: 3, y: 2 }, zoom: 4 })).toBe('(3, 2) zoom 4')
    expect(formatFocus({ target: { kind: 'plane', x: 3, y: 2 }, zoom: 1 })).toBe('(3, 2)')
    expect(formatFocus({ target: { kind: 'space', x: 1, y: 2, z: 3 }, zoom: 1 })).toBe('(1, 2, 3)')
    expect(formatFocus({ target: { kind: 'view', u: 1.5, v: -2 }, zoom: 0.25 })).toBe('view (1.5, -2) zoom 0.25')
  })
  it('round-trips through parseFocus', () => {
    const specs: FocusSpec[] = [
      { target: { kind: 'plane', x: 3, y: -2.125 }, zoom: 4 },
      { target: { kind: 'space', x: 0, y: 1.5, z: -3 }, zoom: 1 },
      { target: { kind: 'view', u: 100, v: 0.001 }, zoom: 0.25 },
    ]
    for (const s of specs) expect(parseFocus(formatFocus(s))).toEqual(s)
  })
})

describe('focusCamera', () => {
  const mapping: AuthorMapping = {
    toContent: (t) => (t.kind === 'plane' ? { x: t.x * 10, y: -t.y * 10 } : null),
  }
  it('places the camera at the mapped point with the spec zoom, unclamped', () => {
    expect(focusCamera({ target: { kind: 'plane', x: 3, y: 2 }, zoom: 1000 }, mapping)).toEqual({
      cx: 30,
      cy: -20,
      zoom: 1000,
    })
  })
  it('is null when the engine cannot place that form', () => {
    expect(focusCamera({ target: { kind: 'space', x: 1, y: 2, z: 3 }, zoom: 2 }, mapping)).toBeNull()
  })
})
