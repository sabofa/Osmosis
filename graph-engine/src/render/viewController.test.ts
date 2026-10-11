import { describe, expect, it } from 'vitest'
import { Camera2D } from './camera2d'
import { ViewController, type WheelInput } from './viewController'

// 100x100 px over x,y in [-10,10]: 5 px/unit at the start.
const setup = () => {
  const cam = new Camera2D(100, 100, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 })
  return { cam, vc: new ViewController(cam) }
}
const wheel = (o: Partial<WheelInput>): WheelInput => ({
  x: 50, y: 50, deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, altKey: false, shiftKey: false, t: 0, ...o,
})
const ptr = (x: number, y: number, t: number) => ({ id: 1, x, y, t, kind: 'mouse' as const, button: 0 })
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('ViewController', () => {
  it('wheel zoom at the centre: bounds shrink by exp(-delta*WHEEL_SENSITIVITY)', () => {
    const { cam, vc } = setup()
    vc.wheel(wheel({ deltaY: -100 }))
    expect(vc.moving).toBe(true)
    vc.step(10000)
    const f = Math.exp(0.15)
    const b = cam.getBounds()
    near(b.xMin, -10 / f); near(b.xMax, 10 / f); near(b.yMin, -10 / f); near(b.yMax, 10 / f)
    expect(vc.moving).toBe(false)
  })

  it('wheel at a point keeps the world point under the cursor', () => {
    const { cam, vc } = setup()
    const before = cam.screenToWorld(20, 30, 100, 100)
    vc.wheel(wheel({ x: 20, y: 30, deltaY: -200 }))
    vc.step(10000)
    const after = cam.screenToWorld(20, 30, 100, 100)
    near(after.x, before.x); near(after.y, before.y)
  })

  it('drag pans exactly by the pixels moved (5 px per unit), content follows the cursor', () => {
    const { cam, vc } = setup()
    vc.pointerDown(ptr(50, 50, 0))
    vc.pointerMove(ptr(60, 40, 16)) // 10 px right, 10 px up: dragStart carries the whole displacement
    vc.pointerMove(ptr(70, 40, 32))
    vc.pointerUp(ptr(70, 40, 500)) // held still: no coast
    vc.step(600)
    const b = cam.getBounds()
    near(b.xMin, -10 - 4); near(b.xMax, 10 - 4) // 20 px / 5 = 4 units, view moves left
    near(b.yMin, -10 - 2); near(b.yMax, 10 - 2) // 10 px up = view moves down 2 units
  })

  it('keys: + zooms by KEY_ZOOM_STEP about the middle, ArrowLeft pans 10% of the screen', () => {
    const { cam, vc } = setup()
    expect(vc.key('+', 0)).toBe(true)
    vc.step(10000)
    near(cam.getBounds().xMax, 10 / 1.25)
    expect(vc.key('x', 10000)).toBe(false)
    const w = cam.getBounds().xMax - cam.getBounds().xMin
    vc.key('ArrowLeft', 10000) // content moves right: view moves left by 10% of the width
    vc.step(20000)
    near(cam.getBounds().xMax, 10 / 1.25 - 0.1 * w)
  })

  it('reset (key 0) eases back to the fitted view; double-click does the same', () => {
    const { cam, vc } = setup()
    vc.wheel(wheel({ deltaY: -400 }))
    vc.step(10000)
    vc.key('0', 10000)
    vc.step(10100)
    expect(vc.moving).toBe(true)
    vc.step(20000)
    near(cam.getBounds().xMin, -10); near(cam.getBounds().yMax, 10)
    vc.wheel(wheel({ deltaY: -400, t: 20000 }))
    vc.step(30000)
    vc.pointerDown(ptr(10, 10, 30000)); vc.pointerUp(ptr(10, 10, 30050))
    vc.pointerDown(ptr(10, 10, 30100)); vc.pointerUp(ptr(10, 10, 30150))
    vc.step(40000)
    near(cam.getBounds().xMax, 10)
  })

  it('Alt+wheel zooms x only about the cursor; Alt+Shift (deltaX fallback) zooms y only', () => {
    const cam = new Camera2D(100, 100, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, { kind: 'ratioXY', x: 1, y: 1 })
    const vc = new ViewController(cam)
    const f = Math.exp(0.15)
    vc.wheel(wheel({ altKey: true, deltaY: -100 }))
    let b = cam.getBounds()
    near(b.xMin, -10 / f); near(b.xMax, 10 / f); near(b.yMin, -10); near(b.yMax, 10)
    vc.wheel(wheel({ altKey: true, shiftKey: true, deltaY: 0, deltaX: -100 }))
    b = cam.getBounds()
    near(b.xMax, 10 / f); near(b.yMax, 10 / f)
    // reset restores the authored ratio at once
    vc.reset(0)
    b = cam.getBounds()
    near(b.xMin, -10); near(b.yMin, -10)
  })

  it('equal aspect: Alt+wheel does nothing, by default', () => {
    const { cam, vc } = setup()
    vc.wheel(wheel({ altKey: true, deltaY: -100 }))
    vc.wheel(wheel({ altKey: true, shiftKey: true, deltaY: -100 }))
    const b = cam.getBounds()
    near(b.xMin, -10); near(b.xMax, 10); near(b.yMin, -10); near(b.yMax, 10)
  })

  it('ratioXY 2:1: x px/unit is twice y; Alt+wheel changes the x span only; reset keeps 2:1', () => {
    const cam = new Camera2D(100, 100, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, { kind: 'ratioXY', x: 2, y: 1 })
    const vc = new ViewController(cam)
    const a = cam.getView()
    near(a.a / a.b, 2)
    const f = Math.exp(0.15)
    vc.wheel(wheel({ altKey: true, deltaY: -100 }))
    const b = cam.getBounds()
    // the 2:1 frame (40 x 20 units) fits the square canvas by width: x spans 20, y bars to 40
    near(b.yMin, -20); near(b.yMax, 20)
    near(b.xMax - b.xMin, 20 / f)
    vc.reset(0)
    near(cam.getView().a / cam.getView().b, 2)
    near(cam.getBounds().xMax - cam.getBounds().xMin, 20)
    near(cam.getBounds().yMax - cam.getBounds().yMin, 40)
  })

  it('the axis-zoom hook can refuse (equal aspect)', () => {
    const cam = new Camera2D(100, 100, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 })
    const vc = new ViewController(cam, { axisZoomAllowed: () => false })
    vc.wheel(wheel({ altKey: true, deltaY: -100 }))
    near(cam.getBounds().xMax, 10)
  })
})

