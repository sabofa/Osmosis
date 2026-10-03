// The value rule in the FINAL picture (spec §12): every value of the shadow family (core, reflected light, cast
// shadow) is darker than every value of the light family (highlight, light, half-tone), and the bounce light stays
// darker than the half-tones. The plan obeys it (valueModel.test.ts); this file holds what comes after the plan: the
// planes, the plane steps, the strokes' colours after the brush-load mix, the scumble, the cast shadow's fade, the
// underpainting and the outlines.
//
// Every number is a hand value, and every test here fails without the thing it is for.

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, PARAM_SCHEMA, resolvePaintParams, type PaintParams } from '../params'
import { PATH_POINTS, ROLES, type Oklab } from '../types'
import { holdLightness, labToLch, lchToLab, linearToOklab, oklabToLinear } from './colour'
import { makeCurve } from './curve'
import { buildContext, buildParticles } from './index'
import { colourOfRecipe, lightnessAtValue, newRecipe, type RecipeEnv } from './recipe'
import { compileCurves } from './respond'
import { terminatorValue } from './roles'
import { packStrokes, roleIndex, type PaintCtx, type StrokeDraft } from './strokes'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, type ViewOpts } from './testing'
import { edgeStrokes } from './contours'
import type { EdgeRun } from './edges'
import { buildUnderpaintField, FAM_BAND, fillUnderpaint, underpaintImage } from './underpaint'
import { CANVAS, LOCALS, lightnessOf, made, SCENARIO, SCENE, spreadOf } from './valueFinalFixture'
import {
  buildPlanMap, CAST_FADE, effectiveValues, familyBound, FAM_LIGHT, FAM_SHADOW, holdFamily, isLightFamily, newZoneSample, planSample, reflectedMax,
  type PlanMap,
} from './value'
import { gIndex, makeFrameCtx } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 300_000 })

const P = DEFAULT_PAINT_PARAMS
const TS = P.value.terminatorSoftness

describe('the final picture of a sphere on a table', () => {
  it('keeps every stroke’s plan value inside its family: no shadow stroke above the cap, no half-tone stroke under the darkest half-tone, the scumble’s ±0.1 included', () => {
    const cap = reflectedMax(P)
    const floor = P.value.halfLo
    let shadow = 0
    let light = 0
    let scumbleShadow = 0
    let scumbleLight = 0
    // the review's scenario, and the lab's own light (56 degrees to the left, 27 up) over the lab's camera (30, 25), where the
    // scumble stands on both sides of the terminator
    const frames: [number, ViewOpts][] = [[1, { ...SCENARIO, azimuth: 200 }], [2, { ...SCENARIO, azimuth: 200 }], [6, { ...SCENARIO, azimuth: 20 }], [1, { azimuth: 30, elevation: 25 }], [2, { azimuth: 30, elevation: 25 }]]
    {
      for (const [seed, viewOpts] of frames) {
        const params = resolvePaintParams({ seed })
        const m = made(params, lchToLab(0.56, 0.14, 38), viewOpts)
        for (const d of m.an.drafts) {
          const gi = gIndex(m.an.fc, d.mx, d.my)
          if (gi < 0 || m.an.fc.g.mark[gi] !== 0) continue
          const nl = m.an.plan.nl[gi]
          const sh = m.an.fc.g.shadow[gi] === 1
          const scumble = ROLES[d.role] === 'scumble'
          if (nl <= -TS / 2 || (sh && nl >= TS / 2 + CAST_FADE)) {
            shadow++
            if (scumble) scumbleShadow++
            expect(d.u, `${ROLES[d.role]} at N·L ${nl.toFixed(2)}`).toBeLessThanOrEqual(cap + 1e-6)
          } else if (!sh && nl >= TS / 2) {
            light++
            if (scumble) scumbleLight++
            expect(d.u, `${ROLES[d.role]} at N·L ${nl.toFixed(2)}`).toBeGreaterThanOrEqual(floor - 1e-6)
          }
        }
      }
    }
    expect(shadow).toBeGreaterThan(200)
    expect(light).toBeGreaterThan(1000)
    // the scumble stands on both sides of the terminator: its lighter variant in the shadow and its darker in the light
    expect(scumbleShadow).toBeGreaterThan(10)
    expect(scumbleLight).toBeGreaterThan(30)
  })

  it('paints the outline of the form in shadow as a dark, found edge, and bridges to the canvas only on the lit side', () => {
    const params = resolvePaintParams({ seed: 1 })
    const m = made(params, lchToLab(0.6, 0, 0), { azimuth: 30, elevation: 25 }, true)
    const canvasBridges: number[] = []
    let foundDark = 0
    for (let i = 0; i < m.batch.count; i++) {
      const d = m.an.drafts[i]
      if (ROLES[d.role] !== 'edge' || !d.colour) continue
      // the lowest N·L under the stretch of the sphere the stroke lies over
      let minNl = 9
      for (let q = 0; q < PATH_POINTS; q++) {
        const gi = gIndex(m.an.fc, d.path[2 * q], d.path[2 * q + 1])
        if (gi >= 0 && m.an.fc.g.mark[gi] === 0) minNl = Math.min(minNl, m.an.plan.nl[gi])
      }
      // the canvas colour is a fixed source of the stroke's colour (the table's is a recipe)
      if (Array.isArray(d.colour.a) || Array.isArray(d.colour.b)) canvasBridges.push(minNl)
      if (d.fam === FAM_SHADOW) {
        foundDark++
        // darker than the lightest a shadow of this grey is (the cap's lightness 0.386), the stroke's own jitter apart
        expect(lightnessOf(m.batch, i)).toBeLessThan(0.386 + 0.05)
        // (a single dark stroke is a found edge; a bridge to what lies across, held to its own side's ceiling, may be soft or lost)
        if (d.colour.b === null) expect(d.edge).toBeGreaterThanOrEqual(2)
      }
    }
    // the shadow side is a found, dark edge in several strokes ...
    expect(foundDark).toBeGreaterThanOrEqual(3)
    // ... and no stroke that carries the canvas's lightness into the form lies in the shadow: the lowest N·L one reaches here is -0.062 (the
    // terminator's own soft edge is 0.05 either side)
    expect(canvasBridges.length).toBeGreaterThan(5)
    for (const nl of canvasBridges) expect(nl).toBeGreaterThan(-0.07)
  })

  it('does not carry a bridge to the canvas into the shadow where the terminator runs along the limb (the camera at 200/2, the light 30/5): none reaches below -0.07', () => {
    // the family of a stretch of outline is read from the lowest value on its way in (a limb's normal turns so fast that the pixel 3 px inside can be lit
    // where the outline is not): a bridge once reached -0.12 here
    let bridges = 0
    for (const seed of [1, 2, 3]) {
      const params = resolvePaintParams({ seed })
      const m = made(params, lchToLab(0.6, 0, 0), { azimuth: 200, elevation: 2, lightAzimuth: 30, lightElevation: 5 }, true)
      const spread = spreadOf(m, params)
      if (spread.canvasReach < 9) bridges++
      expect(spread.canvasReach, `seed ${seed}`).toBeGreaterThan(-0.07)
    }
    expect(bridges).toBeGreaterThanOrEqual(1)
  })
})

