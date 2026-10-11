import { describe, expect, it } from 'vitest'
import { boundsOf, frameAxes, plotToScreen, pxPerUnitXY, screenToPlot, startView } from './plotView'
import type { PlotAspect, PlotWindow } from './plotView'

const screen = { width: 800, height: 400 }
const win: PlotWindow = { uMin: -3, uMax: 5, vMin: -2, vMax: 7 }
const aspects: [string, PlotAspect | null][] = [
  ['default', null],
  ['equal', { kind: 'equal' }],
  ['auto', { kind: 'auto' }],
  ['ratioXY 2:1', { kind: 'ratioXY', x: 2, y: 1 }],
]
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

describe('plotView', () => {
  it.each(aspects)('bounds -> view -> bounds round trip (%s)', (_n, aspect) => {
    const v = startView(win, aspect, screen)
    const b = boundsOf(v, win, screen)
    // fitted (meet): the window lies inside what the screen shows, centred
    expect(b.uMin).toBeLessThanOrEqual(win.uMin + 1e-9)
    expect(b.uMax).toBeGreaterThanOrEqual(win.uMax - 1e-9)
    expect(b.vMin).toBeLessThanOrEqual(win.vMin + 1e-9)
    expect(b.vMax).toBeGreaterThanOrEqual(win.vMax - 1e-9)
    close((b.uMin + b.uMax) / 2, 1)
    close((b.vMin + b.vMax) / 2, 2.5)
    const moved = { ...v, cu: 0.3, cv: -1.1, zoom: 2.5 }
    const p = screenToPlot(moved, win, screen, { x: 123, y: 77 })
    const s = plotToScreen(moved, win, screen, p)
    close(s.x, 123)
    close(s.y, 77)
  })

  it('auto fits the window exactly to the screen', () => {
    const b = boundsOf(startView(win, { kind: 'auto' }, screen), win, screen)
    close(b.uMin, -3)
    close(b.uMax, 5)
    close(b.vMin, -2)
    close(b.vMax, 7)
  })

  it('equal gives one px per unit on both axes; a circle is as wide as tall', () => {
    const v = startView(win, { kind: 'equal' }, screen)
    const ppu = pxPerUnitXY(v, win, screen)
    close(ppu.x, ppu.y)
    const at = (x: number, y: number) => plotToScreen(v, win, screen, { x, y })
    close(at(2, 2).x - at(0, 2).x, at(1, 1).y - at(1, 3).y)
  })

  it('ratioXY 2:1 gives an x:y px-per-unit ratio of 2', () => {
    const ppu = pxPerUnitXY(startView(win, { kind: 'ratioXY', x: 2, y: 1 }, screen), win, screen)
    close(ppu.x / ppu.y, 2)
  })

  it('y points up on screen (frame y is negated)', () => {
    const v = startView(win, { kind: 'auto' }, screen)
    expect(plotToScreen(v, win, screen, { x: 0, y: 6 }).y).toBeLessThan(plotToScreen(v, win, screen, { x: 0, y: 0 }).y)
  })

  it('one period of sin x fits edge to edge', () => {
    const w: PlotWindow = { uMin: 0, uMax: 6.283185307179586, vMin: -1.2, vMax: 1.2 }
    const v = startView(w, { kind: 'auto' }, screen)
    close(plotToScreen(v, w, screen, { x: 0, y: 0 }).x, 0)
    close(plotToScreen(v, w, screen, { x: w.uMax, y: 0 }).x, 800)
    close(plotToScreen(v, w, screen, { x: 1, y: 1.2 }).y, 0)
    close(plotToScreen(v, w, screen, { x: 1, y: -1.2 }).y, 400)
  })

  it('a log window lives in (u,v) = log10', () => {
    const w: PlotWindow = { uMin: -1, uMax: 3, vMin: 0, vMax: 3 }
    const b = boundsOf(startView(w, { kind: 'auto' }, screen), w, screen)
    close(b.uMin, -1)
    close(b.uMax, 3)
    close(b.vMax, 3)
    const ab = frameAxes(w, { kind: 'auto' }, screen)
    close(ab.a, 800 / 4)
    close(ab.b, 400 / 3)
  })

  it('a degenerate window does not poison the view', () => {
    const w: PlotWindow = { uMin: 1, uMax: 1, vMin: 2, vMax: 2 }
    const b = boundsOf(startView(w, null, screen), w, screen)
    for (const n of Object.values(b)) expect(Number.isFinite(n)).toBe(true)
  })
})
