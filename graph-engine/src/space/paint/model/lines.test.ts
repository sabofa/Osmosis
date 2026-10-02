import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { PATH_POINTS, ROLES, type StrokeBatch } from '../types'
import { ROLE_A } from '../gl/strokes'
import { buildParticles, paintFrame } from './index'
import { LINE_MAX_PX } from './lines'
import { flatColours, lineMark, makeGBuffer, paintView, sceneOf } from './testing'

vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS

// A circle of radius R px in the screen (looking straight down the z axis at 100 px a unit), as a closed polyline of 360 points.
const R_PX = 14
const circle = (rPx: number) => {
  const pts: [number, number, number][] = []
  for (let i = 0; i <= 360; i++) pts.push([(rPx / 100) * Math.cos((i / 360) * 2 * Math.PI), (rPx / 100) * Math.sin((i / 360) * 2 * Math.PI), 0])
  return pts
}

function lineStrokes(params = P, pts = circle(R_PX)) {
  const scene = sceneOf([lineMark(pts, { index: 0 })])
  const view = paintView({ width: 400, height: 300, azimuth: 0, elevation: 90, zoom: 100 })
  const g = makeGBuffer(view, 2, () => null)
  const frame = paintFrame(scene, buildParticles(scene, flatColours({ 0: [0.4, 0.04, 0.035] }), params), view, g, params)
  return { b: frame.strokes, view }
}

// The ribbon the renderer draws through a stroke's PATH_POINTS points: a Catmull-Rom curve (shaders/stroke.ts), sampled 16 times a segment.
function ribbon(b: StrokeBatch, i: number): [number, number][] {
  const p = (k: number): [number, number] => [b.path[2 * PATH_POINTS * i + 2 * Math.min(Math.max(k, 0), PATH_POINTS - 1)], b.path[2 * PATH_POINTS * i + 2 * Math.min(Math.max(k, 0), PATH_POINTS - 1) + 1]]
  const out: [number, number][] = []
  for (let a = 0; a < PATH_POINTS - 1; a++) {
    const [p0, p1, p2, p3] = [p(a - 1), p(a), p(a + 1), p(a + 2)]
    for (let s = 0; s < 16; s++) {
      const f = s / 16
      const at = (c: number) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f * f + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * f * f * f)
      out.push([at(0), at(1)])
    }
  }
  out.push(p(PATH_POINTS - 1))
  return out
}

describe('line strokes lie on their polyline', () => {
  const { b, view } = lineStrokes()
  const lines = Array.from({ length: b.count }, (_, i) => i).filter((i) => ROLES[b.role[i]] === 'line')
  const cx = view.width / 2
  const cy = view.height / 2

  it('cuts a line into strokes of at most 21 px, so their points are at most 3 px apart', () => {
    expect(LINE_MAX_PX).toBe(21)
    // a circle of radius 14 px is 88 px round: five strokes of 17.6 px (it was three of 29)
    expect(lines.length).toBe(5)
    for (const i of lines) {
      let length = 0
      for (let k = 1; k < PATH_POINTS; k++) {
        const d = Math.hypot(b.path[2 * PATH_POINTS * i + 2 * k] - b.path[2 * PATH_POINTS * i + 2 * k - 2], b.path[2 * PATH_POINTS * i + 2 * k + 1] - b.path[2 * PATH_POINTS * i + 2 * k - 1])
        expect(d).toBeLessThanOrEqual(3 + 1e-3)
        length += d
      }
      expect(length).toBeLessThanOrEqual(LINE_MAX_PX + 1e-3)
    }
  })

  it('keeps the ribbon the renderer draws within 0.05 px of the circle (a stroke of the role’s own 36 px strayed 0.2 px and more)', () => {
    let worst = 0
    for (const i of lines) for (const [x, y] of ribbon(b, i)) worst = Math.max(worst, Math.abs(Math.hypot(x - cx, y - cy) - R_PX))
    expect(worst).toBeLessThan(0.05)
  })

  it('never makes a stroke longer than 21 px however long the role’s length is set', () => {
    const { b: longer } = lineStrokes(resolvePaintParams({ roles: { line: { length: 120 } } }), circle(60))
    for (let i = 0; i < longer.count; i++) {
      if (ROLES[longer.role[i]] !== 'line') continue
      let length = 0
      for (let k = 1; k < PATH_POINTS; k++) length += Math.hypot(longer.path[2 * PATH_POINTS * i + 2 * k] - longer.path[2 * PATH_POINTS * i + 2 * k - 2], longer.path[2 * PATH_POINTS * i + 2 * k + 1] - longer.path[2 * PATH_POINTS * i + 2 * k - 1])
      expect(length).toBeLessThanOrEqual(LINE_MAX_PX + 1e-3)
    }
  })

  it('does not thin a line stroke or load its start in the renderer, so the cuts do not show as beads along it', () => {
    const at = ROLES.indexOf('line') * 4
    // opacity 0.98, no thinning along the stroke, no start boost, wet pickup 0.04
    expect(Array.from(ROLE_A.subarray(at, at + 4))).toEqual([Math.fround(0.98), 0, 0, Math.fround(0.04)])
  })
})