// ---- the outline, by hand ----

describe('the outline of a form against the canvas', () => {
  // a run of 40 samples (2 G px apart, 80 CSS px) along a silhouette, the form below it (inward is +y): `uA` the form's value,
  // `uB` what lies across (the canvas is 0.7), every sample SOFT, which is the class that bridges to what is across
  const handRun = (uA: number, uB: number): EdgeRun => {
    const n = 40
    const pts = new Float32Array(2 * n)
    const nrm = new Float32Array(2 * n)
    for (let i = 0; i < n; i++) {
      pts[2 * i] = 60 + 2 * i
      pts[2 * i + 1] = 40
      nrm[2 * i + 1] = 1
    }
    return {
      a: -1, b: -1, type: 'silhouette', pts, nrm, h: new Float32Array(n).fill(0.3), cls: new Uint8Array(n).fill(1),
      keys: Uint32Array.from({ length: n }, (_, i) => 1000 + 7919 * i), uA, uB, contrast: Math.abs(uA - uB), mark: 0,
      uAs: new Float32Array(n).fill(uA), uBs: new Float32Array(n).fill(uB),
    }
  }
  const frame = (overrides: Record<string, unknown> = {}) => {
    const params = resolvePaintParams({ seed: 1, roles: { edge: { density: 1 } }, ...overrides } as Partial<PaintParams>)
    return { params, an: made(params, lchToLab(0.6, 0, 0), { azimuth: 30, elevation: 25 }).an }
  }
  const strokesOf = (an: PaintCtx, run: EdgeRun) => {
    const before = an.drafts.length
    edgeStrokes(an, [run])
    return an.drafts.slice(before)
  }

  it('makes the outline of a form in shadow against the canvas a found edge in its own family, never bridged to the canvas', () => {
    const { an } = frame()
    const drafts = strokesOf(an, handRun(0.28, an.plan.uCanvas))
    expect(drafts.length).toBeGreaterThan(0)
    for (const d of drafts) {
      expect(d.fam).toBe(FAM_SHADOW)
      expect(d.edge).toBeGreaterThanOrEqual(2)
      // a single dark stroke: no second colour, and none of it the canvas's
      expect(d.colour?.b).toBeNull()
      expect(Array.isArray(d.colour?.a)).toBe(false)
      // painted at the value of its own side, darker than it: 0.28 less 0.06 (firm) or 0.12 (hard), under the cap
      const side = d.colour?.a as { u: number } | undefined
      expect(side?.u).toBeLessThanOrEqual(0.28 - 0.06 + 1e-6)
    }
  })

  it('bridges a lost or soft outline to the canvas only on the lit side, where the form value and the canvas value match', () => {
    const { an } = frame()
    // a half-tone at 0.6 against the canvas at 0.7: the soft edge stays soft, in the light family, bridged to the canvas colour
    const drafts = strokesOf(an, handRun(0.6, an.plan.uCanvas))
    expect(drafts.length).toBeGreaterThan(0)
    for (const d of drafts) {
      expect(d.fam).toBeUndefined()
      expect(d.edge).toBe(1)
      expect([d.colour?.a, d.colour?.b].some((c) => Array.isArray(c))).toBe(true)
    }
  })

  it('bridges the outline of a form in shadow to the table in the figure own cast shadow at the table value there, never to the canvas', () => {
    const { an } = frame()
    // what lies across is the table in shadow, at 0.36: the values are close, the edge stays lost or soft, and the bridge is to that
    // shadow (a recipe of the ground at 0.36), not to the canvas colour (the fixed source)
    const drafts = strokesOf(an, handRun(0.28, 0.36))
    expect(drafts.length).toBeGreaterThan(0)
    for (const d of drafts) {
      const sources = [d.colour?.a, d.colour?.b].filter((c) => c !== null && c !== undefined)
      expect(sources.some((c) => Array.isArray(c))).toBe(false)
      expect(sources.some((c) => !Array.isArray(c) && (c as { ground: boolean }).ground && Math.abs((c as { u: number }).u - 0.36) < 1e-6)).toBe(true)
    }
  })

  it('scores the shadow-side outline against light canvas FOUND whatever the weights say (every weight and the noise at zero)', () => {
    const e = DEFAULT_PAINT_PARAMS.edges
    const { an, params } = frame({ edges: { ...e, wContrast: [0.32, 0, 0.36], wCurvature: [0.22, 0, 0.08], wFocal: [0.26, 0, 0.06], wLight: [0.1, 0, 0.08], wDepth: [0.1, 0, 0.12], noise: 0 } })
    const spec = (uA: number, uB: number) => ({
      type: 'silhouette' as const,
      mark: 0,
      id: -1,
      S: Array.from({ length: 12 }, (_, i) => ({ p: [60 + 2 * i, 40] as [number, number], nx: 0, ny: 1, q: -1, type: 'silhouette' as const })),
      uA: new Array<number>(12).fill(uA),
      uB: new Array<number>(12).fill(uB),
    })
    // nothing scores the edge: lost on the lit side ...
    expect(Array.from(an.edges.makeRun(spec(0.6, 0.7)).cls)).toEqual(new Array(12).fill(0))
    // ... and found where a form in shadow meets light canvas: the soft limit plus 0.01, the firm class
    const shadow = an.edges.makeRun(spec(0.28, an.plan.uCanvas))
    expect(Array.from(shadow.cls)).toEqual(new Array(12).fill(2))
    for (const h of shadow.h) expect(h).toBeCloseTo(params.edges.softBelow + 0.01, 6)
    // a form in shadow against a table in shadow: the values match, and the family alone does not make it found
    expect(Array.from(an.edges.makeRun(spec(0.28, 0.32)).cls)).toEqual(new Array(12).fill(0))
  })
})

