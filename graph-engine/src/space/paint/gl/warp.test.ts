import { describe, expect, it } from 'vitest'
import { paintView } from '../model/testing'
import { inverseViewProj, projectToView, sourceOf, unprojectAtDepth, viewDepth, wasVisible } from './warp'

const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 4) => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], digits)
}

describe('the underpainting warp: where a pixel of the new view was in the old one', () => {
  // A view along -x from +x (azimuth 0, elevation 0, 100 px a unit, 400 x 300): screen right is +y, up is +z, the
  // eye at x = 20. A second one along -y from +y (azimuth 90): screen right is -x. Orthographic.
  const A = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100 })
  const B = paintView({ width: 400, height: 300, azimuth: 90, elevation: 0, zoom: 100 })
  const P: [number, number, number] = [0, 0.5, 0.25]

  it('projects a world point to CSS px and its view depth (hand-computed)', () => {
    // A: x = 200 + 100 x 0.5 = 250, y = 150 - 100 x 0.25 = 125, depth = 20 - 0 = 20
    const a = projectToView(A, P)!
    close([a.x, a.y, a.depth], [250, 125, 20])
    // B: right is -x, so x = 200 + 100 x 0 = 200, y = 125, depth = 20 - 0.5 = 19.5
    const b = projectToView(B, P)!
    close([b.x, b.y, b.depth], [200, 125, 19.5])
    expect(viewDepth(B, P)).toBeCloseTo(19.5, 5)
  })

  it('unprojects a pixel at a depth back to the world point, for an orthographic camera and a perspective one', () => {
    for (const opts of [{}, { perspective: true }]) {
      const view = paintView({ width: 400, height: 300, azimuth: 33, elevation: 27, zoom: 120, ...opts })
      const inv = inverseViewProj(view)!
      for (const p of [[0.3, 0.6, 0.7], [-0.9, 0.2, -0.4], [0, 0, 0]] as [number, number, number][]) {
        const s = projectToView(view, p)!
        close(unprojectAtDepth(view, inv, s.x, s.y, s.depth), p, 3)
      }
    }
  })

  it('finds where the surface seen at a pixel of the new view was in the old view: (200, 125) at depth 19.5 was (250, 125) at depth 20', () => {
    const inv = inverseViewProj(B)!
    const s = sourceOf(A, B, inv, 200, 125, 19.5)!
    close([s.x, s.y, s.depth], [250, 125, 20], 3)
  })

  it('maps a point of a turned sphere through any pair of views back to its pixel in the old one', () => {
    for (const perspective of [false, true]) {
      const from = paintView({ width: 640, height: 480, azimuth: 20, elevation: 25, zoom: 140, perspective })
      const to = paintView({ width: 640, height: 480, azimuth: 52, elevation: 31, zoom: 140, perspective })
      const inv = inverseViewProj(to)!
      for (const p of [[0.6, 0.0, 0.8], [0.0, -0.7, 0.714], [0.5, 0.5, 0.707]] as [number, number, number][]) {
        const seenTo = projectToView(to, p)!
        const was = projectToView(from, p)!
        const src = sourceOf(from, to, inv, seenTo.x, seenTo.y, seenTo.depth)!
        close([src.x, src.y, src.depth], [was.x, was.y, was.depth], 2)
      }
    }
  })

  it('leaves a point where it was when the view did not move, and there is nothing behind the eye', () => {
    const inv = inverseViewProj(A)!
    const same = sourceOf(A, A, inv, 250, 125, 20)!
    close([same.x, same.y, same.depth], [250, 125, 20], 3)
    // a perspective eye: a point behind it has no pixel
    const p = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100, perspective: true })
    expect(projectToView(p, [p.eye[0] * 2, 0, 0])).toBeNull()
  })

  it('counts a point as seen by the old view when its depth is within the tolerance of the stored one', () => {
    expect(wasVisible(20, 20.01, 0.02)).toBe(true)
    expect(wasVisible(20, 20.05, 0.02)).toBe(false)
    expect(wasVisible(20, Number.POSITIVE_INFINITY, 0.02)).toBe(false)
    expect(wasVisible(20, 19.99, 0.02)).toBe(true)
  })
})
