import { describe, expect, it } from 'vitest'
import { HOVER_TOLERANCE, TOUCH_TOLERANCE } from '../feel'
import { keyReachesView, pointerKindOf, swallowsKey, toleranceInContent } from './domInput'

const key = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...mods,
})

describe('keyReachesView', () => {
  it('lets the view have its own keys', () => {
    for (const k of ['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '0', 'Escape', 'c']) {
      expect(keyReachesView(key(k)), k).toBe(true)
    }
  })

  it('leaves browser shortcuts alone: ctrl, meta or alt held means the page keeps the key', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      for (const k of ['c', '0', '=', '-', '+', 'ArrowLeft']) {
        expect(keyReachesView(key(k, { [mod]: true })), `${mod}+${k}`).toBe(false)
      }
    }
  })

  it('still takes shift, because + is a shifted key on most layouts', () => {
    expect(keyReachesView(key('+', { shiftKey: true }))).toBe(true)
    expect(keyReachesView(key('_', { shiftKey: true }))).toBe(true)
  })

  it('lets zoom and pan keys auto-repeat while held, but acts once for reset, clear and the coordinate toggle', () => {
    for (const k of ['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(keyReachesView(key(k, { repeat: true })), k).toBe(true)
    }
    for (const k of ['0', 'Escape', 'c', 'C']) {
      expect(keyReachesView(key(k, { repeat: true })), k).toBe(false)
    }
  })
})

describe('toleranceInContent', () => {
  it('is the pixel tolerance for the pointer, divided by pixels per content unit', () => {
    expect(toleranceInContent('mouse', 2)).toBeCloseTo(HOVER_TOLERANCE / 2, 12)
    expect(toleranceInContent('pen', 2)).toBeCloseTo(HOVER_TOLERANCE / 2, 12)
    expect(toleranceInContent('touch', 2)).toBeCloseTo(TOUCH_TOLERANCE / 2, 12)
  })

  it('is larger for a finger than for a mouse, and shrinks in content units as the view zooms in', () => {
    expect(toleranceInContent('touch', 1)).toBeGreaterThan(toleranceInContent('mouse', 1))
    expect(toleranceInContent('mouse', 8)).toBeLessThan(toleranceInContent('mouse', 1))
  })

  it('does not blow up on an unmeasured view', () => {
    expect(Number.isFinite(toleranceInContent('mouse', 0))).toBe(true)
    expect(Number.isFinite(toleranceInContent('touch', Number.NaN))).toBe(true)
  })
})

describe('pointerKindOf', () => {
  it('maps the browser pointer types, and treats anything unknown as a mouse', () => {
    expect(pointerKindOf('mouse')).toBe('mouse')
    expect(pointerKindOf('pen')).toBe('pen')
    expect(pointerKindOf('touch')).toBe('touch')
    expect(pointerKindOf('')).toBe('mouse')
    expect(pointerKindOf('stylus')).toBe('mouse')
  })
})

describe('swallowsKey', () => {
  it('swallows a key that did something', () => {
    expect(swallowsKey([{ kind: 'zoom', at: { x: 0, y: 0 }, factor: 1.25, t: 0 }], false)).toBe(true)
    expect(swallowsKey([{ kind: 'reset', t: 0 }], false)).toBe(true)
    expect(swallowsKey([{ kind: 'toggleCoordinates' }], true)).toBe(true)
  })

  it('does not swallow a key that did nothing', () => {
    expect(swallowsKey([], false)).toBe(false)
    expect(swallowsKey([], true)).toBe(false)
  })

  it('leaves c to the browser when nothing listens for the coordinate toggle', () => {
    expect(swallowsKey([{ kind: 'toggleCoordinates' }], false)).toBe(false)
  })
})