describe('the edges of the figure in shadow', () => {
  // the reviewer's frames: five cameras and lights (camera-relative), where a dark blue, a terracotta and a grey each had edge strokes lighter than the
  // cap's lightness in the figure's own colour at the shadow side, bridging the figure to its own cast shadow on the table
  const frames: ViewOpts[] = [
    { azimuth: 30, elevation: 25 },
    { azimuth: 30, elevation: 4 },
    { azimuth: 200, elevation: 2, lightAzimuth: 30, lightElevation: 5 },
    { azimuth: 0, elevation: 40, lightAzimuth: -60, lightElevation: 45 },
    { azimuth: 120, elevation: 10, lightAzimuth: 100, lightElevation: 10 },
  ]
  const colours: [string, Oklab][] = [['dark blue', lchToLab(0.35, 0.12, 260)], ['terracotta', lchToLab(0.56, 0.14, 38)], ['grey', lchToLab(0.6, 0, 0)]]

  it('holds every edge stroke on the shadow side to the cap’s lightness in the figure’s own colour, and under its half-tones: a bridge to the table’s shadow is no lighter', () => {
    let held = 0
    let worstOver = -1
    let at = ''
    for (const seed of [1, 2, 3]) {
      const params = resolvePaintParams({ seed })
      const curve = makeCurve(params)
      for (const [name, local] of colours) {
        // the lightness the cap gives this colour, with none of the curve's own deviation or a stroke's jitter
        const capL = curve.lch({ local, u: reflectedMax(params), noDev: true })[0]
        for (const opts of frames) {
          const m = made(params, local, opts, true)
          const spread = spreadOf(m, params)
          held += spread.nEdgeShadow
          // (the curve's own deviation and the stroke's jitter, up to 0.04 of lightness, are the colour's: the bound is the same recipe at the cap)
          if (spread.nEdgeShadow > 0 && spread.maxShadowEdge - capL > worstOver) {
            worstOver = spread.maxShadowEdge - capL
            at = `seed ${seed}, ${name}, ${JSON.stringify(opts)}: edge ${spread.maxShadowEdge.toFixed(3)} against the cap's ${capL.toFixed(3)}`
          }
          if (spread.nEdgeShadow > 0 && spread.nLight > 0) expect(spread.maxShadowEdge, `${name} seed ${seed} ${JSON.stringify(opts)}`).toBeLessThan(spread.minLight)
        }
      }
    }
    expect(held).toBeGreaterThan(100)
    expect(worstOver, at).toBeLessThanOrEqual(0.04)
  })
})

// ---- the underpainting ----

