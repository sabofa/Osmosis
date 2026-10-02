import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, PARAM_SCHEMA, resolvePaintParams, setParam, type PaintParams } from '../params'
import type { GBuffer, PaintView, SceneColours, StrokeBatch } from '../types'
import type { SpaceScene } from '../../scene/types'
import { lchToLab } from './colour'
import { buildParticles, classifyChange, isColourOnlyChange, paintFrame, recolourFrame } from './index'
import {
  arrowMark, flatColours, graphMesh, lineMark, meshGBuffer, paintView, pointMark, sceneOf, sphereGBuffer, sphereMesh, tableMesh,
} from './testing'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 120_000 })

const P = DEFAULT_PAINT_PARAMS

// Two scenes between them have every kind of stroke a recolour must remake: a
// sphere on a table (block, form, glaze, reflected, dab, edges and a cast shadow,
// the ground's own colour), and a colour-scaled surface with a curve, an arrow and
// a point (colormapped strokes, lines).
interface Case {
  scene: SpaceScene
  colours: SceneColours
  view: PaintView
  gbuffer: (params: PaintParams) => GBuffer
}

const sphereCase = (): Case => {
  const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
  const view = paintView({ width: 480, height: 360, azimuth: 30, elevation: 25, zoom: 100 })
  return {
    scene,
    colours: flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85) }),
    view,
    gbuffer: (params) => sphereGBuffer(480, 360, { view, params, table: { z: -1, mark: 1 } }),
  }
}

const dataCase = (): Case => {
  const saddle = graphMesh((x, y) => 0.5 * (x * x - y * y), { half: 1, n: 24, scaled: true, index: 0 })
  const scene = sceneOf([
    saddle,
    lineMark([[-1, -1, 0.6], [0, 0.2, 0.8], [1, 1, 0.6]], { index: 1 }),
    arrowMark([0, 0, 0.5], [0.4, 0.2, 0.5], { index: 2 }),
    pointMark([[0.3, 0.3, 0.5]], { index: 3 }),
  ])
  const view = paintView({ width: 480, height: 360, azimuth: 40, elevation: 30, zoom: 110 })
  return {
    scene,
    colours: flatColours({ 0: lchToLab(0.6, 0.1, 150), 1: lchToLab(0.4, 0.05, 55), 2: lchToLab(0.4, 0.05, 55), 3: lchToLab(0.4, 0.06, 30) }, (v) => lchToLab(0.45 + 0.4 * v, 0.12, 250 - 120 * v)),
    view,
    gbuffer: (params) => meshGBuffer(480, 360, [{ mesh: saddle, mark: 0 }], { view, params }),
  }
}

const batchEqual = (a: StrokeBatch, b: StrokeBatch) => {
  expect(a.count).toBe(b.count)
  for (const key of Object.keys(a) as (keyof StrokeBatch)[]) {
    if (key === 'count') continue
    expect(Array.from(a[key] as ArrayLike<number>), String(key)).toEqual(Array.from(b[key] as ArrayLike<number>))
  }
}

// The first index at which two images differ (NaN, the mark of an empty pixel, equals NaN), or -1.
const firstDifference = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return 0
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i
  return -1
}

// The new params for a schema path: its maximum, or its minimum where the default is the maximum.
const moved = (path: string): PaintParams => {
  const spec = PARAM_SCHEMA.find((s) => s.path === path)!
  const current = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], P) as number
  return setParam(P, path, current === spec.max ? spec.min : spec.max)
}

