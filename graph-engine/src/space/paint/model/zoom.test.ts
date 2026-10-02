import { describe, expect, it, vi } from 'vitest'
import { ROLE_A } from '../gl/strokes'
import { underpaintFloor } from '../gl/underpaint'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../params'
import { PATH_POINTS, ROLES, type GBuffer, type PaintFrame, type PaintView, type StrokeBatch } from '../types'
import { closeUp, closeUpPressure, loadCellOf, reshapeWidths, sizedBristles, sizedLength, sizedVariance, sizedWidth } from './brush'
import { lchToLab } from './colour'
import { buildParticles, paintFrame } from './index'
import { cellId } from './particles'
import { pressure } from './strokes'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh } from './testing'
import { loadCellLevel, makeFrameCtx, zoomGrow, zoomSizeScale } from './view'

vi.setConfig({ testTimeout: 300_000 })

const P = DEFAULT_PAINT_PARAMS

// A sphere of radius 1 at 200 px a world unit (a 400 px disc on a 480 x 360 view) and the same sphere 3
// and 8 times closer, with the particles the model builds once (3000 a world unit squared): at 1x the
// particles are plentiful, at 3x they begin to fall short of the screen target, at 8x they are 11 times short.
const scene = sceneOf([sphereMesh({ radius: 1 })])
const colours = flatColours({ 0: lchToLab(0.56, 0.14, 38) })
const particlesFor = (params: PaintParams) => buildParticles(scene, colours, params)
const BASE_PX = 200

interface Shot {
  view: PaintView
  gbuffer: GBuffer
  frame: PaintFrame
}

const shoot = (k: number, params: PaintParams = P, particles = particlesFor(params), size: [number, number] = [480, 360]): Shot => {
  const view = paintView({ width: size[0], height: size[1], azimuth: 30, elevation: 25, zoom: BASE_PX * k, magnify: k })
  const gbuffer = sphereGBuffer(size[0], size[1], { view, params })
  return { view, gbuffer, frame: paintFrame(scene, particles, view, gbuffer, params) }
}

// ---- what the strokes cover (a CPU approximation of the brush) ----

// The coverage each pixel of the G-buffer gets from the strokes' footprints: a stroke covers the ribbon
// through its path (its width at each point), with its opacity, and strokes stack as 1 - prod(1 - c).
function strokeCoverage(batch: StrokeBatch, g: GBuffer): Float32Array {
  const rest = new Float32Array(g.width * g.height).fill(1)
  const s = g.scale
  for (let i = 0; i < batch.count; i++) {
    const role = batch.role[i]
    // a glaze's alpha is its own opacity, capped at the role's base; any other role's is scaled by it
    const c = role === ROLES.indexOf('glaze') ? Math.min(batch.alpha[i], ROLE_A[4 * role]) : batch.alpha[i] * ROLE_A[4 * role]
    for (let q = 0; q + 1 < PATH_POINTS; q++) {
      const x0 = batch.path[2 * (PATH_POINTS * i + q)]
      const y0 = batch.path[2 * (PATH_POINTS * i + q) + 1]
      const x1 = batch.path[2 * (PATH_POINTS * i + q + 1)]
      const y1 = batch.path[2 * (PATH_POINTS * i + q + 1) + 1]
      const w0 = batch.width[PATH_POINTS * i + q]
      const w1 = batch.width[PATH_POINTS * i + q + 1]
      const reach = Math.max(w0, w1) / 2
      const gx0 = Math.max(0, Math.floor((Math.min(x0, x1) - reach) / s))
      const gx1 = Math.min(g.width - 1, Math.ceil((Math.max(x0, x1) + reach) / s))
      const gy0 = Math.max(0, Math.floor((Math.min(y0, y1) - reach) / s))
      const gy1 = Math.min(g.height - 1, Math.ceil((Math.max(y0, y1) + reach) / s))
      const dx = x1 - x0
      const dy = y1 - y0
      const len2 = dx * dx + dy * dy || 1
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const px = (gx + 0.5) * s
          const py = (gy + 0.5) * s
          const t = Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / len2))
          const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
          // the bristles leave the outer tenth of the width thin
          if (d <= 0.45 * (w0 + t * (w1 - w0))) rest[gy * g.width + gx] *= 1 - Math.min(1, c)
        }
      }
    }
  }
  return rest.map((r) => 1 - r)
}

