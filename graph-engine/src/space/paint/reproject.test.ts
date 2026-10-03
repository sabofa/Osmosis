import { describe, expect, it, vi } from 'vitest'
import { buildParticles, paintFrame } from './model/index'
import { arrowMark, flatColours, lineMark, makeGBuffer, paintView, pointMark, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './model/testing'
import { DEFAULT_PAINT_PARAMS } from './params'
import { reprojectStrokes } from './reproject'
import { Scratch } from './scratch'
import { PATH_POINTS, ROLES, type StrokeBatch } from './types'

// A frame's strokes in another view, without the model: the paint rides the object while the camera moves.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: [0.56, 0.12, 0.08], 1: [0.9, 0.01, 0.02], 2: [0.4, 0.04, 0.035], 3: [0.4, 0.04, 0.035] })
const sphereScene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])

function frame(opts: { azimuth?: number; perspective?: boolean } = {}) {
  const view = paintView({ width: 640, height: 480, azimuth: opts.azimuth ?? 30, elevation: 25, zoom: 120, perspective: opts.perspective })
  const g = sphereGBuffer(640, 480, { view, table: { z: -1, mark: 1 } })
  const batch = paintFrame(sphereScene, buildParticles(sphereScene, COLOURS, P), view, g, P).strokes
  return { view, batch }
}

const rolesOf = (b: StrokeBatch) => Array.from(b.role, (r) => ROLES[r])
const maxPathError = (a: StrokeBatch, b: StrokeBatch, only?: (i: number) => boolean) => {
  let worst = 0
  for (let i = 0; i < a.count; i++) {
    if (only && !only(i)) continue
    for (let c = 0; c < 2 * PATH_POINTS; c++) worst = Math.max(worst, Math.abs(a.path[2 * PATH_POINTS * i + c] - b.path[2 * PATH_POINTS * i + c]))
  }
  return worst
}