describe('the underpainting', () => {
  // The lightest shadow pixel and the darkest half-tone pixel of the sphere's underpainting (the terminator's own edge belongs to neither).
  const underpaintSpread = (params: PaintParams, local: Oklab, radius: number) => {
    const m = made(params, local, { azimuth: 30, elevation: 25 }, false, [640, 480, radius])
    const under = underpaintImage(buildUnderpaintField(m.an, m.g), params, m.an.env)
    const L = m.view.lightDir
    const out = { maxShadow: -1, minLight: 2, nShadow: 0, nLight: 0 }
    for (let i = 0; i < m.g.width * m.g.height; i++) {
      if (m.g.mark[i] !== 0 || Number.isNaN(under[3 * i])) continue
      const nl = m.g.normal[3 * i] * L[0] + m.g.normal[3 * i + 1] * L[1] + m.g.normal[3 * i + 2] * L[2]
      const lightness = linearToOklab(under[3 * i], under[3 * i + 1], under[3 * i + 2])[0]
      if (nl <= -TS / 2) {
        out.nShadow++
        out.maxShadow = Math.max(out.maxShadow, lightness)
      } else if (nl >= TS / 2) {
        out.nLight++
        out.minLight = Math.min(out.minLight, lightness)
      }
    }
    return out
  }

  // grey and terracotta, the sphere at a radius of 120 px and of 60 (a small figure: the lattice is 12 px, so a form blurs more)
  for (const radius of [120, 60]) {
    for (const [name, local] of [LOCALS[3], LOCALS[0]]) {
      it(`has every shadow pixel darker than every half-tone pixel (${name}, radius ${radius} px)`, () => {
        const r = underpaintSpread(resolvePaintParams({ seed: 1 }), local, radius)
        expect(r.nShadow).toBeGreaterThan(radius * 8)
        expect(r.nLight).toBeGreaterThan(radius * 8)
        expect(r.maxShadow, `shadow ${r.maxShadow.toFixed(3)} against half-tone ${r.minLight.toFixed(3)}`).toBeLessThan(r.minLight - 0.05)
      })
    }
  }

  it('holds the order with the mix value step and strength at their slider maxima: its samples are held to the cap and the darkest half-tone', () => {
    const params = resolvePaintParams({ seed: 1, mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1 } })
    for (const radius of [120, 60]) {
      const r = underpaintSpread(params, LOCALS[3][1], radius)
      expect(r.maxShadow, `radius ${radius}: shadow ${r.maxShadow.toFixed(3)} against half-tone ${r.minLight.toFixed(3)}`).toBeLessThan(r.minLight - 0.05)
    }
  })

  it('turns through the terminator as the plan does: its value across the plan’s soft edge is the plan’s within 0.02, neither crisper nor blurrier (radius 120 and 60)', () => {
    // the plan alone: no brush-load mix, none of the curve's own deviation or the seeded one (at the default plane gradient: the band takes no
    // plane step). A grey of local lightness 0.6 reads L = 0.6 + 0.8 (u - 0.62).
    const params = resolvePaintParams({ seed: 1, mix: { strength: 0 }, curve: { devL: 0, devC: 0, devH: 0 }, value: { deviation: 0 } })
    for (const radius of [120, 60]) {
      const m = made(params, LOCALS[3][1], { azimuth: 30, elevation: 25 }, false, [640, 480, radius])
      expect(m.an.stride).toBe(1) // (the plan is at the image's own resolution)
      const under = underpaintImage(buildUnderpaintField(m.an, m.g), params, m.an.env)
      const L = m.view.lightDir
      const valueAt = (i: number) => 0.62 + (linearToOklab(under[3 * i], under[3 * i + 1], under[3 * i + 2])[0] - 0.6) / 0.8
      const inBand = (i: number) => m.g.mark[i] === 0 && Math.abs(m.an.plan.nl[i]) < TS / 2
      let band = 0
      let worst = 0
      let crisper = 0
      let across = 0
      for (let i = 0; i < m.g.width * m.g.height; i++) {
        if (!inBand(i)) continue
        band++
        worst = Math.max(worst, Math.abs(valueAt(i) - m.an.plan.u[i]))
        if (inBand(i + 1)) crisper = Math.max(crisper, Math.abs(valueAt(i + 1) - valueAt(i)) - Math.abs(m.an.plan.u[i + 1] - m.an.plan.u[i]))
        // the plan's rise through the band, as the underpainting sees it: from the shadow side of the terminator to the light side
        const nl = m.g.normal[3 * i] * L[0] + m.g.normal[3 * i + 1] * L[1] + m.g.normal[3 * i + 2] * L[2]
        if (Math.abs(nl) < 0.01) across += valueAt(i) > 0.3 && valueAt(i) < 0.46 ? 1 : 0
      }
      expect(band, `radius ${radius}`).toBeGreaterThan(radius * 2)
      expect(worst, `radius ${radius}: the largest gap between the underpainting's value and the plan's in the band`).toBeLessThanOrEqual(0.02)
      expect(crisper, `radius ${radius}: a step between neighbours steeper than the plan's`).toBeLessThanOrEqual(0.02)
      // the middle of the edge (N·L 0) is the middle of the plan's rise (0.24 core to 0.52 half-tone: about 0.38), not a plateau of either family
      expect(across, `radius ${radius}`).toBeGreaterThan(radius / 6)
    }
  })

  it('takes its lattice samples from outside the band where a cell has any pixel of the family there (a few in a hundred lie inside it)', () => {
    for (const radius of [120, 60]) {
      const params = resolvePaintParams({ seed: 1 })
      const m = made(params, LOCALS[3][1], { azimuth: 30, elevation: 25 }, false, [640, 480, radius])
      const f = buildUnderpaintField(m.an, m.g)
      const L = m.view.lightDir
      let sphere = 0
      let inside = 0
      for (let k = 0; k < f.count; k++) {
        if (f.mark[k] !== 0) continue
        sphere++
        // (the sphere's normal is its position)
        if (Math.abs(f.pos[3 * k] * L[0] + f.pos[3 * k + 1] * L[1] + f.pos[3 * k + 2] * L[2]) < TS / 2) inside++
      }
      // 18 of 373 at radius 120 and 3 of 107 at 60; without the preference 44 and 14
      expect(sphere).toBeGreaterThan(90)
      expect(inside, `radius ${radius}: ${inside} of ${sphere} samples inside the band`).toBeLessThanOrEqual(0.08 * sphere)
    }
  })

  // a 4 x 1 image, cells 2 pixels wide; sample 0 (cell 0) is light red, sample 1 (cell 1) is dark blue
  const fieldOf = (ownerFam: number[], fam: number[]) => ({
    width: 4, height: 1, owner: Int32Array.from([0, 0, 0, 0]), ownerFam: Uint8Array.from(ownerFam), bandPix: new Int32Array(0), bandDonor: new Int32Array(0), bandU: new Float32Array(0), bandW: new Float32Array(0), bandFam: new Uint8Array(0), bandBound: new Float32Array(0), lw: 2, lh: 1, cell: 2,
    cellStart: Int32Array.from([0, 1, 2]), count: 2, mark: Int32Array.from([0, 0]), fam: Uint8Array.from(fam), bound: new Float32Array(2),
    lab: new Float32Array(6), u: new Float32Array(2), nz: new Float32Array(2), bounce: new Float32Array(2), amb: new Float32Array(2),
    plane: new Float32Array(6), pos: new Float32Array(6), flags: new Uint8Array(2), cellOf: new Uint32Array(2),
  })
  const LIGHT_RED_DARK_BLUE = Float32Array.from([1, 0, 0, 0, 0, 0.25])

  it('blends the light family and the shadow family only each within itself: across the terminator a pixel takes its own family’s sample alone', () => {
    // pixels 0..3 sit at lattice positions -0.25, 0.25, 0.75, 1.25: bilinear weights (3/4, 1/4), (1/4, 3/4); the first two
    // pixels are light (the red sample), the last two shadow (the blue)
    const split = fillUnderpaint(fieldOf([FAM_LIGHT, FAM_LIGHT, FAM_SHADOW, FAM_SHADOW], [FAM_LIGHT, FAM_SHADOW]), LIGHT_RED_DARK_BLUE)
    expect(Array.from(split.slice(0, 6))).toEqual([1, 0, 0, 1, 0, 0])
    expect(Array.from(split.slice(6, 12))).toEqual([0, 0, 0.25, 0, 0, 0.25])
    // the same samples, all one family: bilinear across the two cells, as before
    const joined = fillUnderpaint(fieldOf([FAM_LIGHT, FAM_LIGHT, FAM_LIGHT, FAM_LIGHT], [FAM_LIGHT, FAM_LIGHT]), LIGHT_RED_DARK_BLUE)
    expect(joined[3]).toBeCloseTo(0.75, 6)
    expect(joined[6]).toBeCloseTo(0.25, 6)
  })

  it('has no seam where the band meets the lattice, at the default plane gradient: no step across the band’s edge steeper than the plan’s own', () => {
    // the plan's value alone (no mix, no deviation of the curve or the seeded one), but the plane gradient at its default 0.45: the lattice
    // samples beside the band carry the plane's step, and the band meets them through its ring
    const params = resolvePaintParams({ seed: 1, mix: { strength: 0 }, curve: { devL: 0, devC: 0, devH: 0 }, value: { deviation: 0 } })
    expect(params.edges.planeGradient).toBe(0.45)
    // the camera at 200/2 with the key light at 30/5 and a sphere of 60 px is the steepest case there is (the light at the limb: the plan climbs 0.12
    // in a pixel); the others are the lab's view and a high side light
    const cases: [ViewOpts, number, number][] = [
      [{ azimuth: 200, elevation: 2, lightAzimuth: 30, lightElevation: 5 }, 60, 0.04],
      [{ azimuth: 30, elevation: 25 }, 120, 0.04],
      [{ azimuth: 0, elevation: 40, lightAzimuth: -60, lightElevation: 45 }, 120, 0.04],
      [{ azimuth: 30, elevation: 25 }, 60, 0.04],
    ]
    for (const [opts, radius, allowed] of cases) {
      const m = made(params, LOCALS[3][1], opts, false, [640, 480, radius])
      const field = buildUnderpaintField(m.an, m.g)
      const under = underpaintImage(field, params, m.an.env)
      const valueAt = (i: number) => 0.62 + (linearToOklab(under[3 * i], under[3 * i + 1], under[3 * i + 2])[0] - 0.6) / 0.8
      const live = (i: number) => m.g.mark[i] === 0 && !Number.isNaN(under[3 * i])
      let pairs = 0
      let worst = 0
      for (let y = 1; y < m.g.height; y++) {
        for (let x = 1; x < m.g.width; x++) {
          const i = y * m.g.width + x
          for (const j of [i - 1, i - m.g.width]) {
            if (!live(i) || !live(j) || (field.ownerFam[i] === FAM_BAND) === (field.ownerFam[j] === FAM_BAND)) continue
            pairs++
            worst = Math.max(worst, Math.abs(valueAt(i) - valueAt(j)) - Math.abs(m.an.plan.u[i] - m.an.plan.u[j]))
          }
        }
      }
      expect(pairs, `radius ${radius}`).toBeGreaterThan(100)
      expect(worst, `${JSON.stringify(opts)}, radius ${radius}`).toBeLessThanOrEqual(allowed)
    }
  })

  it('fills the pixels of the band from their own colours, not from either family: the colour made at the plan’s value, or the donor sample’s', () => {
    // pixel 1 is in the band (made from donor sample 1, the shadow side's blue); its own colour is a dark green
    const field = { ...fieldOf([FAM_LIGHT, FAM_BAND, FAM_SHADOW, FAM_SHADOW], [FAM_LIGHT, FAM_SHADOW]), bandPix: Int32Array.from([1]), bandDonor: Int32Array.from([1]), bandU: Float32Array.from([0.4]), bandW: Float32Array.from([1]) }
    const own = fillUnderpaint(field, LIGHT_RED_DARK_BLUE, Float32Array.from([0, 0.5, 0]))
    expect(Array.from(own.slice(3, 6))).toEqual([0, 0.5, 0])
    // the pixels beside it keep their families' samples
    expect(Array.from(own.slice(0, 3))).toEqual([1, 0, 0])
    expect(Array.from(own.slice(6, 9))).toEqual([0, 0, 0.25])
    // without colours of its own the pixel takes its donor's
    expect(Array.from(fillUnderpaint(field, LIGHT_RED_DARK_BLUE).slice(3, 6))).toEqual([0, 0, 0.25])
  })

  it('takes a sample of the other family only where its own has none within reach, so no pixel of a form is left bare', () => {
    // every sample is light and the pixels are shadow: the form still has colour
    const bare = fillUnderpaint(fieldOf([FAM_SHADOW, FAM_SHADOW, FAM_SHADOW, FAM_SHADOW], [FAM_LIGHT, FAM_LIGHT]), LIGHT_RED_DARK_BLUE)
    expect(Array.from(bare.slice(0, 3))).toEqual([1, 0, 0])
    expect(Array.from(bare.slice(9, 12))).toEqual([0, 0, 0.25])
  })
})

