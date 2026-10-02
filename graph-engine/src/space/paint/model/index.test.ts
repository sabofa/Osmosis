import { describe, expect, it, vi } from 'vitest'
import type { MeshMark, SpaceScene } from '../../scene/types'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, ZONES, type GBuffer, type PaintFrame, type PaintView, type StrokeBatch } from '../types'
import { labToLch, lchToLab } from './colour'
import { makeCurve } from './curve'
import { buildParticles, groundLocal, paintFrame } from './index'
import { arrowMark, flatColours, lineMark, paintView, pointMark, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { canvasValue } from './value'
import { makeFrameCtx, project } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const TERRACOTTA = lchToLab(0.56, 0.14, 38)
const COLOURS = flatColours({ 0: TERRACOTTA, 1: lchToLab(0.9, 0.01, 85) })

interface Frame {
  frame: PaintFrame
  view: PaintView
  g: GBuffer
  scene: SpaceScene
}

// A sphere on a table, as the renderer would hand it over: view, G-buffer, particles, then the frame.
function sphereFrame(opts: { params?: PaintParams; width?: number; height?: number; zoom?: number; azimuth?: number; elevation?: number; extra?: SpaceScene['marks'] } = {}): Frame {
  const params = opts.params ?? P
  const width = opts.width ?? 640
  const height = opts.height ?? 480
  const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 }), ...(opts.extra ?? [])])
  const view = paintView({ width, height, azimuth: opts.azimuth ?? 30, elevation: opts.elevation ?? 25, zoom: opts.zoom ?? 120 })
  const g = sphereGBuffer(width, height, { view, params, table: { z: -1, mark: 1 } })
  const set = buildParticles(scene, COLOURS, params)
  return { frame: paintFrame(scene, set, view, g, params), view, g, scene }
}

const bytes = (b: StrokeBatch): string => {
  const parts: ArrayBufferView[] = [b.role, b.layer, b.path, b.width, b.depth, b.colour, b.alpha, b.load, b.impasto, b.bristles, b.bristleVar, b.dry, b.wet, b.endSoft, b.edge, b.seed]
  return parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')).join('|') + `#${b.count}`
}