// The share of covered G-buffer pixels with at least `level` coverage: from the strokes alone, and from
// the underpainting under them (the least it covers, underpaintFloor, wherever the image has paint).
function covered(shot: Shot, params: PaintParams, level: number): { strokes: number; both: number; pixels: number } {
  const { gbuffer: g, frame } = shot
  const strokes = strokeCoverage(frame.strokes, g)
  const floor = underpaintFloor(params)
  let pixels = 0
  let byStrokes = 0
  let byBoth = 0
  for (let i = 0; i < g.width * g.height; i++) {
    if (g.mark[i] < 0) continue
    pixels++
    if (strokes[i] >= level) byStrokes++
    const under = Number.isNaN(frame.underpaint[3 * i]) ? 0 : floor
    if (1 - (1 - under) * (1 - strokes[i]) >= level) byBoth++
  }
  return { strokes: byStrokes / pixels, both: byBoth / pixels, pixels }
}

// What the block-in strokes of a frame are like: their mean width, mean arc length and number of
// bristles, the mean of the width at the start and at the end over the widest point.
function blockStats(batch: StrokeBatch) {
  let n = 0
  let width = 0
  let length = 0
  let bristles = 0
  let start = 0
  let end = 0
  for (let i = 0; i < batch.count; i++) {
    if (ROLES[batch.role[i]] !== 'block') continue
    let widest = 0
    let sum = 0
    for (let q = 0; q < PATH_POINTS; q++) {
      const w = batch.width[PATH_POINTS * i + q]
      widest = Math.max(widest, w)
      sum += w
    }
    let arc = 0
    for (let q = 1; q < PATH_POINTS; q++) {
      arc += Math.hypot(batch.path[2 * (PATH_POINTS * i + q)] - batch.path[2 * (PATH_POINTS * i + q - 1)], batch.path[2 * (PATH_POINTS * i + q) + 1] - batch.path[2 * (PATH_POINTS * i + q - 1) + 1])
    }
    n++
    width += sum / PATH_POINTS
    length += arc
    bristles += batch.bristles[i]
    start += batch.width[PATH_POINTS * i] / widest
    end += batch.width[PATH_POINTS * i + PATH_POINTS - 1] / widest
  }
  return { n, width: width / n, length: length / n, bristles: bristles / n, start: start / n, end: end / n }
}

const BARE: PaintParams = setParam(setParam(P, 'particles.zoomGrowMax', 1), 'particles.zoomStrokeScale', 0)
const ZOOMS = [1, 3, 8]

describe('no bare canvas inside a form, at any zoom', () => {
  it('gives at least 99% of the covered pixels a coverage of 0.6 or more, from the underpainting and the strokes, at 1x, 3x and 8x', () => {
    const particles = particlesFor(P)
    for (const k of ZOOMS) {
      const shot = shoot(k, P, particles)
      const c = covered(shot, P, 0.6)
      expect(c.pixels, `${k}x`).toBeGreaterThan(20000)
      expect(c.both, `${k}x`).toBeGreaterThanOrEqual(0.99)
    }
  })

  it('does so from the underpainting alone: with strokes that do not grow, the gaps between them are still paint (they are not, without it)', () => {
    const particles = particlesFor(BARE)
    for (const k of ZOOMS) {
      const shot = shoot(k, BARE, particles)
      expect(covered(shot, BARE, 0.6).both, `${k}x`).toBeGreaterThanOrEqual(0.99)
    }
    // the strokes alone leave more than half of the form bare at 8x, which is what the underpainting is for
    expect(covered(shoot(8, BARE, particles), BARE, 0.6).strokes).toBeLessThan(0.6)
  })

  it('and the strokes themselves grow to cover the form, as the particles fall short of the screen target', () => {
    const particles = particlesFor(P)
    for (const k of ZOOMS) expect(covered(shoot(k, P, particles), P, 0.6).strokes, `${k}x`).toBeGreaterThanOrEqual(0.95)
  })
})