describe('reprojectStrokes', () => {
  for (const perspective of [false, true]) {
    it(`puts every stroke back where it was in its own view (${perspective ? 'perspective' : 'orthographic'}), the edges too`, () => {
      const { view, batch } = frame({ perspective })
      const again = reprojectStrokes(batch, view, view, P)
      expect(again.count).toBe(batch.count)
      expect(batch.count).toBeGreaterThan(300)
      // every role is there: block, form, glaze, edge, dab (and the table's)
      expect(new Set(rolesOf(batch))).toContain('edge')
      // a path is its world path projected: to float rounding for a surface stroke (a perspective camera divides, and the
      // model's screen path is linear between its steps while the world path is, so a hair of difference), and for an edge
      // (its world points looked up through the G-buffer depth and projected back) within a pixel
      expect(maxPathError(again, batch, (i) => ROLES[batch.role[i]] !== 'edge')).toBeLessThan(perspective ? 0.5 : 0.05)
      expect(maxPathError(again, batch, (i) => ROLES[batch.role[i]] === 'edge')).toBeLessThan(1)
      // nothing but where it is changed: alpha, in its own view, is the one it was made with
      for (let i = 0; i < batch.count; i++) expect(again.alpha[i]).toBeCloseTo(batch.alpha[i], 6)
    })
  }

  it('keeps every stroke, on the object: in a view turned 25 degrees the strokes that still face the camera stay inside the sphere’s outline', () => {
    const { view, batch } = frame({ azimuth: 30 })
    const to = paintView({ width: 640, height: 480, azimuth: 55, elevation: 25, zoom: 120 })
    const turned = reprojectStrokes(batch, view, to, P)
    expect(turned.count).toBe(batch.count)
    // the sphere (radius 1 at the origin) is a disc of 120 px about the screen's centre in an orthographic view
    const cx = to.width / 2
    const cy = to.height / 2
    let onSphere = 0
    let inside = 0
    for (let i = 0; i < turned.count; i++) {
      if (!['block', 'form', 'glaze', 'scumble', 'reflected', 'dab'].includes(ROLES[turned.role[i]])) continue
      // the strokes of the sphere itself: where it started, in the first view, it was in the disc
      const x0 = batch.path[2 * PATH_POINTS * i]
      const y0 = batch.path[2 * PATH_POINTS * i + 1]
      if (Math.hypot(x0 - cx, y0 - cy) > 112) continue
      onSphere++
      let ok = true
      for (let q = 0; q < PATH_POINTS; q++) {
        const x = turned.path[2 * PATH_POINTS * i + 2 * q]
        const y = turned.path[2 * PATH_POINTS * i + 2 * q + 1]
        // the sphere's outline (a walked path is in the tangent plane, a little off the surface)
        if (Math.hypot(x - cx, y - cy) > 120 + 8) ok = false
      }
      if (ok) inside++
    }
    expect(onSphere).toBeGreaterThan(200)
    expect(inside / onSphere).toBeGreaterThan(0.97)
  })

  for (const perspective of [false, true]) {
    it(`never tears a stroke (${perspective ? 'perspective' : 'orthographic'}): in a view turned by up to 60 degrees no stroke, an edge's included, is much longer than it was`, () => {
      const { view, batch } = frame({ perspective })
      const length = (b: StrokeBatch, i: number) => {
        let l = 0
        for (let q = 1; q < PATH_POINTS; q++) l += Math.hypot(b.path[2 * PATH_POINTS * i + 2 * q] - b.path[2 * PATH_POINTS * i + 2 * q - 2], b.path[2 * PATH_POINTS * i + 2 * q + 1] - b.path[2 * PATH_POINTS * i + 2 * q - 1])
        return l
      }
      let edges = 0
      for (const turn of [10, 30, 60]) {
        const to = paintView({ width: 640, height: 480, azimuth: 30 + turn, elevation: 25, zoom: 120, perspective })
        const turned = reprojectStrokes(batch, view, to, P)
        for (let i = 0; i < batch.count; i++) {
          if (ROLES[batch.role[i]] === 'edge') edges++
          expect(length(turned, i), `stroke ${i} (${ROLES[batch.role[i]]}) turned ${turn}`).toBeLessThan(2.5 * length(batch, i) + 25)
        }
      }
      expect(edges).toBeGreaterThan(30)
    })
  }

  it('moves the depth with the view (so the renderer’s order within a layer follows it), and leaves everything else the batch’s own', () => {
    const { view, batch } = frame()
    const to = paintView({ width: 640, height: 480, azimuth: 80, elevation: 25, zoom: 120 })
    const turned = reprojectStrokes(batch, view, to, P)
    for (let i = 0; i < turned.count; i += 7) {
      const w = batch.worldPath.subarray(3 * PATH_POINTS * i, 3 * PATH_POINTS * i + 3)
      const d = (w[0] - to.eye[0]) * to.viewDir[0] + (w[1] - to.eye[1]) * to.viewDir[1] + (w[2] - to.eye[2]) * to.viewDir[2]
      expect(turned.depth[i]).toBeCloseTo(d, 3)
    }
    expect(Array.from(turned.depth)).not.toEqual(Array.from(batch.depth))
    // the colours, roles, layers and widths are the very arrays of the batch: a stroke keeps its colour as it rides
    expect(turned.colour).toBe(batch.colour)
    expect(turned.role).toBe(batch.role)
    expect(turned.layer).toBe(batch.layer)
    expect(turned.width).toBe(batch.width)
    expect(turned.path).not.toBe(batch.path)
    expect(turned.alpha).not.toBe(batch.alpha)
  })

  it('fades out a stroke whose anchor turns away from the viewer, over the model’s own fade band, and never makes one stronger', () => {
    const { view, batch } = frame({ azimuth: 30 })
    const away = paintView({ width: 640, height: 480, azimuth: 30 + 150, elevation: 25, zoom: 120 })
    const turned = reprojectStrokes(batch, view, away, P)
    let faded = 0
    let kept = 0
    for (let i = 0; i < batch.count; i++) {
      expect(turned.alpha[i]).toBeLessThanOrEqual(batch.alpha[i] + 1e-6)
      const hasNormal = batch.worldNormal[3 * i] !== 0 || batch.worldNormal[3 * i + 1] !== 0 || batch.worldNormal[3 * i + 2] !== 0
      if (!hasNormal) {
        // an edge or a line has none: it does not fade
        expect(turned.alpha[i]).toBe(batch.alpha[i])
        continue
      }
      if (turned.alpha[i] < 0.01 * batch.alpha[i]) faded++
      else kept++
      // the anchor's own facing in the new view says which: n.v at or under fadeLo is gone
      const nv = batch.worldNormal[3 * i] * -away.viewDir[0] + batch.worldNormal[3 * i + 1] * -away.viewDir[1] + batch.worldNormal[3 * i + 2] * -away.viewDir[2]
      if (nv <= 0) expect(turned.alpha[i]).toBeLessThan(0.01 * batch.alpha[i] + 1e-6)
    }
    // turned 150 degrees about the sphere, most of the strokes that were on its lit face now look away from the camera
    expect(faded).toBeGreaterThan(kept)
    expect(kept).toBeGreaterThan(0)
  })

  it('moves a stroke made on the screen alone, an arrowhead’s barb or a point’s dab, rigidly with its anchor', () => {
    const scene = sceneOf([
      lineMark([[-1, 0, 0], [1, 0.3, 0.2]], { index: 0 }),
      arrowMark([0, -0.5, 0], [0.8, 0.3, 0.2], { index: 1 }),
      pointMark([[0.2, 0.2, 0.3]], { index: 2, size: 12 }),
    ])
    const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 120 })
    const batch = paintFrame(scene, buildParticles(scene, COLOURS, P), view, makeGBuffer(view, 2, () => null), P).strokes
    const to = paintView({ width: 640, height: 480, azimuth: 60, elevation: 30, zoom: 120 })
    const turned = reprojectStrokes(batch, view, to, P)
    expect(batch.count).toBeGreaterThan(4)
    let rigid = 0
    for (let i = 0; i < batch.count; i++) {
      const w = batch.worldPath.subarray(3 * PATH_POINTS * i, 3 * PATH_POINTS * (i + 1))
      const same = Array.from({ length: PATH_POINTS }, (_, q) => Math.hypot(w[3 * q] - w[0], w[3 * q + 1] - w[1], w[3 * q + 2] - w[2])).every((d) => d < 1e-6)
      if (!same) continue
      rigid++
      // every point of the stroke moved by the same shift: its shape is the one it was made with
      const sx = turned.path[2 * PATH_POINTS * i] - batch.path[2 * PATH_POINTS * i]
      const sy = turned.path[2 * PATH_POINTS * i + 1] - batch.path[2 * PATH_POINTS * i + 1]
      expect(Math.hypot(sx, sy)).toBeGreaterThan(5)
      for (let q = 1; q < PATH_POINTS; q++) {
        expect(turned.path[2 * PATH_POINTS * i + 2 * q] - batch.path[2 * PATH_POINTS * i + 2 * q]).toBeCloseTo(sx, 3)
        expect(turned.path[2 * PATH_POINTS * i + 2 * q + 1] - batch.path[2 * PATH_POINTS * i + 2 * q + 1]).toBeCloseTo(sy, 3)
      }
    }
    // the arrowhead's two barbs and the point's dab are rigid; the shaft and the curve are lines on the geometry
    expect(rigid).toBeGreaterThanOrEqual(3)
    // a line's points are exactly on its 3D polyline: in its own view they are where they were
    const same = reprojectStrokes(batch, view, view, P)
    expect(maxPathError(same, batch)).toBeLessThan(0.05)
  })

  it('leaves a stroke with no world path as it was, and hides a point behind the eye', () => {
    const { view, batch } = frame()
    const bare: StrokeBatch = { ...batch, worldPath: new Float32Array(batch.worldPath.length) }
    const same = reprojectStrokes(bare, view, paintView({ width: 640, height: 480, azimuth: 90, elevation: 10, zoom: 120 }), P)
    expect(Array.from(same.path)).toEqual(Array.from(batch.path))
    expect(Array.from(same.alpha)).toEqual(Array.from(batch.alpha))
    // a perspective camera with a stroke's world point behind it
    const persp = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 120, perspective: true })
    const behind: StrokeBatch = { ...batch, worldPath: Float32Array.from(batch.worldPath) }
    const eye = persp.eye
    const back = [eye[0] - persp.viewDir[0] * 3, eye[1] - persp.viewDir[1] * 3, eye[2] - persp.viewDir[2] * 3]
    for (let q = 0; q < PATH_POINTS; q++) behind.worldPath.set([back[0] + q * 0.01, back[1], back[2]], 3 * q)
    expect(reprojectStrokes(behind, view, persp, P).alpha[0]).toBe(0)
  })

  it('is cheap: 15,000 strokes in a few milliseconds', () => {
    const { view, batch } = frame()
    const n = 15_000
    const big: StrokeBatch = { ...batch, count: n }
    const rep = (a: ArrayLike<number>, per: number) => {
      const out = new Float32Array(per * n)
      for (let i = 0; i < out.length; i++) out[i] = (a as Float32Array)[i % (per * batch.count)]
      return out
    }
    big.path = rep(batch.path, 2 * PATH_POINTS)
    big.worldPath = rep(batch.worldPath, 3 * PATH_POINTS)
    big.worldNormal = rep(batch.worldNormal, 3)
    big.depth = rep(batch.depth, 1)
    big.alpha = rep(batch.alpha, 1)
    const to = paintView({ width: 640, height: 480, azimuth: 45, elevation: 25, zoom: 120 })
    reprojectStrokes(big, view, to, P)
    const times: number[] = []
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now()
      reprojectStrokes(big, view, to, P)
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    expect(times[3]).toBeLessThan(40)
  })

  it('leaves an edge stroke only the share of its alpha the caller says is left (its base’s age), and touches nothing else', () => {
    const { view, batch } = frame()
    const to = paintView({ width: 640, height: 480, azimuth: 40, elevation: 25, zoom: 120 })
    const plain = reprojectStrokes(batch, view, to, P)
    const half = reprojectStrokes(batch, view, to, P, 0.5)
    const none = reprojectStrokes(batch, view, to, P, 0)
    const edges = Array.from({ length: batch.count }, (_, i) => i).filter((i) => ROLES[batch.role[i]] === 'edge')
    expect(edges.length).toBeGreaterThan(10)
    expect(edges.some((i) => plain.alpha[i] > 0.3)).toBe(true)
    for (let i = 0; i < batch.count; i++) {
      if (ROLES[batch.role[i]] === 'edge') {
        expect(half.alpha[i]).toBeCloseTo(0.5 * plain.alpha[i], 7)
        expect(none.alpha[i]).toBe(0)
      } else {
        // the strokes of the surface, and the lines, are as they were: they are where the surface is, in any view
        expect(half.alpha[i]).toBe(plain.alpha[i])
        expect(none.alpha[i]).toBe(plain.alpha[i])
      }
    }
    // the path is the same: only how much of the edge is shown changes
    expect(Array.from(none.path)).toEqual(Array.from(plain.path))
    // and no argument is no fade
    expect(Array.from(reprojectStrokes(batch, view, to, P, 1).alpha)).toEqual(Array.from(plain.alpha))
  })

  it('given a scratch, makes the same strokes in arrays it keeps, written afresh each call, and never touches the batch’s own', () => {
    const { view, batch } = frame()
    const to = paintView({ width: 640, height: 480, azimuth: 40, elevation: 25, zoom: 120 })
    const to2 = paintView({ width: 640, height: 480, azimuth: 55, elevation: 25, zoom: 120 })
    const plain = reprojectStrokes(batch, view, to, P, 0.5)
    const plain2 = reprojectStrokes(batch, view, to2, P, 1)
    const own = [Array.from(batch.path), Array.from(batch.depth), Array.from(batch.alpha)]
    const scratch = new Scratch()
    const a = reprojectStrokes(batch, view, to, P, 0.5, scratch)
    expect(Array.from(a.path)).toEqual(Array.from(plain.path))
    expect(Array.from(a.depth)).toEqual(Array.from(plain.depth))
    expect(Array.from(a.alpha)).toEqual(Array.from(plain.alpha))
    expect(scratch.allocations).toBe(3)
    // again, for another view: the same arrays, now holding that view's strokes (every element rewritten)
    const b = reprojectStrokes(batch, view, to2, P, 1, scratch)
    expect(b.path).toBe(a.path)
    expect(b.alpha).toBe(a.alpha)
    expect(Array.from(b.path)).toEqual(Array.from(plain2.path))
    expect(Array.from(b.alpha)).toEqual(Array.from(plain2.alpha))
    expect(scratch.allocations).toBe(3)
    // what the batch holds is its own
    expect([Array.from(batch.path), Array.from(batch.depth), Array.from(batch.alpha)]).toEqual(own)
    expect(b.path).not.toBe(batch.path)
    expect(b.colour).toBe(batch.colour)
  })
})