// ---- the plan's values: the planes, the steps and the bounds ----

describe('planes and stepped values', () => {
  it('merges small pieces within a family only: a plane of the review’s scenario holds one family, and no shadow pixel is stepped above the cap', () => {
    const cap = reflectedMax(P)
    for (const seed of [2, 6]) {
      const params = resolvePaintParams({ seed })
      const m = made(params, lchToLab(0.6, 0, 0), { ...SCENARIO, azimuth: 200 })
      const { planes, plan } = m.an
      const families = new Map<number, Set<number>>()
      let shadowPixels = 0
      for (let i = 0; i < m.an.fc.g.width * m.an.fc.g.height; i++) {
        const id = planes.plane[i]
        if (id < 0 || m.an.fc.g.mark[i] !== 0) continue
        const set = families.get(id) ?? new Set<number>()
        set.add(plan.fam[i])
        families.set(id, set)
        if (plan.nl[i] <= -TS / 2) {
          shadowPixels++
          // the plane's mean plus 0.45 of the pixel's own gradient, as the strokes take it (planes.ts stepValue): at most the cap
          const stepped = planes.planes[id].u + params.edges.planeGradient * (plan.u[i] - planes.planes[id].u)
          expect(stepped, `plane ${id} (mean ${planes.planes[id].u.toFixed(3)}, ${planes.planes[id].area} px)`).toBeLessThanOrEqual(cap + 1e-6)
        }
      }
      expect(shadowPixels).toBeGreaterThan(500)
      // a plane is of one family, except where the terminator's own soft edge runs through it
      let mixed = 0
      for (const set of families.values()) if (set.size > 1) mixed++
      expect(mixed).toBeLessThanOrEqual(1)
    }
  })

  // a plan of four pixels: two in shadow (the cap 0.352 and a pixel of the terminator's edge at 0.40) and two in light
  // (a half-tone at 0.60 and a pixel of the edge at 0.45), the darkest half-tone being 0.52
  const hand = {
    fam: Uint8Array.from([FAM_SHADOW, FAM_SHADOW, FAM_LIGHT, FAM_LIGHT]),
    u: Float32Array.from([0.3, 0.4, 0.6, 0.45]),
    capU: 0.352,
    floorU: 0.52,
  } as unknown as PlanMap

  it('bounds a stroke’s value by its family: the cap or the darkest half-tone, or the plan’s own value where that is beyond it', () => {
    expect(familyBound(hand, 0)).toBeCloseTo(0.352, 6)
    expect(familyBound(hand, 1)).toBeCloseTo(0.4, 6)
    expect(familyBound(hand, 2)).toBeCloseTo(0.52, 6)
    expect(familyBound(hand, 3)).toBeCloseTo(0.45, 6)
    // a shadow stroke is lifted no higher, a light stroke lowered no lower, and neither is moved the other way
    expect(holdFamily(hand, 0, 0.5)).toBeCloseTo(0.352, 6)
    expect(holdFamily(hand, 0, 0.2)).toBe(0.2)
    expect(holdFamily(hand, 1, 0.5)).toBeCloseTo(0.4, 6)
    expect(holdFamily(hand, 2, 0.3)).toBeCloseTo(0.52, 6)
    expect(holdFamily(hand, 2, 0.7)).toBe(0.7)
    expect(holdFamily(hand, 3, 0.3)).toBeCloseTo(0.45, 6)
  })

  it('passes the bounds through the value curve: halved values, halved cap and darkest half-tone', () => {
    const halved = resolvePaintParams({ environment: { occlusion: 0 }, curves: { value: [[0, 0], [1, 0.5]] } })
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const g = sphereGBuffer(400, 300, { view, params: halved })
    const plan = buildPlanMap(makeFrameCtx(sceneOf([sphereMesh()]), view, g, halved))
    expect(plan.capU).toBeCloseTo(0.176, 5)
    expect(plan.floorU).toBeCloseTo(0.26, 5)
  })

  it('holds the stop of the form strokes at the value of the terminator, through the value curve the plan has', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 75 })
    const at = (params: PaintParams) => terminatorValue(buildContext(SCENE, buildParticles(SCENE, flatColours({ 0: lchToLab(0.6, 0, 0), 1: CANVAS }), params), view, sphereGBuffer(400, 300, { view, params }), params))
    // the middle of the core (0.24) and the darkest half-tone (0.52): 0.38, which the value curve then maps
    expect(at(P)).toBeCloseTo(0.38, 9)
    expect(at(resolvePaintParams({ curves: { value: [[0, 0], [0.38, 0.6], [1, 1]] } }))).toBeCloseTo(0.6, 3)
  })
})

