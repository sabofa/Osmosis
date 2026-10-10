import { describe, expect, it } from 'vitest'
import { contentToScreen, fittedCamera, screenToContent } from './camera'
import { EASE_DURATION } from './feel'
import { ViewMotion } from './motion'
import type { Camera } from './types'

const frame = { x: -320, y: -240, width: 640, height: 480 }
const screen = { width: 800, height: 400 }
const FRAME_MS = 16
const T0 = 1000

function make(reducedMotion = false, start = fittedCamera(frame)) {
  return new ViewMotion({ frame, screen, start, reducedMotion })
}

// Step the fake clock every 16 ms from `from` up to and including `until`.
function run(m: ViewMotion, from: number, until: number, each?: (t: number) => void) {
  for (let t = from + FRAME_MS; t <= until; t += FRAME_MS) {
    m.step(t)
    each?.(t)
  }
}

const at = { x: 610, y: 95 }

describe('smoothed zoom', () => {
  it('keeps the point under the cursor fixed at every step', () => {
    const m = make()
    const start = screenToContent(at, frame, m.current, screen)
    m.zoomAt(at, 2.5, T0)
    let worst = 0
    let frames = 0
    run(m, T0, T0 + 1500, () => {
      const p = screenToContent(at, frame, m.current, screen)
      worst = Math.max(worst, Math.abs(p.x - start.x), Math.abs(p.y - start.y))
      frames++
    })
    expect(frames).toBeGreaterThan(50)
    expect(worst).toBeLessThan(1e-9)
    expect(m.current.zoom).toBeCloseTo(2.5, 9)
  })

  it('keeps it fixed across several wheel events landing mid-flight', () => {
    const m = make()
    const start = screenToContent(at, frame, m.current, screen)
    let worst = 0
    let t = T0
    for (let i = 0; i < 6; i++) {
      m.zoomAt(at, 1.3, t)
      run(m, t, t + 40, () => {
        const p = screenToContent(at, frame, m.current, screen)
        worst = Math.max(worst, Math.abs(p.x - start.x), Math.abs(p.y - start.y))
      })
      t += 48
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('arrives within about 300 ms, and a small notch is settled by 400 ms', () => {
    const m = make()
    m.zoomAt(at, 2, T0)
    run(m, T0, T0 + 300)
    // 300 ms is 4.3 time constants: less than 2% of the move is left.
    expect(Math.log(2) - Math.log(m.current.zoom)).toBeLessThan(0.02 * Math.log(2))
    run(m, T0 + 300, T0 + 1000)
    expect(m.moving).toBe(false)
    expect(m.current).toEqual(m.target)

    // The snap threshold is in log zoom, so "moving is false by 400 ms" holds
    // for a notch of about 3% or less; a large zoom takes longer to snap.
    const small = make()
    small.zoomAt(at, 1.02, T0)
    run(small, T0, T0 + 400)
    expect(small.moving).toBe(false)
  })

  it('never overshoots: zooming in rises monotonically to the target, never past it', () => {
    const m = make()
    m.zoomAt(at, 3, T0)
    const target = m.target.zoom
    let last = m.current.zoom
    run(m, T0, T0 + 1500, () => {
      expect(m.current.zoom).toBeGreaterThanOrEqual(last)
      expect(m.current.zoom).toBeLessThanOrEqual(target)
      last = m.current.zoom
    })
    expect(last).toBe(target)
  })

  it('never overshoots when zooming out either', () => {
    const m = make()
    m.zoomAt(at, 0.25, T0)
    const target = m.target.zoom
    let last = m.current.zoom
    run(m, T0, T0 + 1500, () => {
      expect(m.current.zoom).toBeLessThanOrEqual(last)
      expect(m.current.zoom).toBeGreaterThanOrEqual(target)
      last = m.current.zoom
    })
    expect(last).toBe(target)
  })

  it('smooths a key pan toward its target without overshoot', () => {
    const m = make(false, { cx: 0, cy: 0, zoom: 2 })
    m.panBy(100, 0, T0)
    expect(m.current.cx).toBe(0)
    const goal = m.target.cx
    expect(goal).toBeLessThan(0)
    let last = 0
    run(m, T0, T0 + 1500, () => {
      expect(m.current.cx).toBeLessThanOrEqual(last)
      expect(m.current.cx).toBeGreaterThanOrEqual(goal)
      last = m.current.cx
    })
    expect(m.current.cx).toBe(goal)
    expect(m.moving).toBe(false)
  })

  it('zooming out 1000x arrives at the zoom limit', () => {
    const m = make()
    m.zoomAt(at, 1e-3, T0)
    expect(m.target.zoom).toBe(0.1)
    run(m, T0, T0 + 3000)
    expect(m.moving).toBe(false)
    expect(m.current.zoom).toBe(0.1)
  })

  it('zooming in 1000x arrives at the other limit', () => {
    const m = make()
    m.zoomAt(at, 1e3, T0)
    run(m, T0, T0 + 3000)
    expect(m.current.zoom).toBe(64)
  })
})

describe('drag and pinch', () => {
  it('a drag is exact: current is target at once, and content moved the dragged pixels', () => {
    const m = make(false, { cx: 0, cy: 0, zoom: 3 })
    const p = { x: 12, y: -7 }
    const before = contentToScreen(p, frame, m.current, screen)
    m.dragStart(T0)
    m.dragBy(30, 0, T0 + 10)
    expect(m.current).toEqual(m.target)
    const after = contentToScreen(p, frame, m.current, screen)
    expect(after.x - before.x).toBeCloseTo(30, 9)
    expect(after.y - before.y).toBeCloseTo(0, 9)
    expect(m.moving).toBe(false)
  })

  it('a pinch is exact and holds the point between the fingers', () => {
    const m = make(false, { cx: 10, cy: 20, zoom: 2 })
    const p = screenToContent(at, frame, m.current, screen)
    m.pinch(at, 1.7, 0, 0, T0)
    expect(m.current).toEqual(m.target)
    expect(m.current.zoom).toBeCloseTo(3.4, 12)
    const q = screenToContent(at, frame, m.current, screen)
    expect(q.x).toBeCloseTo(p.x, 9)
    expect(q.y).toBeCloseTo(p.y, 9)
  })

  it('a pinch also pans by the midpoint movement', () => {
    const m = make(false, { cx: 0, cy: 0, zoom: 2 })
    const p = screenToContent(at, frame, m.current, screen)
    m.pinch(at, 1, 15, -9, T0)
    const s = contentToScreen(p, frame, m.current, screen)
    expect(s.x - at.x).toBeCloseTo(15, 9)
    expect(s.y - at.y).toBeCloseTo(-9, 9)
  })

  it('a pinch past a zoom limit still holds the point fixed', () => {
    const m = make(false, { cx: 0, cy: 0, zoom: 50 })
    const p = screenToContent(at, frame, m.current, screen)
    m.pinch(at, 10, 0, 0, T0)
    expect(m.current.zoom).toBe(64)
    const q = screenToContent(at, frame, m.current, screen)
    expect(q.x).toBeCloseTo(p.x, 9)
    expect(q.y).toBeCloseTo(p.y, 9)
  })
})

describe('coasting', () => {
  function flick(m: ViewMotion, releaseAfter = 0) {
    m.dragStart(T0)
    for (let i = 1; i <= 5; i++) m.dragBy(20, 0, T0 + i * 10) // 100 px over 50 ms
    m.dragEnd(T0 + 50 + releaseAfter)
  }

  it('keeps moving after release, slows down, and stops within 2 s', () => {
    const m = make()
    flick(m)
    expect(m.moving).toBe(true)
    const releaseAt = T0 + 50
    let prevX = m.current.cx
    const steps: number[] = []
    let t = releaseAt
    while (m.moving && t < releaseAt + 2500) {
      t += FRAME_MS
      m.step(t)
      steps.push(prevX - m.current.cx) // dragging right moves the centre left
      prevX = m.current.cx
    }
    expect(steps[0]).toBeGreaterThan(0)
    for (let i = 1; i < steps.length - 1; i++) expect(steps[i]).toBeLessThan(steps[i - 1])
    expect(m.moving).toBe(false)
    expect(t - releaseAt).toBeLessThan(2000)
  })

  it('carries on at the speed of the last 80 ms', () => {
    const m = make()
    flick(m)
    const x0 = m.current.cx
    m.step(T0 + 50 + FRAME_MS)
    // 100 px per 80 ms = 1.25 px/ms, for 16 ms = 20 px, at 0.8333 px per unit.
    expect((x0 - m.current.cx) * (400 / 480)).toBeCloseTo(20, 6)
  })

  it('does not coast after holding still for 100 ms', () => {
    const m = make()
    flick(m, 100)
    expect(m.moving).toBe(false)
    const before = m.current
    run(m, T0 + 150, T0 + 500)
    expect(m.current).toEqual(before)
  })

  it('stops against a limit instead of pushing into it', () => {
    // Free coasting from cx = 500 would carry ~450 more units left of the
    // bound at 704 (zoom 1: 480 half-width, 96 kept), so it must hit the wall.
    const m = make(false, { cx: 500, cy: 0, zoom: 1 })
    m.dragStart(T0)
    for (let i = 1; i <= 5; i++) m.dragBy(-20, 0, T0 + i * 10) // content leaves left, centre goes right
    m.dragEnd(T0 + 50)
    expect(m.moving).toBe(true)
    expect(m.current.cx).toBeLessThan(704)
    run(m, T0 + 50, T0 + 400)
    expect(m.current.cx).toBe(704)
    // It stopped on the wall, well before the velocity would have decayed (~1.7 s).
    expect(m.moving).toBe(false)
  })

  it('dragStart halts a coast where it is', () => {
    const m = make()
    flick(m)
    run(m, T0 + 50, T0 + 150)
    const here = m.current
    m.dragStart(T0 + 150)
    expect(m.moving).toBe(false)
    run(m, T0 + 150, T0 + 400)
    expect(m.current).toEqual(here)
  })
})

describe('animated moves', () => {
  const goal = { cx: 100, cy: -60, zoom: 8 }

  it('arrives exactly after EASE_DURATION, and is 87.5% of the way at half time', () => {
    const m = make()
    m.animateTo(goal, T0)
    expect(m.moving).toBe(true)
    m.step(T0 + EASE_DURATION / 2)
    expect(Math.log(m.current.zoom) / Math.log(8)).toBeCloseTo(0.875, 9)
    expect(m.current.cx / 100).toBeCloseTo(0.875, 9)
    expect(m.moving).toBe(true)
    expect(m.step(T0 + EASE_DURATION)).toBe(false)
    expect(m.current).toEqual(goal)
    expect(m.moving).toBe(false)
  })

  it('goes to the clamped camera when asked past a limit', () => {
    const m = make()
    m.animateTo({ cx: 0, cy: 0, zoom: 1e4 }, T0)
    m.step(T0 + EASE_DURATION)
    expect(m.current.zoom).toBe(64)
  })

  it('a drag during the move starts from where the view is, with no jump', () => {
    const m = make()
    m.animateTo(goal, T0)
    run(m, T0, T0 + 96)
    m.step(T0 + 100)
    const here = m.current
    expect(here.zoom).toBeGreaterThan(1)
    expect(here.zoom).toBeLessThan(8)
    m.dragStart(T0 + 100)
    expect(m.current).toEqual(here)
    expect(m.target).toEqual(here)
    expect(m.moving).toBe(false)
    m.dragBy(10, 0, T0 + 110)
    const p = { x: 3, y: 4 }
    const a = contentToScreen(p, frame, here, screen)
    const b = contentToScreen(p, frame, m.current, screen)
    expect(b.x - a.x).toBeCloseTo(10, 9)
    run(m, T0 + 110, T0 + 600)
    expect(m.current.zoom).toBe(here.zoom)
  })

  it('a wheel zoom during the move starts from where the view is', () => {
    const m = make()
    m.animateTo(goal, T0)
    m.step(T0 + 100)
    const here = m.current
    m.zoomAt(at, 1.5, T0 + 100)
    expect(m.target.zoom).toBeCloseTo(here.zoom * 1.5, 9)
  })
})

describe('reduced motion', () => {
  it('lands zoomAt at once', () => {
    const m = make(true)
    m.zoomAt(at, 2, T0)
    expect(m.moving).toBe(false)
    expect(m.current).toEqual(m.target)
    expect(m.current.zoom).toBe(2)
  })

  it('lands panBy at once', () => {
    const m = make(true, { cx: 0, cy: 0, zoom: 2 })
    m.panBy(50, 0, T0)
    expect(m.moving).toBe(false)
    expect(m.current).toEqual(m.target)
    expect(m.current.cx).toBeLessThan(0)
  })

  it('lands animateTo at once', () => {
    const m = make(true)
    m.animateTo({ cx: 100, cy: -60, zoom: 8 }, T0)
    expect(m.moving).toBe(false)
    expect(m.current).toEqual({ cx: 100, cy: -60, zoom: 8 })
  })

  it('does not coast', () => {
    const m = make(true)
    m.dragStart(T0)
    for (let i = 1; i <= 5; i++) m.dragBy(20, 0, T0 + i * 10)
    m.dragEnd(T0 + 50)
    expect(m.moving).toBe(false)
    const before = m.current
    run(m, T0 + 50, T0 + 400)
    expect(m.current).toEqual(before)
  })

  it('switching it on finishes a move in flight', () => {
    const m = make()
    m.zoomAt(at, 4, T0)
    m.setReducedMotion(true)
    expect(m.moving).toBe(false)
    expect(m.current).toEqual(m.target)
  })
})

describe('housekeeping', () => {
  it('setContent jumps to the start view and stops everything', () => {
    const m = make()
    m.zoomAt(at, 4, T0)
    const other = { x: 0, y: 0, width: 100, height: 100 }
    m.setContent(other, fittedCamera(other))
    expect(m.moving).toBe(false)
    expect(m.current).toEqual({ cx: 50, cy: 50, zoom: 1 })
    expect(m.target).toEqual(m.current)
  })

  it('setScreen keeps the camera', () => {
    const m = make(false, { cx: 30, cy: 10, zoom: 2 })
    m.setScreen({ width: 500, height: 500 })
    expect(m.current).toEqual({ cx: 30, cy: 10, zoom: 2 })
    expect(m.target).toEqual(m.current)
  })

  it('step while idle reports not moving and changes nothing', () => {
    const m = make()
    expect(m.step(T0)).toBe(false)
    expect(m.current).toEqual(fittedCamera(frame))
  })
})

// The readout holds the camera it was handed (React state keeps it by
// reference and bails out of a re-render when the next one is the same
// object), so every frame of a move must hand over a fresh camera, and one
// already handed over must never change afterwards.
describe('published cameras', () => {
  function frames(m: ViewMotion, from: number, until: number) {
    const held: { camera: Camera; zoom: number; cx: number }[] = []
    run(m, from, until, () => held.push({ camera: m.current, zoom: m.current.zoom, cx: m.current.cx }))
    return held
  }

  it('consecutive frames of a smoothed zoom are distinct cameras whose zoom changes', () => {
    const m = make()
    m.zoomAt(at, 2.5, T0)
    const held = frames(m, T0, T0 + 400)
    expect(held.length).toBeGreaterThan(10)
    for (let i = 1; i < 10; i++) {
      expect(held[i].camera).not.toBe(held[i - 1].camera)
      expect(held[i].zoom).toBeGreaterThan(held[i - 1].zoom)
    }
  })

  it('a camera handed over is never mutated by the frames after it', () => {
    const m = make()
    m.zoomAt(at, 2.5, T0)
    const held = frames(m, T0, T0 + 1500)
    for (const h of held) {
      expect(h.camera.zoom).toBe(h.zoom)
      expect(h.camera.cx).toBe(h.cx)
    }
  })

  it('an eased move and a smoothed pan are fresh cameras every frame too', () => {
    const eased = make(false, { cx: 0, cy: 0, zoom: 2 })
    eased.animateTo({ cx: 50, cy: 20, zoom: 4 }, T0)
    const e = frames(eased, T0, T0 + 200)
    for (let i = 1; i < e.length; i++) expect(e[i].camera).not.toBe(e[i - 1].camera)
    const panned = make(false, { cx: 0, cy: 0, zoom: 2 })
    panned.panBy(100, 0, T0)
    const p = frames(panned, T0, T0 + 200)
    for (let i = 1; i < 8; i++) expect(p[i].camera).not.toBe(p[i - 1].camera)
  })
})
