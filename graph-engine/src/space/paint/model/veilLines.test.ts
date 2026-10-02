import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { LAYER_ORDER, ROLES, type PaintView } from '../types'
import { buildParticles, paintFrame } from './index'
import { behindVeil } from './lines'
import { veilOf } from './roles'
import { BEHIND_VEIL_LAYER } from './strokes'
import { flatColours, lineMark, makeGBuffer, paintView, quadMesh, sceneOf } from './testing'

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: [0.6, 0.02, -0.06], 1: [0.4, 0.04, 0.035], 2: [0.4, 0.04, 0.035] })

// A vertical sheet in the plane x = 0 (opacity 0.4, so a veil), and two curves along x: one wholly behind it
// (x from -1 to -0.3) and one wholly in front (x from 0.3 to 1), seen from the +x side.
const sheet = quadMesh({ origin: [0, -1, -1], e1: [0, 2, 0], e2: [0, 0, 2], n: 4, opacity: 0.4, index: 0 })
const scene = sceneOf([
  sheet,
  lineMark([[-1, -0.3, 0.1], [-0.3, 0.3, 0.1]], { index: 1 }),
  lineMark([[0.3, -0.3, 0.1], [1, 0.3, 0.1]], { index: 2 }),
])

function frame(view: PaintView) {
  const g = makeGBuffer(view, 2, () => null) // a veil is not in the G-buffer, and nothing else is drawn
  return paintFrame(scene, buildParticles(scene, COLOURS, P), view, g, P).strokes
}

// The line strokes of a frame split by the layer they are painted in.
function lines(b: ReturnType<typeof frame>) {
  const out = { behind: [] as number[], front: [] as number[], other: [] as number[] }
  const lineRole = ROLES.indexOf('line')
  for (let i = 0; i < b.count; i++) {
    if (b.role[i] !== lineRole) continue
    if (b.layer[i] === BEHIND_VEIL_LAYER) out.behind.push(b.depth[i])
    else if (b.layer[i] === LAYER_ORDER.indexOf('line')) out.front.push(b.depth[i])
    else out.other.push(b.layer[i])
  }
  return out
}

describe('a line seen through a veil (a translucent sheet)', () => {
  it('is painted before the glaze, so the veil tints it, and is still a line (the role shapes the brush)', () => {
    expect(BEHIND_VEIL_LAYER).toBeLessThan(LAYER_ORDER.indexOf('glaze'))
    const l = lines(frame(paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 150 })))
    expect(l.behind.length).toBeGreaterThanOrEqual(2)
    expect(l.front.length).toBeGreaterThanOrEqual(2)
    expect(l.other).toEqual([])
    // the ones behind the sheet are the farther ones from the eye
    expect(Math.min(...l.behind)).toBeGreaterThan(Math.max(...l.front))
  })

  it('does so through a perspective camera as well', () => {
    const l = lines(frame(paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 150, perspective: true })))
    expect(l.behind.length).toBeGreaterThanOrEqual(2)
    expect(l.front.length).toBeGreaterThanOrEqual(2)
    expect(Math.min(...l.behind)).toBeGreaterThan(Math.max(...l.front))
  })

  it('keeps the line layer for a curve that is beside the sheet, not behind it (the sheet ends where its edge is)', () => {
    // seen from the +x side, a curve off to the side of the sheet (y beyond 1) is not behind it
    const beside = sceneOf([sheet, lineMark([[-1, 1.8, 0.1], [-0.3, 2.4, 0.1]], { index: 1 })])
    const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 100 })
    const g = makeGBuffer(view, 2, () => null)
    const b = paintFrame(beside, buildParticles(beside, COLOURS, P), view, g, P).strokes
    const l = lines(b)
    expect(l.front.length).toBeGreaterThan(1)
    expect(l.behind).toEqual([])
  })

  it('behindVeil is the crossing test: between the eye and the point, within the sheet’s edges, flat sheets only', () => {
    const view = paintView({ width: 640, height: 480, azimuth: 0, elevation: 0, zoom: 100 }) // looking along -x from +x
    const g = makeGBuffer(view, 2, () => null)
    const set = buildParticles(scene, COLOURS, P)
    const an = { view, ortho: true } as unknown as Parameters<typeof behindVeil>[0]
    void g
    void set
    const v = veilOf(sheet)
    expect(v.plane).not.toBeNull()
    expect(behindVeil(an, [v], [-0.5, 0, 0])).toBe(true) // behind it
    expect(behindVeil(an, [v], [0.5, 0, 0])).toBe(false) // in front of it
    expect(behindVeil(an, [v], [-0.5, 3, 0])).toBe(false) // behind where the sheet is not
    expect(behindVeil(an, [], [-0.5, 0, 0])).toBe(false)
    // a curved or solid veil has no plane to test
    expect(behindVeil(an, [{ ...v, plane: null }], [-0.5, 0, 0])).toBe(false)
  })
})