describe('strokes sized for the view', () => {
  const particles = particlesFor(P)
  // a view wide enough that a 300 px stroke is not cut short by its edge (a stroke ends where the G-buffer does)
  const stats = ZOOMS.map((k) => blockStats(shoot(k, P, particles, [1280, 800]).frame.strokes))

  it('are never smaller as the view zooms in, and a close-up brush is several times the size', () => {
    expect(stats[1].width).toBeGreaterThanOrEqual(stats[0].width)
    expect(stats[2].width).toBeGreaterThanOrEqual(stats[1].width)
    expect(stats[1].length).toBeGreaterThanOrEqual(stats[0].length)
    expect(stats[2].length).toBeGreaterThanOrEqual(stats[1].length)
    // 3x: the brush follows the zoom (3^0.35 = 1.47) and the particles begin to fall short
    expect(stats[1].width / stats[0].width).toBeGreaterThan(1.45)
    // 8x: the growth (up to 3) and the brush following the zoom (2.07) would multiply to 6.2 and make leaves; the
    // two together stop at particles.zoomBigMax = 4, and the strokes get longer for their width instead
    expect(stats[2].width / stats[0].width).toBeGreaterThan(3)
    expect(stats[2].width / stats[0].width).toBeLessThan(4.3)
    expect(stats[2].length / stats[0].length).toBeGreaterThan(4)
    expect(stats[2].length / stats[0].length).toBeLessThan(8.5) // 4 x 1.9 = 7.6 and the strokes' own variation
  })

  it('leave their size to the roles when growth and the brush following the zoom are both off', () => {
    const bare = ZOOMS.map((k) => blockStats(shoot(k, BARE, particlesFor(BARE)).frame.strokes))
    // (the visible part of a sphere is not the same part of it, so the mean moves a little: not by the 4x and 8x of a zoom)
    expect(bare[2].width / bare[0].width).toBeLessThan(1.35)
    expect(bare[2].length / bare[0].length).toBeLessThan(1.35)
  })

  it('have more bristles with a bigger brush, and read as brush strokes: tapered at both ends, long for their width', () => {
    expect(stats[2].bristles).toBeGreaterThan(2.5 * stats[0].bristles)
    // at the tuned size the stroke starts at its full width; close up it starts on a narrower, loaded edge and tapers to a point-ish end
    expect(stats[0].start).toBeGreaterThan(0.95)
    expect(stats[2].start).toBeLessThan(0.85)
    expect(stats[2].end).toBeLessThan(0.35)
    expect(stats[2].length / stats[2].width).toBeGreaterThan(1.25 * (stats[0].length / stats[0].width))
  })

  it('mix a fresh load every few strokes whatever the zoom, so a close-up is not one flat colour', () => {
    const loads = ZOOMS.map((k) => shoot(k, P, particles).frame.stats.loads)
    // the brush-load cell is half a world unit; at 8x it would swallow the view (1 to 4 loads), so it halves 3 times
    expect(loads[2]).toBeGreaterThanOrEqual(20)
    expect(loads[1]).toBeGreaterThanOrEqual(loads[0])
  })

  it('are the frame of the tuned framing when the view says nothing about its zoom, or says 1 (or less)', () => {
    const none = paintView({ width: 480, height: 360, azimuth: 30, elevation: 25, zoom: BASE_PX })
    const g = sphereGBuffer(480, 360, { view: none, params: P })
    const a = paintFrame(scene, particles, none, g, P)
    const b = paintFrame(scene, particles, { ...none, zoom: 1 }, g, P)
    const c = paintFrame(scene, particles, { ...none, zoom: 0.5 }, g, P)
    for (const other of [b, c]) {
      expect(Array.from(other.strokes.width)).toEqual(Array.from(a.strokes.width))
      expect(Array.from(other.strokes.path)).toEqual(Array.from(a.strokes.path))
      expect(Array.from(other.strokes.colour)).toEqual(Array.from(a.strokes.colour))
    }
  })
})

