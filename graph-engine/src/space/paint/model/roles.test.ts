import { describe, expect, it, vi } from 'vitest'
import type { SpaceScene } from '../../scene/types'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { PATH_POINTS, ROLES, type GBuffer, type PaintFrame, type PaintView, type Role } from '../types'
import { labToLch, lchToLab } from './colour'
import { buildParticles, paintFrame } from './index'
import { flatColours, graphMesh, makeGBuffer, meshGBuffer, paintView, quadMesh, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { terminatorValue } from './value'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85), 2: lchToLab(0.72, 0.05, 235) })

interface Run {
  frame: PaintFrame
  g: GBuffer
  view: PaintView
  scene: SpaceScene
}

function sphereRun(params: PaintParams = P, opts: { zoom?: number; width?: number; height?: number } = {}): Run {
  const width = opts.width ?? 640
  const height = opts.height ?? 480
  const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
  const view = paintView({ width, height, azimuth: 30, elevation: 25, zoom: opts.zoom ?? 120 })
  const g = sphereGBuffer(width, height, { view, params, table: { z: -1, mark: 1 } })
  return { frame: paintFrame(scene, buildParticles(scene, COLOURS, params), view, g, params), g, view, scene }
}

// The strokes of one role, with the debug value, zone and plane at the middle of each path.
function strokesOf(run: Run, role: Role) {
  const b = run.frame.strokes
  const d = run.frame.debug
  const out: { i: number; x: number; y: number; value: number; zone: number }[] = []
  for (let i = 0; i < b.count; i++) {
    if (ROLES[b.role[i]] !== role) continue
    const x = (b.path[2 * PATH_POINTS * i + 6] + b.path[2 * PATH_POINTS * i + 8]) / 2
    const y = (b.path[2 * PATH_POINTS * i + 7] + b.path[2 * PATH_POINTS * i + 9]) / 2
    const gi = Math.floor(y / run.g.scale) * run.g.width + Math.floor(x / run.g.scale)
    out.push({ i, x, y, value: gi >= 0 && gi < d.value.length ? d.value[gi] : -1, zone: gi >= 0 && gi < d.zones.length ? d.zones[gi] : 255 })
  }
  return out
}

