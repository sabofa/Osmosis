import { describe, expect, it } from 'vitest'
import { fittedCamera, visibleRect } from './camera'
import { clampCamera, DEFAULT_LIMITS } from './limits'

const frame = { x: -320, y: -240, width: 640, height: 480 }
const screen = { width: 800, height: 400 }

// How much of the frame, along x, the visible rect covers.
function overlapX(cam: { cx: number; cy: number; zoom: number }) {
  const v = visibleRect(frame, cam, screen)
  return Math.min(v.x + v.width, frame.x + frame.width) - Math.max(v.x, frame.x)
}

describe('the limits', () => {
  it('clamps zoom to 0.1 and 64', () => {
    expect(clampCamera({ cx: 0, cy: 0, zoom: 0.001 }, frame, screen, DEFAULT_LIMITS).zoom).toBe(0.1)
    expect(clampCamera({ cx: 0, cy: 0, zoom: 1e6 }, frame, screen, DEFAULT_LIMITS).zoom).toBe(64)
  })

  it('keeps 15% of the frame on screen after an extreme pan at zoom 1', () => {
    const far = clampCamera({ cx: 1e6, cy: 0, zoom: 1 }, frame, screen, DEFAULT_LIMITS)
    expect(overlapX(far)).toBeCloseTo(0.15 * frame.width, 9)
    const farLeft = clampCamera({ cx: -1e6, cy: 0, zoom: 1 }, frame, screen, DEFAULT_LIMITS)
    expect(overlapX(farLeft)).toBeCloseTo(0.15 * frame.width, 9)
  })

  it('keeps half the visible width on the frame when zoomed in past that', () => {
    const cam = clampCamera({ cx: 1e6, cy: 0, zoom: 64 }, frame, screen, DEFAULT_LIMITS)
    const v = visibleRect(frame, cam, screen)
    expect(overlapX(cam)).toBeCloseTo(v.width / 2, 9)
  })

  it('clamps the y axis the same way', () => {
    const cam = clampCamera({ cx: 0, cy: -1e6, zoom: 1 }, frame, screen, DEFAULT_LIMITS)
    const v = visibleRect(frame, cam, screen)
    const overlap = Math.min(v.y + v.height, frame.y + frame.height) - Math.max(v.y, frame.y)
    expect(overlap).toBeCloseTo(0.15 * frame.height, 9)
  })

  it('returns a camera inside the bounds unchanged', () => {
    const cam = { cx: 30, cy: -20, zoom: 2.5 }
    expect(clampCamera(cam, frame, screen, DEFAULT_LIMITS)).toEqual(cam)
    expect(clampCamera(fittedCamera(frame), frame, screen, DEFAULT_LIMITS)).toEqual(fittedCamera(frame))
  })
})