describe('determinism', () => {
  it('gives the same strokes and underpainting for the same scene, parameters, seed and view, and again after turning away and back', () => {
    const particles = particlesFor(P)
    const at = (azimuth: number) => {
      const view = paintView({ width: 480, height: 360, azimuth, elevation: 25, zoom: BASE_PX * 3, magnify: 3 })
      return paintFrame(scene, particles, view, sphereGBuffer(480, 360, { view, params: P }), P)
    }
    const first = at(30)
    at(42)
    const again = at(30)
    for (const key of Object.keys(first.strokes) as (keyof StrokeBatch)[]) {
      if (key !== 'count') expect(Array.from(again.strokes[key] as ArrayLike<number>), key).toEqual(Array.from(first.strokes[key] as ArrayLike<number>))
    }
    expect(again.underpaint.length).toBe(first.underpaint.length)
    let different = 0
    for (let i = 0; i < first.underpaint.length; i++) if (!Object.is(again.underpaint[i], first.underpaint[i])) different++
    expect(different).toBe(0)
  })
})

describe('the sizes the view asks for', () => {
  const view = paintView({ width: 480, height: 360 })
  const g = sphereGBuffer(480, 360, { view })
  const ctx = (params: PaintParams, v: PaintView = view) => makeFrameCtx(scene, v, g, params)

  it('grows a stroke by sqrt(target / available) where the particles fall short, up to zoomGrowMax, and not at all where they are plentiful', () => {
    // target 90 a 10k px², block density 1: a particle that stands for 400 px² makes 25 available against 90 wanted, a ratio of 3.6
    const fc = ctx(P)
    expect(zoomGrow(fc, 50, 'block')).toBe(1) // 0.45 of the target is wanted: plentiful
    expect(zoomGrow(fc, 10000 / 90, 'block')).toBeCloseTo(1, 12) // exactly the target
    expect(zoomGrow(fc, 400, 'block')).toBeCloseTo(Math.sqrt(3.6), 12)
    expect(zoomGrow(fc, 1e6, 'block')).toBe(3) // capped at zoomGrowMax
    // a role that wants fewer (scumble 0.8) falls short later
    expect(zoomGrow(fc, 400, 'scumble')).toBeCloseTo(Math.sqrt(2.88), 12)
    // the cap is a parameter, and 1 turns growth off
    expect(zoomGrow(ctx(setParam(P, 'particles.zoomGrowMax', 2)), 1e6, 'block')).toBe(2)
    expect(zoomGrow(ctx(setParam(P, 'particles.zoomGrowMax', 1)), 400, 'block')).toBe(1)
    // while dragging the target drops by dragDensity, and so does the shortfall
    const dragging = ctx(setParam(P, 'particles.dragDensity', 0.5), { ...view, dragging: true })
    expect(zoomGrow(dragging, 400, 'block')).toBeCloseTo(Math.sqrt(1.8), 12)
  })

  it('makes the brush follow the zoom as zoom^zoomStrokeScale, never below 1', () => {
    expect(zoomSizeScale({ ...view, zoom: 8 }, P)).toBeCloseTo(8 ** 0.35, 12)
    expect(zoomSizeScale({ ...view, zoom: 8 }, P)).toBeCloseTo(2.0705, 4)
    expect(zoomSizeScale({ ...view, zoom: 8 }, setParam(P, 'particles.zoomStrokeScale', 0))).toBe(1)
    // (the brush alone is held at zoomBigMax too: 8 would be 4)
    expect(zoomSizeScale({ ...view, zoom: 8 }, setParam(P, 'particles.zoomStrokeScale', 1))).toBe(4)
    expect(zoomSizeScale({ ...view, zoom: 8 }, setParam(setParam(P, 'particles.zoomStrokeScale', 1), 'particles.zoomBigMax', 10))).toBe(8)
    expect(zoomSizeScale({ ...view, zoom: 0.25 }, P)).toBe(1)
    expect(zoomSizeScale(view, P)).toBe(1)
    expect(zoomSizeScale({ ...view, zoom: Number.NaN }, P)).toBe(1)
    expect(ctx(P, { ...view, zoom: 8 }).sizeScale).toBeCloseTo(8 ** 0.35, 12)
  })

  it('halves the brush-load cell in whole steps of the zoom, nesting a finer cell in a coarser one', () => {
    expect([undefined, 0.5, 1, 1.4, 1.42, 2.8, 2.9, 5.6, 5.7, 8, 100].map(loadCellLevel)).toEqual([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 6])
    const set = particlesFor(P)
    // level 0 is the particle's own cell; level 2 of a half-unit cell is a cell of 0.125
    expect(loadCellOf(set, 0, 0.5, 0)).toBe(set.cell[0])
    const [x, y, z] = [set.position[0], set.position[1], set.position[2]]
    expect(loadCellOf(set, 0, 0.5, 2)).toBe(cellId(Math.floor(x / 0.125), Math.floor(y / 0.125), Math.floor(z / 0.125)))
  })

  it('has the brush: size, longer for its width, more bristles and more varied ones, from the tuned size up, with no step', () => {
    expect([sizedWidth(22, 1), sizedLength(46, 1), sizedBristles(9, 1), sizedVariance(0.35, 1), closeUp(1)]).toEqual([22, 46, 9, 0.35, 0])
    // 3x the brush: 3x the width, 3 x 1.9 the length, 9 x 3^0.75 = 20.5 bristles, 0.35 x 1.45 as varied
    expect(sizedWidth(22, 3)).toBe(66)
    expect(closeUp(3)).toBe(1)
    expect(sizedLength(46, 3)).toBeCloseTo(46 * 3 * 1.9, 9)
    expect(sizedBristles(9, 3)).toBe(Math.round(9 * 3 ** 0.75))
    expect(sizedVariance(0.35, 3)).toBeCloseTo(0.35 * 1.45, 12)
    // never more bristles than the shader reads, and the variance stays a fraction
    expect(sizedBristles(24, 6)).toBe(48)
    expect(sizedVariance(0.9, 6)).toBe(1)
    // the change is smooth: halfway through the ramp, halfway changed
    expect(closeUp((1.15 + 2.2) / 2)).toBeCloseTo(0.5, 12)
  })

  it('reshapes the width along a stroke from the full-width start and short taper to a loaded start and a long taper, only past the tuned size', () => {
    const widths = (big: number) => {
      const w = Float32Array.from({ length: PATH_POINTS }, (_, q) => 20 * pressure(q / (PATH_POINTS - 1)))
      reshapeWidths(w, big)
      return w
    }
    // at the tuned size nothing changes
    const tuned = widths(1)
    for (let q = 0; q < PATH_POINTS; q++) expect(tuned[q]).toBeCloseTo(20 * pressure(q / (PATH_POINTS - 1)), 5)
    // close up the widths are 20 x the close-up pressure, point by point
    const close = widths(3)
    for (let q = 0; q < PATH_POINTS; q++) expect(close[q]).toBeCloseTo(20 * closeUpPressure(q / (PATH_POINTS - 1)), 4)
    // hand values: 0.78 x 1 x (1 + 0.1 e^-2.25) at the start, 0.3 at the end
    expect(closeUpPressure(0)).toBeCloseTo(0.78 * (1 + 0.1 * Math.exp(-2.25)), 12)
    expect(closeUpPressure(1)).toBeCloseTo(0.3, 5)
  })
})