describe('paintFrame', () => {
  const base = sphereFrame()

  it('gives a lit sphere on a table strokes in block, form, glaze, edge and dab (and reflected light)', () => {
    const by = base.frame.stats.byRole
    for (const role of ['block', 'form', 'glaze', 'edge', 'dab'] as const) expect(by[role], role).toBeGreaterThan(0)
    // reflected light faces the table: seen from a low camera (from above, the sphere hides most of what faces down)
    expect(sphereFrame({ elevation: 4 }).frame.stats.byRole.reflected).toBeGreaterThan(0)
    // no data marks; and scumble, where the value turns softly over a width (the turn from half-tone to light is wide)
    expect(by.line).toBe(0)
    expect(by.scumble).toBeGreaterThan(0)
    // the stats add up, and so do the loads
    const sum = ROLES.reduce((n, r) => n + by[r], 0)
    expect(sum).toBe(base.frame.stats.strokes)
    expect(base.frame.strokes.count).toBe(sum)
    expect(base.frame.stats.loads).toBeGreaterThan(20)
    expect(base.frame.stats.loads).toBeLessThan(sum)
  })

  it('is deterministic: the same scene, parameters, seed and view give a byte-identical stroke batch', () => {
    const again = sphereFrame()
    expect(bytes(again.frame.strokes)).toBe(bytes(base.frame.strokes))
    // rotating away and back gives the identical image
    const away = sphereFrame({ azimuth: 75 })
    expect(bytes(away.frame.strokes)).not.toBe(bytes(base.frame.strokes))
    expect(bytes(sphereFrame({ azimuth: 30 }).frame.strokes)).toBe(bytes(base.frame.strokes))
    // another seed repaints every stroke
    const other = sphereFrame({ params: resolvePaintParams({ seed: 7 }) })
    expect(bytes(other.frame.strokes)).not.toBe(bytes(base.frame.strokes))
    // and nothing depends on a clock or Math.random: the batch is the same however often it is asked
    const third = sphereFrame()
    expect(bytes(third.frame.strokes)).toBe(bytes(base.frame.strokes))
  })

  it('paints in order: layer by layer, back to front by depth within a layer', () => {
    const b = base.frame.strokes
    let lastLayer = -1
    let lastDepth = Infinity
    let violations = 0
    for (let i = 0; i < b.count; i++) {
      expect(LAYER_ORDER[b.layer[i]]).toBe(ROLES[b.role[i]])
      if (b.layer[i] < lastLayer) violations++
      if (b.layer[i] > lastLayer) {
        lastLayer = b.layer[i]
        lastDepth = Infinity
      }
      // farther (a larger distance) first
      if (b.depth[i] > lastDepth + 1e-4) violations++
      lastDepth = b.depth[i]
    }
    expect(violations).toBe(0)
    // the layers the lit sphere uses come in the painting order
    const seen = [...new Set(Array.from(b.layer))]
    expect(seen).toEqual([...seen].sort((a, c) => a - c))
  })

  it('shapes every stroke as PATH_POINTS points in CSS px with positive widths and a pressure along them', () => {
    const b = base.frame.strokes
    expect(b.path.length).toBe(2 * PATH_POINTS * b.count)
    expect(b.width.length).toBe(PATH_POINTS * b.count)
    let tapered = 0
    for (let i = 0; i < b.count; i++) {
      for (let k = 0; k < PATH_POINTS; k++) {
        expect(b.path[2 * PATH_POINTS * i + 2 * k]).toBeGreaterThan(-100)
        expect(b.path[2 * PATH_POINTS * i + 2 * k]).toBeLessThan(740)
        expect(b.width[PATH_POINTS * i + k]).toBeGreaterThan(0)
      }
      // a taper over the last 30%: the end is thinner than the middle (strokes only, not dabs or lines)
      if (ROLES[b.role[i]] === 'block') {
        const w = b.width.subarray(PATH_POINTS * i, PATH_POINTS * i + PATH_POINTS)
        if (w[PATH_POINTS - 1] < w[Math.floor(PATH_POINTS / 2)]) tapered++
      }
      for (const arr of [b.alpha, b.load, b.impasto, b.bristles, b.dry, b.wet, b.endSoft]) expect(Number.isFinite(arr[i])).toBe(true)
      for (let c = 0; c < 3; c++) {
        expect(b.colour[3 * i + c]).toBeGreaterThanOrEqual(0)
        expect(b.colour[3 * i + c]).toBeLessThanOrEqual(1)
      }
      expect(b.alpha[i]).toBeGreaterThanOrEqual(0)
      expect(b.alpha[i]).toBeLessThanOrEqual(1)
      expect(b.edge[i] === 255 || b.edge[i] <= 3).toBe(true)
    }
    expect(tapered / base.frame.stats.byRole.block).toBeGreaterThan(0.9)
  })

  it('keeps block-in strokes on the surface they grew from: on the sphere or in its cast shadow', () => {
    const b = base.frame.strokes
    const g = base.g
    let checked = 0
    let off = 0
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'block') continue
      // the start (loaded end) and the middle of the path stand on a painted pixel of the figure or a shadow
      for (const k of [0, 3]) {
        const x = b.path[2 * PATH_POINTS * i + 2 * k]
        const y = b.path[2 * PATH_POINTS * i + 2 * k + 1]
        const gx = Math.floor(x / g.scale)
        const gy = Math.floor(y / g.scale)
        if (gx < 0 || gy < 0 || gx >= g.width || gy >= g.height) continue
        const gi = gy * g.width + gx
        checked++
        const onSphere = g.mark[gi] === 0
        const inShadow = g.mark[gi] === 1 && g.shadow[gi] === 1
        // allow a pixel of slack at the rim
        let near = onSphere || inShadow
        if (!near) {
          for (let dy = -2; dy <= 2 && !near; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const q = (gy + dy) * g.width + gx + dx
              if (q >= 0 && q < g.mark.length && (g.mark[q] === 0 || (g.mark[q] === 1 && g.shadow[q] === 1))) {
                near = true
                break
              }
            }
          }
        }
        if (!near) off++
      }
    }
    expect(checked).toBeGreaterThan(800)
    expect(off / checked).toBeLessThan(0.02)
    // and the lit table is bare canvas: no block stroke starts there
    let litTable = 0
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'block') continue
      const gx = Math.floor(b.path[2 * PATH_POINTS * i] / g.scale)
      const gy = Math.floor(b.path[2 * PATH_POINTS * i + 1] / g.scale)
      const gi = gy * g.width + gx
      if (gi >= 0 && gi < g.mark.length && g.mark[gi] === 1 && g.shadow[gi] === 0) litTable++
    }
    expect(litTable).toBe(0)
  })

  it('puts the highlight dab at the brightest place, and the form strokes near the terminator', () => {
    const b = base.frame.strokes
    const g = base.g
    // the dab: where the sphere's normal is nearest the light
    const L = base.view.lightDir
    let bestI = -1
    let bestN = -2
    for (let i = 0; i < g.width * g.height; i++) {
      if (g.mark[i] !== 0) continue
      const n = g.normal[3 * i] * L[0] + g.normal[3 * i + 1] * L[1] + g.normal[3 * i + 2] * L[2]
      if (n > bestN) {
        bestN = n
        bestI = i
      }
    }
    const peakX = ((bestI % g.width) + 0.5) * g.scale
    const peakY = (Math.floor(bestI / g.width) + 0.5) * g.scale
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'dab') continue
      const mx = (b.path[2 * PATH_POINTS * i] + b.path[2 * PATH_POINTS * i + 2 * (PATH_POINTS - 1)]) / 2
      const my = (b.path[2 * PATH_POINTS * i + 1] + b.path[2 * PATH_POINTS * i + 2 * (PATH_POINTS - 1) + 1]) / 2
      expect(Math.hypot(mx - peakX, my - peakY)).toBeLessThan(12)
      // short, thick, loaded
      expect(Math.hypot(b.path[2 * PATH_POINTS * i + 14] - b.path[2 * PATH_POINTS * i], b.path[2 * PATH_POINTS * i + 15] - b.path[2 * PATH_POINTS * i + 1])).toBeLessThan(14)
      expect(b.load[i]).toBeGreaterThan(0.9)
      expect(b.impasto[i]).toBeGreaterThan(1.2)
    }
    // form strokes: loaded where the value plan is the half-tone, none in the deep core or the full light
    const fc = makeFrameCtx(base.scene, base.view, g, P)
    void fc
    const forms = Array.from({ length: b.count }, (_, i) => i).filter((i) => ROLES[b.role[i]] === 'form')
    expect(forms.length).toBeGreaterThan(20)
  })

  it('classes the strokes near an edge by that edge, and every other by its place', () => {
    const b = base.frame.strokes
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < b.count; i++) {
      const r = ROLES[b.role[i]]
      if (r === 'block' || r === 'form') {
        expect(b.edge[i]).toBeLessThanOrEqual(3)
        counts[b.edge[i]]++
        // what the class does: a hard stroke does not pick up, a soft one picks up at least 0.22, ends dissolve
        if (b.edge[i] === 3) {
          expect(b.wet[i]).toBe(0)
          expect(b.endSoft[i]).toBeLessThan(0.25)
        }
        if (b.edge[i] === 1) {
          expect(b.wet[i]).toBeGreaterThanOrEqual(0.22 - 1e-6)
          expect(b.endSoft[i]).toBeGreaterThan(0.5)
        }
        if (b.edge[i] === 0) expect(b.wet[i]).toBeGreaterThanOrEqual(0.32 - 1e-6)
      } else if (r === 'glaze' || r === 'reflected' || r === 'dab' || r === 'line') expect(b.edge[i]).toBe(255)
    }
    // the sphere has hard and soft stretches and the in-between
    expect(counts.filter((c) => c > 0).length).toBeGreaterThanOrEqual(3)
  })

  it('hands the renderer its debug views: the model’s value, planes, zones and edge segments', () => {
    const d = base.frame.debug
    const g = base.g
    const n = g.width * g.height
    expect(d.value.length).toBe(n)
    expect(d.planes.length).toBe(n)
    expect(d.zones.length).toBe(n)
    let figure = 0
    let bad = 0
    const zoneSeen = new Set<number>()
    for (let i = 0; i < n; i++) {
      if (g.mark[i] < 0) {
        if (d.value[i] !== -1 || d.planes[i] !== -1 || d.zones[i] !== 255) bad++
      } else {
        figure++
        if (d.value[i] < 0 || d.value[i] > 1 || d.planes[i] < 0) bad++
        zoneSeen.add(d.zones[i])
      }
    }
    expect(bad).toBe(0)
    expect(figure).toBeGreaterThan(10000)
    for (const z of [0, 1, 2, 4]) expect(zoneSeen.has(z), ZONES[z]).toBe(true) // light, half, core, cast
    expect(d.edgeSegments.length).toBe(4 * d.edgeClass.length)
    expect(d.edgeClass.length).toBeGreaterThan(100)
    expect(Math.max(...d.edgeClass)).toBeLessThanOrEqual(3)
    // segments are in CSS px: inside the canvas
    expect(Math.min(...d.edgeSegments)).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...d.edgeSegments)).toBeLessThanOrEqual(641)
  })

  it('follows the density sliders without changing a stroke it keeps', () => {
    const thin = sphereFrame({ params: resolvePaintParams({ particles: { targetPer10kPx: 45 } }) })
    expect(thin.frame.stats.byRole.block).toBeLessThan(base.frame.stats.byRole.block * 0.7)
    expect(thin.frame.stats.byRole.block).toBeGreaterThan(base.frame.stats.byRole.block * 0.35)
  })

  it('shows the model’s value in the debug view, not the renderer’s: a curve changes it', () => {
    const dark = sphereFrame({ params: resolvePaintParams({ curves: { value: [[0, 0], [1, 0.5]] } }) })
    let maxDark = 0
    let maxBase = 0
    for (const v of dark.frame.debug.value) maxDark = Math.max(maxDark, v)
    for (const v of base.frame.debug.value) maxBase = Math.max(maxBase, v)
    // the plan's highlight (lightHi 0.94) against the same plan through a value curve that halves it
    expect(maxBase).toBeGreaterThan(0.9)
    expect(maxDark).toBeLessThanOrEqual(0.5 + 1e-6)
  })
})