describe('stroke roles by detection (spec §3.7, §11)', () => {
  const base = sphereRun()

  it('puts glaze in the core and cast zones where the value is under glazeBelow', () => {
    const glaze = strokesOf(base, 'glaze')
    expect(glaze.length).toBeGreaterThan(50)
    // core (2) or cast (4), judged where the stroke lies (a stroke's middle can sit a hair across the edge of its zone)
    const inZone = glaze.filter((s) => s.zone === 2 || s.zone === 4).length
    expect(inZone / glaze.length).toBeGreaterThan(0.93)
    // a threshold under the plateaus (core 0.24, cast 0.32) leaves nothing to glaze; one above them glazes the whole shadow
    const none = sphereRun(resolvePaintParams({ detect: { glazeBelow: 0.1 } }))
    expect(none.frame.stats.byRole.glaze).toBe(0)
    const all = sphereRun(resolvePaintParams({ detect: { glazeBelow: 1 } }))
    expect(all.frame.stats.byRole.glaze).toBeGreaterThanOrEqual(base.frame.stats.byRole.glaze)
    const between = sphereRun(resolvePaintParams({ detect: { glazeBelow: 0.28 } }))
    // under 0.28 the core (0.24) glazes and the cast shadow (0.32) does not
    expect(between.frame.stats.byRole.glaze).toBeLessThan(base.frame.stats.byRole.glaze)
    expect(between.frame.stats.byRole.glaze).toBeGreaterThan(0)
  })

  it('puts reflected light where the zone is reflected and the bounce in the value is at least reflectedMin', () => {
    const refl = strokesOf(base, 'reflected')
    expect(refl.length).toBeGreaterThan(5)
    // the reflected zone (3), or the core it grades into
    expect(refl.filter((s) => s.zone === 3 || s.zone === 2).length / refl.length).toBeGreaterThan(0.8)
    // a minimum above the whole bounce term (0.10·max(−nz, 0) ≤ 0.10): none; no bounce light: none
    expect(sphereRun(resolvePaintParams({ detect: { reflectedMin: 0.2 } })).frame.stats.byRole.reflected).toBe(0)
    expect(sphereRun(resolvePaintParams({ light: { bounce: 0 } })).frame.stats.byRole.reflected).toBe(0)
    // a minimum of 0 lets in every strongly reflected stroke
    expect(sphereRun(resolvePaintParams({ detect: { reflectedMin: 0 } })).frame.stats.byRole.reflected).toBeGreaterThanOrEqual(base.frame.stats.byRole.reflected)
  })

  it('puts form strokes within formBand of the terminator, and none with a zero band', () => {
    const term = terminatorValue(P) // 0.485
    const forms = strokesOf(base, 'form')
    expect(forms.length).toBeGreaterThan(30)
    // the model's own value at the stroke is inside 0.485 ± 0.18 (give the stroke's own extent a little slack)
    const inside = forms.filter((s) => Math.abs(s.value - term) <= 0.18 + 0.06).length
    expect(inside / forms.length).toBeGreaterThan(0.9)
    expect(sphereRun(resolvePaintParams({ detect: { formBand: 0 } })).frame.stats.byRole.form).toBe(0)
    const wide = sphereRun(resolvePaintParams({ detect: { formBand: 0.5 } })).frame.stats.byRole.form
    expect(wide).toBeGreaterThan(base.frame.stats.byRole.form)
    // the band is centred on the terminator: moving the terminator moves the strokes
    const moved = sphereRun(resolvePaintParams({ value: { halfLo: 0.8, halfHi: 0.9, lightLo: 0.92 } }))
    expect(moved.frame.stats.byRole.form).not.toBe(base.frame.stats.byRole.form)
  })

  it('stops a form stroke below the core: none of its path lies in the core shadow', () => {
    const b = base.frame.strokes
    const d = base.frame.debug
    let points = 0
    let inCore = 0
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'form') continue
      for (let k = 0; k < PATH_POINTS; k++) {
        const x = b.path[2 * PATH_POINTS * i + 2 * k]
        const y = b.path[2 * PATH_POINTS * i + 2 * k + 1]
        const gi = Math.floor(y / base.g.scale) * base.g.width + Math.floor(x / base.g.scale)
        if (gi < 0 || gi >= d.zones.length || d.zones[gi] === 255) continue
        points++
        if (d.zones[gi] === 2) inCore++
      }
    }
    expect(points).toBeGreaterThan(200)
    // (a stroke may end on the first pixel past the edge of the core)
    expect(inCore / points).toBeLessThan(0.04)
  })

  it('scumbles only where a transition is wide: none on a small sphere, some where the gradient allows', () => {
    // the sphere's value changes by ~0.0075 per CSS px at its terminator: far above the default 0.004
    expect(base.frame.stats.byRole.scumble).toBe(0)
    // soft zone boundaries (0.20 wide) make the transition ~13 px across on this sphere, wider than the 6 px asked for
    const gentleParams = { detect: { scumbleGradient: 0.05 }, value: { soft: 0.2 } }
    const gentle = sphereRun(resolvePaintParams(gentleParams))
    expect(gentle.frame.stats.byRole.scumble).toBeGreaterThan(10)
    // every scumble stroke lies in a transition between zones: the value there is near a zone boundary (0.42 or 0.785)
    for (const s of strokesOf(gentle, 'scumble')) {
      const near = Math.min(Math.abs(s.value - 0.42), Math.abs(s.value - 0.785))
      expect(near).toBeLessThan(0.15)
    }
    // and a wider required width (more than the transition is across) leaves none
    expect(sphereRun(resolvePaintParams(gentleParams, { detect: { scumbleMinPx: 60 } })).frame.stats.byRole.scumble).toBe(0)
    // a gradient limit under the sphere's own (~0.0075 per px at its terminator) leaves none either
    expect(sphereRun(resolvePaintParams(gentleParams, { detect: { scumbleGradient: 0.002 } })).frame.stats.byRole.scumble).toBe(0)
    // the strokes alternate: a lighter neighbour and a darker one, by parity
    const b = gentle.frame.strokes
    const lightness = (i: number) => {
      const l = Math.cbrt(0.4122214708 * b.colour[3 * i] + 0.5363325363 * b.colour[3 * i + 1] + 0.0514459929 * b.colour[3 * i + 2])
      const m = Math.cbrt(0.2119034982 * b.colour[3 * i] + 0.6806995451 * b.colour[3 * i + 1] + 0.1073969566 * b.colour[3 * i + 2])
      const s = Math.cbrt(0.0883024619 * b.colour[3 * i] + 0.2817188376 * b.colour[3 * i + 1] + 0.6299787005 * b.colour[3 * i + 2])
      return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    }
    const even: number[] = []
    const odd: number[] = []
    for (const s of strokesOf(gentle, 'scumble')) (b.seed[s.i] & 1 ? odd : even).push(lightness(s.i))
    expect(even.length).toBeGreaterThan(3)
    expect(odd.length).toBeGreaterThan(3)
    const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length
    // u ± 0.10 is L ± 0.08 through the 0.8 slope: the two parities differ by about 0.16 (the zones differ too, so only the sign is firm)
    expect(Math.abs(mean(odd) - mean(even))).toBeGreaterThan(0.03)
  })

  it('loads the brush at the lighter end of a form stroke, and at the left end of the hand-laid strokes', () => {
    const b = base.frame.strokes
    const d = base.frame.debug
    const valueAt = (x: number, y: number) => d.value[Math.floor(y / base.g.scale) * base.g.width + Math.floor(x / base.g.scale)]
    let lightFirst = 0
    let darkFirst = 0
    let leftFirst = 0
    let rightFirst = 0
    for (let i = 0; i < b.count; i++) {
      const role = ROLES[b.role[i]]
      const x0 = b.path[2 * PATH_POINTS * i]
      const y0 = b.path[2 * PATH_POINTS * i + 1]
      const x1 = b.path[2 * PATH_POINTS * i + 2 * PATH_POINTS - 2]
      const y1 = b.path[2 * PATH_POINTS * i + 2 * PATH_POINTS - 1]
      if (role === 'form') {
        const dv = valueAt(x0, y0) - valueAt(x1, y1)
        if (dv > 0.01) lightFirst++
        if (dv < -0.01) darkFirst++
      } else if (role === 'block' || role === 'scumble' || role === 'glaze' || role === 'reflected') {
        if (x0 <= x1 + 1e-3) leftFirst++
        else rightFirst++
      }
    }
    // a form stroke runs across the terminator, so its two ends differ in value: the loaded start is on the light side
    expect(lightFirst).toBeGreaterThan(30)
    // (the plan value is not strictly increasing in the model's value everywhere: at a zone edge a stroke can read the other way)
    expect(darkFirst).toBeLessThan(0.05 * lightFirst)
    // the others start at their left end
    expect(leftFirst).toBeGreaterThan(300)
    expect(rightFirst).toBe(0)
  })

  it('puts dabs on the top fraction of value maxima, at least dabMinPx apart', () => {
    // the default: the top 1.5% of the sphere's one maximum, one dab
    expect(base.frame.stats.byRole.dab).toBe(1)
    // a wavy surface has many maxima: a bigger fraction takes more of them
    const mesh = graphMesh((x, y) => 0.2 * Math.sin(5.4 * x) * Math.cos(5.4 * y), { half: 1.25, n: 90 })
    const scene = sceneOf([mesh])
    const run = (params: PaintParams): PaintFrame => {
      const view = paintView({ width: 640, height: 480, azimuth: 40, elevation: 55, zoom: 150 })
      const g = meshGBuffer(640, 480, [{ mesh, mark: 0 }], { view, params })
      return paintFrame(scene, buildParticles(scene, flatColours({ 0: lchToLab(0.6, 0.085, 150) }), params), view, g, params)
    }
    const few = run(P)
    const many = run(resolvePaintParams({ detect: { dabTopFraction: 1, dabMinPx: 12 } }))
    expect(many.stats.byRole.dab).toBeGreaterThan(few.stats.byRole.dab)
    expect(many.stats.byRole.dab).toBeGreaterThanOrEqual(4)
    // every pair of dabs is at least dabMinPx apart (centre to centre)
    const centres: [number, number][] = []
    const b = many.strokes
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'dab') continue
      centres.push([(b.path[2 * PATH_POINTS * i] + b.path[2 * PATH_POINTS * i + 14]) / 2, (b.path[2 * PATH_POINTS * i + 1] + b.path[2 * PATH_POINTS * i + 15]) / 2])
    }
    for (let i = 0; i < centres.length; i++) {
      for (let j = i + 1; j < centres.length; j++) expect(Math.hypot(centres[i][0] - centres[j][0], centres[i][1] - centres[j][1])).toBeGreaterThanOrEqual(12 - 0.5)
    }
    // a wider spacing leaves fewer
    const spread = run(resolvePaintParams({ detect: { dabTopFraction: 1, dabMinPx: 60 } }))
    expect(spread.stats.byRole.dab).toBeLessThan(many.stats.byRole.dab)
    // and it is the spacing that decides it: ripple crests 75..150 px apart are each a local maximum over a 75 px radius,
    // yet the chosen dabs keep 150 between them
    const wide = run(resolvePaintParams({ detect: { dabTopFraction: 1, dabMinPx: 150 } }))
    const wb = wide.strokes
    const wc: [number, number][] = []
    for (let i = 0; i < wb.count; i++) {
      if (ROLES[wb.role[i]] !== 'dab') continue
      wc.push([(wb.path[2 * PATH_POINTS * i] + wb.path[2 * PATH_POINTS * i + 14]) / 2, (wb.path[2 * PATH_POINTS * i + 1] + wb.path[2 * PATH_POINTS * i + 15]) / 2])
    }
    expect(wc.length).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < wc.length; i++) {
      for (let j = i + 1; j < wc.length; j++) expect(Math.hypot(wc[i][0] - wc[j][0], wc[i][1] - wc[j][1])).toBeGreaterThanOrEqual(150 - 0.5)
    }
    // no highlight, no dab: a figure that never gets bright (value under 0.8)
    expect(sphereRun(resolvePaintParams({ light: { intensity: 0.2, ambient: 0.1 } })).frame.stats.byRole.dab).toBe(0)
  })

  it('makes the dab short, thick and bold: a lighter value of the local colour, with more chroma', () => {
    const b = base.frame.strokes
    let dab = -1
    let block = -1
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] === 'dab') dab = i
    }
    expect(dab).toBeGreaterThanOrEqual(0)
    block = Array.from({ length: b.count }, (_, i) => i).filter((i) => ROLES[b.role[i]] === 'block')[0]
    expect(b.load[dab]).toBeGreaterThan(b.load[block])
    expect(b.impasto[dab]).toBeGreaterThan(b.impasto[block])
    expect(b.dry[dab]).toBeLessThan(0.2)
    expect(b.wet[dab]).toBe(0)
  })
})

