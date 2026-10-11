import { describe, expect, it } from 'vitest'
import { contentToScreen, visibleRect } from './camera'
import { COMMIT_DRIFT, COMMIT_THROTTLE_MS, OVERSCAN, SETTLE_MS } from './feel'
import {
  commitDue,
  coversRect,
  growRect,
  liveTransform,
  liveTransformValue,
  scaleDrift,
  type CommitInput,
} from './liveTransform'
import type { Camera, Rect, Size, Vec } from './types'

const FRAME: Rect = { x: -3, y: 5, width: 40, height: 25 }
const SCREEN: Size = { width: 800, height: 500 }

const cameras: Camera[] = [
  { cx: 17, cy: 17.5, zoom: 1 },
  { cx: 17, cy: 17.5, zoom: 3.7 },
  { cx: -2.25, cy: 9, zoom: 0.4 },
  { cx: 30, cy: 28, zoom: 64 },
  { cx: 0.001, cy: -40, zoom: 0.1 },
]
const points: Vec[] = [
  { x: 0, y: 0 },
  { x: 17, y: 17.5 },
  { x: -3, y: 5 },
  { x: 37, y: 30 },
  { x: 12.3456, y: 21.987 },
]

// Where a content point is on screen when the svg shows `committed` and the
// transform is applied on top (transform-origin at the screen's top-left).
function throughTransform(p: Vec, committed: Camera, live: Camera): Vec {
  const t = liveTransform(visibleRect(FRAME, committed, SCREEN), visibleRect(FRAME, live, SCREEN), SCREEN)
  const s = contentToScreen(p, FRAME, committed, SCREEN)
  return { x: s.x * t.scale + t.tx, y: s.y * t.scale + t.ty }
}