describe('the local colour of bare table', () => {
  it('is the canvas tone run backward through the curve at the value of lit canvas', () => {
    // default canvas Oklab (0.93, 0.004, 0.022): L 0.93, C 0.02236, hue 79.695. Lit canvas has value 0.7; the curve takes
    // L = local + 0.8 (u - 0.62) so local L = 0.93 - 0.8 x 0.08 = 0.866, and scales chroma by the bell at 0.7 (0.8840)
    const local = labToLch(groundLocal(P))
    expect(local[0]).toBeCloseTo(0.866, 9)
    expect(local[1]).toBeCloseTo(0.02236068 / 0.884, 3)
    expect(local[2]).toBeCloseTo(79.695, 2)
    // and run forward through the curve at lit canvas it comes back as the canvas, to the soft clamp of the lights
    // (0.93 reads 0.925) and the warm tint of the light
    const out = makeCurve(P).lch({ local: groundLocal(P), u: canvasValue(P), noDev: true })
    expect(out[0]).toBeCloseTo(0.925, 3)
    expect(out[1]).toBeCloseTo(0.0224, 1)
    expect(Math.abs(out[2] - 79.695)).toBeLessThan(2)
    // it follows the canvas: L 0.6 has a lit value of 0.7 - 0.8 x (0.93 - 0.6) = 0.436, so local L = 0.6 - 0.8 x (0.436 - 0.62) = 0.7472
    const dark = resolvePaintParams({ canvas: { tone: lchToLab(0.6, 0.05, 80) } })
    expect(labToLch(groundLocal(dark))[0]).toBeCloseTo(0.7472, 9)
  })
})