// ---- the plan itself: the structure's guard, and the cast shadow's fade ----

describe('the value plan’s structure', () => {
  it('holds the structure whatever the sliders say: the core a gap under the darkest half-tone, the ramps rising, the cap under the half-tones', () => {
    const e = effectiveValues(P)
    expect([e.halfLo, e.halfHi, e.lightLo, e.lightHi, e.corePlateau]).toEqual([0.52, 0.72, 0.85, 0.94, 0.24])
    expect(e.reflectedMax).toBeCloseTo(0.24 + 0.4 * (0.52 - 0.24), 9)
    expect([e.castPlateau, e.castContact]).toEqual([0.32, 0.2])
    // a core set above the half-tones: held 0.02 under the darkest half-tone, the cap 0.4 of that gap above it
    const high = effectiveValues(resolvePaintParams({ value: { corePlateau: 0.6 } }))
    expect(high.corePlateau).toBeCloseTo(0.5, 9)
    expect(high.reflectedMax).toBeCloseTo(0.5 + 0.4 * 0.02, 9)
    // the cap at its widest share is still under the darkest half-tone
    const widest = effectiveValues(resolvePaintParams({ value: { corePlateau: 0.52, reflectedShare: 0.9 } }))
    expect(widest.corePlateau).toBeCloseTo(0.5, 9)
    expect(widest.reflectedMax).toBeCloseTo(0.5 + 0.9 * 0.02, 9)
    expect(widest.reflectedMax).toBeLessThan(widest.halfLo)
    // a ramp that falls is flat, from where it would fall
    const falling = effectiveValues(resolvePaintParams({ value: { halfHi: 0.3, lightLo: 0.4, lightHi: 0.35 } }))
    expect([falling.halfHi, falling.lightLo, falling.lightHi]).toEqual([0.52, 0.52, 0.52])
    // and a cast shadow is never lighter than the cap
    const cast = effectiveValues(resolvePaintParams({ value: { castPlateau: 1, castContact: 1 } }))
    expect(cast.castPlateau).toBeCloseTo(0.352, 9)
    expect(cast.castContact).toBeCloseTo(0.352, 9)
    // and the darkest half-tone itself is never under the gap
    const zero = effectiveValues(resolvePaintParams({ value: { halfLo: 0 } }))
    expect([zero.halfLo, zero.corePlateau]).toEqual([0.02, 0])
    expect(zero.reflectedMax).toBeLessThan(zero.halfLo)
  })

  it('keeps the form shadow under the darkest half-tone for a core slider above the half-tones (the review’s corePlateau 0.6)', () => {
    const params = resolvePaintParams({ value: { corePlateau: 0.6 } })
    const curves = compileCurves(params)
    const zs = newZoneSample()
    let maxShadow = 0
    let minLight = 2
    for (let k = -100; k <= 100; k++) {
      const nl = k / 100
      planSample(params, curves, nl, nl <= 0, 0.3, 0.2, 0.9, 0, zs)
      if (nl <= -TS / 2) maxShadow = Math.max(maxShadow, zs.u)
      else if (nl >= TS / 2) minLight = Math.min(minLight, zs.u)
    }
    // between the held core (0.5) and the cap (0.508), and under the darkest half-tone
    expect(maxShadow).toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(maxShadow).toBeLessThanOrEqual(0.508 + 1e-9)
    expect(minLight).toBeGreaterThanOrEqual(0.52 - 1e-9)
  })

  it('takes a cast shadow in the fade to a value no lighter than the cap, and leaves the terminator’s own edge as it was', () => {
    const curves = compileCurves(P)
    const rMax = reflectedMax(P)
    const zs = newZoneSample()
    const up = [0, 0, 1] as const
    const at = (nl: number, shadow: boolean) => planSample(P, curves, nl, shadow, up[0], up[1], up[2], 0, zs).u
    // the middle of the fade (N·L 0.04: the cast weight is a half): the light end is the cap, the shadow end the plateau 0.32
    expect(at(CAST_FADE / 2, true)).toBeCloseTo((rMax + 0.32) / 2, 9)
    // past the fade it is the plateau
    expect(at(CAST_FADE, true)).toBeCloseTo(0.32, 9)
    expect(at(0.5, true)).toBeCloseTo(0.32, 9)
    // every fade step from the middle on is no lighter than the cap
    for (let k = 0; k <= 20; k++) expect(at(CAST_FADE / 2 + (k / 20) * (CAST_FADE / 2), true)).toBeLessThanOrEqual(rMax + 1e-9)
    // at the start of the fade (N·L 0) the shadow flag changes nothing, and nor does it on the shadow side of the terminator
    expect(at(0.0, true)).toBe(at(0.0, false))
    expect(at(-TS / 4, true)).toBe(at(-TS / 4, false))
    // the family of a pixel: the light family is where the weight of the light is over a half
    expect(isLightFamily(P, 0.2, false)).toBe(true)
    expect(isLightFamily(P, 0.2, true)).toBe(false)
    expect(isLightFamily(P, 0.0, false)).toBe(false)
    expect(isLightFamily(P, 0.6 * CAST_FADE, true)).toBe(false)
    expect(isLightFamily(P, 0.4 * CAST_FADE, true)).toBe(true)
  })

  it('names the saved preset’s old form band as ignored: the key is formBandNL now, in N·L units', () => {
    expect(PARAM_SCHEMA.some((s) => s.path === 'detect.formBandNL')).toBe(true)
    expect(PARAM_SCHEMA.some((s) => s.path === 'detect.formBand')).toBe(false)
    expect(resolvePaintParams({ detect: { formBand: 0.5 } } as never).detect.formBandNL).toBe(P.detect.formBandNL)
    expect(resolvePaintParams({ detect: { formBandNL: 0.5 } }).detect.formBandNL).toBe(0.5)
  })
})

