import { describe, expect, it } from 'vitest'
import { ARRIVE_LOG_ZOOM, ARRIVE_PX } from '../feel'
import type { AuthorMapping, FocusSpec } from '../focus'
import type { Camera } from '../types'
import { resetTarget, sameView, startCamera, viewKey } from './startView'

const FITTED: Camera = { cx: 50, cy: 40, zoom: 1 }
const START: Camera = { cx: 10, cy: 20, zoom: 4 }

describe('resetTarget', () => {
  it('goes to the start view from anywhere else', () => {
    expect(resetTarget({ cx: -30, cy: 5, zoom: 2 }, START, FITTED)).toEqual(START)
    expect(resetTarget(FITTED, START, FITTED)).toEqual(START)
  })

  it('goes to the fitted view when the view is already at the start', () => {
    expect(resetTarget({ ...START }, START, FITTED)).toEqual(FITTED)
  })

  it('counts as at the start within the arrival tolerances, and not beyond them', () => {
    const ppu = 10
    const within: Camera = { cx: START.cx + (ARRIVE_PX * 0.9) / ppu, cy: START.cy, zoom: START.zoom * Math.exp(ARRIVE_LOG_ZOOM * 0.9) }
    const beyondPan: Camera = { cx: START.cx + (ARRIVE_PX * 1.5) / ppu, cy: START.cy, zoom: START.zoom }
    const beyondZoom: Camera = { ...START, zoom: START.zoom * Math.exp(ARRIVE_LOG_ZOOM * 1.5) }
    expect(resetTarget(within, START, FITTED, ppu)).toEqual(FITTED)
    expect(resetTarget(beyondPan, START, FITTED, ppu)).toEqual(START)
    expect(resetTarget(beyondZoom, START, FITTED, ppu)).toEqual(START)
  })

  it('measures the pan tolerance in screen pixels, so it tightens as the view zooms in', () => {
    const near: Camera = { cx: START.cx + 0.01, cy: START.cy, zoom: START.zoom }
    // 0.01 content units is a tenth of a pixel at 10 px/unit, but 0.001 px at 0.1 px/unit.
    expect(resetTarget(near, START, FITTED, 0.1)).toEqual(FITTED)
    expect(resetTarget(near, START, FITTED, 10)).toEqual(START)
  })

  it('gives the fitted view when the start is the fitted view', () => {
    expect(resetTarget({ cx: 0, cy: 0, zoom: 3 }, FITTED, FITTED)).toEqual(FITTED)
    expect(resetTarget(FITTED, FITTED, FITTED)).toEqual(FITTED)
  })

  it('two resets in a row from afar end on the fitted view (the spec: two double-clicks show everything)', () => {
    const first = resetTarget({ cx: 99, cy: 99, zoom: 8 }, START, FITTED)
    expect(first).toEqual(START)
    expect(resetTarget(first, START, FITTED)).toEqual(FITTED)
  })
})

describe('sameView', () => {
  it('is true for equal cameras and false when any of the three differs', () => {
    expect(sameView(START, { ...START }, 1)).toBe(true)
    expect(sameView(START, { ...START, cx: START.cx + 1 }, 1)).toBe(false)
    expect(sameView(START, { ...START, cy: START.cy - 1 }, 1)).toBe(false)
    expect(sameView(START, { ...START, zoom: 5 }, 1)).toBe(false)
  })

  it('answers on a degenerate pixel scale instead of dividing by zero', () => {
    expect(sameView(START, { ...START }, 0)).toBe(true)
    expect(sameView(START, { ...START, cx: 11 }, 0)).toBe(false)
    expect(sameView(START, { ...START }, Number.NaN)).toBe(true)
  })
})

describe('startCamera', () => {
  const mapping: AuthorMapping = {
    toContent: (t) => (t.kind === 'plane' ? { x: t.x * 10, y: -t.y * 10 } : t.kind === 'view' ? { x: t.u, y: t.v } : null),
  }
  const at = (target: FocusSpec['target'], zoom: number): FocusSpec => ({ target, zoom })

  it('is the focus, mapped into content, when the spec sets one', () => {
    expect(startCamera(at({ kind: 'plane', x: 3, y: 2 }, 4), mapping, FITTED)).toEqual({ cx: 30, cy: -20, zoom: 4 })
  })

  it('is fitted when there is no focus', () => {
    expect(startCamera(null, mapping, FITTED)).toEqual(FITTED)
    expect(startCamera(undefined, mapping, FITTED)).toEqual(FITTED)
  })

  it('is fitted when the engine cannot place the focus (a space target on a flat figure)', () => {
    expect(startCamera(at({ kind: 'space', x: 1, y: 2, z: 3 }, 2), mapping, FITTED)).toEqual(FITTED)
  })
})

describe('viewKey', () => {
  const frame = { x: 0, y: 0, width: 100, height: 80 }

  it('is equal for equal values, so a rebuild of the same drawing is not a new figure', () => {
    expect(viewKey({ ...frame }, { ...START })).toBe(viewKey(frame, START))
  })

  it('differs when the frame or the start view differs', () => {
    expect(viewKey({ ...frame, width: 101 }, START)).not.toBe(viewKey(frame, START))
    expect(viewKey(frame, { ...START, zoom: 5 })).not.toBe(viewKey(frame, START))
    expect(viewKey(frame, { ...START, cx: 11 })).not.toBe(viewKey(frame, START))
  })

  it('is null when there is nothing to handle', () => {
    expect(viewKey(null, START)).toBeNull()
    expect(viewKey(frame, null)).toBeNull()
  })
})