describe('ViewController locked', () => {
  const B = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
  it('wheel, drag, keys and reset leave the bounds and report not-handled; unlocking works again', () => {
    const cam = new Camera2D(100, 100, B)
    const vc = new ViewController(cam, { locked: true })
    expect(vc.wheel(wheel({ deltaY: -100 }))).toBe(false)
    expect(vc.wheel(wheel({ deltaY: -100, altKey: true }))).toBe(false)
    expect(vc.pointerDown(ptr(50, 50, 0))).toEqual([])
    expect(vc.pointerMove(ptr(70, 40, 16))).toEqual([])
    expect(vc.pointerUp(ptr(70, 40, 32))).toEqual([])
    expect(vc.key('ArrowLeft', 40)).toBe(false)
    expect(vc.key('+', 50)).toBe(false)
    vc.reset(60)
    expect(vc.moving).toBe(false)
    expect(vc.step(10000)).toBe(false)
    expect(cam.getBounds()).toEqual(B)
    vc.locked = false
    expect(vc.wheel(wheel({ deltaY: -100 }))).toBe(true)
    vc.step(20000)
    expect(cam.getBounds().xMax).toBeLessThan(10)
  })
})


describe('ViewController.cancel', () => {
  it('a drag then lock leaves nothing coasting or dragging', () => {
    const { cam, vc } = setup()
    vc.pointerDown(ptr(50, 50, 0))
    vc.pointerMove(ptr(60, 50, 10))
    vc.pointerMove(ptr(80, 50, 20))
    vc.step(20)
    vc.cancel()
    vc.locked = true
    const before = cam.getBounds()
    expect(vc.moving).toBe(false)
    expect(vc.step(5000)).toBe(false)
    expect(cam.getBounds()).toEqual(before)
    // unlocked again: a fresh pointer-up does not resume the old drag
    vc.locked = false
    expect(vc.pointerUp(ptr(80, 50, 6000)).some((i) => i.kind === 'dragEnd')).toBe(false)
    expect(vc.moving).toBe(false)
  })
})