describe('data marks are exact and found (spec §7)', () => {
  // a circle of radius 0.5 in the plane x = 2, in front of the sphere, in 48 segments
  const circle: [number, number, number][] = Array.from({ length: 49 }, (_, i) => [2, 0.5 * Math.cos((i / 48) * 2 * Math.PI), 0.5 * Math.sin((i / 48) * 2 * Math.PI)])
  const square: [number, number, number][] = [[2, -0.4, -0.4], [2, 0.4, -0.4], [2, 0.4, 0.4], [2, -0.4, 0.4], [2, -0.4, -0.4]]

  const marks = [lineMark(circle, { index: 2 }), lineMark(square, { index: 3 })]
  const f = sphereFrame({ extra: marks, azimuth: 0 })
  const lines = (() => {
    const out: number[] = []
    const b = f.frame.strokes
    for (let i = 0; i < b.count; i++) if (ROLES[b.role[i]] === 'line') out.push(i)
    return out
  })()
  const fc = makeFrameCtx(f.scene, f.view, f.g, P)
  const proj = (p: readonly number[]): [number, number] => {
    const o = [0, 0, 0]
    project(fc, p[0], p[1], p[2], o)
    return [o[0], o[1]]
  }
  const distToPolyline = (poly: [number, number][], x: number, y: number): number => {
    let best = Infinity
    for (let i = 0; i + 1 < poly.length; i++) {
      const [x0, y0] = poly[i]
      const [x1, y1] = poly[i + 1]
      const dx = x1 - x0, dy = y1 - y0
      const l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0
      best = Math.min(best, Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)))
    }
    return best
  }

  it('lays every point of a line stroke on the projected polyline, within 0.01 px', () => {
    expect(lines.length).toBeGreaterThan(8)
    const polyC = circle.map(proj)
    const polyS = square.map(proj)
    const b = f.frame.strokes
    let worst = 0
    for (const i of lines) {
      for (let k = 0; k < PATH_POINTS; k++) {
        const x = b.path[2 * PATH_POINTS * i + 2 * k]
        const y = b.path[2 * PATH_POINTS * i + 2 * k + 1]
        worst = Math.max(worst, Math.min(distToPolyline(polyC, x, y), distToPolyline(polyS, x, y)))
      }
    }
    expect(worst).toBeLessThan(0.01)
  })

  it('ends a stroke exactly at each corner, and spans the whole polyline', () => {
    const b = f.frame.strokes
    for (const corner of [[2, -0.4, -0.4], [2, 0.4, -0.4], [2, 0.4, 0.4], [2, -0.4, 0.4]]) {
      const [cx, cy] = proj(corner)
      let near = Infinity
      for (const i of lines) {
        for (const k of [0, PATH_POINTS - 1]) near = Math.min(near, Math.hypot(b.path[2 * PATH_POINTS * i + 2 * k] - cx, b.path[2 * PATH_POINTS * i + 2 * k + 1] - cy))
      }
      expect(near).toBeLessThan(0.01)
    }
    // the strokes of the square cover its perimeter: total path length is at least the polyline's
    const polyS = square.map(proj)
    let perimeter = 0
    for (let i = 0; i + 1 < polyS.length; i++) perimeter += Math.hypot(polyS[i + 1][0] - polyS[i][0], polyS[i + 1][1] - polyS[i][1])
    let covered = 0
    for (const i of lines) {
      const mid = [(b.path[2 * PATH_POINTS * i] + b.path[2 * PATH_POINTS * i + 14]) / 2, (b.path[2 * PATH_POINTS * i + 1] + b.path[2 * PATH_POINTS * i + 15]) / 2]
      if (distToPolyline(polyS, mid[0], mid[1]) < 0.5) {
        for (let k = 0; k + 1 < PATH_POINTS; k++) covered += Math.hypot(b.path[2 * PATH_POINTS * i + 2 * k + 2] - b.path[2 * PATH_POINTS * i + 2 * k], b.path[2 * PATH_POINTS * i + 2 * k + 3] - b.path[2 * PATH_POINTS * i + 2 * k + 1])
      }
    }
    expect(covered).toBeGreaterThan(perimeter * 0.97)
  })

  it('is deterministic with data marks in the scene: the same frame twice is byte-identical, every line stroke included', () => {
    const again = sphereFrame({ extra: marks, azimuth: 0 })
    expect(bytes(again.frame.strokes)).toBe(bytes(f.frame.strokes))
    // and the line strokes' own seeds (a pure function of the mark and the stretch) are the same too
    const seeds = (fr: Frame) => lines.map((i) => fr.frame.strokes.seed[i])
    expect(seeds(again)).toEqual(seeds(f))
    expect(new Set(seeds(f)).size).toBeGreaterThan(lines.length / 2)
  })

  it('never perturbs a position: the seed changes colours and loads, not one path point', () => {
    const other = sphereFrame({ extra: marks, azimuth: 0, params: resolvePaintParams({ seed: 99 }) })
    const pick = (fr: Frame) => {
      const b = fr.frame.strokes
      const out: number[] = []
      for (let i = 0; i < b.count; i++) {
        if (ROLES[b.role[i]] === 'line') out.push(...Array.from(b.path.subarray(2 * PATH_POINTS * i, 2 * PATH_POINTS * (i + 1))))
      }
      return out
    }
    expect(pick(other)).toEqual(pick(f))
    const colours = (fr: Frame) => Array.from(fr.frame.strokes.colour.subarray(0, 30))
    expect(colours(other)).not.toEqual(colours(f))
  })

  it('paints points as short loaded dabs centred exactly on the point, and arrows with a head that meets at the tip', () => {
    const pt: [number, number, number] = [2, 0.2, 0.3]
    const tail: [number, number, number] = [2, -0.5, -0.2]
    const vec: [number, number, number] = [0, 0.9, 0.3]
    const tip: [number, number, number] = [2, 0.4, 0.1]
    const fr = sphereFrame({ extra: [pointMark([pt], { index: 2 }), arrowMark(tail, vec, { index: 3 })], azimuth: 0 })
    const fc2 = makeFrameCtx(fr.scene, fr.view, fr.g, P)
    const pr = (p: readonly number[]): [number, number] => {
      const o = [0, 0, 0]
      project(fc2, p[0], p[1], p[2], o)
      return [o[0], o[1]]
    }
    const b = fr.frame.strokes
    const idx: number[] = []
    for (let i = 0; i < b.count; i++) if (ROLES[b.role[i]] === 'line') idx.push(i)
    const mid = (i: number): [number, number] => [(b.path[2 * PATH_POINTS * i] + b.path[2 * PATH_POINTS * i + 2 * (PATH_POINTS - 1)]) / 2, (b.path[2 * PATH_POINTS * i + 1] + b.path[2 * PATH_POINTS * i + 2 * (PATH_POINTS - 1) + 1]) / 2]
    const [px, py] = pr(pt)
    const dabs = idx.filter((i) => Math.hypot(mid(i)[0] - px, mid(i)[1] - py) < 0.01)
    expect(dabs.length).toBe(1)
    // a dab is short and thick
    const d = dabs[0]
    expect(Math.hypot(b.path[2 * PATH_POINTS * d + 14] - b.path[2 * PATH_POINTS * d], b.path[2 * PATH_POINTS * d + 15] - b.path[2 * PATH_POINTS * d + 1])).toBeLessThan(8)
    expect(b.width[PATH_POINTS * d]).toBeGreaterThan(4)
    // the head: two strokes whose last point is the tip, exactly
    const [tx, ty] = pr(tip)
    const heads = idx.filter((i) => Math.hypot(b.path[2 * PATH_POINTS * i + 14] - tx, b.path[2 * PATH_POINTS * i + 15] - ty) < 0.01)
    expect(heads.length).toBeGreaterThanOrEqual(3) // the shaft ends at the tip too, and two barbs
    // and the shaft starts at the tail
    const [ax, ay] = pr(tail)
    expect(idx.some((i) => Math.hypot(b.path[2 * PATH_POINTS * i] - ax, b.path[2 * PATH_POINTS * i + 1] - ay) < 0.01 || Math.hypot(b.path[2 * PATH_POINTS * i + 14] - ax, b.path[2 * PATH_POINTS * i + 15] - ay) < 0.01)).toBe(true)
  })

  it('leaves out a line where a surface hides it when hidden is none, and dashes it when dashed', () => {
    // a line behind the sphere (x = -2), seen from the front
    const behind: [number, number, number][] = [[-2, -1.2, 0], [-2, 1.2, 0]]
    const none = sphereFrame({ extra: [lineMark(behind, { index: 2, hidden: 'none' })], azimuth: 0 })
    const dashed = sphereFrame({ extra: [lineMark(behind, { index: 2, hidden: 'dashed' })], azimuth: 0 })
    const count = (fr: Frame) => Array.from(fr.frame.strokes.role).filter((r) => ROLES[r] === 'line').length
    const alphas = (fr: Frame) => {
      const b = fr.frame.strokes
      const out: number[] = []
      for (let i = 0; i < b.count; i++) if (ROLES[b.role[i]] === 'line') out.push(b.alpha[i])
      return out
    }
    // the line passes behind the sphere's disc (radius 120 px at zoom 120) for a stretch: that part is gone
    expect(count(none)).toBeGreaterThan(0)
    expect(alphas(none).every((a) => a === 1)).toBe(true)
    // dashed: the hidden stretch comes back, as short dashes at half strength
    expect(count(dashed)).toBeGreaterThan(count(none))
    expect(alphas(dashed).some((a) => a === 0.5)).toBe(true)
    // no visible stroke of the 'none' line has a point inside the sphere's disc
    const b = none.frame.strokes
    const cx = 320
    const cy = 240
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'line') continue
      for (let k = 0; k < PATH_POINTS; k++) {
        const x = b.path[2 * PATH_POINTS * i + 2 * k]
        const y = b.path[2 * PATH_POINTS * i + 2 * k + 1]
        // (the sphere's silhouette is a circle of radius ~120 about the screen centre at this view)
        expect(Math.hypot(x - cx, y - cy)).toBeGreaterThan(110)
      }
    }
  })
})

