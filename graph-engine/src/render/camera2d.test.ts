import { describe, expect, it } from 'vitest'
import { Camera2D } from './camera2d'

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
    c.zoomAt(1e-9, 400, 400, 800, 800)
    expect(c.getBounds().yMax - c.getBounds().yMin).toBeCloseTo(12 / 1e6, 9) // PLOT_LIMITS zoomMax 1e6 (old floor was viewHeight 1e-3)
    const d = new Camera2D(800, 800)
    d.resize(1600, 800)
    expect(d.getBounds().yMax - d.getBounds().yMin).toBeCloseTo(12)
    expect(d.getBounds().xMax - d.getBounds().xMin).toBeCloseTo(24)
  })
})