// ---- the brush-load mix's value step ----

describe('the brush-load mix’s value step', () => {
  const draft = (lab: [number, number, number], extra: Partial<StrokeDraft> = {}): StrokeDraft => ({
    role: roleIndex('block'),
    path: new Float32Array(2 * PATH_POINTS),
    width: new Float32Array(PATH_POINTS).fill(3),
    depth: 5,
    lab,
    u: 0.3,
    cell: 7,
    mx: 0,
    my: 0,
    colormapped: false,
    alpha: 1,
    load: 1,
    impasto: 1,
    bristles: 6,
    bristleVar: 0.3,
    dry: 0.2,
    wet: 0.1,
    endSoft: 0,
    edge: 255,
    seed: 3,
    jit0: 0,
    jit1: 0,
    order: 0,
    ...extra,
  })
  // every load takes the maximum value step (0.15 up; or down, with the balance at -1), at twice the strength
  const stepUp = resolvePaintParams({ mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: 1 } })
  const stepDown = resolvePaintParams({ mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: -1 } })
  const lightnessOfPacked = (drafts: StrokeDraft[], params: PaintParams) => linearToOklab(...(Array.from(packStrokes(drafts, params).batch.colour) as [number, number, number]))[0]

  it('cannot lift a shadow-family stroke over the lightness the cap gives it, nor drop a light-family stroke under the darkest half-tone’s', () => {
    // a grey shadow stroke of lightness 0.28, its cap's lightness 0.30: the mix lifts it by up to 0.15 ...
    const free = lightnessOfPacked([draft([0.28, 0, 0])], stepUp)
    expect(free).toBeGreaterThan(0.33)
    // ... and the cap holds it
    expect(lightnessOfPacked([draft([0.28, 0, 0], { fam: FAM_SHADOW, uBound: 0.352, lBound: 0.3 })], stepUp)).toBeCloseTo(0.3, 6)
    // a grey half-tone stroke of lightness 0.6, the darkest half-tone's lightness 0.55: the mix drops it by up to 0.15 ...
    expect(lightnessOfPacked([draft([0.6, 0, 0])], stepDown)).toBeLessThan(0.55)
    // ... and the floor holds it
    expect(lightnessOfPacked([draft([0.6, 0, 0], { fam: FAM_LIGHT, uBound: 0.52, lBound: 0.55 })], stepDown)).toBeCloseTo(0.55, 6)
  })

  it('leaves a stroke inside its bound exactly as the mix made it, bit for bit, and a stroke of no family alone', () => {
    const off = resolvePaintParams({ mix: { strength: 0 } })
    const lab: [number, number, number] = [0.25, 0.03, -0.02]
    const plain = packStrokes([draft(lab)], off).batch.colour
    const inside = packStrokes([draft(lab, { fam: FAM_SHADOW, uBound: 0.352, lBound: 0.3 })], off).batch.colour
    expect(Array.from(inside)).toEqual(Array.from(plain))
    expect(Array.from(plain)).toEqual(Array.from(Float32Array.from(oklabToLinear(lab))))
    // the light side the same
    const lightLab: [number, number, number] = [0.7, 0.02, 0.04]
    expect(Array.from(packStrokes([draft(lightLab, { fam: FAM_LIGHT, uBound: 0.52, lBound: 0.55 })], off).batch.colour)).toEqual(Array.from(packStrokes([draft(lightLab)], off).batch.colour))
  })

  it('holds a lightness and keeps the hue and chroma it fits to the gamut (hand values)', () => {
    const lab: [number, number, number] = [0.5, 0.02, 0.01]
    const lch = labToLch(lab)
    // inside the bound: the colour as it is
    expect(holdLightness(lab, true, 0.6)).toEqual(lab)
    expect(holdLightness(lab, false, 0.4)).toEqual(lab)
    // beyond it: the lightness is the bound's, the hue and chroma the colour's
    const lower = holdLightness(lab, true, 0.4)
    expect(lower[0]).toBeCloseTo(0.4, 9)
    expect(labToLch(lower)[1]).toBeCloseTo(lch[1], 6)
    expect(labToLch(lower)[2]).toBeCloseTo(lch[2], 6)
    expect(holdLightness(lab, false, 0.6)[0]).toBeCloseTo(0.6, 9)
    // a grey stays grey
    expect(holdLightness([0.5, 0, 0], true, 0.3)).toEqual([0.3, 0, 0])
  })

  it('makes a stroke’s bound from the stroke’s own recipe: its lightness at the bound value, and a fixed colour’s own', () => {
    const curve = makeCurve(P)
    const env: RecipeEnv = { curve, ground: lchToLab(0.7, 0.01, 80), devL: P.curve.devL, devC: P.curve.devC, devH: P.curve.devH }
    const r = newRecipe()
    r.lx = 0.6
    r.u = 0.3
    r.g0 = 1.2
    r.c0 = 0.5
    const same = (u: number) => colourOfRecipe({ ...r, u }, env)[0]
    expect(lightnessAtValue({ a: r, b: null, t: 0 }, 0.352, env)).toBe(same(0.352))
    // the curve's slope is 0.8 per unit of value: the lightness at the cap is above that at 0.3 by about 0.04
    expect(lightnessAtValue({ a: r, b: null, t: 0 }, 0.352, env) - same(0.3)).toBeCloseTo(0.8 * 0.052, 1)
    // a fixed colour (the canvas) has its own lightness whatever the value; two sources are blended
    expect(lightnessAtValue({ a: [0.93, 0, 0], b: null, t: 0 }, 0.1, env)).toBe(0.93)
    expect(lightnessAtValue({ a: r, b: [0.9, 0, 0], t: 0.5 }, 0.352, env)).toBeCloseTo((same(0.352) + 0.9) / 2, 9)
  })
})