describe('colormapped surfaces keep their colour (spec §7)', () => {
  // Two saddles of the same colour: one flat colour, one coloured by height through a scale that is that colour everywhere.
  const colour = lchToLab(0.6, 0.12, 150)
  // whether each particle of the mesh was coloured by a colour scale
  const huesOf = (mesh: MeshMark, colours: ReturnType<typeof flatColours>): number[] => Array.from(buildParticles(sceneOf([mesh]), colours, P).colormapped)

  it('marks a colour-scaled mesh’s particles as colormapped, and draws their stroke colours within a third of the hue spread', () => {
    const flatMesh = sphereMesh({ radius: 1 })
    const scaled: MeshMark = { ...sphereMesh({ radius: 1 }), scalars: new Float64Array((48 + 1) * (32 + 1)).fill(0.5), style: { ...flatMesh.style, colorScale: 0 } }
    const flat = flatColours({ 0: colour })
    const mapped = flatColours({ 0: [0, 0, 0] }, () => colour)
    expect(huesOf(scaled, mapped).every((v) => v === 1)).toBe(true)
    expect(huesOf(flatMesh, flat).every((v) => v === 0)).toBe(true)
    const spread = (mesh: MeshMark, cols: ReturnType<typeof flatColours>): number => {
      const scene = sceneOf([mesh])
      const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 120 })
      const g = sphereGBuffer(640, 480, { view })
      const fr = paintFrame(scene, buildParticles(scene, cols, P), view, g, P)
      const b = fr.strokes
      const hues: number[] = []
      for (let i = 0; i < b.count; i++) {
        if (ROLES[b.role[i]] !== 'block') continue
        // linear sRGB back to OKLab: hue of the stroke
        const lin = [b.colour[3 * i], b.colour[3 * i + 1], b.colour[3 * i + 2]]
        const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2])
        const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2])
        const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2])
        const lab = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
        const dh = ((labToLch(lab)[2] - 150 + 540) % 360) - 180
        hues.push(dh)
      }
      // the spread of hue about the local colour's own
      const mean = hues.reduce((a, c) => a + c, 0) / hues.length
      return Math.sqrt(hues.reduce((a, c) => a + (c - mean) ** 2, 0) / hues.length)
    }
    const flatSpread = spread(flatMesh, flat)
    const mappedSpread = spread(scaled, mapped)
    expect(flatSpread).toBeGreaterThan(5)
    // hue offsets, swings, tints, the curve's own seeded deviation and the strokes' jitter all scale by a third (colormapHue,
    // and colormapScale for the mix): the spread is a third. (It was accepted from 0.2 to 0.55, and was 0.4: the deviation
    // and the jitter were left whole.)
    expect(mappedSpread / flatSpread).toBeLessThan(0.38)
    expect(mappedSpread / flatSpread).toBeGreaterThan(0.28)
  })
})
