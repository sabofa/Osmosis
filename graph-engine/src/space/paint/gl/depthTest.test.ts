import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { buildParticles, paintFrame } from '../model/index'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { reprojectStrokes } from '../reproject'
import { PATH_POINTS, ROLES } from '../types'
import { depthBias, NO_SURFACE } from './depth'
import { readFileSync } from 'node:fs'
import { HIDDEN_DASH } from '../bake/types'
import {
  anchorOf,
  DASH_EDGE,
  DASH_OFF,
  DASH_ON,
  dashMask,
  DEPTH_SLOPE_CAP,
  depthVisible,
  FORM_REACH,
  formVisible,
  glPixel,
  HIDDEN_ALPHA,
  hiddenShare,
  sceneSlope,
  type SceneDepthImage,
} from './depthTest'
import { sceneBounds } from './meshes'

vi.setConfig({ testTimeout: 60_000 })

// A depth image from a function of the pixel (GL's y up; the test says what is at each pixel).
const image = (width: number, height: number, z: (x: number, y: number) => number): SceneDepthImage => ({ width, height, at: z })

describe('sceneSlope: the change of depth over a pixel, capped', () => {
  it('is the smaller one-sided difference on each axis and the larger axis: a plane z = 0.5 x + 0.25 y has slope 0.5', () => {
    const plane = image(20, 20, (x, y) => 5 + 0.5 * x + 0.25 * y)
    expect(sceneSlope(plane, 10, 10, 1)).toBeCloseTo(0.5, 12)
    // the capped slope: eight biases
    expect(sceneSlope(plane, 10, 10, 0.01)).toBeCloseTo(DEPTH_SLOPE_CAP * 0.01, 12)
  })

  it('does not take the far side of a silhouette for a slope: a pixel on a flat surface beside a 100-unit step has slope 0', () => {
    // depth 5 left of x = 10, 105 from there on: at x = 9 one side is flat, the other is the step
    const step = image(20, 20, (x) => (x < 10 ? 5 : 105))
    expect(sceneSlope(step, 9, 10, 1000)).toBe(0)
    expect(sceneSlope(step, 10, 10, 1000)).toBe(0)
  })

  it('reads past the image as its edge pixel (clamped), which makes the border pixel’s outward difference nil: no slope on a border', () => {
    const plane = image(8, 8, (x) => 2 * x)
    expect(sceneSlope(plane, 0, 4, 10)).toBe(0)
    expect(sceneSlope(plane, 7, 4, 10)).toBe(0)
    expect(sceneSlope(plane, 3, 4, 10)).toBeCloseTo(2, 12)
  })
})