describe('liveTransform', () => {
  it('is the identity when the live view is the committed one', () => {
    for (const c of cameras) {
      const v = visibleRect(FRAME, c, SCREEN)
      expect(liveTransform(v, v, SCREEN)).toEqual({ tx: 0, ty: 0, scale: 1 })
    }
  })

  it('lands every content point where the live camera puts it, for pans', () => {
    for (const c of cameras) {
      for (const [dx, dy] of [
        [5, 0],
        [0, -3],
        [-12, 9.5],
      ]) {
        const live = { ...c, cx: c.cx + dx / c.zoom, cy: c.cy + dy / c.zoom }
        for (const p of points) {
          const want = contentToScreen(p, FRAME, live, SCREEN)
          const got = throughTransform(p, c, live)
          expect(Math.abs(got.x - want.x)).toBeLessThan(1e-9)
          expect(Math.abs(got.y - want.y)).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('lands every content point where the live camera puts it, for zooms and zoom-pans', () => {
    for (const c of cameras) {
      for (const k of [0.25, 0.7, 1.3, 2, 9.5]) {
        const live = { cx: c.cx + 1.5, cy: c.cy - 0.75, zoom: c.zoom * k }
        for (const p of points) {
          const want = contentToScreen(p, FRAME, live, SCREEN)
          const got = throughTransform(p, c, live)
          expect(Math.abs(got.x - want.x)).toBeLessThan(1e-9)
          expect(Math.abs(got.y - want.y)).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('scales by the committed width over the live width: zoom in, scale up', () => {
    const c = cameras[0]
    const t = liveTransform(visibleRect(FRAME, c, SCREEN), visibleRect(FRAME, { ...c, zoom: 2 }, SCREEN), SCREEN)
    expect(t.scale).toBeCloseTo(2, 12)
  })

  it('a degenerate window gives the identity rather than NaN', () => {
    const v = visibleRect(FRAME, cameras[0], SCREEN)
    expect(liveTransform(v, { ...v, width: 0 }, SCREEN)).toEqual({ tx: 0, ty: 0, scale: 1 })
    expect(liveTransform({ ...v, width: 0 }, v, SCREEN)).toEqual({ tx: 0, ty: 0, scale: 1 })
    expect(liveTransform(v, v, { width: 0, height: 0 })).toEqual({ tx: 0, ty: 0, scale: 1 })
  })
})

describe('liveTransformValue', () => {
  it('is a CSS translate then scale, with the numbers the transform has', () => {
    expect(liveTransformValue({ tx: 12.5, ty: -3, scale: 1.25 })).toBe('translate(12.5px, -3px) scale(1.25)')
  })

  it('is empty for the identity, so the element carries no transform at rest', () => {
    expect(liveTransformValue({ tx: 0, ty: 0, scale: 1 })).toBe('')
  })

  it('keeps enough digits not to creep at the highest zoom', () => {
    const t = { tx: 123456.789012, ty: 0, scale: 63.99999999 }
    const m = /translate\(([^p]+)px, ([^p]+)px\) scale\(([^)]+)\)/.exec(liveTransformValue(t))!
    expect(Number(m[1])).toBeCloseTo(t.tx, 5)
    expect(Number(m[3])).toBeCloseTo(t.scale, 8)
  })
})

describe('growRect / coversRect', () => {
  const r: Rect = { x: 10, y: 20, width: 100, height: 50 }

  it('grows by a fraction of its own size on every side', () => {
    expect(growRect(r, 0.25)).toEqual({ x: -15, y: 7.5, width: 150, height: 75 })
    expect(growRect(r, 0)).toEqual(r)
  })

  it('covers itself, a smaller rect inside, and not one that pokes out', () => {
    expect(coversRect(r, r)).toBe(true)
    expect(coversRect(r, { x: 20, y: 25, width: 10, height: 10 })).toBe(true)
    expect(coversRect(r, { x: 20, y: 25, width: 100, height: 10 })).toBe(false)
    expect(coversRect(r, { x: 5, y: 25, width: 10, height: 10 })).toBe(false)
    expect(coversRect(r, { x: 20, y: 65, width: 10, height: 10 })).toBe(false)
  })

  it('tolerates rounding at the edge', () => {
    expect(coversRect(r, { x: 10 - 1e-12, y: 20, width: 100, height: 50 })).toBe(true)
  })
})

describe('scaleDrift', () => {
  it('is the ratio between the windows, as an at-least-one number, either way', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 50 }
    expect(scaleDrift(a, a)).toBeCloseTo(1, 12)
    expect(scaleDrift(a, { x: 3, y: 4, width: 50, height: 25 })).toBeCloseTo(2, 12)
    expect(scaleDrift(a, { x: 3, y: 4, width: 200, height: 100 })).toBeCloseTo(2, 12)
    expect(scaleDrift(a, { x: 0, y: 0, width: 0, height: 0 })).toBe(Infinity)
  })
})

describe('commitDue', () => {
  const committed: Rect = { x: 0, y: 0, width: 100, height: 50 }
  const base: CommitInput = {
    committed,
    live: { x: 5, y: 3, width: 100, height: 50 },
    overscan: OVERSCAN,
    moving: true,
    idleMs: 0,
    sinceCommitMs: 0,
    reduced: false,
    screenChanged: false,
  }
  const due = (over: Partial<CommitInput> = {}) => commitDue({ ...base, ...over })
  // A window `factor` times smaller (zoomed in) about its own middle.
  const scaled = (factor: number): Rect => ({
    x: 50 - 50 / factor,
    y: 25 - 25 / factor,
    width: 100 / factor,
    height: 50 / factor,
  })

  it('commits the first view at once, with nothing committed yet', () => {
    expect(due({ committed: null })).toBe(true)
  })

  it('does nothing when the live view is the committed one', () => {
    expect(due({ live: committed, moving: false, idleMs: 10_000, sinceCommitMs: 10_000 })).toBe(false)
  })

  it('does not commit a small pan in flight', () => {
    expect(due({ sinceCommitMs: 10_000 })).toBe(false)
  })

  it('commits when motion stops, once it has been still for the settle time', () => {
    expect(due({ moving: false, idleMs: SETTLE_MS - 1 })).toBe(false)
    expect(due({ moving: false, idleMs: SETTLE_MS })).toBe(true)
  })

  it('does not settle while it is still moving, however long since the last change', () => {
    expect(due({ moving: true, idleMs: 10_000 })).toBe(false)
  })

  it('commits at once in reduced motion, and when the screen changed', () => {
    expect(due({ reduced: true })).toBe(true)
    expect(due({ screenChanged: true })).toBe(true)
  })

  it('commits a zoom that has drifted past the factor, but only every COMMIT_THROTTLE_MS', () => {
    const zoomedIn = scaled(COMMIT_DRIFT + 0.01)
    expect(due({ live: zoomedIn, sinceCommitMs: COMMIT_THROTTLE_MS - 1 })).toBe(false)
    expect(due({ live: zoomedIn, sinceCommitMs: COMMIT_THROTTLE_MS })).toBe(true)
    const zoomedOut = scaled(1 / (COMMIT_DRIFT + 0.01))
    expect(due({ live: zoomedOut, sinceCommitMs: COMMIT_THROTTLE_MS })).toBe(true)
  })

  it('does not commit a zoom inside the factor that the overscan still covers', () => {
    expect(due({ live: scaled(COMMIT_DRIFT - 0.1), sinceCommitMs: 10_000 })).toBe(false)
    // Zoomed out, the screen shows 1.5 times the window: still inside 1 + 2 * OVERSCAN.
    expect(due({ live: scaled(1 / 1.5), sinceCommitMs: 10_000 })).toBe(false)
  })

  it('commits a zoom-out that uncovers the screen, even inside the drift factor', () => {
    expect(due({ live: scaled(1 / (1 + 2 * OVERSCAN + 0.05)), sinceCommitMs: 10_000 })).toBe(true)
  })

  it('commits a view that has left the overscanned window (a strip would show blank), throttled', () => {
    const edge = committed.width * OVERSCAN
    const inside = { ...committed, x: edge - 0.5 }
    const outside = { ...committed, x: edge + 0.5 }
    expect(due({ live: inside, sinceCommitMs: 10_000 })).toBe(false)
    expect(due({ live: outside, sinceCommitMs: 10_000 })).toBe(true)
    expect(due({ live: outside, sinceCommitMs: COMMIT_THROTTLE_MS - 1 })).toBe(false)
  })
})