describe('veils: a mesh with opacity under 1 is glazed and nothing else', () => {
  // a translucent sheet facing the camera, and nothing opaque: the G-buffer is empty
  const sheet = quadMesh({ origin: [0, -1, -1], e1: [0, 2, 0], e2: [0, 0, 2], opacity: 0.4, index: 0 })
  const scene = sceneOf([sheet])
  const view = paintView({ width: 640, height: 480, azimuth: 0, elevation: 0, zoom: 120 })
  const g = makeGBuffer(view, 2, () => null)
  const run = (params: PaintParams) => paintFrame(scene, buildParticles(scene, flatColours({ 0: lchToLab(0.72, 0.055, 232) }), params), view, g, params)
  const frame = run(P)

  it('paints only glazes, at alpha 0.26, with no impasto', () => {
    const by = frame.stats.byRole
    expect(by.glaze).toBeGreaterThan(20)
    for (const r of ROLES) if (r !== 'glaze') expect(by[r], r).toBe(0)
    const b = frame.strokes
    let main = 0
    for (let i = 0; i < b.count; i++) {
      // a glaze's alpha is its own absolute opacity, never over 0.34: 0.26 for the veil (0.30 for its dry border strokes), faded at the limb
      expect(b.alpha[i]).toBeLessThanOrEqual(0.3 + 1e-6)
      if (b.alpha[i] > 0.2) main++
      expect(b.impasto[i]).toBe(0)
      // wide strokes, heavily overlapped
      expect(b.width[PATH_POINTS * i + 3]).toBeGreaterThan(20)
    }
    expect(main).toBeGreaterThan(b.count * 0.4)
    // the veil's own strokes carry exactly 0.26 where nothing fades them
    expect(Math.max(...Array.from(b.alpha).filter((a) => a < 0.29))).toBeCloseTo(0.26, 6)
  })

  it('lays them in two crossing directions, so the veil is woven', () => {
    const b = frame.strokes
    let horizontal = 0
    let vertical = 0
    for (let i = 0; i < b.count; i++) {
      const dx = b.path[2 * PATH_POINTS * i + 14] - b.path[2 * PATH_POINTS * i]
      const dy = b.path[2 * PATH_POINTS * i + 15] - b.path[2 * PATH_POINTS * i + 1]
      if (Math.abs(dx) > 2 * Math.abs(dy)) horizontal++
      if (Math.abs(dy) > 2 * Math.abs(dx)) vertical++
    }
    expect(horizontal).toBeGreaterThan(5)
    expect(vertical).toBeGreaterThan(5)
  })

  it('keeps its strokes on the sheet', () => {
    // the sheet is the square of side 2 world units: 240 px at zoom 120, centred on the screen
    const b = frame.strokes
    let off = 0
    for (let i = 0; i < b.count; i++) {
      for (const k of [0, PATH_POINTS - 1]) {
        const x = b.path[2 * PATH_POINTS * i + 2 * k]
        const y = b.path[2 * PATH_POINTS * i + 2 * k + 1]
        if (Math.abs(x - 320) > 123 || Math.abs(y - 240) > 123) off++
      }
    }
    expect(off).toBe(0)
  })

  it('is whole when nothing is in front of it, and tinted by what lies behind only through the painting order', () => {
    // glaze is the fourth layer: after the block-in of anything behind it
    expect(Array.from(frame.strokes.layer).every((l) => l === 3)).toBe(true)
    // a sphere behind the sheet is painted (block first), then the veil
    const sphere = sphereMesh({ radius: 0.6, centre: [-2, 0, 0], index: 0 })
    const scene2 = sceneOf([sphere, quadMesh({ origin: [0, -1, -1], e1: [0, 2, 0], e2: [0, 0, 2], opacity: 0.4, index: 1 })])
    const g2 = sphereGBuffer(640, 480, { view, centre: [-2, 0, 0], radius: 0.6 })
    const f = paintFrame(scene2, buildParticles(scene2, COLOURS, P), view, g2, P)
    const layers = Array.from(f.strokes.layer)
    expect(layers.indexOf(0)).toBe(0) // the block-in first
    expect(layers.lastIndexOf(0)).toBeLessThan(layers.indexOf(3, layers.lastIndexOf(0))) // then glazes, some of them the veil's
    expect(f.stats.byRole.block).toBeGreaterThan(20)
    // the veil's own glazes sit over the sphere: some glaze strokes lie in the sphere's disc, which is not in shadow
    expect(f.stats.byRole.glaze).toBeGreaterThan(frame.stats.byRole.glaze * 0.5)
    void labToLch
  })
})