describe('depthVisible: a stroke behind the surface fades, over a tolerance that grows with the slope across it', () => {
  const bias = 0.1
  const flat = image(20, 20, () => 10)

  it('sees a stroke on the surface, and one in front of it; hides one well behind it', () => {
    expect(depthVisible(flat, 5, 5, 10, 2, bias, 1)).toBe(1)
    expect(depthVisible(flat, 5, 5, 7, 2, bias, 1)).toBe(1)
    // tolerance 0.1 on flat ground: a stroke 0.2 behind is gone, 0.1 behind is whole, 0.15 is half of the way (smoothstep midpoint)
    expect(depthVisible(flat, 5, 5, 10.2, 2, bias, 1)).toBe(0)
    expect(depthVisible(flat, 5, 5, 10.1, 2, bias, 1)).toBe(1)
    expect(depthVisible(flat, 5, 5, 10.15, 2, bias, 1)).toBeCloseTo(0.5, 12)
  })

  it('widens the tolerance by the slope times the half width (at least 1.5 px): on a 0.05-a-pixel slope a 3 px half width allows 0.1 + 0.15', () => {
    const slope = image(20, 20, (x) => 10 + 0.05 * x)
    // zc at x = 5 is 10.25; the stroke is 0.25 behind it: tol = 0.1 + 0.05 * 3 = 0.25: whole
    expect(depthVisible(slope, 5, 5, 10.5, 3, bias, 1)).toBe(1)
    // the same stroke with a half width of 1 px (counted as 1.5): tol = 0.1 + 0.075 = 0.175, so 0.25 behind is between tol and 2 tol
    const v = depthVisible(slope, 5, 5, 10.5, 1, bias, 1)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  it('counts the half width in backing px: at pixel ratio 2 the same stroke allows the slope across twice as many', () => {
    const slope = image(20, 20, (x) => 10 + 0.05 * x)
    // zc at x = 5 is 10.25; the stroke is 0.3 behind it, with a half width of 3 CSS px
    // at ratio 1 the tolerance is 0.1 + 0.05 x 3 = 0.25: 0.3 is past it, a smoothstep of (0.3 - 0.25) / 0.25 = 0.2 of the way out
    expect(depthVisible(slope, 5, 5, 10.55, 3, bias, 1)).toBeCloseTo(1 - 0.2 * 0.2 * (3 - 2 * 0.2), 12)
    // at ratio 2 it is 6 backing px: 0.1 + 0.05 x 6 = 0.4, and the stroke is whole
    expect(depthVisible(slope, 5, 5, 10.55, 3, bias, 2)).toBe(1)
    // a hair of a stroke (0.3 CSS px) is no narrower than 1.5 backing px, at either ratio
    expect(depthVisible(slope, 5, 5, 10.55, 0.3, bias, 2)).toBe(depthVisible(slope, 5, 5, 10.55, 0.3, bias, 1))
  })

  it('hides a stroke behind a nearer surface of a different object, whatever the slope there', () => {
    // a wall at depth 3 in front of the stroke at depth 10
    const wall = image(20, 20, () => 3)
    expect(depthVisible(wall, 5, 5, 10, 4, bias, 1)).toBe(0)
  })

  it('treats a stroke over nothing (NO_SURFACE) as in front of it: one-sided, nothing hides it', () => {
    const none = image(20, 20, () => NO_SURFACE)
    expect(depthVisible(none, 5, 5, 10, 2, bias, 1)).toBe(1)
  })
})

describe('glPixel: CSS px of the view to the depth image, GL y up', () => {
  it('flips y: the top left of the view is the top row, the last row of the image', () => {
    expect(glPixel(0, 0, 400, 300, 800, 600)).toEqual([0, 600])
    expect(glPixel(400, 300, 400, 300, 800, 600)).toEqual([800, 0])
    expect(glPixel(100, 75, 400, 300, 800, 600)).toEqual([200, 450])
  })
})

describe('anchorOf: the point of a decal nearest the viewer', () => {
  it('is the index of the smallest depth, the first of equals', () => {
    expect(anchorOf([5, 3, 4, 3])).toBe(1)
    expect(anchorOf([2, 3, 4])).toBe(0)
    expect(anchorOf([24.5, 24.4, 19.8, 19.6, 19.6])).toBe(3)
  })
})

describe('formVisible: an edge decal that has left its form goes, once per stroke, at its nearest point', () => {
  const bias = 0.1
  // the form is a disc of radius 20 px about (50, 50) at depth 10, over nothing; the image is 100 x 100 at pixel ratio 1
  const disc = image(100, 100, (x, y) => (Math.hypot(x + 0.5 - 50, y + 0.5 - 50) < 20 ? 10 : NO_SURFACE))
  const at = (cssX: number, cssYDown: number, vz: number, ratio = 1) => formVisible(disc, cssX, cssYDown, 100, 100, vz, ratio, bias)

  it('keeps a decal on the form: at its depth, anywhere inside', () => {
    expect(at(50, 50, 10)).toBe(1)
    expect(at(60, 40, 10.05)).toBe(1)
  })

  it('keeps a decal on the outline, where the pixel under it is background: the form is within reach', () => {
    // the outline at x = 70: its pixel is just outside the disc, the form is a pixel or two away
    expect(at(70.4, 50, 10)).toBe(1)
    expect(at(70 + FORM_REACH - 1, 50, 10)).toBe(1)
  })

  it('clips a decal over nothing, beyond reach of the form (FORM_REACH CSS px)', () => {
    expect(at(70 + FORM_REACH + 3, 50, 10)).toBe(0)
    expect(at(95, 95, 10)).toBe(0)
  })

  it('clips a decal that floats off the form, in front of it or behind it, over the form itself', () => {
    expect(at(50, 50, 10 - 1)).toBe(0)
    expect(at(50, 50, 10 + 1)).toBe(0)
  })

  it('flips y as the shader does: a disc low in the GL image is low on the screen', () => {
    // a form only in the bottom 20 rows of the image (GL y < 20), that is the bottom of the view
    const low = image(100, 100, (_x, y) => (y < 20 ? 10 : NO_SURFACE))
    expect(formVisible(low, 50, 95, 100, 100, 10, 1, bias)).toBe(1)
    expect(formVisible(low, 50, 5, 100, 100, 10, 1, bias)).toBe(0)
  })

  it('reaches FORM_REACH CSS px at any pixel ratio: at ratio 2 the window is twice as many backing px', () => {
    const wide = image(200, 200, (x, y) => (Math.hypot(x + 0.5 - 100, y + 0.5 - 100) < 40 ? 10 : NO_SURFACE))
    // 2 CSS px = 4 backing px outside the rim (x = 140): the form is within 3 CSS px
    expect(formVisible(wide, 71, 50, 100, 100, 10, 2, bias)).toBe(1)
    expect(formVisible(wide, 70 + FORM_REACH + 3, 50, 100, 100, 10, 2, bias)).toBe(0)
  })

  it('allows a steep limb: its depth moves fast across the reach, and the tolerance with it', () => {
    // a ramp of 0.1 a pixel (a bias a pixel) down to the rim at x = 70, and nothing beyond: the decal's own depth is the
    // model's (the nearest in its pixels), which can be a pixel or two off the window's nearest
    const ramp = image(100, 100, (x) => (x < 70 ? 10 + 0.1 * (70 - x) : NO_SURFACE))
    // the nearest surface in reach of (71, 50) is x = 69 at depth 10.1; a decal at 10.4 is 0.3 off: tol = 0.1 + 0.1 * 3 = 0.4
    expect(formVisible(ramp, 71, 50, 100, 100, 10.4, 1, bias)).toBe(1)
    // a flat form has none of that leniency
    const flat = image(100, 100, (x) => (x < 70 ? 10 : NO_SURFACE))
    expect(formVisible(flat, 71, 50, 100, 100, 10.4, 1, bias)).toBe(0)
  })
})

// The real thing: the model's own edge strokes on a sphere on a table, seen at the view they were made for, against the
// scene's depth for that view (full resolution, as the renderer's depth pass is). Nothing has moved, so the edges are
// where the surfaces are, and they must all be shown. (Before round 2, 190 of 608 edge samples were hidden here, and 30
// of the 76 edges were mostly hidden: the first pixel of an orbit stripped the figure of its edges.)
describe('the edge strokes of a sphere on a table, at the view they were made for', () => {
  const W = 640
  const H = 480
  const P = DEFAULT_PAINT_PARAMS
  const scene = sceneOf([sphereMesh({ radius: 0.6 }), tableMesh({ z: -0.6, half: 1.5, index: 1 })])
  const colours = flatColours({ 0: [0.56, 0.12, 0.08], 1: [0.9, 0.01, 0.02] })
  const view = paintView({ width: W, height: H, azimuth: 30, elevation: 25, zoom: 200 })
  const options = { view, params: P, centre: [0, 0, 0] as [number, number, number], radius: 0.6, mark: 0, table: { z: -0.6, mark: 1 } }
  const g = sphereGBuffer(W, H, options)
  const frame = paintFrame(scene, buildParticles(scene, colours, P), view, g, P)
  const strokes = frame.strokes
  const bias = depthBias(sceneBounds(scene).radius)
  // the scene's depth at backing px (here the CSS px), GL's y up
  const full = sphereGBuffer(W, H, { ...options, scale: 1 })
  const scenery = image(W, H, (x, y) => {
    const z = full.depth[(H - 1 - y) * W + x]
    return Number.isFinite(z) ? z : NO_SURFACE
  })
  const viewDepth = (i: number, q: number) =>
    (strokes.worldPath[3 * PATH_POINTS * i + 3 * q] - view.eye[0]) * view.viewDir[0] +
    (strokes.worldPath[3 * PATH_POINTS * i + 3 * q + 1] - view.eye[1]) * view.viewDir[1] +
    (strokes.worldPath[3 * PATH_POINTS * i + 3 * q + 2] - view.eye[2]) * view.viewDir[2]

  // every sample of the strokes of a role: [x, y] CSS px, the decal's depth there, its half width, the unit normal of the path
  function samples(role: string) {
    const out: { i: number; x: number; y: number; vz: number; hw: number; nx: number; ny: number }[] = []
    const r = ROLES.indexOf(role as (typeof ROLES)[number])
    for (let i = 0; i < strokes.count; i++) {
      if (strokes.role[i] !== r) continue
      for (let q = 0; q < PATH_POINTS; q++) {
        const x = strokes.path[2 * PATH_POINTS * i + 2 * q]
        const y = strokes.path[2 * PATH_POINTS * i + 2 * q + 1]
        const a = Math.max(q - 1, 0)
        const b = Math.min(q + 1, PATH_POINTS - 1)
        const tx = strokes.path[2 * PATH_POINTS * i + 2 * b] - strokes.path[2 * PATH_POINTS * i + 2 * a]
        const ty = strokes.path[2 * PATH_POINTS * i + 2 * b + 1] - strokes.path[2 * PATH_POINTS * i + 2 * a + 1]
        const l = Math.hypot(tx, ty) || 1
        out.push({ i, x, y, vz: viewDepth(i, q), hw: Math.max(strokes.width[PATH_POINTS * i + q] * 0.5, 0.6), nx: -ty / l, ny: tx / l })
      }
    }
    return out
  }
  // whether the edge stroke is on its form, as the vertex shader decides it: at its point nearest the viewer
  const formOf = new Map<number, number>()
  const form = (i: number): number => {
    const have = formOf.get(i)
    if (have !== undefined) return have
    const depths = Array.from({ length: PATH_POINTS }, (_, q) => viewDepth(i, q))
    const k = anchorOf(depths)
    const v = formVisible(scenery, strokes.path[2 * PATH_POINTS * i + 2 * k], strokes.path[2 * PATH_POINTS * i + 2 * k + 1], W, H, depths[k], 1, bias)
    formOf.set(i, v)
    return v
  }
  // what the shader shows of a sample's centreline: the fragment test at its pixel, and for an edge the form test of its stroke
  const seen = (s: ReturnType<typeof samples>[number], edge: boolean) => {
    const [cx, cy] = glPixel(s.x, s.y, W, H, W, H)
    const fragment = depthVisible(scenery, Math.floor(cx), Math.floor(cy), s.vz, s.hw, bias, 1)
    return edge ? fragment * form(s.i) : fragment
  }

  it('has edge strokes to test, and they have a depth of their own at every point (a decal that follows the surface)', () => {
    const edge = samples('edge')
    expect(strokes.count).toBeGreaterThan(300)
    expect(edge.length).toBeGreaterThan(400)
    // a long edge on the sphere's rim runs over a range of depths: more than a stroke of one depth would
    const byStroke = new Map<number, number[]>()
    for (const s of edge) byStroke.set(s.i, [...(byStroke.get(s.i) ?? []), s.vz])
    const spread = [...byStroke.values()].filter((zs) => Math.max(...zs) - Math.min(...zs) > 1e-3).length
    expect(spread).toBeGreaterThan(byStroke.size / 2)
  })

  it('shows at least 99% of the edge samples at the centreline, as the block strokes always were', () => {
    const edge = samples('edge')
    const hidden = edge.filter((s) => seen(s, true) < 0.5).length
    expect(hidden / edge.length).toBeLessThanOrEqual(0.01)
    const block = samples('block')
    expect(block.filter((s) => seen(s, false) < 0.5).length / block.length).toBeLessThanOrEqual(0.01)
  })

  it('shows the edge samples across the ribbon too (a half width either side of the centreline), one-sided', () => {
    const edge = samples('edge')
    let n = 0
    let hidden = 0
    for (const s of edge) {
      for (const side of [-1, 1]) {
        const [cx, cy] = glPixel(s.x + s.nx * s.hw * side, s.y + s.ny * s.hw * side, W, H, W, H)
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue
        n++
        if (depthVisible(scenery, Math.floor(cx), Math.floor(cy), s.vz, s.hw, bias, 1) < 0.5) hidden++
      }
    }
    expect(n).toBeGreaterThan(800)
    expect(hidden / n).toBeLessThanOrEqual(0.01)
  })

  // The first pixel of an orbit: the decals ride the surface they were traced on (each point at the depth of its own
  // surface), so the new view's depth still finds them on it. Measured with the decal of ONE depth (the nearest of its
  // path, round 1): 21% of the edge samples hidden after 5 degrees, and 16 of the 76 edges off their form.
  it('keeps the edges through an orbit: after 5, 10 and 20 degrees at most 1% of the edge samples are hidden, and at most 8% after 40 (the far side of the sphere turns away)', () => {
    const edge = ROLES.indexOf('edge')
    for (const [turn, most] of [[5, 0.01], [10, 0.01], [20, 0.01], [40, 0.08]] as const) {
      const to = paintView({ width: W, height: H, azimuth: 30 + turn, elevation: 25, zoom: 200 })
      const turned = reprojectStrokes(strokes, view, to, P)
      const next = sphereGBuffer(W, H, { ...options, view: to, scale: 1 })
      const depthNow = image(W, H, (x, y) => {
        const z = next.depth[(H - 1 - y) * W + x]
        return Number.isFinite(z) ? z : NO_SURFACE
      })
      let n = 0
      let hidden = 0
      for (let i = 0; i < turned.count; i++) {
        if (turned.role[i] !== edge) continue
        const depths = Array.from({ length: PATH_POINTS }, (_, q) => {
          const w = 3 * PATH_POINTS * i + 3 * q
          return (strokes.worldPath[w] - to.eye[0]) * to.viewDir[0] + (strokes.worldPath[w + 1] - to.eye[1]) * to.viewDir[1] + (strokes.worldPath[w + 2] - to.eye[2]) * to.viewDir[2]
        })
        const k = anchorOf(depths)
        const form = formVisible(depthNow, turned.path[2 * PATH_POINTS * i + 2 * k], turned.path[2 * PATH_POINTS * i + 2 * k + 1], W, H, depths[k], 1, bias)
        for (let q = 0; q < PATH_POINTS; q++) {
          const x = turned.path[2 * PATH_POINTS * i + 2 * q]
          const y = turned.path[2 * PATH_POINTS * i + 2 * q + 1]
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          const [cx, cy] = glPixel(x, y, W, H, W, H)
          n++
          if (depthVisible(depthNow, Math.floor(cx), Math.floor(cy), depths[q], Math.max(turned.width[PATH_POINTS * i + q] * 0.5, 0.6), bias, 1) * form < 0.5) hidden++
        }
      }
      expect(n, `turn ${turn}`).toBeGreaterThan(550)
      expect(hidden / n, `turn ${turn}`).toBeLessThanOrEqual(most)
    }
  })
})

describe('the hidden pass: the dash mask and the depth test turned the other way', () => {
  it('uses the per-frame model’s hidden dash (5 px on, 4 px off) and its faintness (alpha 0.5)', () => {
    expect(HIDDEN_DASH).toEqual([5, 4])
    expect([DASH_ON, DASH_OFF]).toEqual([5, 4])
    expect(HIDDEN_ALPHA).toBe(0.5)
    // the model's hidden run is a stroke of alpha 0.5 (lines.ts): the number has no export to import, so read it
    const lines = readFileSync(new URL('../model/lines.ts', import.meta.url), 'utf8')
    expect(lines).toContain('alpha: hiddenRun ? 0.5 : 1,')
  })

  it('reads the dash from the contract (bake/types.ts) on both sides: the model dashes its hidden runs with it, and the renderer’s depth test does not import the model', () => {
    const model = readFileSync(new URL('../model/lines.ts', import.meta.url), 'utf8')
    expect(model).toContain("import { HIDDEN_DASH } from '../bake/types'")
    expect(model).toContain('dash && dash.length ? dash : HIDDEN_DASH')
    // the model no longer defines its own
    expect(model).not.toMatch(/(?:const|let)\s+HIDDEN_DASH\b/)
    const renderer = readFileSync(new URL('./depthTest.ts', import.meta.url), 'utf8')
    expect(renderer).toContain("import { HIDDEN_DASH } from '../bake/types'")
    expect(renderer).not.toMatch(/from '\.\.\/model\//)
  })

  describe('dashMask', () => {
    it('is 1 inside a dash and 0 in a gap, a dash starting at the stroke’s start: 5 px on, 4 px off', () => {
      for (const s of [1, 2.5, 4]) expect(dashMask(s), `s ${s}`).toBe(1)
      for (const s of [6, 7, 8]) expect(dashMask(s), `s ${s}`).toBe(0)
      // the next dash
      for (const s of [10, 11.5, 13]) expect(dashMask(s), `s ${s}`).toBe(1)
      for (const s of [15, 16.5, 17]) expect(dashMask(s), `s ${s}`).toBe(0)
    })

    it('has an edge DASH_EDGE (1 px) wide, centred on the end of a dash: half at the start and at the end, whole and nothing half a pixel in and out', () => {
      expect(DASH_EDGE).toBe(1)
      expect(dashMask(0)).toBeCloseTo(0.5, 12)
      expect(dashMask(5)).toBeCloseTo(0.5, 12)
      expect(dashMask(9)).toBeCloseTo(0.5, 12)
      expect(dashMask(-0.5)).toBe(0)
      expect(dashMask(0.5)).toBe(1)
      expect(dashMask(4.5)).toBe(1)
      expect(dashMask(5.5)).toBe(0)
      expect(dashMask(8.5)).toBe(0)
      expect(dashMask(9.5)).toBe(1)
      expect(dashMask(0.25)).toBeCloseTo(0.75, 12)
      expect(dashMask(5.25)).toBeCloseTo(0.25, 12)
    })

    it('repeats every 9 px, before the start of the stroke too (its cap)', () => {
      for (const s of [-3.3, -0.2, 0.1, 2, 4.9, 5.2, 7, 8.8]) {
        for (const k of [-3, -1, 1, 4]) expect(dashMask(s + 9 * k), `s ${s} k ${k}`).toBeCloseTo(dashMask(s), 9)
      }
    })

    it('covers 5 px of every 9: the edges lose and gain the same, and the share on is 5/9', () => {
      let sum = 0
      let on = 0
      const steps = 9000
      for (let i = 0; i < steps; i++) {
        const v = dashMask((i + 0.5) / 1000)
        sum += v / 1000
        if (v >= 0.5) on++
      }
      expect(sum).toBeCloseTo(5, 2)
      expect(on / steps).toBeCloseTo(5 / 9, 2)
    })

    it('takes another pattern too: 2 on, 2 off', () => {
      expect(dashMask(1, 2, 2)).toBe(1)
      expect(dashMask(3, 2, 2)).toBe(0)
      expect(dashMask(5, 2, 2)).toBe(1)
    })
  })

  describe('hiddenShare', () => {
    const bias = 0.1
    const flat = image(20, 20, () => 10)

    it('draws nothing where the stroke is on or in front of the surface, and the dashed faint stroke where a surface is nearer', () => {
      expect(hiddenShare(flat, 5, 5, 7, 2, bias, 1, 2)).toBe(0)
      expect(hiddenShare(flat, 5, 5, 10, 2, bias, 1, 2)).toBe(0)
      // well behind: the mask and the faintness
      expect(hiddenShare(flat, 5, 5, 10.5, 2, bias, 1, 2)).toBe(HIDDEN_ALPHA)
      expect(hiddenShare(flat, 5, 5, 10.5, 2, bias, 1, 6)).toBe(0)
      expect(hiddenShare(flat, 5, 5, 10.5, 2, bias, 1, 5)).toBeCloseTo(HIDDEN_ALPHA * 0.5, 12)
    })

    it('is the other half of the normal pass at every depth: where the normal pass draws a share v of the stroke, the hidden pass draws 1 - v, so the stroke is whole once between them', () => {
      for (let vz = 9; vz <= 10.5; vz += 0.013) {
        const seen = depthVisible(flat, 5, 5, vz, 2, bias, 1)
        const hidden = hiddenShare(flat, 5, 5, vz, 2, bias, 1, 2) / (dashMask(2) * HIDDEN_ALPHA)
        expect(seen + hidden, `vz ${vz}`).toBeCloseTo(1, 12)
      }
    })

    it('uses the same tolerance as the normal pass, slope included', () => {
      const slope = image(20, 20, (x) => 10 + 0.05 * x)
      for (const vz of [10.2, 10.5, 10.7]) {
        const seen = depthVisible(slope, 5, 5, vz, 3, bias, 1)
        const hidden = hiddenShare(slope, 5, 5, vz, 3, bias, 1, 2) / HIDDEN_ALPHA
        expect(seen + hidden, `vz ${vz}`).toBeCloseTo(1, 12)
      }
    })
  })
})
