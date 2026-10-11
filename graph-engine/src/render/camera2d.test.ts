import { describe, expect, it } from 'vitest'
import { Camera2D } from './camera2d'
import { axisZoom } from '../plot/view/axisZoom'

describe('Camera2D facade', () => {
  it('defaults to 12 units tall, centred, width following the canvas', () => {
    const b = new Camera2D(800, 400).getBounds()
    expect(b.yMin).toBeCloseTo(-6)
    expect(b.yMax).toBeCloseTo(6)
    expect(b.xMax).toBeCloseTo(12)
  })
  it('fits a requested window inside the canvas', () => {
    const b = new Camera2D(400, 400, { xMin: 0, xMax: 20, yMin: 0, yMax: 10 }).getBounds()
    expect(b.xMin).toBeCloseTo(0)
    expect(b.xMax).toBeCloseTo(20)
    expect(b.yMax - b.yMin).toBeCloseTo(20)
  })
  it('zoomAt holds the point under the cursor and scales worldPerPixel', () => {
    const c = new Camera2D(800, 800)
    const before = c.screenToWorld(600, 200, 800, 800)
    const wpp = c.worldPerPixel(800)
    c.zoomAt(0.5, 600, 200, 800, 800)
    const after = c.screenToWorld(600, 200, 800, 800)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(c.worldPerPixel(800)).toBeCloseTo(wpp / 2)
  })
  it('pans by pixels and round-trips world and screen', () => {
    const c = new Camera2D(800, 800)
    c.panByPixels(80, 40, 800)
    expect(c.getBounds().xMin).toBeCloseTo(-6 - 1.2)
    expect(c.getBounds().yMax).toBeCloseTo(6 + 0.6)
    const s = c.worldToScreen(1, 2, 800, 800)
    const w = c.screenToWorld(s.x, s.y, 800, 800)
    expect(w.x).toBeCloseTo(1)
    expect(w.y).toBeCloseTo(2)
  })
  it('clamps zoom to PLOT_LIMITS, and resize keeps height in units', () => {
    const c = new Camera2D(800, 800)
    c.zoomAt(1e-12, 400, 400, 800, 800)
    expect(c.getBounds().yMax - c.getBounds().yMin).toBeCloseTo(12 / 2e10, 15) // PLOT_ZOOM.max: view height 6e-10, under the spec's 1e-9
    const d = new Camera2D(800, 800)
    d.resize(1600, 800)
    expect(d.getBounds().yMax - d.getBounds().yMin).toBeCloseTo(12)
    expect(d.getBounds().xMax - d.getBounds().xMin).toBeCloseTo(24)
  })
  it('worldPerPixelXY: a 2:1 ratio gives px-per-unit 2:1, so world-per-pixel x is half of y', () => {
    // window 20 x 10, frame 40 x 10 at ratio 2:1, canvas 800 square: base 20 -> 40 px/unit on x, 20 on y
    const c = new Camera2D(800, 800, { xMin: 0, xMax: 20, yMin: 0, yMax: 10 }, { kind: 'ratioXY', x: 2, y: 1 })
    const w = c.worldPerPixelXY(800)
    expect(w.x).toBeCloseTo(1 / 40)
    expect(w.y).toBeCloseTo(1 / 20)
    expect(w.x / w.y).toBeCloseTo(0.5)
    expect(c.worldPerPixel(800)).toBeCloseTo(w.x)
  })
  it('equal aspect gives the same world-per-pixel on both axes', () => {
    const w = new Camera2D(800, 800, { xMin: 0, xMax: 20, yMin: 0, yMax: 10 }).worldPerPixelXY(800)
    expect(w.x).toBeCloseTo(w.y)
  })
  it('a one-axis zoom makes the two differ', () => {
    const c = new Camera2D(800, 800)
    c.setView(axisZoom(c.getView(), c.plotWindow(), 'x', 2, { x: 400, y: 400 }, c.screenSize()))
    const w = c.worldPerPixelXY(800)
    expect(w.y / w.x).toBeCloseTo(2)
  })
  it('auto aspect re-derives the unit ratio on resize (equal keeps its ratio)', () => {
    const win = { xMin: 0, xMax: 20, yMin: 0, yMax: 10 }
    const c = new Camera2D(800, 800, win, { kind: 'auto' })
    expect(c.worldPerPixelXY(800).x).toBeCloseTo(1 / 40)
    expect(c.worldPerPixelXY(800).y).toBeCloseTo(1 / 80)
    c.resize(400, 800)
    const w = c.worldPerPixelXY(800)
    expect(w.x).toBeCloseTo(1 / 20)
    expect(w.y).toBeCloseTo(1 / 80)
    const b = c.getBounds()
    expect(b.xMin).toBeCloseTo(0)
    expect(b.xMax).toBeCloseTo(20)
    expect(b.yMax).toBeCloseTo(10)
    const e = new Camera2D(800, 800, win)
    e.resize(400, 800)
    expect(e.worldPerPixelXY(800).x).toBeCloseTo(e.worldPerPixelXY(800).y)
  })
})

describe('Camera2D.setFrame', () => {
  it("resets a panned view to the new authored frame (an unchanged frame never calls it: see frameChanged)", () => {
    const c = new Camera2D(400, 400, { xMin: 0, xMax: 20, yMin: 0, yMax: 10 })
    c.panByPixels(50, 0, 400)
    const panned = c.getBounds()
    expect(panned.xMin).not.toBeCloseTo(0)
    c.setFrame({ xMin: -4, xMax: 4, yMin: -4, yMax: 4 }, null)
    const b = c.getBounds()
    expect(b.xMin).toBeCloseTo(-4)
    expect(b.xMax).toBeCloseTo(4)
  })
  it('zoom range covers a 1e-9 .. 1e12 view height at the default window', () => {
    const height = (c: Camera2D) => c.getBounds().yMax - c.getBounds().yMin
    const lo = new Camera2D(800, 800)
    lo.zoomAt(1e-30, 400, 400, 800, 800)
    expect(height(lo)).toBeLessThanOrEqual(1e-9)
    const hi = new Camera2D(800, 800)
    hi.zoomAt(1e30, 400, 400, 800, 800)
    expect(height(hi)).toBeGreaterThanOrEqual(1e12)
  })
  it('origin: the three camera sits on it and its bounds are relative to it; getBounds stays absolute', () => {
    const c = new Camera2D(800, 800, { xMin: 999, xMax: 1001, yMin: -1, yMax: 1 })
    c.setOrigin(1000, 0)
    expect(c.camera.position.x).toBe(1000)
    expect(c.camera.left).toBeCloseTo(-1)
    expect(c.camera.right).toBeCloseTo(1)
    expect(c.getBounds().xMin).toBeCloseTo(999)
  })
})