describe('recolouring a frame (colour parameters change, nothing else does)', () => {
  const cases = [sphereCase(), dataCase()]
  const bases = cases.map((c) => {
    const particles = buildParticles(c.scene, c.colours, P)
    const frame = paintFrame(c.scene, particles, c.view, c.gbuffer(P), P)
    return { particles, frame }
  })

  // every slider that the model classes as a colour parameter, one at a time
  const colourPaths = PARAM_SCHEMA.map((s) => s.path).filter((path) => isColourOnlyChange(P, moved(path)))

  it('classes the lighting curve, its adjustment curves, the environment colour and the mix as colour-only', () => {
    expect(colourPaths.length).toBeGreaterThan(50)
    for (const path of ['curve.lSlope', 'curve.cPeak', 'curve.warmHue', 'curve.devL', 'curve.devH', 'curve.planeStepA', 'curve.skyTint', 'curve.colormapHue', 'environment.hue', 'environment.chroma', 'environment.absorption', 'mix.strength', 'mix.hueMax', 'mix.roleBlock', 'mix.loadBreakPx', 'mix.hueBias', 'mix.colormapScale']) {
      expect(colourPaths, path).toContain(path)
    }
    // the four colour curves of the editor
    for (const name of ['lAdjust', 'cAdjust', 'hAdjust', 'mixAmount'] as const) {
      expect(isColourOnlyChange(P, { ...P, curves: { ...P.curves, [name]: [[0, 0.1], [0.5, 0.3], [1, 0.1]] } }), name).toBe(true)
    }
    // nothing changed is no change of anything
    expect(isColourOnlyChange(P, structuredClone(P))).toBe(true)
  })

  it('does not class anything that moves a stroke, or the value plan, as colour-only', () => {
    for (const path of ['light.azimuth', 'light.intensity', 'light.shadows', 'value.halfLo', 'value.deviation', 'roles.block.width', 'roles.form.length', 'roles.dab.wet', 'edges.stopAt', 'detect.formBand', 'particles.maxPerUnit2', 'particles.dragDensity', 'impasto.strength', 'canvas.tone.0', 'canvas.texture', 'mix.loadCell', 'environment.occlusion', 'seed']) {
      expect(isColourOnlyChange(P, moved(path)), path).toBe(false)
    }
    // the curves that shape the value, not the colour
    expect(isColourOnlyChange(P, { ...P, curves: { ...P.curves, lightResponse: [[0, 0], [0.5, 0.7], [1, 1]] } })).toBe(false)
    expect(isColourOnlyChange(P, { ...P, curves: { ...P.curves, value: [[0, 0], [0.5, 0.7], [1, 1]] } })).toBe(false)
    // one colour change and one other together are a full frame
    expect(isColourOnlyChange(P, { ...setParam(P, 'curve.lSlope', 1.1), roles: { ...P.roles, block: { ...P.roles.block, width: 30 } } })).toBe(false)
  })

  it('classifies a change of parameters by what it asks of a frame: same, render, colour or full', () => {
    expect(classifyChange(P, structuredClone(P))).toBe('same')
    // only the renderer reads these: the relief, the canvas's texture and weave
    for (const path of ['impasto.strength', 'impasto.lightAzimuth', 'impasto.lightElevation', 'canvas.texture', 'underpaint.opacity', 'underpaint.streak']) expect(classifyChange(P, moved(path)), path).toBe('render')
    expect(classifyChange(P, { ...P, canvas: { ...P.canvas, weave: 'duck' } })).toBe('render')
    expect(classifyChange(P, setParam(setParam(P, 'impasto.strength', 2), 'canvas.texture', 0.3))).toBe('render')
    // colour parameters, alone or with a renderer one
    expect(classifyChange(P, moved('curve.lSlope'))).toBe('colour')
    expect(classifyChange(P, setParam(setParam(P, 'curve.lSlope', 0.9), 'impasto.strength', 2))).toBe('colour')
    // anything that moves a stroke or the value plan, however many renderer parameters come with it
    for (const path of ['light.azimuth', 'roles.block.width', 'seed', 'canvas.tone.0', 'mix.loadCell', 'particles.maxPerUnit2', 'particles.zoomGrowMax', 'particles.zoomStrokeScale']) expect(classifyChange(P, moved(path)), path).toBe('full')
    expect(classifyChange(P, setParam(setParam(P, 'light.azimuth', 50), 'impasto.strength', 2))).toBe('full')
    // render-only parameters are not colour-only ones
    expect(isColourOnlyChange(P, moved('impasto.strength'))).toBe(false)
  })

  it('gives, for every colour slider, exactly the frame a full run gives (strokes, stats and debug views)', () => {
    cases.forEach((c, k) => {
      const { frame } = bases[k]
      for (const path of colourPaths) {
        const next = moved(path)
        const again = recolourFrame(frame, next)
        expect(again, path).not.toBeNull()
        const full = paintFrame(c.scene, bases[k].particles, c.view, c.gbuffer(next), next)
        batchEqual(again!.strokes, full.strokes)
        // the underpainting is made again with them
        expect(firstDifference(again!.underpaint, full.underpaint), `${path}: underpaint`).toBe(-1)
        expect(again!.stats, path).toEqual(full.stats)
        expect(again!.debug.edgeSegments, path).toEqual(full.debug.edgeSegments)
      }
    })
  })

  it('does so for edited adjustment curves, and one recolour after another', () => {
    const c = cases[0]
    const { frame, particles } = bases[0]
    const edited = resolvePaintParams({
      curves: { lAdjust: [[0, 0.1], [0.4, -0.08], [1, 0.05]], cAdjust: [[0, 1.4], [0.5, 0.6], [1, 1.2]], hAdjust: [[0, 20], [0.5, -25], [1, 30]], mixAmount: [[0, 0.2], [0.6, 1.8], [1, 0.4]] },
      environment: { hue: 120, chroma: 0.09, absorption: 0.9 },
      mix: { strength: 1.4, hueBias: 0.3 },
    })
    const first = recolourFrame(frame, edited)!
    const fullEdited = paintFrame(c.scene, particles, c.view, c.gbuffer(edited), edited)
    batchEqual(first.strokes, fullEdited.strokes)
    expect(firstDifference(first.underpaint, fullEdited.underpaint)).toBe(-1)
    // from a recolour, to a further one, and back to the start
    const more = setParam(edited, 'curve.lSlope', 1.2)
    const second = recolourFrame(first, more)!
    const fullMore = paintFrame(c.scene, particles, c.view, c.gbuffer(more), more)
    batchEqual(second.strokes, fullMore.strokes)
    expect(firstDifference(second.underpaint, fullMore.underpaint)).toBe(-1)
    const back = recolourFrame(second, P)!
    batchEqual(back.strokes, frame.strokes)
    expect(firstDifference(back.underpaint, frame.underpaint)).toBe(-1)
  })

  it('shares the debug views, and says no to a frame it did not make', () => {
    const { frame } = bases[0]
    const again = recolourFrame(frame, setParam(P, 'curve.cPeak', 1.3))!
    expect(again.debug).toBe(frame.debug)
    expect(recolourFrame({ ...frame }, P)).toBeNull()
  })

  it('really changes the colours (a recolour that returned the old ones would pass the rest)', () => {
    const { frame } = bases[0]
    const again = recolourFrame(frame, setParam(P, 'curve.lSlope', 1.3))!
    let differing = 0
    for (let i = 0; i < frame.strokes.count; i++) if (again.strokes.colour[3 * i] !== frame.strokes.colour[3 * i]) differing++
    expect(differing).toBeGreaterThan(frame.strokes.count / 2)
    // the underpainting's colours change, and its coverage does not
    let paintedDiffering = 0
    for (let i = 0; i < frame.underpaint.length; i++) {
      expect(Number.isNaN(again.underpaint[i])).toBe(Number.isNaN(frame.underpaint[i]))
      if (again.underpaint[i] !== frame.underpaint[i]) paintedDiffering++
    }
    expect(paintedDiffering).toBeGreaterThan(1000)
    // and leaves every geometry array alone
    expect(Array.from(again.strokes.path)).toEqual(Array.from(frame.strokes.path))
    expect(Array.from(again.strokes.width)).toEqual(Array.from(frame.strokes.width))
    expect(Array.from(again.strokes.seed)).toEqual(Array.from(frame.strokes.seed))
  })
})

