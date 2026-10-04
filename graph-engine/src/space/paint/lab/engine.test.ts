import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { lengthFactorsMoved } from '../bake/index'
import type { AuthoredFraming, BakedPainting } from '../bake/types'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../params'
import { createPaintFakeGl, timeline } from '../gl/fakePaintGl'
import { encodeFloatTexel } from '../gl/gbuffer'
import { edgeFade, matchStrokes } from '../liveOrbit'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { reprojectStrokes } from '../reproject'
import type { Scratch as ScratchClass } from '../scratch'
import {
  bakeTransferList,
  PaintSession,
  recolourTransferList,
  type BakeAnswer,
  type BakeRequest,
  type BakedColours,
  type FrameResponse,
  type RecolourAnswer,
  type RecolourRequest,
  type SceneColourData,
  type SessionRequest,
  type SessionResponse,
} from '../session'
import { PATH_POINTS, ROLES, type PaintDebugMode, type PaintFrame, type PaintView, type StrokeBatch } from '../types'
import type { SpaceScene } from '../../scene/types'
import type { BakeHost, BakeStatus, EngineEvents, EngineOptions, FrameStats, ModelHost, PaintEngine } from '../../../../../review/src/paintLabEngine'
import { buildFigure, heldFraming } from '../../../../../review/src/paintLabCamera'
import { colourData } from '../gl/bakedSurfaces'

// The Paint Lab's engine: one frame at a time, newest request wins, a colour-only change is a
// colour frame, a Showcase tile is copied when it is painted. It runs here on the fake GL and on
// the page's own thread (?worker=0); a Worker that fails falls back to that.
vi.setConfig({ testTimeout: 120_000 })

let createPaintEngine: typeof import('../../../../../review/src/paintLabEngine').createPaintEngine
let BAKE_DEBOUNCE_MS: number

// paintLabState reads the page's URL when it is imported.
async function load(search: string) {
  vi.resetModules()
  vi.stubGlobal('location', { search, href: `http://lab/paint-lab.html${search}` })
  ;({ createPaintEngine, BAKE_DEBOUNCE_MS } = await import('../../../../../review/src/paintLabEngine'))
}

beforeAll(async () => load('?worker=0'))
afterEach(() => vi.unstubAllGlobals())

const P = DEFAULT_PAINT_PARAMS
const SCENE = sceneOf([sphereMesh({ radius: 0.6 }), tableMesh({ z: -0.6, half: 1.5, index: 1 })])
const OTHER = sceneOf([sphereMesh({ radius: 0.5 }), tableMesh({ z: -0.5, half: 1.5, index: 1 })])
const COLOURS = flatColours({ 0: [0.56, 0.12, 0.08], 1: [0.9, 0.01, 0.02] })
const view = (opts: Parameters<typeof paintView>[0] = {}): PaintView => paintView({ width: 320, height: 240, azimuth: 30, elevation: 25, zoom: 100, ...opts })

function setup() {
  const gl = createPaintFakeGl({}, { width: 320, height: 240 })
  // the engine sizes the canvas through its style for a tile
  Object.assign(gl.canvas.canvas, { style: {} })
  const frames: FrameStats[] = []
  const errors: (string | null)[] = []
  const events: EngineEvents = { onFrame: (s) => frames.push(s), onError: (m) => errors.push(m) }
  const engine: PaintEngine = createPaintEngine(gl.canvas.canvas, events)
  engine.setScene(SCENE, COLOURS)
  // how many G-buffer passes the renderer has made
  const gbuffers = () => timeline(gl).filter((e) => e.kind === 'gbuffer').length / 2
  const done = (n: number) => vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(n), { timeout: 60_000, interval: 5 })
  return { gl, engine, frames, errors, gbuffers, done }
}

const kinds = (frames: FrameStats[]) => frames.map((f) => f.kind)

describe('the frames of the engine', () => {
  it('makes a full frame first (G-buffer, model, paint), and reports where its time went', async () => {
    const { engine, frames, errors, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    expect(frames[0].kind).toBe('full')
    expect(gbuffers()).toBe(1)
    expect(frames[0].ms).toBeGreaterThan(0)
    expect(frames[0].modelMs).toBeGreaterThan(0)
    expect(frames[0].paperMs).toBeGreaterThan(0) // the paper is generated with the first frame
    expect(errors).toEqual([null])
    engine.dispose()
  })

  it('makes a colour frame, with no G-buffer pass, when only colour parameters changed and the view did not', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    engine.render(view(), setParam(P, 'curve.lSlope', 0.95), 'none')
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'colour'])
    expect(gbuffers()).toBe(1)
    expect(frames[1].gbufferMs).toBe(0)
    // and again, from the same first frame
    engine.render(view(), setParam(P, 'mix.hueMax', 40), 'none')
    await done(3)
    expect(kinds(frames)).toEqual(['full', 'colour', 'colour'])
    expect(gbuffers()).toBe(1)
    engine.dispose()
  })

  it('paints the same strokes again, with no G-buffer and no model, when only the relief or the canvas changed', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    // the relief: strength, light azimuth and elevation
    engine.render(view(), setParam(P, 'impasto.strength', 1.6), 'none')
    await done(2)
    engine.render(view(), setParam(setParam(P, 'impasto.strength', 1.6), 'impasto.lightAzimuth', 200), 'none')
    await done(3)
    expect(kinds(frames)).toEqual(['full', 'repaint', 'repaint'])
    expect(frames[1].strokes).toBe(frames[0].strokes)
    expect(frames[1].modelMs).toBe(0)
    expect(frames[1].gbufferMs).toBe(0)
    expect(frames[1].paperMs).toBe(0) // the paper is the same
    expect(gbuffers()).toBe(1)
    // the canvas texture and weave move the paper (made by the model's thread), not a stroke
    engine.render(view(), setParam(P, 'canvas.texture', 0.8), 'none')
    await done(4)
    expect(frames[3].kind).toBe('repaint')
    expect(frames[3].paperMs).toBeGreaterThan(0)
    expect(gbuffers()).toBe(1)
    engine.render(view(), { ...P, canvas: { ...P.canvas, weave: 'linen' } }, 'none')
    await done(5)
    expect(frames[4].kind).toBe('repaint')
    expect(gbuffers()).toBe(1)
    engine.dispose()
  })

  it('goes back to colour frames after a repaint, and a colour change then its undoing is two colour frames, not a full one', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    engine.render(view(), setParam(P, 'impasto.strength', 2), 'none')
    await done(2)
    engine.render(view(), setParam(setParam(P, 'impasto.strength', 2), 'curve.lSlope', 1.1), 'none')
    await done(3)
    engine.render(view(), P, 'none') // back to the analysed parameters
    await done(4)
    expect(kinds(frames)).toEqual(['full', 'repaint', 'colour', 'colour'])
    expect(gbuffers()).toBe(1)
    // and the strokes of the last of them are the first frame's colours again
    expect(frames[3].strokes).toBe(frames[0].strokes)
    engine.dispose()
  })

  it('makes a full frame when the debug view, the light, a stroke size or the scene changed (and a re-projection when only the camera did)', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    const next = async (v: PaintView, params: PaintParams, debug: PaintDebugMode) => {
      const n = frames.length
      engine.render(v, params, debug)
      await done(n + 1)
      return frames[frames.length - 1].kind
    }
    // the camera moved (dragging, so that no model frame follows by itself): the strokes are the last frame's
    expect(await next(view({ azimuth: 40, dragging: true }), P, 'none')).toBe('reproject')
    expect(await next(view({ azimuth: 40 }), P, 'edges')).toBe('full') // another debug view: images of the G-buffer cannot move
    expect(await next(view({ azimuth: 40 }), setParam(P, 'light.azimuth', 20), 'edges')).toBe('full') // the light
    expect(await next(view({ azimuth: 40 }), setParam(setParam(P, 'light.azimuth', 20), 'roles.block.width', 30), 'edges')).toBe('full') // a stroke size
    expect(gbuffers()).toBe(4)
    // the new scene: even with nothing else changed, a colour request would have nothing to recolour
    engine.setScene(OTHER, COLOURS)
    expect(await next(view({ azimuth: 40 }), setParam(setParam(P, 'light.azimuth', 20), 'roles.block.width', 30), 'edges')).toBe('full')
    engine.dispose()
  })

  it('gives a scene new colours (a theme, a local colour) a full frame, never a recolour of the old one', async () => {
    const { engine, frames, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    engine.setScene(SCENE, flatColours({ 0: [0.4, 0.1, -0.1], 1: [0.9, 0.01, 0.02] }))
    engine.render(view(), setParam(P, 'curve.lSlope', 0.9), 'none')
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'full'])
    engine.dispose()
  })

  it('does one frame at a time, and of the requests that came while it worked only the newest is made', async () => {
    const { engine, frames, gl, done } = setup()
    // three requests in the same task: the first starts, the second is replaced by the third
    engine.render(view({ azimuth: 10, pixelRatio: 1 }), P, 'none')
    engine.render(view({ azimuth: 20, pixelRatio: 2 }), P, 'none')
    engine.render(view({ azimuth: 30, pixelRatio: 3 }), P, 'none')
    await done(2)
    await new Promise((r) => setTimeout(r, 50))
    expect(frames.length).toBe(2)
    // the renderer sizes its canvas to the last view it painted (the client width, 320, times its pixel ratio): the newest
    expect(gl.canvas.canvas.width).toBe(960)
    engine.dispose()
  })

  it('does not paint a frame of the view over a new scene: what the model made for the old figure is dropped', async () => {
    const { engine, frames, done } = setup()
    engine.render(view(), P, 'none')
    // the figure changes in the same task, before the model's answer is taken
    engine.setScene(OTHER, COLOURS)
    await new Promise((r) => setTimeout(r, 50))
    expect(frames.length).toBe(0) // the old figure's frame was made and dropped
    engine.render(view(), P, 'none')
    await done(1)
    expect(frames[0].kind).toBe('full')
    engine.dispose()
  })

  it('reports a failed frame as an error to show, and carries on with the next one', async () => {
    const { engine, frames, errors, done } = setup()
    // a view the model cannot use: not a number for a matrix
    const broken = view()
    broken.viewProj = new Float32Array(16).fill(Number.NaN)
    engine.render(broken, P, 'none')
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 60_000, interval: 5 })
    engine.render(view(), P, 'none')
    await done(frames.length + 1)
    expect(errors[errors.length - 1]).toBeNull()
    engine.dispose()
  })
})

// ---- a real picture: the sphere's G-buffer through the fake GL's readback, so the model has strokes to make ----

const sphereView = (opts: Parameters<typeof paintView>[0] = {}): PaintView => paintView({ width: 320, height: 240, azimuth: 30, elevation: 25, zoom: 200, ...opts })

function withPicture(extra: EngineOptions = {}, glLimits: Parameters<typeof createPaintFakeGl>[2] = {}) {
  const painted: { frame: PaintFrame; kind: FrameStats['kind'] }[] = []
  const crossfades: number[] = []
  const snapshot = { canvas: { width: 0, height: 0 }, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  const gl = createPaintFakeGl({}, { width: 320, height: 240 }, glLimits)
  Object.assign(gl.canvas.canvas, { style: {} })
  const frames: FrameStats[] = []
  const errors: (string | null)[] = []
  const engine = createPaintEngine(
    gl.canvas.canvas,
    { onFrame: (f) => frames.push(f), onError: (m) => errors.push(m), onCrossfade: () => crossfades.push(frames.length), onPaint: (frame, kind) => painted.push({ frame, kind }) },
    { snapshot, ...extra },
  )
  engine.setScene(SCENE, COLOURS)
  // The renderer reads the sphere back as the G-buffer of the view it is about to paint.
  const go = (v: PaintView, params: PaintParams = P, debug: PaintDebugMode = 'none') => {
    const g = sphereGBuffer(v.width, v.height, { view: v, params, centre: [0, 0, 0], radius: 0.6, mark: 0, table: { z: -0.6, mark: 1 } })
    gl.setReadback((_a, _w, _h, dst) => {
      const out = dst as Float32Array
      for (let i = 0; i < g.width * g.height; i++) {
        const t =
          g.mark[i] < 0
            ? [0, 0, 1e30, 0]
            : encodeFloatTexel({ normal: [g.normal[3 * i], g.normal[3 * i + 1], g.normal[3 * i + 2]], depth: g.depth[i], value: g.value[i], shadow: g.shadow[i] === 1, mark: g.mark[i] })
        out.set(t, 4 * i)
      }
    })
    engine.render(v, params, debug)
  }
  const gbuffers = () => timeline(gl).filter((e) => e.kind === 'gbuffer').length / 2
  const done = (n: number) => vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(n), { timeout: 60_000, interval: 5 })
  return { engine, frames, errors, painted, crossfades, snapshot, go, gbuffers, done, gl }
}

const sameStrokes = (a: StrokeBatch, b: StrokeBatch) => {
  expect(a.count).toBe(b.count)
  for (const key of Object.keys(a) as (keyof StrokeBatch)[]) if (key !== 'count') expect(Array.from(a[key] as ArrayLike<number>), String(key)).toEqual(Array.from(b[key] as ArrayLike<number>))
}

describe('the camera moving: the last frame\'s strokes, re-projected', () => {
  it('re-projects every stroke through the new view while the pointer is down: no G-buffer, no model, nothing thinned', async () => {
    const { engine, frames, painted, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    const first = painted[0].frame.strokes
    expect(first.count).toBeGreaterThan(100)
    for (let k = 1; k <= 5; k++) go(sphereView({ azimuth: 30 + 6 * k, dragging: true }), P)
    // each one is painted at once, in the same task: the engine re-projects synchronously
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject', 'reproject', 'reproject'])
    expect(gbuffers()).toBe(1)
    for (const f of frames.slice(1)) {
      expect(f.modelMs).toBe(0)
      expect(f.gbufferMs).toBe(0)
      expect(f.strokes).toBe(first.count)
    }
    // the strokes are the first frame's: its colours, roles, widths, but a path of their own for the view
    const last = painted[painted.length - 1].frame.strokes
    expect(last.colour).toBe(first.colour)
    expect(last.role).toBe(first.role)
    expect(last.count).toBe(first.count)
    expect(Array.from(last.path)).not.toEqual(Array.from(first.path))
    engine.dispose()
  })

  it('puts a dragged frame through the new view’s depth: the depth pass, the stroke test and the warped underpainting; a full frame through none', async () => {
    const { engine, frames, gl, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    const events = () => timeline(gl)
    // the full frame (G-buffer, model, paint): no depth pass, no test, the plain underpainting
    expect(events().filter((e) => e.kind === 'depth')).toHaveLength(0)
    for (const s of events().filter((e) => e.kind === 'stroke')) expect(s.uniforms.u_depthTest).toEqual([0])
    expect(events().filter((e) => e.kind === 'underpaint').every((e) => !gl.fake.programSource(e.draw!.program).fragment.includes('#define WARP'))).toBe(true)
    const before = events().length
    // drag: the re-projected frame draws the scene's depth (the sphere and the table), then tests every layer against it
    go(sphereView({ azimuth: 44, dragging: true }), P)
    expect(frames[frames.length - 1].kind).toBe('reproject')
    const dragged = events().slice(before)
    expect(dragged.filter((e) => e.kind === 'depth')).toHaveLength(2)
    expect(dragged.filter((e) => e.kind === 'depth').every((e) => e.draw?.depthTest === true)).toBe(true)
    const strokes = dragged.filter((e) => e.kind === 'stroke')
    expect(strokes.length).toBeGreaterThan(2)
    for (const s of strokes) expect(s.uniforms.u_depthTest).toEqual([1])
    // the depth pass comes before the first stroke, and the underpainting is warped
    expect(dragged.findIndex((e) => e.kind === 'depth')).toBeLessThan(dragged.findIndex((e) => e.kind === 'stroke'))
    const under = dragged.find((e) => e.kind === 'underpaint')!
    expect(gl.fake.programSource(under.draw!.program).fragment).toContain('#define WARP')
    // and it is the old view that the warp is told: the view the full frame was made for (320 x 240 CSS px)
    expect(under.uniforms.u_oldCss).toEqual([320, 240])
    engine.dispose()
  })

  it('warps from the G-buffer depth of the frame the strokes came from: the last full frame’s, replaced by the release’s', async () => {
    const { engine, gl, go, done } = withPicture()
    const depthUploads = () =>
      gl.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === 0x1903 && c.args[7] === 0x1406 && c.args[4] === 160 && c.args[5] === 120).map((c) => c.args[8] as Float32Array)
    const expected = (azimuth: number) => sphereGBuffer(320, 240, { view: sphereView({ azimuth }), params: P, centre: [0, 0, 0], radius: 0.6, mark: 0, table: { z: -0.6, mark: 1 } }).depth
    go(sphereView(), P)
    await done(1)
    go(sphereView({ azimuth: 44, dragging: true }), P)
    go(sphereView({ azimuth: 50, dragging: true }), P)
    // one upload for the two dragged frames, and it is the first frame's G-buffer depth, pixel for pixel
    expect(depthUploads()).toHaveLength(1)
    expect(Array.from(depthUploads()[0])).toEqual(Array.from(expected(30)))
    // the release makes a frame of its own, and the next drag warps from that one
    go(sphereView({ azimuth: 50 }), P)
    await done(4)
    go(sphereView({ azimuth: 58, dragging: true }), P)
    expect(depthUploads()).toHaveLength(2)
    expect(Array.from(depthUploads()[1])).toEqual(Array.from(expected(50)))
    expect(Array.from(depthUploads()[1])).not.toEqual(Array.from(depthUploads()[0]))
    engine.dispose()
  })

  it('makes the model\'s frame once on the pointer\'s release, and eases from the re-projected picture to it', async () => {
    const { engine, frames, crossfades, snapshot, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView({ azimuth: 50, dragging: true }), P)
    go(sphereView({ azimuth: 64, dragging: true }), P)
    expect(snapshot.drawImage).toHaveBeenCalledTimes(2) // each re-projected frame was copied in its own task
    expect(crossfades).toEqual([])
    // the release: a full frame at once, with a G-buffer of its own
    go(sphereView({ azimuth: 64 }), P)
    await done(4)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'full'])
    expect(gbuffers()).toBe(2)
    expect(crossfades).toEqual([3]) // eased once, as the fourth frame was painted (three had been reported)
    // and the picture after it is a still one: nothing else is queued
    await new Promise((r) => setTimeout(r, 250))
    expect(frames.length).toBe(4)
    engine.dispose()
  })

  it('does not run the model while the pointer is down, however long it is held: the picture is the re-projected one until the release', async () => {
    const { engine, frames, crossfades, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView({ azimuth: 50, dragging: true }), P)
    // held still, well past the time the model would be asked for after a wheel move
    await new Promise((r) => setTimeout(r, 400))
    expect(kinds(frames)).toEqual(['full', 'reproject'])
    expect(gbuffers()).toBe(1)
    go(sphereView({ azimuth: 54, dragging: true }), P)
    await new Promise((r) => setTimeout(r, 400))
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject'])
    expect(crossfades).toEqual([])
    // the release is what asks for it
    go(sphereView({ azimuth: 54 }), P)
    await done(4)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'full'])
    expect(gbuffers()).toBe(2)
    engine.dispose()
  })

  it('does not ease when nothing was re-projected (a slider\'s full frame replaces a picture that was the model\'s)', async () => {
    const { engine, frames, crossfades, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView(), setParam(P, 'light.azimuth', 40))
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'full'])
    expect(crossfades).toEqual([])
    engine.dispose()
  })

  it('re-projects a move that is not a drag (the wheel, a key, an eased step) and runs the model once it has stopped', async () => {
    const { engine, frames, crossfades, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    // three moves of the wheel in quick succession: three re-projections, and one model frame after the last
    go(sphereView({ zoom: 210 }), P)
    go(sphereView({ zoom: 222 }), P)
    go(sphereView({ zoom: 235 }), P)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject'])
    expect(gbuffers()).toBe(1)
    await done(5)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject', 'full'])
    expect(gbuffers()).toBe(2)
    expect(crossfades).toEqual([4])
    // the model's frame is for the view it stopped at: still, so nothing follows
    await new Promise((r) => setTimeout(r, 300))
    expect(frames.length).toBe(5)
    engine.dispose()
  })

  it('does not paint a model frame as it was made for a view the camera has left: it becomes the base, and the picture is its strokes re-projected into the view the camera has now', async () => {
    vi.useFakeTimers()
    try {
      // (no easing: the picture is the new base's strokes alone, so what is painted is what the test reads)
      const { engine, frames, painted, go } = withPicture({ reducedMotion: () => true })
      go(sphereView(), P)
      await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
      // a wheel move: re-projected at once, and the model's frame is due in 120 ms
      go(sphereView({ zoom: 230 }), P)
      expect(kinds(frames)).toEqual(['full', 'reproject'])
      // the model's frame starts (its G-buffer is read now) ... and the camera moves again before its answer is taken
      vi.advanceTimersByTime(130)
      go(sphereView({ azimuth: 60, dragging: true }), P)
      expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject'])
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(5)
      // the model's frame (for zoom 230) was made for a view the camera has left: it becomes the base at once, but under a drag
      // it is not painted in the task it came in: nothing is painted, and no request is asked for
      expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject'])
      expect(painted.map((p) => p.kind)).toEqual(['full', 'reproject', 'reproject'])
      // the next animation frame paints it: the picture is its strokes in the view the camera has now (one more picture, adopted)
      go(sphereView({ azimuth: 66, dragging: true }), P)
      expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject'])
      expect(frames[3].adopted).toBe(true)
      // the strokes of the one it replaced were another frame's: these are the adopted frame's
      const adopted = painted[3].frame.strokes
      expect(adopted.colour).not.toBe(painted[0].frame.strokes.colour)
      // and they are the ones the next re-projection starts from
      go(sphereView({ azimuth: 72, dragging: true }), P)
      expect(painted[painted.length - 1].frame.strokes.colour).toBe(adopted.colour)
      expect(frames[4].adopted).toBeUndefined()
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the camera dragged after something else changed', () => {
  // a stroke size: the model's analysis (not a colour, not a renderer-only parameter)
  const WIDER = setParam(P, 'roles.block.width', 30)

  it('keeps re-projecting while the pointer is down after a slider moved, brings the slider in as a base, and runs the model once, at the release', async () => {
    const { engine, frames, gbuffers, go, done } = withPicture({ reducedMotion: () => true })
    go(sphereView(), P)
    await done(1)
    go(sphereView(), WIDER) // the slider: a frame for it starts (in a worker it takes 100 to 300 ms) ...
    for (let k = 1; k <= 4; k++) go(sphereView({ azimuth: 30 + 5 * k, dragging: true }), WIDER) // ... and the user starts orbiting
    // each move is shown at once, from the strokes the engine holds: no wait for the model, no G-buffer of a drag
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject', 'reproject'])
    await new Promise((r) => setTimeout(r, 100))
    // (the slider's own frame is for a view the camera has left: it becomes the base and the picture is made of it, once)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject', 'reproject', 'reproject'])
    expect(frames[5].adopted).toBe(true)
    go(sphereView({ azimuth: 55, dragging: true }), WIDER)
    expect(kinds(frames).slice(-1)).toEqual(['reproject'])
    // the release: the model's frame for the view it stopped at, once
    go(sphereView({ azimuth: 55 }), WIDER)
    await done(8)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'reproject', 'reproject', 'reproject', 'reproject', 'full'])
    expect(gbuffers()).toBe(3) // the first frame, the slider's (adopted), the release
    engine.dispose()
  })

  it('still asks for the model on a move that is not a drag when a slider moved (the wheel, a key, an eased step)', async () => {
    const { engine, frames, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView({ zoom: 230 }), WIDER)
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'full'])
    engine.dispose()
  })

  it('does not re-project strokes onto a figure the renderer was not given: its depth pass is of the other figure', async () => {
    const { engine, frames, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    // another figure is asked for (the renderer is given it), and the lab goes back before its frame has landed
    engine.setScene(OTHER, COLOURS)
    go(sphereView({ azimuth: 40 }), P)
    engine.setScene(SCENE, COLOURS)
    go(sphereView({ azimuth: 50, dragging: true }), P)
    expect(kinds(frames)).toEqual(['full'])
    await done(2)
    await new Promise((r) => setTimeout(r, 50))
    expect(kinds(frames)).not.toContain('reproject')
    engine.dispose()
  })
})

describe('a still picture', () => {
  it('is made once and painted again, not recomputed: nothing runs, nothing is queued, and a repeat request is the same strokes', async () => {
    const { engine, frames, painted, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView(), P)
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'repaint'])
    expect(painted[1].frame.strokes).toBe(painted[0].frame.strokes)
    expect(gbuffers()).toBe(1)
    await new Promise((r) => setTimeout(r, 400))
    expect(frames.length).toBe(2) // no timer, no periodic frame
    engine.dispose()
  })

  it('is the same strokes after an orbit away and back to the view it was made for: it is painted again, not made again', async () => {
    const { engine, frames, painted, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView({ azimuth: 70, dragging: true }), P)
    go(sphereView({ azimuth: 100, dragging: true }), P)
    go(sphereView({ azimuth: 30, dragging: true }), P)
    go(sphereView({ azimuth: 30 }), P)
    await done(5)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject', 'repaint', 'repaint'])
    expect(gbuffers()).toBe(1)
    sameStrokes(painted[painted.length - 1].frame.strokes, painted[0].frame.strokes)
    engine.dispose()
  })

  it('is byte-identical when the model makes it again: the same view and parameters, after a slider and back', async () => {
    const { engine, frames, painted, gbuffers, go, done } = withPicture()
    go(sphereView(), P)
    await done(1)
    go(sphereView({ lightAzimuth: 40 }), setParam(P, 'light.azimuth', 40))
    await done(2)
    go(sphereView(), P)
    await done(3)
    expect(kinds(frames)).toEqual(['full', 'full', 'full'])
    expect(gbuffers()).toBe(3)
    const a = painted[0].frame
    const b = painted[2].frame
    expect(b.strokes).not.toBe(a.strokes) // a frame of its own ...
    expect(a.strokes.count).toBeGreaterThan(100)
    sameStrokes(b.strokes, a.strokes) // ... and the same one, to the last byte
    expect(Array.from(b.debug.edgeSegments)).toEqual(Array.from(a.debug.edgeSegments))
    // and the one in between was a different frame (the check above would pass for a model that ignored the light)
    expect(Array.from(painted[1].frame.strokes.colour)).not.toEqual(Array.from(a.strokes.colour))
    engine.dispose()
  })
})

describe('the graphics context', () => {
  it('shows a lost context, and paints the picture again by itself when it comes back', async () => {
    const { engine, gl, frames, errors, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    gl.canvas.lose()
    expect(String(errors[errors.length - 1])).toMatch(/graphics context was lost/)
    gl.canvas.restore()
    await done(2)
    // the strokes are the engine's own: no G-buffer, no model
    expect(frames[1].kind).toBe('repaint')
    expect(gbuffers()).toBe(1)
    expect(errors[errors.length - 1]).toBeNull()
    engine.dispose()
  })
})

describe('the graphics context after the picture was settled', () => {
  const composites = (gl: ReturnType<typeof setup>['gl']) => timeline(gl).filter((e) => e.kind === 'composite').length

  it('paints the picture again when the context comes back after a wheel step: [full, reproject, full], lost, restored, and a fresh composite', async () => {
    const { engine, gl, frames, errors, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    // a wheel step: re-projected at once, and the model's frame for the view it stopped at after the settle delay
    engine.render(view({ zoom: 110 }), P, 'none')
    await done(3)
    expect(kinds(frames)).toEqual(['full', 'reproject', 'full'])
    const before = composites(gl)
    gl.canvas.lose()
    gl.canvas.restore()
    // (the settled request is the one on screen: a restore that kept the older request skipped it as already shown, and the canvas stayed blank)
    await done(4)
    expect(frames[3].kind).toBe('repaint')
    expect(composites(gl)).toBe(before + 1)
    expect(gbuffers()).toBe(2) // from the strokes the engine holds: no new G-buffer and no model
    expect(errors[errors.length - 1]).toBeNull()
    engine.dispose()
  })

  it('does not stay silent on a context that comes back after an error: the renderer and the engine both start again', async () => {
    let failing = true
    const gl = createPaintFakeGl({ failCompile: (source) => failing && source.includes('// paint: stroke') }, { width: 320, height: 240 })
    Object.assign(gl.canvas.canvas, { style: {} })
    const frames: FrameStats[] = []
    const errors: (string | null)[] = []
    const engine = createPaintEngine(gl.canvas.canvas, { onFrame: (s) => frames.push(s), onError: (m) => errors.push(m) })
    engine.setScene(SCENE, COLOURS)
    engine.render(view(), P, 'none')
    await vi.waitFor(() => expect(errors.some((m) => m && /compile/.test(m))).toBe(true), { timeout: 60_000, interval: 5 })
    expect(frames.length).toBe(0)
    // the shader compiles on the new context
    failing = false
    gl.canvas.lose()
    gl.canvas.restore()
    await vi.waitFor(() => expect(frames.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(errors[errors.length - 1]).toBeNull()
    expect(composites(gl)).toBeGreaterThan(0)
    engine.dispose()
  })
})

describe('a tile of the Showcase', () => {
  const target = () => {
    const calls: string[] = []
    return {
      calls,
      context: { canvas: { width: 80, height: 60 }, drawImage: vi.fn(() => calls.push('drawImage')) } as unknown as CanvasRenderingContext2D,
    }
  }

  it('is painted and then copied, in the order asked, each scene set before its own tile', async () => {
    const { engine, gl } = setup()
    const a = target()
    const b = target()
    engine.setScene(SCENE, COLOURS)
    const first = engine.renderTo(a.context, view(), P, 'none')
    engine.setScene(OTHER, COLOURS)
    const second = engine.renderTo(b.context, view(), P, 'none')
    const stats = await Promise.all([first, second])
    expect(stats[0].kind).toBe('full')
    expect(a.context.drawImage).toHaveBeenCalledTimes(1)
    expect(b.context.drawImage).toHaveBeenCalledTimes(1)
    // the copy is of the canvas the engine painted, scaled to the tile
    expect(vi.mocked(a.context.drawImage).mock.calls[0].slice(1, 5)).toEqual([0, 0, 80, 60])
    // each tile's composite came before its own copy (two composites, in order)
    expect(timeline(gl).filter((e) => e.kind === 'composite')).toHaveLength(2)
    engine.dispose()
  })

  it('does not rebuild a scene it has seen: alternating between two scenes costs the model no particles', async () => {
    const { engine } = setup()
    const t = target()
    const run = async (scene: typeof SCENE) => {
      engine.setScene(scene, COLOURS)
      return engine.renderTo(t.context, view(), P, 'none')
    }
    const first = await run(SCENE)
    await run(OTHER)
    const again = await run(SCENE)
    expect(first.particlesMs).toBeGreaterThan(0)
    expect(again.particlesMs).toBe(0)
    engine.dispose()
  })

  it('is no base for the lab’s own frames: a tile that runs between a view’s request and its answer does not make the answer stale', async () => {
    const { engine, frames } = setup()
    const t = target()
    engine.render(view({ azimuth: 10 }), P, 'none') // the model starts a frame for it ...
    engine.render(view({ azimuth: 20 }), P, 'none') // ... and the next view waits behind it
    const tile = engine.renderTo(t.context, view(), P, 'none') // a tile, made after both, goes first
    await tile
    // the first answer is shown re-projected into the newer view (the camera moved on while it ran); the second is the view's own,
    // painted after the tile and not dropped as older than it
    await vi.waitFor(() => expect(kinds(frames)).toEqual(['reproject', 'full']), { timeout: 10_000, interval: 10 })
    engine.dispose()
  })

  it('is refused, not hung, when the engine is disposed before its turn', async () => {
    const { engine } = setup()
    const t = target()
    const a = engine.renderTo(t.context, view(), P, 'none')
    const b = engine.renderTo(t.context, view(), P, 'none')
    engine.dispose()
    await expect(b).rejects.toThrow(/disposed/)
    void a.catch(() => {})
  })
})

describe('where the model runs', () => {
  it('falls back to this thread when the Worker cannot run, and still paints', async () => {
    class BrokenWorker {
      onmessage: unknown = null
      onerror: ((e: { message: string }) => void) | null = null
      constructor() {
        queueMicrotask(() => setTimeout(() => this.onerror?.({ message: 'no module workers here' }), 0))
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await load('?')
    const { engine, frames, errors, done } = setup()
    engine.render(view(), P, 'none')
    // the worker never answers and then reports its failure: the engine moves the model to this thread,
    // and the frame that was waiting for the worker is made there
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled(), { timeout: 10_000 })
    await done(1)
    expect(frames[0].kind).toBe('full')
    // and the next frame is made there too
    engine.render(view({ azimuth: 50 }), P, 'none')
    await done(2)
    expect(errors.filter((m) => m !== null)).toEqual([])
    engine.dispose()
    await load('?worker=0')
  })
})

// ---- the model keeps painting while the camera drags ----

// A model that is slow: a frame is asked for, and answered when the test says so (finish), by the real session. Like the
// Worker it is off this thread (so the engine runs the model under a drag), and the engine hands it one request at a time.
class SlowHost implements ModelHost {
  readonly background = true
  readonly requests: SessionRequest[] = []
  readonly responses: FrameResponse[] = []
  maxRunning = 0
  private running = 0
  private readonly waiting: (() => void)[] = []
  private readonly session = new PaintSession()
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData) {
    this.session.setScene(sceneId, scene, colours)
  }
  setColours(sceneId: number, colours: SceneColourData) {
    this.session.setColours(sceneId, colours)
  }
  frame(request: SessionRequest): Promise<SessionResponse> {
    this.requests.push(request)
    this.maxRunning = Math.max(this.maxRunning, ++this.running)
    // The answer is made when the request arrives, from what the model holds at that moment (as a worker does: the figure's
    // colours the lab sets afterwards are not in it), and handed back when the test says the model is done.
    const response = this.session.frame(request)
    if (response.ok && response.kind !== 'paper') this.responses.push(response)
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.running--
        resolve(response)
      })
    })
  }
  // The model finishes the request it is working on (the engine takes the answer when the test next waits).
  finish(): void {
    this.waiting.shift()?.()
  }
  dispose() {}
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('the model keeps painting while the camera drags', () => {
  // N frames of a drag, 3 degrees each, with the model finishing what it is doing after every `every`-th.
  it.each([
    [24, 6, 4],
    [30, 5, 6],
    [12, 4, 3],
  ])('%i frames, the model finishing every %i-th: %i of its frames are adopted as the base, each made for the newest view, one at a time, and no frame waits for it', async (n, every, adopted) => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, frames, painted, crossfades, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    go(sphereView(), P)
    host.finish()
    await done(1)
    const turned: number[] = []
    for (let k = 1; k <= n + 1; k++) {
      clock.t += 16
      const before = frames.length
      go(sphereView({ azimuth: 30 + 3 * k, dragging: true }), P)
      // the picture is on screen as the call returns: it does not wait for the model
      expect(frames.length).toBe(before + 1)
      expect(frames[frames.length - 1].kind).toBe('reproject')
      if (k % every === 0 && k <= n) {
        // the model answers: the answer is adopted, but in its own task nothing is painted and no request is asked for
        const paintedThen = painted.length
        const requestsThen = host.requests.length
        host.finish()
        await flush()
        expect(painted.length).toBe(paintedThen)
        expect(host.requests.length).toBe(requestsThen)
        turned.push(30 + 3 * (k + 1)) // the next animation frame's render() paints from it and asks for the next request
      }
    }
    // each adoption's picture is the next frame's, reported with it
    expect(frames.filter((f) => f.adopted)).toHaveLength(adopted)
    // the model never ran two frames at once, and never a frame for a view that was not the newest when it started:
    // the first drag frame's, then each the model took up after finishing one (the newest view, at the next frame)
    expect(host.maxRunning).toBe(1)
    const live = host.requests.slice(1)
    const askedFor = [33, ...turned.slice(0, adopted)]
    expect(live.length).toBe(askedFor.length)
    live.forEach((r, i) => {
      expect(r.view.dragging).toBe(true)
      expect(r.kind).toBe('full')
      expect(Array.from(r.view.viewProj)).toEqual(Array.from(sphereView({ azimuth: askedFor[i], dragging: true }).viewProj))
      // the particles are the ones a still view has: only the analysis is coarser (a view that drags, in the model)
      expect(r.params.particles).toEqual(P.particles)
    })
    expect(live.length).toBeLessThanOrEqual(n / 2 + 1) // the views in between were skipped for the newest
    expect(crossfades).toEqual([]) // an adopted frame is a re-projected picture, not one that eases from the snapshot
    engine.dispose()
  })

  it('runs the model once more at the release, at full quality, for the view it stopped at, and its picture is the one a still view gets', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const a = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    a.go(sphereView(), P)
    host.finish()
    await a.done(1)
    for (let k = 1; k <= 12; k++) {
      clock.t += 16
      a.go(sphereView({ azimuth: 30 + 3 * k, dragging: true }), P)
      if (k % 4 === 0) {
        host.finish()
        await flush()
      }
    }
    // the pointer stays at azimuth 66 for another frame, which asks for the model's frame for that view, and the model finishes
    // it: it is the base on screen (and the picture is made of it at once, for a camera that has paused)
    a.go(sphereView({ azimuth: 66, dragging: true }), P)
    host.finish()
    await flush()
    const before = host.requests.length
    a.go(sphereView({ azimuth: 66 }), P) // the pointer is released there
    // that base is for that very view, but it was made as a drag's is (a coarser analysis): the release makes its own frame
    expect(host.requests.length).toBe(before + 1)
    host.finish()
    await vi.waitFor(() => expect(a.painted.filter((p) => p.kind === 'full').length).toBeGreaterThanOrEqual(2), { timeout: 60_000, interval: 5 })
    const last = host.requests[host.requests.length - 1]
    expect(last.view.dragging).toBe(false) // full quality: the analysis of a still view
    expect(host.requests.filter((r) => !r.view.dragging)).toHaveLength(2) // the first frame's, and the release's: once
    expect(a.crossfades).toHaveLength(1) // and it eases from the re-projected picture, as before
    const released = a.painted.filter((p) => p.kind === 'full')[1].frame.strokes
    // a fresh engine that was never dragged makes the same frame of that view, to the last byte
    const b = withPicture()
    b.go(sphereView({ azimuth: 66 }), P)
    await b.done(1)
    sameStrokes(released, b.painted[0].frame.strokes)
    a.engine.dispose()
    b.engine.dispose()
  })

  it('eases in a frame made for the view the camera is at, when the pointer has stopped: a re-projected picture, not a repaint over a snapshot', async () => {
    const host = new SlowHost()
    const { engine, frames, crossfades, go, done } = withPicture({ host, reducedMotion: () => true })
    go(sphereView(), P)
    host.finish()
    await done(1)
    go(sphereView({ azimuth: 40, dragging: true }), P) // the model starts a frame for az 40, and the pointer stays there
    host.finish()
    await flush()
    expect(frames[frames.length - 1].adopted).toBe(true)
    expect(frames[frames.length - 1].kind).toBe('reproject')
    expect(crossfades).toEqual([]) // no picture laid over the picture
    engine.dispose()
  })

  it('does not adopt a frame that was made before the figure’s colours changed', async () => {
    const host = new SlowHost()
    const { engine, frames, go, done } = withPicture({ host, reducedMotion: () => true })
    go(sphereView(), P)
    host.finish()
    await done(1)
    go(sphereView({ azimuth: 40, dragging: true }), P) // the model starts a frame for it, and makes it from the figure's colours ...
    expect(host.responses.length).toBe(2)
    engine.setScene(SCENE, flatColours({ 0: [0.4, 0.1, -0.1], 1: [0.9, 0.01, 0.02] })) // ... and the theme changes before it is back
    host.finish()
    await flush()
    expect(frames.some((f) => f.adopted)).toBe(false)
    expect(kinds(frames)).toEqual(['full', 'reproject'])
    engine.dispose()
  })

  it('eases a new base in over 120 ms: the strokes both frames have stay, the ones that appeared fade in, the ones that went fade out', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => false })
    const v0 = sphereView()
    go(v0, P)
    host.finish()
    await done(1)
    const first = host.responses[0].strokes
    clock.t = 1000
    go(sphereView({ azimuth: 40, dragging: true }), P) // the camera leaves the first frame's view at t = 1000; the model starts a frame for az 40
    clock.t = 1016
    const v70 = sphereView({ azimuth: 70, dragging: true })
    go(v70, P) // and leaves az 40 at t = 1016
    clock.t = 1100
    host.finish() // the model's frame for az 40 is adopted at t = 1100
    await flush()
    go(v70, P) // and the next animation frame paints it
    const next = host.responses[1].strokes
    const askedView = host.requests[1].view
    // the strokes each base shows in this view: the first's has been leaving its view for 100 ms, the second's for 84 (edges only)
    const oldShown = (t: number) => reprojectStrokes(first, v0, v70, P, edgeFade(t - 1000))
    const newShown = (t: number) => reprojectStrokes(next, askedView, v70, P, edgeFade(t - 1016))
    const key = (b: StrokeBatch, i: number) => `${b.role[i]}/${b.seed[i]}`
    const index = (b: StrokeBatch) => {
      const m = new Map<string, number[]>()
      for (let i = 0; i < b.count; i++) m.set(key(b, i), [...(m.get(key(b, i)) ?? []), i])
      return m
    }
    const edge = ROLES.indexOf('edge')
    const inOld = index(first)
    const inNew = index(next)
    const appeared = [...inNew].filter(([k, v]) => v.length === 1 && !inOld.has(k) && next.role[v[0]] !== edge)
    const went = [...inOld].filter(([k, v]) => v.length === 1 && !inNew.has(k) && first.role[v[0]] !== edge)
    expect(appeared.length).toBeGreaterThan(20) // the form turned into view: there are strokes the first frame did not have
    expect(went.length).toBeGreaterThan(5) // and some it had that are gone
    const shown = () => painted[painted.length - 1].frame.strokes
    const alphaOf = (b: StrokeBatch, k: string): number => {
      const at = index(b).get(k)
      expect(at, k).toHaveLength(1)
      return b.alpha[(at as number[])[0]]
    }

    // adopted: the picture is still the old base's: the new strokes not yet in, the old ones all there
    let s = shown()
    expect(painted[painted.length - 1].kind).toBe('reproject')
    for (const [k] of appeared.slice(0, 40)) expect(alphaOf(s, k), `appeared ${k}`).toBe(0)
    for (const [k, v] of went.slice(0, 40)) expect(alphaOf(s, k), `went ${k}`).toBeCloseTo(oldShown(1100).alpha[v[0]], 6)
    // every stroke of either frame is there: the new base's, and the old base's that no new one continues
    expect(s.count).toBeGreaterThan(next.count)
    expect(s.count).toBeLessThanOrEqual(next.count + first.count)

    // 60 ms on, half way: the ones that appeared are half there, the ones that went are half gone
    clock.t = 1160
    go(v70, P)
    s = shown()
    for (const [k, v] of appeared.slice(0, 40)) expect(alphaOf(s, k), `appeared ${k}`).toBeCloseTo(0.5 * newShown(1160).alpha[v[0]], 6)
    for (const [k, v] of went.slice(0, 40)) expect(alphaOf(s, k), `went ${k}`).toBeCloseTo(0.5 * oldShown(1160).alpha[v[0]], 6)

    // and nothing is squeezed on the way: a stroke the two bases share keeps its length at mid-fade (the ones that run the other
    // way are eased in their own order, not point to opposite point, which would draw them to a point)
    const lengthOf = (b: StrokeBatch, j: number) => {
      let l = 0
      for (let k = 1; k < PATH_POINTS; k++) l += Math.hypot(b.path[2 * PATH_POINTS * j + 2 * k] - b.path[2 * PATH_POINTS * j + 2 * k - 2], b.path[2 * PATH_POINTS * j + 2 * k + 1] - b.path[2 * PATH_POINTS * j + 2 * k - 1])
      return l
    }
    const shared = matchStrokes(first, next)
    const oldNow = oldShown(1160)
    const newNow = newShown(1160)
    let checked = 0
    let squeezed = 0
    for (let j = 0; j < next.count; j++) {
      const i = shared.pair[j]
      if (i < 0 || next.role[j] === edge) continue
      const shortest = Math.min(lengthOf(oldNow, i), lengthOf(newNow, j))
      if (shortest < 2) continue
      checked++
      if (lengthOf(s, j) < 0.8 * shortest) squeezed++
    }
    expect(checked).toBeGreaterThan(50)
    expect(squeezed).toBe(0)

    // 120 ms on: the new base's strokes, and nothing of the old one
    clock.t = 1220
    go(v70, P)
    s = shown()
    expect(s.count).toBe(next.count)
    const expected = newShown(1220)
    expect(Array.from(s.alpha)).toEqual(Array.from(expected.alpha))
    expect(Array.from(s.path)).toEqual(Array.from(expected.path))
    expect(s.colour).toBe(next.colour) // the base's own arrays again
    engine.dispose()
  })

  it('shows the new base at once under reduced motion: no old strokes, none faded in', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    const v0 = sphereView()
    go(v0, P)
    host.finish()
    await done(1)
    clock.t = 1000
    go(sphereView({ azimuth: 40, dragging: true }), P)
    const v70 = sphereView({ azimuth: 70, dragging: true })
    clock.t = 1016
    go(v70, P)
    clock.t = 1100
    host.finish()
    await flush()
    go(v70, P)
    const next = host.responses[1].strokes
    const s = painted[painted.length - 1].frame.strokes
    const expected = reprojectStrokes(next, host.requests[1].view, v70, P, edgeFade(84))
    expect(s.count).toBe(next.count)
    expect(Array.from(s.alpha)).toEqual(Array.from(expected.alpha))
    expect(Math.max(...Array.from(s.alpha))).toBeGreaterThan(0.5)
    engine.dispose()
  })
})

describe('the edges of a base that the camera has left', () => {
  it('fade out with its age, over 200 ms from when the camera left its view: none of an outline is left inside a form', async () => {
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ now: () => clock.t })
    const v0 = sphereView()
    go(v0, P)
    await done(1)
    const first = painted[0].frame.strokes
    const v1 = sphereView({ azimuth: 34, dragging: true })
    const plain = reprojectStrokes(first, v0, v1, P) // the base's strokes in the new view, with every edge as it was
    const edge = ROLES.indexOf('edge')
    const edges = Array.from({ length: first.count }, (_, i) => i).filter((i) => first.role[i] === edge && plain.alpha[i] > 0.2)
    expect(edges.length).toBeGreaterThan(5)
    const shownAt = (t: number) => {
      clock.t = t
      go(v1, P)
      return painted[painted.length - 1].frame.strokes
    }
    // the camera leaves the view at t = 5000
    const at0 = shownAt(5000)
    for (const i of edges) expect(at0.alpha[i]).toBeCloseTo(plain.alpha[i], 6)
    const at100 = shownAt(5100)
    for (const i of edges) expect(at100.alpha[i]).toBeCloseTo(0.5 * plain.alpha[i], 6)
    const at150 = shownAt(5150)
    for (const i of edges) expect(at150.alpha[i]).toBeCloseTo(0.25 * plain.alpha[i], 6)
    for (const t of [5200, 5201, 9000]) {
      const old = shownAt(t)
      for (let i = 0; i < first.count; i++) if (first.role[i] === edge) expect(old.alpha[i], `edge ${i} at ${t}`).toBe(0)
      // the rest of the picture is the strokes as they were
      for (let i = 0; i < first.count; i++) if (first.role[i] !== edge) expect(old.alpha[i]).toBe(plain.alpha[i])
    }
    engine.dispose()
  })
})

describe('the edges of a base age when the view turns, not when it zooms or pans', () => {
  it('stay as they were under a zoom or a pan, however long, and age from the moment the view turns', async () => {
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ now: () => clock.t })
    const v0 = sphereView()
    go(v0, P)
    await done(1)
    const first = painted[0].frame.strokes
    const edge = ROLES.indexOf('edge')
    const zoomed = sphereView({ zoom: 260, dragging: true })
    const panned = sphereView({ zoom: 260, target: [0.1, 0, 0.05], dragging: true })
    const turnedView = sphereView({ azimuth: 34, dragging: true })
    const edges = Array.from({ length: first.count }, (_, i) => i).filter((i) => first.role[i] === edge)
    const shownAt = (t: number, v: PaintView) => {
      clock.t = t
      go(v, P)
      return painted[painted.length - 1].frame.strokes
    }
    for (const v of [zoomed, panned]) {
      const plain = reprojectStrokes(first, v0, v, P)
      expect(edges.some((i) => plain.alpha[i] > 0.2)).toBe(true)
      for (const t of [5000, 5100, 5250, 9000]) {
        const shown = shownAt(t, v)
        for (const i of edges) expect(shown.alpha[i], `edge ${i} at ${t}`).toBe(plain.alpha[i])
      }
    }
    // the view turns at t = 10000: from then on they age as they always did
    const plain = reprojectStrokes(first, v0, turnedView, P)
    const strong = edges.filter((i) => plain.alpha[i] > 0.2)
    for (const i of strong) expect(shownAt(10000, turnedView).alpha[i]).toBeCloseTo(plain.alpha[i], 6)
    for (const i of strong) expect(shownAt(10100, turnedView).alpha[i]).toBeCloseTo(0.5 * plain.alpha[i], 6)
    for (const i of strong) expect(shownAt(10200, turnedView).alpha[i]).toBe(0)
    engine.dispose()
  })
})

describe('a frame that lands after a zoom or a pan of the camera', () => {
  it('has its edges whole: the camera never turned from the view it was made for', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    const v0 = sphereView()
    go(v0, P)
    host.finish()
    await done(1)
    const WIDER = setParam(P, 'roles.block.width', 30)
    go(v0, WIDER) // a slider: the model's frame for it starts
    clock.t = 1000
    const zoomed = sphereView({ zoom: 260, dragging: true })
    go(zoomed, WIDER) // and the camera is zoomed (it looks the same way)
    clock.t = 1150
    host.finish()
    await flush() // the slider's frame lands
    const slider = host.responses[1].strokes
    const plain = reprojectStrokes(slider, host.requests[1].view, zoomed, P, 1)
    const edge = ROLES.indexOf('edge')
    const edges = Array.from({ length: slider.count }, (_, i) => i).filter((i) => slider.role[i] === edge && plain.alpha[i] > 0.2)
    expect(edges.length).toBeGreaterThan(5)
    // at the landing, and a long while after: nothing aged them
    for (const t of [1150, 1250, 4000]) {
      clock.t = t
      go(zoomed, WIDER)
      const shown = painted[painted.length - 1].frame.strokes
      for (const i of edges) expect(shown.alpha[i], `edge ${i} at ${t}`).toBeCloseTo(plain.alpha[i], 6)
    }
    engine.dispose()
  })

  it('ages them from the turn, not from a zoom that came before it', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    const v0 = sphereView()
    go(v0, P)
    host.finish()
    await done(1)
    const WIDER = setParam(P, 'roles.block.width', 30)
    go(v0, WIDER) // a slider: the model's frame for it starts
    clock.t = 1000
    go(sphereView({ zoom: 260, dragging: true }), WIDER) // the camera zooms at t = 1000 ...
    clock.t = 1100
    const turnedView = sphereView({ azimuth: 36, zoom: 260, dragging: true })
    go(turnedView, WIDER) // ... and turns at t = 1100
    clock.t = 1250
    host.finish()
    await flush() // the frame lands 150 ms after the turn (250 after the zoom)
    go(turnedView, WIDER)
    const slider = host.responses[1].strokes
    const plain = reprojectStrokes(slider, host.requests[1].view, turnedView, P, 1)
    const edge = ROLES.indexOf('edge')
    const edges = Array.from({ length: slider.count }, (_, i) => i).filter((i) => slider.role[i] === edge && plain.alpha[i] > 0.2)
    expect(edges.length).toBeGreaterThan(5)
    const shown = painted[painted.length - 1].frame.strokes
    for (const i of edges) expect(shown.alpha[i]).toBeCloseTo(0.25 * plain.alpha[i], 6) // edgeFade(150), not edgeFade(250) = 0
    engine.dispose()
  })
})

describe('the edges of a frame that lands after the camera has moved on', () => {
  // The release asks for a full frame; the pointer grabs the camera again and drags it on before the frame lands. Its edges
  // are the outline of the view the camera left when it was grabbed, not of the moment the frame lands.
  it('are aged from the move: a release that is grabbed again, its frame landing 180 ms after the camera left its view', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    go(sphereView(), P)
    host.finish()
    await done(1)
    clock.t = 100
    go(sphereView({ azimuth: 40, dragging: true }), P)
    host.finish()
    await flush() // a model frame for azimuth 40, adopted
    clock.t = 200
    go(sphereView({ azimuth: 40 }), P) // the pointer is released at azimuth 40: the model's full frame is asked for
    clock.t = 1000
    const v52 = sphereView({ azimuth: 52, dragging: true })
    go(v52, P) // grabbed again and dragged on: the camera leaves azimuth 40 at t = 1000
    clock.t = 1180
    host.finish()
    await flush() // the release's frame lands, 180 ms after the camera left its view
    go(v52, P)
    const release = host.responses[2].strokes
    expect(host.requests[2].view.dragging).toBe(false)
    const plain = reprojectStrokes(release, host.requests[2].view, v52, P, 1)
    const shown = painted[painted.length - 1].frame.strokes
    const edge = ROLES.indexOf('edge')
    const edges = Array.from({ length: release.count }, (_, i) => i).filter((i) => release.role[i] === edge && plain.alpha[i] > 0.2)
    expect(edges.length).toBeGreaterThan(5)
    // edgeFade(180) = 0.1 of its alpha is left; from the landing it would have been all of it
    for (const i of edges) expect(shown.alpha[i]).toBeCloseTo(0.1 * plain.alpha[i], 6)
    for (let i = 0; i < release.count; i++) if (release.role[i] !== edge) expect(shown.alpha[i]).toBe(plain.alpha[i])
    engine.dispose()
  })

  it('are aged from the move for a slider’s frame too, not only a drag’s', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true })
    go(sphereView(), P)
    host.finish()
    await done(1)
    go(sphereView(), setParam(P, 'roles.block.width', 30)) // a slider: the model's frame for it starts
    clock.t = 1000
    const v40 = sphereView({ azimuth: 40, dragging: true })
    go(v40, setParam(P, 'roles.block.width', 30)) // the camera leaves its view at t = 1000
    clock.t = 1150
    host.finish()
    await flush() // the slider's frame lands 150 ms later
    go(v40, setParam(P, 'roles.block.width', 30))
    const slider = host.responses[1].strokes
    const plain = reprojectStrokes(slider, host.requests[1].view, v40, P, 1)
    const shown = painted[painted.length - 1].frame.strokes
    const edge = ROLES.indexOf('edge')
    const edges = Array.from({ length: slider.count }, (_, i) => i).filter((i) => slider.role[i] === edge && plain.alpha[i] > 0.2)
    expect(edges.length).toBeGreaterThan(5)
    for (const i of edges) expect(shown.alpha[i]).toBeCloseTo(0.25 * plain.alpha[i], 6) // edgeFade(150)
    engine.dispose()
  })
})

describe('the crossfade of a camera that has stopped', () => {
  it('goes on by itself to the end: a new base is eased in with no further request for a frame', async () => {
    vi.useFakeTimers()
    try {
      const host = new SlowHost()
      const clock = { t: 0 }
      const { engine, painted, frames, go } = withPicture({ host, now: () => clock.t, reducedMotion: () => false })
      go(sphereView(), P)
      host.finish()
      await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
      clock.t = 1000
      go(sphereView({ azimuth: 40, dragging: true }), P)
      const v70 = sphereView({ azimuth: 70, dragging: true })
      clock.t = 1016
      go(v70, P) // the pointer stops here: nothing asks for a frame from now on
      clock.t = 1100
      host.finish()
      await vi.advanceTimersByTimeAsync(0)
      const next = host.responses[1].strokes
      const seen = () => painted[painted.length - 1].frame.strokes
      // adopted, and not painted in its own task: the pointer has stopped, so no render() comes; the tick paints it
      expect(frames[frames.length - 1].adopted).toBeUndefined()
      clock.t = 1110
      await vi.advanceTimersByTimeAsync(16)
      // easing in, the old strokes still there
      expect(frames[frames.length - 1].adopted).toBe(true)
      expect(seen().count).toBeGreaterThan(next.count)
      const after = painted.length
      // 60 ms on, with no frame asked for: the engine paints the next step itself
      clock.t = 1160
      await vi.advanceTimersByTimeAsync(16)
      expect(painted.length).toBeGreaterThan(after)
      expect(seen().count).toBeGreaterThan(next.count)
      // and at 120 ms the last of it: the new base's strokes alone, after which it paints nothing more
      clock.t = 1230
      await vi.advanceTimersByTimeAsync(16)
      expect(seen().count).toBe(next.count)
      const done = painted.length
      await vi.advanceTimersByTimeAsync(200)
      expect(painted.length).toBe(done)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---- who does what, in which task ----

describe('the work of an adopted frame is not stacked on one task', () => {
  // A drag whose first model request is pending, the camera at azimuth 50 (the request is for 40): `go` takes the clock with it.
  async function dragging(extra: EngineOptions = {}, glLimits: Parameters<typeof createPaintFakeGl>[2] = {}) {
    const host = new SlowHost()
    const clock = { t: 0 }
    const rig = withPicture({ host, now: () => clock.t, reducedMotion: () => true, ...extra }, glLimits)
    rig.go(sphereView(), P)
    if (glLimits.asyncReadback) await vi.waitFor(() => expect(host.requests.length).toBe(1), { timeout: 5000, interval: 2 })
    host.finish()
    await rig.done(1)
    clock.t = 100
    rig.go(sphereView({ azimuth: 40, dragging: true }), P)
    if (glLimits.asyncReadback) await vi.waitFor(() => expect(host.requests.length).toBe(2), { timeout: 5000, interval: 2 })
    clock.t = 116
    rig.go(sphereView({ azimuth: 50, dragging: true }), P)
    return { host, clock, ...rig }
  }

  it('paints nothing and asks for nothing in the task the answer came in; the next animation frame’s render() paints it and asks for the next request', async () => {
    const { host, engine, painted, frames, go } = await dragging()
    const paintedThen = painted.length
    const requestsThen = host.requests.length
    host.finish()
    await flush()
    // adopted, and not painted, and the model is not asked for the next frame either
    expect(painted.length).toBe(paintedThen)
    expect(host.requests.length).toBe(requestsThen)
    expect(frames.some((f) => f.adopted)).toBe(false)
    // the next animation frame: its re-projection is made from the adopted base, and it asks for the model's frame for its view
    go(sphereView({ azimuth: 55, dragging: true }), P)
    expect(painted.length).toBe(paintedThen + 1)
    expect(frames[frames.length - 1].adopted).toBe(true)
    expect(host.requests.length).toBe(requestsThen + 1)
    expect(Array.from(host.requests[requestsThen].view.viewProj)).toEqual(Array.from(sphereView({ azimuth: 55, dragging: true }).viewProj))
    engine.dispose()
  })

  it('paints a pointer that has paused by the tick, and asks for its next request after two frames’ wait: no render() comes for either', async () => {
    vi.useFakeTimers()
    try {
      const { host, clock, engine, painted, frames } = await dragging()
      const paintedThen = painted.length
      const requestsThen = host.requests.length
      clock.t = 120
      host.finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(painted.length).toBe(paintedThen)
      // a frame has just painted (at 116): the tick leaves the picture to the next animation frame ...
      clock.t = 124
      await vi.advanceTimersByTimeAsync(16)
      expect(painted.length).toBe(paintedThen)
      // ... and, none having come by the time a frame's worth has passed, paints it itself
      clock.t = 140
      await vi.advanceTimersByTimeAsync(16)
      expect(painted.length).toBe(paintedThen + 1)
      expect(frames[frames.length - 1].adopted).toBe(true)
      // the request that waited for a render() starts by itself once two frames have passed since the answer
      expect(host.requests.length).toBe(requestsThen)
      clock.t = 170
      await vi.advanceTimersByTimeAsync(16)
      expect(host.requests.length).toBe(requestsThen + 1)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not paint an adopted frame twice: the tick leaves a frame that was painted since to the animation frames of the drag', async () => {
    vi.useFakeTimers()
    try {
      const host = new SlowHost()
      const clock = { t: 0 }
      const { engine, painted, go } = withPicture({ host, now: () => clock.t, reducedMotion: () => false })
      go(sphereView(), P)
      host.finish()
      await vi.waitFor(() => expect(painted.length).toBeGreaterThanOrEqual(1))
      clock.t = 100
      go(sphereView({ azimuth: 40, dragging: true }), P)
      clock.t = 116
      go(sphereView({ azimuth: 50, dragging: true }), P)
      clock.t = 130
      host.finish() // the answer is adopted and a fade begins
      await vi.advanceTimersByTimeAsync(0)
      // the drag's animation frames go on every 16 ms: each paints, and the tick, firing between them, paints none of its own
      const seen = painted.length
      for (let k = 1; k <= 5; k++) {
        clock.t += 16
        go(sphereView({ azimuth: 50 + 2 * k, dragging: true }), P)
        await vi.advanceTimersByTimeAsync(15)
      }
      expect(painted.length).toBe(seen + 5)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('what a fade allocates', () => {
  it('nothing, after its first frame: the re-projections and the blend are made in arrays kept from frame to frame', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, painted, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => false })
    go(sphereView(), P)
    host.finish()
    await done(1)
    clock.t = 100
    go(sphereView({ azimuth: 40, dragging: true }), P)
    clock.t = 116
    const v = (k: number) => sphereView({ azimuth: 50 + k, dragging: true })
    go(v(0), P)
    host.finish()
    await flush() // the model's frame is adopted: a fade begins (the strokes of two bases, 120 ms)
    // watch every array the engine's re-projections and blends are made in: each Scratch counts the arrays it has had to make
    // (the class the engine was loaded with: the module registry is reset for each engine, so it is imported now, not at the top)
    const { Scratch } = await import('../scratch')
    const kept = new Set<ScratchClass>()
    const original = Scratch.prototype.array
    Scratch.prototype.array = function (this: ScratchClass, ...args: Parameters<ScratchClass['array']>) {
      kept.add(this)
      return original.apply(this, args)
    } as ScratchClass['array']
    const made = () => [...kept].reduce((n, scratch) => n + scratch.allocations, 0)
    try {
      clock.t = 120
      go(v(1), P) // the fade's first frame: the arrays are made
      const blended = painted[painted.length - 1].frame.strokes.count
      expect(blended).toBeGreaterThan(host.responses[1].strokes.count) // (the new strokes and the old ones that went: a fade)
      const first = made()
      // the old base's re-projection, the new one's and the blend: path, depth, alpha twice and the blend's own arrays
      expect(kept.size).toBe(3)
      expect(first).toBeGreaterThan(20)
      for (let k = 2; k <= 11; k++) {
        clock.t += 5
        go(v(k), P) // ten more frames of the fade (still inside its 120 ms)
        expect(painted[painted.length - 1].frame.strokes.count).toBe(blended)
      }
      // not one more array
      expect(made()).toBe(first)
    } finally {
      Scratch.prototype.array = original
    }
    engine.dispose()
  })
})

describe('the G-buffer of a request is read without the page waiting', () => {
  it('draws it and goes on: the picture is on screen at once, the request goes out when the fence has passed, and no readPixels fills an array', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, frames, gl, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true }, { asyncReadback: true, fenceDelayPolls: 3 })
    go(sphereView(), P)
    // the first frame's G-buffer is drawn, and read back through a fence the GPU has not passed yet: nothing has gone to the model
    expect(host.requests.length).toBe(0)
    expect(gl.fences.created).toBeGreaterThan(0)
    await vi.waitFor(() => expect(host.requests.length).toBe(1), { timeout: 5000, interval: 2 })
    host.finish()
    await done(1)
    // under a drag: the picture is on screen as the call returns, with the G-buffer still waiting on the GPU
    clock.t = 100
    const before = frames.length
    go(sphereView({ azimuth: 40, dragging: true }), P)
    expect(frames.length).toBe(before + 1)
    expect(frames[frames.length - 1].kind).toBe('reproject')
    expect(host.requests.length).toBe(1)
    await vi.waitFor(() => expect(host.requests.length).toBe(2), { timeout: 5000, interval: 2 })
    // not one readPixels went to an array, only to the pack buffer; the fences polled and deleted
    expect(gl.reads.length).toBeGreaterThanOrEqual(2)
    expect(gl.reads.every((r) => r.pack === true)).toBe(true)
    expect(gl.fences.pending).toBeGreaterThanOrEqual(3)
    expect(gl.fences.deleted).toBe(gl.fences.created)
    engine.dispose()
  })

  it('sends nothing to the model, and shows no error, when the engine is disposed while the GPU is still working', async () => {
    const host = new SlowHost()
    const { engine, errors, gl, go } = withPicture({ host, reducedMotion: () => true }, { asyncReadback: true, fenceDelayPolls: 5 })
    go(sphereView(), P)
    expect(gl.fences.created).toBeGreaterThan(0)
    engine.dispose()
    await new Promise((r) => setTimeout(r, 50))
    expect(host.requests.length).toBe(0)
    expect(errors.filter((m) => m !== null)).toEqual([])
  })

  it('asks the model for nothing when the context is lost while the G-buffer is read, and never shows a blank picture: the restore asks again and the picture comes back whole', async () => {
    const host = new SlowHost()
    const { engine, painted, gl, go, done } = withPicture({ host, reducedMotion: () => true }, { asyncReadback: true, fenceDelayPolls: 6 })
    go(sphereView(), P)
    await vi.waitFor(() => expect(host.requests.length).toBe(1), { timeout: 5000, interval: 2 })
    host.finish()
    await done(1)
    expect(painted[painted.length - 1].frame.strokes.count).toBeGreaterThan(0)
    // a slider: a full frame, its G-buffer still with the GPU when the context goes
    go(sphereView(), setParam(P, 'roles.block.width', 30))
    gl.canvas.lose()
    await new Promise((r) => setTimeout(r, 60)) // (the poll finds the context gone)
    expect(host.requests.length).toBe(1) // no G-buffer, so no request: an empty one would have made a frame with nothing in it
    gl.canvas.restore()
    await vi.waitFor(() => expect(host.requests.length).toBe(2), { timeout: 5000, interval: 2 })
    host.finish()
    await done(2)
    const last = painted[painted.length - 1]
    expect(last.kind).toBe('full')
    expect(last.frame.strokes.count).toBe(host.responses[1].strokes.count)
    expect(last.frame.strokes.count).toBeGreaterThan(0)
    // no picture on screen at any time had no strokes
    expect(painted.every((p) => p.frame.strokes.count > 0)).toBe(true)
    engine.dispose()
  })

  it('drops a read that was begun on a context that has come back since: lost and restored in one task, the picture is asked for again, whole, and no error comes of the stale fence', async () => {
    const host = new SlowHost()
    const { engine, errors, painted, gl, go, done } = withPicture({ host, reducedMotion: () => true }, { asyncReadback: true, fenceDelayPolls: 3 })
    go(sphereView(), P)
    gl.canvas.lose()
    gl.canvas.restore()
    await vi.waitFor(() => expect(host.requests.length).toBe(1), { timeout: 5000, interval: 2 })
    host.finish()
    await done(1)
    await new Promise((r) => setTimeout(r, 40))
    expect(host.requests.length).toBe(1) // the read of the context that went never reached the model
    expect(painted.length).toBe(1)
    expect(painted[0].frame.strokes.count).toBeGreaterThan(0)
    // the loss was said once; nothing else
    expect(errors.filter((m) => m !== null)).toEqual([expect.stringMatching(/graphics context was lost/)])
    engine.dispose()
  })

  it('still runs a drag: the model’s frames are adopted, one at a time, through the fence', async () => {
    const host = new SlowHost()
    const clock = { t: 0 }
    const { engine, frames, painted, gl, go, done } = withPicture({ host, now: () => clock.t, reducedMotion: () => true }, { asyncReadback: true, fenceDelayPolls: 1 })
    go(sphereView(), P)
    await vi.waitFor(() => expect(host.requests.length).toBe(1), { timeout: 5000, interval: 2 })
    host.finish()
    await done(1)
    for (let k = 1; k <= 13; k++) {
      clock.t += 16
      go(sphereView({ azimuth: 30 + 3 * k, dragging: true }), P)
      if (k % 4 === 1) {
        // a request is out (or goes out once its fence has passed): let the model finish it
        await vi.waitFor(() => expect(host.requests.length).toBe(1 + (k + 3) / 4), { timeout: 5000, interval: 2 })
        host.finish()
        await flush()
      }
    }
    expect(host.maxRunning).toBe(1)
    expect(frames.filter((f) => f.adopted).length).toBeGreaterThanOrEqual(3)
    expect(painted.length).toBeGreaterThan(13)
    expect(gl.reads.every((r) => r.pack === true)).toBe(true)
    engine.dispose()
  })
})

describe('an answer that comes while a fade runs', () => {
  // each non-edge stroke's alpha, by what it is painted from (the strongest where a particle has more than one)
  const alphaByKey = (b: StrokeBatch) => {
    const edge = ROLES.indexOf('edge')
    const out = new Map<string, number>()
    for (let i = 0; i < b.count; i++) if (b.role[i] !== edge) out.set(`${b.role[i]}/${b.seed[i]}`, Math.max(out.get(`${b.role[i]}/${b.seed[i]}`) ?? 0, b.alpha[i]))
    return out
  }
  const biggestJump = (a: Map<string, number>, b: Map<string, number>) => {
    let worst = 0
    for (const k of new Set([...a.keys(), ...b.keys()])) worst = Math.max(worst, Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)))
    return worst
  }

  // a fade from the first frame to a model frame for azimuth 40, the camera paused at 52; a second answer comes half way through
  async function midFade() {
    const host = new SlowHost()
    const clock = { t: 0 }
    const rig = withPicture({ host, now: () => clock.t, reducedMotion: () => false })
    rig.go(sphereView(), P)
    host.finish()
    await rig.done(1)
    clock.t = 100
    rig.go(sphereView({ azimuth: 40, dragging: true }), P) // the model starts a frame for az 40
    const now = sphereView({ azimuth: 52, dragging: true })
    clock.t = 116
    rig.go(now, P)
    clock.t = 120
    host.finish() // the first answer: adopted at t = 120, a fade of 120 ms begins
    await flush()
    clock.t = 130
    rig.go(now, P) // painted, and the next request starts (for az 52)
    expect(rig.frames.filter((f) => f.adopted)).toHaveLength(1)
    return { host, clock, now, ...rig }
  }

  it('waits for the fade to end and then takes over: no stroke’s alpha jumps by more than 0.05 between two frames, at the answer or at the take-over', async () => {
    const { host, clock, now, engine, painted, frames, go } = await midFade()
    // t = 190, half way through the fade
    clock.t = 190
    go(now, P)
    const before = alphaByKey(painted[painted.length - 1].frame.strokes)
    host.finish() // the second answer, mid-fade
    await flush()
    clock.t = 191
    go(now, P)
    const after = alphaByKey(painted[painted.length - 1].frame.strokes)
    // held: the picture goes on as it was (a millisecond of the fade is all that moved)
    expect(biggestJump(before, after)).toBeLessThanOrEqual(0.05)
    expect(frames.filter((f) => f.adopted)).toHaveLength(1)
    // the fade ends at t = 240: the held answer takes over then, and again nothing jumps
    clock.t = 239
    go(now, P)
    const last = alphaByKey(painted[painted.length - 1].frame.strokes)
    clock.t = 241
    go(now, P)
    const first = alphaByKey(painted[painted.length - 1].frame.strokes)
    expect(biggestJump(last, first)).toBeLessThanOrEqual(0.05)
    expect(frames.filter((f) => f.adopted)).toHaveLength(2)
    // and its own fade runs, to the strokes of the second answer alone
    clock.t = 241 + 130
    go(now, P)
    const finished = painted[painted.length - 1].frame.strokes
    expect(finished.count).toBe(host.responses[2].strokes.count)
    engine.dispose()
  })

  it('drops the answer it holds when the figure is switched, and back: the base stays the first answer’s and no second fade begins', async () => {
    const { host, clock, now, engine, painted, frames, go } = await midFade()
    clock.t = 160
    go(now, P)
    host.finish() // the second answer, held
    await flush()
    engine.setScene(OTHER, COLOURS)
    engine.setScene(SCENE, COLOURS)
    clock.t = 241
    go(now, P)
    clock.t = 300
    go(now, P)
    expect(frames.filter((f) => f.adopted)).toHaveLength(1)
    expect(painted[painted.length - 1].frame.strokes.count).toBe(host.responses[1].strokes.count)
    engine.dispose()
  })

  it('keeps only the newest of the answers that come while it runs, and drops one that is older than the base', async () => {
    const { host, clock, now, engine, painted, frames, go } = await midFade()
    clock.t = 160
    go(now, P)
    host.finish() // the second answer, held
    await flush()
    clock.t = 165
    go(now, P) // asks for the next request, for the same view
    host.finish() // and its answer comes too, still mid-fade: it replaces the one held
    await flush()
    clock.t = 241
    go(now, P)
    clock.t = 241 + 130
    go(now, P)
    // the base after both fades is the newest answer's
    expect(painted[painted.length - 1].frame.strokes.count).toBe(host.responses[3].strokes.count)
    expect(frames.filter((f) => f.adopted)).toHaveLength(2)
    engine.dispose()
  })

  // the picture a still view gets from a fresh engine: the model's own frame for it, as it made it
  const stillFrameOf = async (v: PaintView) => {
    const fresh = withPicture({ reducedMotion: () => true })
    fresh.go(v, P)
    await fresh.done(1)
    const strokes = fresh.painted[0].frame.strokes
    fresh.engine.dispose()
    return strokes
  }

  it('paints the frame of a release at once when it lands mid-fade, and the picture ends as the still frame: not as a re-projection that nothing replaces', async () => {
    const { host, clock, engine, painted, go } = await midFade()
    // (t = 130: the model works on a frame for az 52, and the fade from the first answer runs to t = 240)
    clock.t = 150
    go(sphereView({ azimuth: 52 }), P) // the pointer is let go: the release's frame is asked for, behind the one that runs
    clock.t = 160
    host.finish() // the drag's frame, for the view the camera is at: taken in, and a fade of its own begins
    await flush()
    expect(host.requests.length).toBe(4) // the release's, started
    clock.t = 170
    host.finish() // the release's frame lands, in the middle of that fade
    await flush()
    const last = painted[painted.length - 1]
    expect(last.kind).toBe('full')
    sameStrokes(last.frame.strokes, await stillFrameOf(sphereView({ azimuth: 52 })))
    // and nothing paints over it afterwards: no tick, no take-over
    const count = painted.length
    await new Promise((r) => setTimeout(r, 60))
    expect(painted.length).toBe(count)
    engine.dispose()
  })

  it('paints the release’s frame at once when an answer is being held too: the held one is dropped, the still frame is the last picture', async () => {
    const { host, clock, now, engine, painted, go } = await midFade()
    clock.t = 160
    go(now, P)
    host.finish() // an answer for the view the camera is at, mid-fade: held
    await flush()
    clock.t = 170
    go(sphereView({ azimuth: 52 }), P) // the pointer is let go: the release's frame, asked for at once
    expect(host.requests.length).toBe(4)
    clock.t = 180
    host.finish() // it lands while the first fade still has 60 ms to run
    await flush()
    const last = painted[painted.length - 1]
    expect(last.kind).toBe('full')
    sameStrokes(last.frame.strokes, await stillFrameOf(sphereView({ azimuth: 52 })))
    // the answer that was held does not take over after it, whenever the fade would have ended
    const count = painted.length
    clock.t = 400
    await new Promise((r) => setTimeout(r, 60))
    expect(painted.length).toBe(count)
    engine.dispose()
  })

  it('ages the edges of the answer it holds from the turn of the camera, not from the take-over', async () => {
    const { host, clock, now, engine, painted, go } = await midFade()
    clock.t = 160
    go(now, P)
    host.finish() // an answer for az 52, held (the camera is at its view)
    await flush()
    const turned = sphereView({ azimuth: 60, dragging: true })
    clock.t = 180
    go(turned, P) // the camera turns from the view of the answer that waits
    clock.t = 241
    go(turned, P) // the fade is over: the held answer takes over
    expect(painted[painted.length - 1].frame.strokes.count).toBeGreaterThan(host.responses[2].strokes.count) // (its own fade has begun)
    // 205 ms after the turn (144 after the take-over) its edges are gone; the fade between the bases is over by then
    clock.t = 385
    go(turned, P)
    const shown = painted[painted.length - 1].frame.strokes
    const edge = ROLES.indexOf('edge')
    expect(shown.count).toBe(host.responses[2].strokes.count)
    for (let i = 0; i < shown.count; i++) if (shown.role[i] === edge) expect(shown.alpha[i], `edge ${i}`).toBe(0)
    engine.dispose()
  })
})

describe('a fade that is not the base’s any more', () => {
  it('does not go on ticking: the user asks for reduced motion mid-fade and the next answer is adopted at once', async () => {
    vi.useFakeTimers()
    try {
      const host = new SlowHost()
      const clock = { t: 0 }
      const reduced = { on: false }
      const { engine, painted, go } = withPicture({ host, now: () => clock.t, reducedMotion: () => reduced.on })
      go(sphereView(), P)
      host.finish()
      await vi.waitFor(() => expect(painted.length).toBeGreaterThanOrEqual(1))
      clock.t = 100
      go(sphereView({ azimuth: 40, dragging: true }), P)
      const now = sphereView({ azimuth: 52, dragging: true })
      clock.t = 116
      go(now, P)
      clock.t = 120
      host.finish() // adopted: a fade begins
      await vi.advanceTimersByTimeAsync(0)
      clock.t = 130
      go(now, P) // painted, and the next request starts
      clock.t = 135
      go(now, P) // (the drag goes on: the next answer is adopted without a picture)
      reduced.on = true // mid-fade, the user asks for no motion ...
      clock.t = 140
      host.finish() // ... and the next answer comes: adopted at once, the fade over the old base is of no base now
      await vi.advanceTimersByTimeAsync(0)
      reduced.on = false // (and asks for motion again, before the picture is made: the stale fade must not come back to life)
      clock.t = 150
      go(sphereView({ azimuth: 55, dragging: true }), P) // the drag goes on
      // the picture is the new base's strokes alone: the old fade is not blended in with them
      expect(painted[painted.length - 1].frame.strokes.count).toBe(host.responses[2].strokes.count)
      const painting = painted.length
      // nothing is left to ease: no tick paints again
      for (let k = 0; k < 12; k++) {
        clock.t += 16
        await vi.advanceTimersByTimeAsync(16)
      }
      expect(painted.length).toBe(painting)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('is not taken to another figure and back: a figure switch mid-drag ends it, and no tick paints after it', async () => {
    vi.useFakeTimers()
    try {
      const host = new SlowHost()
      const clock = { t: 0 }
      const { engine, painted, go } = withPicture({ host, now: () => clock.t, reducedMotion: () => false })
      go(sphereView(), P)
      host.finish()
      await vi.waitFor(() => expect(painted.length).toBeGreaterThanOrEqual(1))
      clock.t = 100
      go(sphereView({ azimuth: 40, dragging: true }), P)
      const now = sphereView({ azimuth: 52, dragging: true })
      clock.t = 116
      go(now, P)
      clock.t = 120
      host.finish() // adopted: a fade begins
      await vi.advanceTimersByTimeAsync(0)
      clock.t = 130
      go(now, P)
      const next = host.responses[1].strokes
      expect(painted[painted.length - 1].frame.strokes.count).toBeGreaterThan(next.count) // (the fade: the old strokes are still there)
      // the figure is switched, and switched back, in the time the fade had left
      engine.setScene(OTHER, COLOURS)
      engine.setScene(SCENE, COLOURS)
      const painting = painted.length
      for (let k = 0; k < 10; k++) {
        clock.t += 16
        await vi.advanceTimersByTimeAsync(16)
      }
      expect(painted.length).toBe(painting) // no tick paints a fade of a figure that was left
      // the picture of the figure when it is back is its base's strokes alone: the fade is gone
      clock.t = 140
      go(now, P)
      expect(painted[painted.length - 1].frame.strokes.count).toBe(next.count)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---- the baked painting: bake in the worker, a frame from the bake on this thread ----

// The model's host of these tests: the real session, and a count of the frames it was asked for. (The bake is NOT made here: it has a host of its own.)
class LiveHost implements ModelHost {
  readonly background = true
  readonly session = new PaintSession()
  readonly frameRequests: SessionRequest[] = []
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData) {
    this.session.setScene(sceneId, scene, colours)
  }
  setColours(sceneId: number, colours: SceneColourData) {
    this.session.setColours(sceneId, colours)
  }
  frame(request: SessionRequest): Promise<SessionResponse> {
    this.frameRequests.push(request)
    return Promise.resolve(this.session.frame(request))
  }
  dispose() {}
}

// The bake's host of these tests: the real session behind it, as a worker of its own is, and what comes back is a COPY with the transferred arrays moved
// (structuredClone with the transfer lists), so the page's painting is not the session's own object. `manual` holds a bake in flight until the test
// releases it (the real bake is made then). `cancel` is what the worker's is: what is in flight is abandoned (never made, its promise settles with id -1),
// and the session is made again with the scenes it held and none of its bake.
class BakeSide implements BakeHost {
  readonly background = true
  session = new PaintSession()
  readonly bakeRequests: BakeRequest[] = []
  readonly recolourRequests: RecolourRequest[] = []
  readonly bakes: BakedPainting[] = []
  // The colours of each recolour answered, copied before they were handed over.
  readonly recoloured: BakedColours[] = []
  cancels = 0
  respawns = 0
  sceneSets = 0
  maxRunning = 0
  private running = 0
  private readonly scenes = new Map<number, { scene: SpaceScene; colours: SceneColourData }>()
  private waiting: { run: () => void; settle: (a: BakeAnswer) => void }[] = []
  private readonly manual: boolean
  constructor(manual = false) {
    this.manual = manual
  }
  // Bakes asked for and neither made nor cancelled.
  get held(): number {
    return this.waiting.length
  }
  setScene(sceneId: number, scene: SpaceScene, colours: SceneColourData) {
    this.scenes.set(sceneId, { scene, colours })
    this.session.setScene(sceneId, scene, colours)
    this.sceneSets++
  }
  setColours(sceneId: number, colours: SceneColourData) {
    const have = this.scenes.get(sceneId)
    if (have) have.colours = colours
    this.session.setColours(sceneId, colours)
  }
  bake(request: BakeRequest, progress: (percent: number) => void): Promise<BakeAnswer> {
    this.bakeRequests.push(request)
    this.maxRunning = Math.max(this.maxRunning, ++this.running)
    return new Promise((resolve) => {
      const entry = {
        settle: resolve,
        run: () => {
          const answer = this.session.bake(request, progress)
          this.running--
          if (!answer.ok) return resolve(answer)
          const sent = structuredClone(answer, { transfer: bakeTransferList(answer.baked) }) as BakeAnswer
          if (sent.ok) this.bakes.push(sent.baked)
          resolve(sent)
        },
      }
      this.waiting.push(entry)
      if (!this.manual) {
        setTimeout(() => {
          const i = this.waiting.indexOf(entry)
          if (i >= 0) {
            this.waiting.splice(i, 1)
            entry.run()
          }
        }, 0)
      }
    })
  }
  recolour(request: RecolourRequest): Promise<RecolourAnswer> {
    this.recolourRequests.push(request)
    const answer = this.session.recolour(request)
    if (!answer.ok) return Promise.resolve(answer)
    this.recoloured.push(structuredClone(answer.colours))
    return Promise.resolve(structuredClone(answer, { transfer: recolourTransferList(answer.colours) }) as RecolourAnswer)
  }
  // The bake in flight (manual) is made, and its answer handed back.
  release(): void {
    const entry = this.waiting.shift()
    entry?.run()
  }
  cancel() {
    this.cancels++
    for (const w of this.waiting.splice(0)) w.settle({ id: -1, ok: false, error: 'the bake was cancelled' })
    this.running = 0
    this.session = new PaintSession()
    for (const [id, sc] of this.scenes) {
      this.session.setScene(id, sc.scene, sc.colours)
      this.sceneSets++
    }
    this.respawns++
  }
  dispose() {}
}

// The key light in the world, as the lab's view carries it when the light is fixed in the world (paintLabCamera.ts worldLightDirection): from the
// light's own azimuth and elevation, the same for every view of the camera.
const worldLightOf = (params: PaintParams): [number, number, number] => {
  const a = (params.light.azimuth * Math.PI) / 180
  const e = (params.light.elevation * Math.PI) / 180
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]
}
const bview = (opts: Parameters<typeof paintView>[0] = {}): PaintView => paintView({ width: 320, height: 240, azimuth: 30, elevation: 25, zoom: 100, ...opts })
const FRAMING = ((): AuthoredFraming => {
  const v = bview()
  return { eye: [...v.eye], viewDir: [...v.viewDir], ortho: true, worldPerPx: 1 / 100 }
})()
// A sphere and a table, with few particles: a bake is heavy and the machine shared.
const BP: PaintParams = { ...P, particles: { ...P.particles, maxPerUnit2: 250 } }
const FLAT = setParam(BP, 'light.worldFixed', 0)
const BSCENE = sceneOf([sphereMesh({ radius: 0.6, nu: 20, nv: 14 }), tableMesh({ z: -0.6, half: 1.5, index: 1 })])
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const sumOf = (a: Float32Array): number => a.reduce((x, y) => x + y, 0)

function bakeSetup(
  opts: { manual?: boolean; host?: ModelHost; bakeHost?: BakeHost | null; fake?: Parameters<typeof createPaintFakeGl>[0]; limits?: Parameters<typeof createPaintFakeGl>[2] } = {},
) {
  const live = opts.host ?? new LiveHost()
  const bake = opts.bakeHost === undefined ? new BakeSide(opts.manual ?? false) : opts.bakeHost
  const gl = createPaintFakeGl(opts.fake ?? {}, { width: 320, height: 240 }, opts.limits ?? {})
  Object.assign(gl.canvas.canvas, { style: {} })
  const frames: FrameStats[] = []
  const errors: (string | null)[] = []
  const statuses: BakeStatus[] = []
  const painted: { frame: PaintFrame; kind: FrameStats['kind'] }[] = []
  // The batches of the baked frames as the engine gave them: it builds each in arrays it keeps from frame to frame (the next frame writes over them), so `painted`
  // holds a copy of each, which a test can read at its leisure.
  const raw: StrokeBatch[] = []
  const inner = createPaintEngine(
    gl.canvas.canvas,
    {
      onFrame: (f) => frames.push(f),
      onError: (m) => errors.push(m),
      onBake: (s) => statuses.push(s),
      onPaint: (frame, kind) => {
        if (kind === 'baked') raw.push(frame.strokes)
        painted.push({ frame: kind === 'baked' ? { ...frame, strokes: copyOf(frame.strokes) } : frame, kind })
      },
    },
    { host: live, bakeHost: bake },
  )
  // (the view's light is the params' light in the world, as the lab builds it)
  const engine: PaintEngine = { ...inner, render: (v, p, d, a, b) => inner.render({ ...v, lightDir: worldLightOf(p) }, p, d, a, b) }
  engine.setScene(BSCENE, COLOURS)
  const baked = () => frames.filter((f) => f.kind === 'baked')
  // The first frames: the per-frame painter's while the first bake is made, then the bake's.
  const ready = async (params: PaintParams = BP, framing: AuthoredFraming = FRAMING) => {
    engine.render(bview(), params, 'none', framing)
    // (a manual bake host is let go: the first bake is made when it is asked for)
    if (bake instanceof BakeSide && opts.manual) {
      await vi.waitFor(() => expect(bake.bakeRequests.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
      bake.release()
    }
    await vi.waitFor(() => expect(baked().length).toBeGreaterThanOrEqual(1), { timeout: 120_000, interval: 5 })
  }
  const composites = () => timeline(gl).filter((e) => e.kind === 'composite').length
  const gbuffers = () => timeline(gl).filter((e) => e.kind === 'gbuffer').length / 2
  // `host` is the bake's (BakeSide), `live` the model's (LiveHost) unless the test gave its own.
  return { host: bake as BakeSide, live: live as LiveHost, gl, engine, frames, errors, statuses, painted, raw, baked, ready, composites, gbuffers }
}

// A batch of strokes copied (every typed array of it).
function copyOf(b: StrokeBatch): StrokeBatch {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, ArrayBuffer.isView(v) ? (v as Float32Array).slice() : v])) as unknown as StrokeBatch
}

describe('the baked painting: which painter draws', () => {
  it('draws per frame, and builds no bake, when the light is not fixed in the world', async () => {
    const t = bakeSetup()
    t.engine.render(bview(), FLAT, 'none', FRAMING)
    await vi.waitFor(() => expect(t.frames.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(t.frames[0]).toMatchObject({ kind: 'full', path: 'live', buildMs: 0 })
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests).toEqual([])
    expect(t.statuses.every((s) => s.path === 'live' && s.painting === null && s.why === null)).toBe(true)
    // and a drag is the live orbit's: re-projected frames, the model behind
    t.engine.render(bview({ azimuth: 40, dragging: true }), FLAT, 'none', FRAMING)
    expect(t.frames[t.frames.length - 1].kind).toBe('reproject')
    t.engine.dispose()
  })

  it('draws per frame, and builds no bake, when a debug view is chosen, the page gave no framing, the host cannot bake, or the lab has the bake switched off', async () => {
    const t = bakeSetup()
    t.engine.render(bview(), BP, 'value', FRAMING)
    t.engine.render(bview(), BP, 'none')
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests).toEqual([])
    expect(t.frames.every((f) => f.path === 'live')).toBe(true)
    t.engine.dispose()
    // (a host with no bake in it: the lab's own is a worker or the session; a test's slow host is neither)
    const slow = new SlowHost()
    const s = bakeSetup({ host: slow, bakeHost: null })
    s.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(slow.requests.length).toBe(1), { timeout: 60_000, interval: 5 })
    slow.finish()
    await vi.waitFor(() => expect(s.frames.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(s.frames[0].path).toBe('live')
    s.engine.dispose()
    // the Bake switch off (the page's: &bake=0 starts it off, and the stage gives it to every render; the engine no longer reads the URL for it)
    const off = bakeSetup()
    off.engine.render(bview(), BP, 'none', FRAMING, false)
    await vi.waitFor(() => expect(off.frames.length).toBe(1), { timeout: 60_000, interval: 5 })
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(off.host.bakeRequests).toEqual([])
    expect(off.frames[0].path).toBe('live')
    off.engine.dispose()
  })

  it('draws per frame, and says why, when the renderer cannot depth-test strokes (no float render targets): the status line, and no bake', async () => {
    const t = bakeSetup({ fake: { colorBufferFloat: false } })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.frames.length).toBe(1), { timeout: 60_000, interval: 5 })
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests).toEqual([])
    expect(t.frames[0].path).toBe('live')
    const last = t.statuses[t.statuses.length - 1]
    expect(last).toMatchObject({ path: 'live', painting: null })
    expect(last.why).toMatch(/float/)
    t.engine.dispose()
  })

  it('draws from the bake when all three hold: the light is fixed in the world, the renderer can depth-test, no debug view', async () => {
    const t = bakeSetup()
    await t.ready()
    expect(t.host.bakeRequests.length).toBe(1)
    const f = t.baked()[0]
    expect(f).toMatchObject({ kind: 'baked', path: 'baked', modelMs: 0, gbufferMs: 0 })
    expect(f.strokes).toBeGreaterThan(100)
    expect(f.buildMs).toBeGreaterThan(0)
    expect(f.paintMs).toBeGreaterThan(0)
    expect(f.ms).toBeGreaterThanOrEqual(f.buildMs)
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'baked', painting: null, why: null })
    expect(t.errors.filter((m) => m !== null)).toEqual([])
    t.engine.dispose()
  })
})

describe('the baked painting: the first bake', () => {
  it('shows the per-frame painter while it is made (150 ms after the first render, in the worker), with its progress, and the bake from then on', async () => {
    const t = bakeSetup()
    const t0 = performance.now()
    t.engine.render(bview(), BP, 'none', FRAMING)
    // nothing asked for yet: the bake waits out the debounce, so the first picture is the per-frame painter's
    expect(t.host.bakeRequests.length).toBe(0)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(performance.now() - t0).toBeGreaterThanOrEqual(BAKE_DEBOUNCE_MS - 15)
    const request = t.host.bakeRequests[0]
    expect(request.params).toBe(BP)
    expect(request.lightDir).toEqual(worldLightOf(BP))
    expect(request.authored).toEqual(FRAMING)
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(1), { timeout: 120_000, interval: 5 })
    expect(t.frames[0]).toMatchObject({ kind: 'full', path: 'live' })
    // the progress: "Painting… 0%" first, then it grows (whole percents, each once), 100 at the end, and cleared on arrival
    const percents = t.statuses.filter((s) => s.painting !== null).map((s) => s.painting as number)
    expect(percents[0]).toBe(0)
    expect(percents.length).toBeGreaterThan(3)
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThan(percents[i - 1])
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'baked', painting: null, why: null })
    // the model's frame the bake replaced did not come back over it
    await sleep(100)
    expect(t.frames.slice(t.frames.indexOf(t.baked()[0])).every((f) => f.kind === 'baked')).toBe(true)
    t.engine.dispose()
  })

  it('does not bake for another figure’s inputs: a bake that lands after the figure changed is dropped, and the new figure is baked (live frames meanwhile)', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    // another figure while the first is baked
    const other = sceneOf([sphereMesh({ radius: 0.5, nu: 20, nv: 14 }), tableMesh({ z: -0.5, half: 1.5, index: 1 })])
    t.engine.setScene(other, COLOURS)
    t.engine.render(bview(), BP, 'none', FRAMING)
    const before = t.frames.length
    t.host.release()
    await sleep(50)
    // the old figure's bake was dropped: nothing baked was painted
    expect(t.baked().length).toBe(0)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[1].sceneId).not.toBe(t.host.bakeRequests[0].sceneId)
    t.host.release()
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(1), { timeout: 120_000, interval: 5 })
    expect(t.frames.length).toBeGreaterThan(before)
    t.engine.dispose()
  })
})

describe('the baked painting: every frame is a frame of the bake, with no model run', () => {
  it('builds every baked frame in arrays it keeps (final fix wave, L3): the strokes of two frames in a row are views of the same buffers, and the renderer has painted the first before the second writes over it', async () => {
    const t = bakeSetup()
    await t.ready()
    for (const az of [50, 55, 60]) t.engine.render(bview({ azimuth: az }), BP, 'none', FRAMING)
    const [a, b] = t.raw.slice(-2)
    expect(b).not.toBe(a)
    let arrays = 0
    for (const k of Object.keys(a) as (keyof StrokeBatch)[]) {
      const x = a[k]
      const y = b[k]
      if (!ArrayBuffer.isView(x) || !ArrayBuffer.isView(y)) continue
      arrays++
      expect(y.buffer, String(k)).toBe(x.buffer)
    }
    expect(arrays).toBeGreaterThanOrEqual(19)
    // (what a test is shown of each is a copy: the pictures differ from frame to frame, the arrays do not)
    const last = t.painted.filter((p) => p.kind === 'baked')
    expect(last[last.length - 1].frame.strokes.path.buffer).not.toBe(last[last.length - 2].frame.strokes.path.buffer)
    t.engine.dispose()
  })

  it('builds a frame for each render of a drag, synchronously, asks the model for nothing, and does not bake again (frame build and paint times reported)', async () => {
    const t = bakeSetup()
    await t.ready()
    const asked = { frames: t.live.frameRequests.length, bakes: t.host.bakeRequests.length }
    const before = t.frames.length
    for (let k = 1; k <= 30; k++) t.engine.render(bview({ azimuth: 30 + 3 * k, dragging: true }), BP, 'none', FRAMING)
    // (every render painted its frame as it returned: the G-buffer's landing may add repaints, not fewer)
    expect(t.frames.length - before).toBeGreaterThanOrEqual(30)
    for (const f of t.frames.slice(before)) expect(f).toMatchObject({ kind: 'baked', path: 'baked', modelMs: 0, gbufferMs: 0 })
    expect(t.frames.slice(before).every((f) => f.buildMs > 0 && f.paintMs >= 0 && f.strokes > 0)).toBe(true)
    await sleep(BAKE_DEBOUNCE_MS + 150)
    expect(t.live.frameRequests.length).toBe(asked.frames)
    expect(t.host.bakeRequests.length).toBe(asked.bakes)
    expect(t.host.recolourRequests.length).toBe(0)
    // the camera at rest again: a frame at full density, from the same bake
    t.engine.render(bview({ azimuth: 120 }), BP, 'none', FRAMING)
    expect(t.frames[t.frames.length - 1].kind).toBe('baked')
    expect(t.host.bakeRequests.length).toBe(asked.bakes)
    t.engine.dispose()
  })

  it('thins a frame under a drag by the drag density, as the frame does, and draws every stroke at rest', async () => {
    const t = bakeSetup()
    await t.ready()
    t.engine.render(bview({ azimuth: 50 }), BP, 'none', FRAMING)
    const rest = t.frames[t.frames.length - 1].strokes
    t.engine.render(bview({ azimuth: 50, dragging: true }), setParam(BP, 'particles.dragDensity', 0.3), 'none', FRAMING)
    expect(t.frames[t.frames.length - 1].strokes).toBeLessThan(rest)
    t.engine.dispose()
  })

  it('reads the G-buffer back without waiting, and paints the picture again with it when it lands for the view the camera stopped at', async () => {
    const t = bakeSetup({ limits: { asyncReadback: true, fenceDelayPolls: 2 } })
    await t.ready()
    // let the readbacks of the first frames land, then move the camera and stop
    await sleep(60)
    const asked = t.live.frameRequests.length
    t.engine.render(bview({ azimuth: 70, dragging: true }), BP, 'none', FRAMING)
    t.engine.render(bview({ azimuth: 75 }), BP, 'none', FRAMING)
    const n = t.frames.length
    const passes = t.gbuffers()
    // the G-buffer for this view was drawn (not waited for) and, when its fence has passed, the picture is made again with it
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 10_000, interval: 5 })
    expect(t.frames[t.frames.length - 1].kind).toBe('baked')
    expect(t.gbuffers()).toBeGreaterThanOrEqual(passes)
    expect(t.live.frameRequests.length).toBe(asked) // no model request was made for it
    t.engine.dispose()
  })
})

describe('the baked painting: what a change of parameters asks of it', () => {
  it('repaints only, with no request at all, for a renderer parameter or one only a frame reads (the relief, the drag density, the fade)', async () => {
    const t = bakeSetup()
    await t.ready()
    for (const [path, value] of [['impasto.strength', 1.6], ['particles.dragDensity', 0.5], ['particles.fadeHi', 0.5], ['roles.block.density', 0.8]] as const) {
      const n = t.frames.length
      t.engine.render(bview(), setParam(BP, path, value), 'none', FRAMING)
      expect(t.frames.length, path).toBe(n + 1)
      expect(t.frames[n].kind, path).toBe('baked')
    }
    await sleep(BAKE_DEBOUNCE_MS + 200)
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.host.recolourRequests.length).toBe(0)
    t.engine.dispose()
  })

  it('makes the colours again, in the worker, for a colour parameter: only the colour arrays come back, and the picture has the new colours; no bake', async () => {
    const t = bakeSetup()
    await t.ready()
    t.engine.render(bview(), BP, 'none', FRAMING)
    const first = t.painted[t.painted.length - 1].frame.strokes
    const colours = sumOf(first.colour)
    const strokes = first.count
    const next = setParam(BP, 'curve.warmHue', 20)
    const n = t.frames.length
    t.engine.render(bview(), next, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.recolourRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(t.host.recolourRequests[0]).toMatchObject({ key: t.host.bakes[0].key, params: next })
    // the colours land and the picture is painted with them, without anyone asking for a frame
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n + 1), { timeout: 60_000, interval: 5 })
    t.engine.render(bview(), next, 'none', FRAMING)
    const recoloured = t.painted[t.painted.length - 1].frame.strokes
    expect(recoloured.count).toBe(strokes)
    expect(sumOf(recoloured.colour)).not.toBeCloseTo(colours, 3)
    expect(t.host.bakeRequests.length).toBe(1)
    // and a second colour change, and the first one back: recolours again, never a bake
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.recolourRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    await sleep(200)
    t.engine.render(bview(), BP, 'none', FRAMING)
    expect(sumOf(t.painted[t.painted.length - 1].frame.strokes.colour)).toBeCloseTo(colours, 3)
    expect(t.host.bakeRequests.length).toBe(1)
    t.engine.dispose()
  })

  it('makes a new bake for anything else the bake reads (the light, a role’s size, the seed), 150 ms after the last change, with the old bake on screen meanwhile', async () => {
    const t = bakeSetup()
    await t.ready()
    const firstColours = (() => {
      t.engine.render(bview(), BP, 'none', FRAMING)
      return sumOf(t.painted[t.painted.length - 1].frame.strokes.colour)
    })()
    for (const [path, value] of [['light.azimuth', 20], ['roles.block.width', 30], ['seed', 7]] as const) {
      const bakes = t.host.bakeRequests.length
      const next = setParam(BP, path, value)
      const at = performance.now()
      t.engine.render(bview(), next, 'none', FRAMING)
      // the old bake is what is on screen, and the status line says it is painting
      expect(t.frames[t.frames.length - 1].kind, path).toBe('baked')
      expect(t.statuses[t.statuses.length - 1].painting, path).toBe(0)
      expect(t.host.bakeRequests.length, path).toBe(bakes)
      await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(bakes + 1), { timeout: 60_000, interval: 5 })
      expect(performance.now() - at, path).toBeGreaterThanOrEqual(BAKE_DEBOUNCE_MS - 15)
      expect(t.host.bakeRequests[bakes].params, path).toBe(next)
      // (the next frames, with the bake in the making, are still the old bake's)
      t.engine.render(bview({ azimuth: 35 }), next, 'none', FRAMING)
      expect(t.frames[t.frames.length - 1].kind, path).toBe('baked')
      await vi.waitFor(() => expect(t.statuses[t.statuses.length - 1].painting).toBeNull(), { timeout: 120_000, interval: 5 })
      // back to the first params: another bake (the one held is the changed one's), whose colours are the first's again
      t.engine.render(bview(), BP, 'none', FRAMING)
      await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(bakes + 2), { timeout: 60_000, interval: 5 })
      await vi.waitFor(() => expect(t.statuses[t.statuses.length - 1].painting).toBeNull(), { timeout: 120_000, interval: 5 })
      t.engine.render(bview(), BP, 'none', FRAMING)
      expect(sumOf(t.painted[t.painted.length - 1].frame.strokes.colour), path).toBeCloseTo(firstColours, 3)
    }
    t.engine.dispose()
  }, 600_000)

  it('is one bake for a slider that is dragged: a change in every 100 ms keeps the debounce waiting, and the bake is for the last', async () => {
    const t = bakeSetup()
    await t.ready()
    const bakes = t.host.bakeRequests.length
    let last = BP
    let at = 0
    for (let k = 1; k <= 4; k++) {
      last = setParam(BP, 'light.azimuth', -35 + 5 * k)
      t.engine.render(bview(), last, 'none', FRAMING)
      at = performance.now()
      await sleep(90)
    }
    expect(t.host.bakeRequests.length).toBe(bakes)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(bakes + 1), { timeout: 60_000, interval: 5 })
    expect(performance.now() - at).toBeGreaterThanOrEqual(BAKE_DEBOUNCE_MS - 15 - 90)
    expect(t.host.bakeRequests[bakes].params).toBe(last)
    t.engine.dispose()
  })

  it('re-bakes when a slider that only a frame reads moves a stroke’s baked length across a bucket, and not when it does not', async () => {
    const t = bakeSetup()
    await t.ready()
    const held = t.host.bakes[0]
    const moved = [0.2, 0.5, 2, 4, 8, 16].find((v) => lengthFactorsMoved(held.areaPerParticle, held.referenceWorldPerPx, BP, setParam(BP, 'particles.zoomGrowMax', v)))
    expect(moved, 'a zoom growth that moves the bucketed length of the baked paths').toBeDefined()
    const still = setParam(BP, 'particles.dragDensity', 0.4)
    expect(lengthFactorsMoved(held.areaPerParticle, held.referenceWorldPerPx, BP, still)).toBe(false)
    t.engine.render(bview(), still, 'none', FRAMING)
    await sleep(BAKE_DEBOUNCE_MS + 150)
    expect(t.host.bakeRequests.length).toBe(1)
    t.engine.render(bview(), setParam(BP, 'particles.zoomGrowMax', moved as number), 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    t.engine.dispose()
  })

  it('makes a new bake for another framing (a resized stage, another figure’s camera), and none for the camera that orbits', async () => {
    const t = bakeSetup()
    await t.ready()
    t.engine.render(bview({ azimuth: 100, elevation: 50 }), BP, 'none', { ...FRAMING, eye: [5, 5, 5], viewDir: [-0.6, -0.6, -0.5] })
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[1].authored.eye).toEqual([5, 5, 5])
    t.engine.dispose()
  })

  it('makes a new bake for new colours of the figure (a theme, a local colour), the per-frame painter drawing meanwhile', async () => {
    const t = bakeSetup()
    await t.ready()
    t.engine.setScene(BSCENE, flatColours({ 0: [0.4, 0.1, -0.1], 1: [0.9, 0.01, 0.02] }))
    const n = t.frames.length
    t.engine.render(bview(), BP, 'none', FRAMING)
    // (the old bake is of the old colours: the model draws the picture for the new ones)
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
    expect(t.frames[n]).toMatchObject({ kind: 'full', path: 'live' })
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    await vi.waitFor(() => expect(t.frames[t.frames.length - 1].kind).toBe('baked'), { timeout: 120_000, interval: 5 })
    t.engine.dispose()
  })
})

describe('the baked painting: one bake at a time, the newest request, a stale bake dropped', () => {
  it('stops a bake that a change made useless (the one on screen stays), and bakes the newest', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    t.host.release()
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(1), { timeout: 120_000, interval: 5 })
    t.engine.render(bview(), BP, 'none', FRAMING)
    const onScreen = sumOf(t.painted[t.painted.length - 1].frame.strokes.colour)
    // a change: its bake starts, and while it is made another change comes
    const second = setParam(BP, 'light.azimuth', 10)
    t.engine.render(bview(), second, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    const third = setParam(BP, 'light.azimuth', 40)
    t.engine.render(bview(), third, 'none', FRAMING)
    await sleep(60) // (the G-buffer of these light parameters lands, and the picture is painted again with it)
    const n = t.frames.length
    expect(t.host.cancels).toBe(1) // the second's bake was stopped by the third's light
    t.host.release() // (nothing is in flight to make)
    await sleep(100)
    expect(t.frames.length).toBe(n) // nothing was painted for it
    t.engine.render(bview(), third, 'none', FRAMING)
    expect(sumOf(t.painted[t.painted.length - 1].frame.strokes.colour)).toBeCloseTo(onScreen, 3) // still the first bake's
    // the newest is baked (one at a time: never two in flight), and when it lands it is the picture
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(3), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[2].params).toBe(third)
    t.host.release()
    await vi.waitFor(() => expect(t.statuses[t.statuses.length - 1].painting).toBeNull(), { timeout: 120_000, interval: 5 })
    t.engine.render(bview(), third, 'none', FRAMING)
    expect(sumOf(t.painted[t.painted.length - 1].frame.strokes.colour)).not.toBeCloseTo(onScreen, 3)
    expect(t.host.maxRunning).toBe(1)
    t.engine.dispose()
  }, 600_000)

  it('cancels the bake in flight for a change of the light, and of the changes that follow bakes the newest, once', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    // changes come while the first is made
    const params = [20, 30, 40].map((v) => setParam(BP, 'light.azimuth', v))
    for (const p of params) {
      t.engine.render(bview(), p, 'none', FRAMING)
      await sleep(20)
    }
    // the first change stopped the bake in flight (nothing was made of it); the last, 150 ms on, is baked, once
    expect(t.host.cancels).toBe(1)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 120_000, interval: 5 })
    expect(t.host.bakeRequests[1].params).toBe(params[2])
    t.host.release()
    await vi.waitFor(() => expect(t.statuses[t.statuses.length - 1].painting).toBeNull(), { timeout: 120_000, interval: 5 })
    expect(t.host.bakeRequests.length).toBe(2)
    expect(t.host.maxRunning).toBe(1)
    t.engine.dispose()
  }, 600_000)

  it('drops a bake that lands stale for what a cancel does not see (a frame-only slider that moves the bucketed length of its paths): it is made, its answer is not shown, and the newest is baked', async () => {
    const t = bakeSetup({ manual: true })
    await t.ready()
    const first = t.host.bakes[0]
    const grow = [0.2, 0.5, 2, 4, 8, 16].find((v) => lengthFactorsMoved(first.areaPerParticle, first.referenceWorldPerPx, BP, setParam(BP, 'particles.zoomGrowMax', v)))
    expect(grow, 'a zoom growth that crosses a bucket').toBeDefined()
    const second = setParam(BP, 'light.azimuth', 10)
    t.engine.render(bview(), second, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    // a slider only a frame reads: the bake in the making is not useless (no cancel), but its paths will be of a length that is no longer the bucket's
    const third = setParam(second, 'particles.zoomGrowMax', grow as number)
    t.engine.render(bview(), third, 'none', FRAMING)
    expect(t.host.cancels).toBe(0)
    await sleep(60)
    const n = t.frames.length
    t.host.release()
    await sleep(100)
    expect(t.frames.length).toBe(n) // the bake was made and dropped: nothing was painted for it
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(3), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[2].params).toBe(third)
    t.host.release()
    await vi.waitFor(() => expect(t.statuses[t.statuses.length - 1].painting).toBeNull(), { timeout: 120_000, interval: 5 })
    t.engine.dispose()
  }, 600_000)

  it('keeps a colour change that came while a bake was made, once the bake has landed: a recolour of it', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    const coloured = setParam(BP, 'curve.warmHue', 25)
    t.engine.render(bview(), coloured, 'none', FRAMING)
    t.host.release()
    // the bake is not stale (the colour is not what it is made of): it is the picture, then its colours are made again
    await vi.waitFor(() => expect(t.host.recolourRequests.length).toBe(1), { timeout: 120_000, interval: 5 })
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.host.recolourRequests[0].params).toBe(coloured)
    expect(t.baked().length).toBeGreaterThanOrEqual(1)
    t.engine.dispose()
  }, 600_000)
})

describe('the baked painting: the paths back and forth', () => {
  it('goes to the per-frame painter for a debug view and the light turned camera-relative, and back to the bake held, with no new bake', async () => {
    const t = bakeSetup()
    await t.ready()
    const live = async (params: PaintParams, debug: PaintDebugMode) => {
      const n = t.frames.length
      t.engine.render(bview({ azimuth: 45 }), params, debug, FRAMING)
      await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
      return t.frames[t.frames.length - 1]
    }
    expect(await live(BP, 'value')).toMatchObject({ kind: 'full', path: 'live' })
    expect((await live(BP, 'none')).path).toBe('baked')
    expect(await live(FLAT, 'none')).toMatchObject({ kind: 'full', path: 'live' })
    expect((await live(BP, 'none')).path).toBe('baked')
    await sleep(BAKE_DEBOUNCE_MS + 100)
    expect(t.host.bakeRequests.length).toBe(1)
    t.engine.dispose()
  })

  it('does not paint a model frame over the bake: one still in the worker when the bake takes over is dropped', async () => {
    const t = bakeSetup()
    await t.ready()
    // a live frame asked for by a debug view, then the bake takes the picture back before its answer is taken
    const n = t.frames.length
    t.engine.render(bview({ azimuth: 45 }), BP, 'value', FRAMING)
    t.engine.render(bview({ azimuth: 45 }), BP, 'none', FRAMING)
    await sleep(250)
    // the frames since are the bake's (the model's frame for the debug view, which came back after the bake took over, was not painted)
    expect(t.frames.length).toBeGreaterThan(n)
    expect(t.frames.slice(n).every((f) => f.path === 'baked')).toBe(true)
    t.engine.dispose()
  })

  it('leaves the Showcase’s tiles to the per-frame painter whatever the light (renderTo), and builds no bake for them', async () => {
    const t = bakeSetup()
    const target = { canvas: { width: 100, height: 75 }, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const stats = await t.engine.renderTo(target, bview(), BP, 'none')
    expect(stats).toMatchObject({ kind: 'full', path: 'live', buildMs: 0 })
    await sleep(BAKE_DEBOUNCE_MS + 200)
    expect(t.host.bakeRequests).toEqual([])
    t.engine.dispose()
  })
})

describe('the baked painting: failures and the graphics context', () => {
  it('keeps a bake that lands while the context is lost, and paints it when the context comes back: a paint that painted nothing says nothing of the renderer’s depth test (final fix wave, M1)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    // (the per-frame painter's first picture is on screen, from a context that could depth-test: the renderer's stats say so)
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
    t.gl.canvas.lose()
    expect(String(t.errors[t.errors.length - 1])).toMatch(/graphics context was lost/)
    // the bake lands during the loss
    t.host.release()
    await vi.waitFor(() => expect(t.statuses[t.statuses.length - 1]).toMatchObject({ path: 'baked' }), { timeout: 60_000, interval: 5 })
    await sleep(50)
    // it is kept: the baked path is the one the status line says, with nothing said of a renderer that cannot depth-test, and nothing was painted for it
    expect(t.statuses.some((s) => s.why !== null)).toBe(false)
    expect(t.baked().length).toBe(0)
    t.gl.canvas.restore()
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
    expect(t.frames[t.frames.length - 1]).toMatchObject({ kind: 'baked', path: 'baked' })
    expect(t.errors[t.errors.length - 1]).toBeNull()
    // and it stays the picture: the next render is the bake's, with no new bake, and the status line never said it was off
    t.engine.render(bview({ azimuth: 50 }), BP, 'none', FRAMING)
    expect(t.frames[t.frames.length - 1]).toMatchObject({ kind: 'baked', path: 'baked' })
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.statuses.some((s) => s.why !== null)).toBe(false)
    t.engine.dispose()
    vi.restoreAllMocks()
  })

  it('keeps the baked path when a debug view is left while the context is lost, and paints the bake again when it comes back (final fix wave, M1)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = bakeSetup()
    await t.ready()
    const n = t.frames.length
    t.engine.render(bview({ azimuth: 45 }), BP, 'value', FRAMING)
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
    expect(t.frames[t.frames.length - 1]).toMatchObject({ path: 'live' })
    t.gl.canvas.lose()
    // back from the debug view, with the context gone
    const m = t.frames.length
    t.engine.render(bview({ azimuth: 45 }), BP, 'none', FRAMING)
    await sleep(50)
    expect(t.statuses.some((s) => s.why !== null)).toBe(false)
    expect(t.statuses[t.statuses.length - 1]).toMatchObject({ path: 'baked' })
    // (nothing could be painted: no frame is reported, none is called baked)
    expect(t.frames.length).toBe(m)
    t.gl.canvas.restore()
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(m), { timeout: 60_000, interval: 5 })
    expect(t.frames[t.frames.length - 1]).toMatchObject({ kind: 'baked', path: 'baked' })
    expect(t.host.bakeRequests.length).toBe(1)
    t.engine.dispose()
    vi.restoreAllMocks()
  })

  it('falls back to the per-frame painter, and says why, when a bake fails; the figure still paints', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    class FailingHost extends BakeSide {
      override bake(request: BakeRequest): Promise<BakeAnswer> {
        this.bakeRequests.push(request)
        return Promise.resolve({ id: request.id, ok: false, error: 'out of memory' })
      }
    }
    const t = bakeSetup({ bakeHost: new FailingHost() })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.statuses.some((s) => s.why?.includes('out of memory'))).toBe(true), { timeout: 60_000, interval: 5 })
    const n = t.frames.length
    t.engine.render(bview({ azimuth: 50 }), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
    expect(t.frames[t.frames.length - 1].path).toBe('live')
    expect(t.host.bakeRequests.length).toBe(1) // not asked again and again
    t.engine.dispose()
    vi.restoreAllMocks()
  })

  it('paints the baked picture again when the context comes back (the renderer put the surfaces up itself), with no bake and no model run', async () => {
    const t = bakeSetup()
    await t.ready()
    t.engine.render(bview({ azimuth: 60 }), BP, 'none', FRAMING)
    const asked = t.live.frameRequests.length
    const before = t.composites()
    const n = t.frames.length
    t.gl.canvas.lose()
    expect(String(t.errors[t.errors.length - 1])).toMatch(/graphics context was lost/)
    t.gl.canvas.restore()
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
    expect(t.frames[t.frames.length - 1]).toMatchObject({ kind: 'baked', path: 'baked' })
    expect(t.composites()).toBeGreaterThan(before)
    expect(t.errors[t.errors.length - 1]).toBeNull()
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.live.frameRequests.length).toBe(asked)
    t.engine.dispose()
  })
})

// ---- fix round 1: a worker of its own for the bake, a bake that is not stale to enter on, a stage that may be resized, the G-buffer at rest ----

describe('the baked painting: a bake of its own host', () => {
  it('does not hold the new figure’s first frame behind the bake of the old one: the figure changes mid-bake, the bake is cancelled, and the model’s frame comes at once', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(t.host.held).toBe(1) // the bake is in flight and will stay so: the test does not let it finish
    // (the first figure's live frame was not waiting for it)
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
    const other = sceneOf([sphereMesh({ radius: 0.5, nu: 20, nv: 14 }), tableMesh({ z: -0.5, half: 1.5, index: 1 })])
    const n = t.frames.length
    t.engine.setScene(other, COLOURS)
    t.engine.render(bview(), BP, 'none', FRAMING)
    expect(t.host.cancels).toBe(1)
    expect(t.host.held).toBe(0)
    // the new figure's picture arrives with the old bake still not done (it never will be): a model frame, from the model's own host
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
    expect(t.frames[n]).toMatchObject({ kind: 'full', path: 'live' })
    expect(t.baked().length).toBe(0)
    expect(t.live.frameRequests[t.live.frameRequests.length - 1].sceneId).not.toBe(t.host.bakeRequests[0].sceneId)
    // then its own bake, for its own scene, and the worker that made the cancelled one was made again with both scenes
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[1].sceneId).not.toBe(t.host.bakeRequests[0].sceneId)
    expect(t.host.respawns).toBe(1)
    t.host.release()
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(1), { timeout: 120_000, interval: 5 })
    expect(t.host.maxRunning).toBe(1)
    t.engine.dispose()
  })

  it('shows a first load a picture while its bake is made: the model’s frame arrives with the bake still in flight', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    await vi.waitFor(() => expect(t.frames.length).toBeGreaterThanOrEqual(1), { timeout: 60_000, interval: 5 })
    expect(t.frames[0]).toMatchObject({ kind: 'full', path: 'live' })
    expect(t.host.held).toBe(1)
    expect(t.baked().length).toBe(0)
    t.engine.dispose()
  })

  it('cancels a bake in flight for real when a change makes it useless (the light, a role’s size, the framing, new colours): the host is told, nothing waits for it, and the newest is baked after the debounce', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    const changes: [string, PaintParams, AuthoredFraming][] = [
      ['the light', setParam(BP, 'light.azimuth', 20), FRAMING],
      ['a role’s size', setParam(BP, 'roles.block.width', 30), FRAMING],
      ['the framing', BP, { ...FRAMING, worldPerPx: FRAMING.worldPerPx * 1.5 }],
    ]
    let cancels = 0
    let requests = 1
    for (const [name, params, framing] of changes) {
      t.engine.render(bview(), params, 'none', framing)
      expect(t.host.cancels, name).toBe(++cancels)
      expect(t.host.held, name).toBe(0)
      const wanted = ++requests
      await vi.waitFor(() => expect(t.host.bakeRequests.length, name).toBe(wanted), { timeout: 60_000, interval: 5 })
      expect(t.host.bakeRequests[wanted - 1].params, name).toBe(params)
      expect(t.host.bakeRequests[wanted - 1].authored, name).toEqual(framing)
      // the worker was made again, with the scene it held
      expect(t.host.respawns, name).toBe(cancels)
    }
    // back to the first: the bake in flight is again of something else, and is cancelled too
    t.engine.render(bview(), BP, 'none', FRAMING)
    expect(t.host.cancels).toBe(cancels + 1)
    t.engine.dispose()
  })

  it('does not cancel a bake for a change that leaves it right (a colour parameter, a renderer parameter, one only a frame reads): it lands, and is the picture', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    for (const [path, value] of [['curve.warmHue', 20], ['impasto.strength', 1.7], ['particles.dragDensity', 0.6]] as const) t.engine.render(bview(), setParam(BP, path, value), 'none', FRAMING)
    expect(t.host.cancels).toBe(0)
    expect(t.host.held).toBe(1)
    t.host.release()
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(1), { timeout: 120_000, interval: 5 })
    expect(t.host.bakeRequests.length).toBe(1)
    t.engine.dispose()
  })

  it('does not cancel a bake when the baked path is left for a debug view: it lands, is held, and is the picture on the way back, with no new bake', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    t.engine.render(bview(), BP, 'value', FRAMING)
    expect(t.host.cancels).toBe(0)
    t.host.release()
    await sleep(200)
    // (nothing baked was drawn: the debug view is the model's)
    expect(t.baked().length).toBe(0)
    t.engine.render(bview(), BP, 'none', FRAMING)
    expect(t.frames[t.frames.length - 1]).toMatchObject({ kind: 'baked', path: 'baked' })
    await sleep(BAKE_DEBOUNCE_MS + 150)
    expect(t.host.bakeRequests.length).toBe(1)
    t.engine.dispose()
  })

  it('makes the bake cancelled by new colours not wait for the colours either: the colours are told to the bake host, the bake is cancelled and made again', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    t.engine.setScene(BSCENE, flatColours({ 0: [0.4, 0.1, -0.1], 1: [0.9, 0.01, 0.02] }))
    expect(t.host.cancels).toBe(1)
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    t.engine.dispose()
  })
})

// A Worker that never answers: what the engine posts to each is recorded. (A bake in a real one is not interruptible, so the lab terminates it.)
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((event: unknown) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  readonly posted: { type: string; [key: string]: unknown }[] = []
  terminated = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(message: { type: string; request?: { id: number } }) {
    this.posted.push(message)
    // (the model's frames are answered, with a failure the lab shows and goes on from: a model that never answered would hold every later request)
    if (message.type === 'frame' && message.request) {
      const id = message.request.id
      queueMicrotask(() => this.onmessage?.({ data: { type: 'frame', response: { id, ok: false, error: 'a worker that does not paint' } } }))
    }
  }
  terminate() {
    this.terminated = true
  }
  types(): string[] {
    return this.posted.map((m) => m.type)
  }
}

describe('the baked painting: the workers', () => {
  async function withWorkers() {
    FakeWorker.all = []
    vi.stubGlobal('Worker', FakeWorker)
    await load('?')
    const gl = createPaintFakeGl({}, { width: 320, height: 240 })
    Object.assign(gl.canvas.canvas, { style: {} })
    const statuses: BakeStatus[] = []
    const inner = createPaintEngine(gl.canvas.canvas, { onFrame: () => {}, onError: () => {}, onBake: (s) => statuses.push(s) })
    const engine: PaintEngine = { ...inner, render: (v, p, d, a, b) => inner.render({ ...v, lightDir: worldLightOf(p) }, p, d, a, b) }
    engine.setScene(BSCENE, COLOURS)
    return { engine, statuses }
  }

  it('gives the bake a worker of its own: frames go to the model’s worker and bakes to the other, which has its own copy of the scene', async () => {
    const { engine } = await withWorkers()
    try {
      engine.render(bview(), BP, 'none', FRAMING)
      await vi.waitFor(() => expect(FakeWorker.all.length).toBe(2), { timeout: 10_000, interval: 5 })
      const [model, bake] = FakeWorker.all
      await vi.waitFor(() => expect(bake.types()).toContain('bake'), { timeout: 10_000, interval: 5 })
      await vi.waitFor(() => expect(model.types()).toContain('frame'), { timeout: 10_000, interval: 5 })
      expect(model.types().filter((t) => t !== 'scene' && t !== 'frame')).toEqual([])
      expect(bake.types()).toEqual(['scene', 'bake'])
      expect(bake.posted[1]).toMatchObject({ request: { params: BP, authored: FRAMING } })
      expect(bake.posted[0].sceneId).toBe(model.posted[0].sceneId)
    } finally {
      engine.dispose()
      await load('?worker=0')
    }
  })

  it('terminates the bake worker and makes another, with the scene, when a bake in flight is made useless; and for another figure, with both scenes', async () => {
    const { engine } = await withWorkers()
    try {
      engine.render(bview(), BP, 'none', FRAMING)
      await vi.waitFor(() => expect(FakeWorker.all[1]?.types()).toContain('bake'), { timeout: 10_000, interval: 5 })
      const first = FakeWorker.all[1]
      const light = setParam(BP, 'light.azimuth', 25)
      engine.render(bview(), light, 'none', FRAMING)
      expect(first.terminated).toBe(true)
      expect(FakeWorker.all.length).toBe(3)
      const second = FakeWorker.all[2]
      expect(second.types()).toEqual(['scene'])
      await vi.waitFor(() => expect(second.types()).toEqual(['scene', 'bake']), { timeout: 10_000, interval: 5 })
      expect(second.posted[1]).toMatchObject({ request: { params: light } })
      // the model's worker was never terminated
      expect(FakeWorker.all[0].terminated).toBe(false)
      // another figure: the model's frame goes to the model's worker at once; the bake worker is made again and given both scenes
      const other = sceneOf([sphereMesh({ radius: 0.5, nu: 20, nv: 14 }), tableMesh({ z: -0.5, half: 1.5, index: 1 })])
      engine.setScene(other, COLOURS)
      expect(second.terminated).toBe(true)
      const third = FakeWorker.all[3]
      expect(third.types()).toEqual(['scene', 'scene'])
      const ids = new Set(third.posted.map((m) => m.sceneId))
      expect(ids.size).toBe(2)
      engine.render(bview(), light, 'none', FRAMING)
      await vi.waitFor(() => expect(third.types()).toEqual(['scene', 'scene', 'bake']), { timeout: 10_000, interval: 5 })
      expect((third.posted[2].request as BakeRequest).sceneId).toBe(third.posted[1].sceneId)
      expect(FakeWorker.all[0].terminated).toBe(false)
      expect(FakeWorker.all[0].posted.some((m) => m.type === 'frame' && (m.request as SessionRequest).sceneId === third.posted[1].sceneId)).toBe(true)
    } finally {
      engine.dispose()
      await load('?worker=0')
    }
  })

  it('turns the bake off when its worker dies, says so in the status line, and does not bake on this thread; the model’s worker is not the bake’s', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { engine, statuses } = await withWorkers()
    try {
      engine.render(bview(), BP, 'none', FRAMING)
      await vi.waitFor(() => expect(FakeWorker.all[1]?.types()).toContain('bake'), { timeout: 10_000, interval: 5 })
      FakeWorker.all[1].onerror?.({ message: 'boom' })
      const last = statuses[statuses.length - 1]
      expect(last.path).toBe('live')
      expect(last.painting).toBeNull()
      expect(last.why).toMatch(/bake worker stopped.*boom/)
      // the worker that threw is stopped, not left running: the engine lets go of the host, and its dispose() would not find it
      expect(FakeWorker.all[1].terminated).toBe(true)
      expect(FakeWorker.all[0].terminated).toBe(false)
      // from now on no bake is asked for, anywhere: no new worker, and no bake on this thread (the model's worker is the live one)
      const posted = FakeWorker.all.map((w) => w.types().length)
      engine.render(bview(), setParam(BP, 'light.azimuth', 40), 'none', FRAMING)
      await sleep(BAKE_DEBOUNCE_MS + 250)
      expect(FakeWorker.all.length).toBe(2)
      expect(FakeWorker.all.some((w) => w.types().includes('bake') && w !== FakeWorker.all[1])).toBe(false)
      expect(FakeWorker.all[1].posted.filter((m) => m.type === 'bake').length).toBe(1)
      expect(FakeWorker.all[0].types().length).toBeGreaterThanOrEqual(posted[0])
      expect(statuses[statuses.length - 1].why).toMatch(/bake worker stopped/)
    } finally {
      engine.dispose()
      vi.restoreAllMocks()
      await load('?worker=0')
    }
  })

  it('does not start a worker for the bake when it is not wanted (the model’s worker alone for a figure drawn per frame, and for the Showcase)', async () => {
    const { engine } = await withWorkers()
    try {
      engine.render(bview(), FLAT, 'none', FRAMING)
      await sleep(BAKE_DEBOUNCE_MS + 150)
      expect(FakeWorker.all.length).toBe(1)
      const target = { canvas: { width: 100, height: 75 }, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
      void engine.renderTo(target, bview(), BP, 'none').catch(() => {})
      await sleep(50)
      expect(FakeWorker.all.length).toBe(1)
    } finally {
      engine.dispose()
      await load('?worker=0')
    }
  })

  it('bakes on this thread, in the model’s own session, when &worker=0 asked for it (the default of this file): no worker is made, and the baked frames come', async () => {
    FakeWorker.all = []
    vi.stubGlobal('Worker', FakeWorker)
    const gl = createPaintFakeGl({}, { width: 320, height: 240 })
    Object.assign(gl.canvas.canvas, { style: {} })
    const frames: FrameStats[] = []
    const inner = createPaintEngine(gl.canvas.canvas, { onFrame: (f) => frames.push(f), onError: () => {} })
    const engine: PaintEngine = { ...inner, render: (v, p, d, a, b) => inner.render({ ...v, lightDir: worldLightOf(p) }, p, d, a, b) }
    engine.setScene(BSCENE, COLOURS)
    engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(frames.some((f) => f.kind === 'baked')).toBe(true), { timeout: 120_000, interval: 5 })
    expect(FakeWorker.all.length).toBe(0)
    engine.dispose()
  })
})

describe('the baked painting: a bake worker that died', () => {
  it('is terminated when it errors, and again nothing is left running when the engine is disposed after (final fix wave, T6-Low)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    FakeWorker.all = []
    vi.stubGlobal('Worker', FakeWorker)
    await load('?')
    const gl = createPaintFakeGl({}, { width: 320, height: 240 })
    Object.assign(gl.canvas.canvas, { style: {} })
    const inner = createPaintEngine(gl.canvas.canvas, { onFrame: () => {}, onError: () => {}, onBake: () => {} })
    const engine: PaintEngine = { ...inner, render: (v, p, d, a, b) => inner.render({ ...v, lightDir: worldLightOf(p) }, p, d, a, b) }
    engine.setScene(BSCENE, COLOURS)
    try {
      engine.render(bview(), BP, 'none', FRAMING)
      await vi.waitFor(() => expect(FakeWorker.all[1]?.types()).toContain('bake'), { timeout: 10_000, interval: 5 })
      const [model, bake] = FakeWorker.all
      expect(bake.terminated).toBe(false)
      bake.onerror?.({ message: 'it broke' })
      expect(bake.terminated).toBe(true)
      // (it does not talk to the engine any more)
      expect(bake.onmessage).toBeNull()
      expect(bake.onerror).toBeNull()
      expect(model.terminated).toBe(false)
      engine.dispose()
      expect(model.terminated).toBe(true)
      expect(bake.terminated).toBe(true)
      expect(FakeWorker.all.length).toBe(2)
    } finally {
      vi.restoreAllMocks()
      await load('?worker=0')
    }
  })
})

describe('the baked painting: coming back to it', () => {
  it('holds the live picture, on the way back from a debug view, until a bake for the params of the moment lands: a stale bake is not shown', async () => {
    const t = bakeSetup({ manual: true })
    await t.ready()
    const live = async (params: PaintParams, debug: PaintDebugMode) => {
      const n = t.frames.length
      t.engine.render(bview({ azimuth: 45 }), params, debug, FRAMING)
      await vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })
      return t.frames[t.frames.length - 1]
    }
    const moved = setParam(BP, 'light.azimuth', 15)
    expect(await live(BP, 'value')).toMatchObject({ kind: 'full', path: 'live' })
    // the light moves in the debug view (a bake is not wanted there), then the debug view goes: the bake held is for the old light
    expect(await live(moved, 'value')).toMatchObject({ kind: 'full', path: 'live' })
    expect(await live(moved, 'none')).toMatchObject({ kind: 'full', path: 'live' })
    // ... and stays the per-frame painter's while the new bake is made (150 ms, and the bake in flight)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[1].params).toBe(moved)
    expect(await live(moved, 'none')).toMatchObject({ path: 'live' })
    expect(t.statuses[t.statuses.length - 1].path).toBe('live')
    expect(t.statuses[t.statuses.length - 1].painting).not.toBeNull()
    // the bake lands: it takes over, at once
    t.host.release()
    await vi.waitFor(() => expect(t.frames[t.frames.length - 1].kind).toBe('baked'), { timeout: 120_000, interval: 5 })
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'baked', painting: null, why: null })
    t.engine.dispose()
  })

  it('keeps the old bake on screen when it is the baked path already (a slider moved: the old bake until the new one lands, as ruled)', async () => {
    const t = bakeSetup({ manual: true })
    await t.ready()
    const n = t.frames.length
    t.engine.render(bview(), setParam(BP, 'light.azimuth', 15), 'none', FRAMING)
    expect(t.frames.length).toBe(n + 1)
    expect(t.frames[n]).toMatchObject({ kind: 'baked', path: 'baked' })
    t.engine.dispose()
  })

  it('enters the baked path on a bake that is right for the params of the moment even when the colours still to be made again (a recolour is on its way)', async () => {
    const t = bakeSetup({ manual: true })
    await t.ready()
    const colour = setParam(BP, 'curve.warmHue', 20)
    t.engine.render(bview(), BP, 'value', FRAMING)
    const n = t.frames.length
    t.engine.render(bview(), colour, 'none', FRAMING)
    expect(t.frames[n]).toMatchObject({ kind: 'baked', path: 'baked' })
    t.engine.dispose()
  })
})

describe('the baked painting: the Bake switch', () => {
  // The lab's view setting (the panel's "Bake (instant orbit)"), given to render() as its fifth argument; it is not a painter parameter. The light is
  // fixed in the world throughout (BP's is), so the switch is the only thing that decides.
  const waitFrames = (t: { frames: FrameStats[] }, n: number) => vi.waitFor(() => expect(t.frames.length).toBeGreaterThan(n), { timeout: 60_000, interval: 5 })

  it('draws per frame, with no bake asked for, while it is off, though the light is fixed in the world: every slider is a live frame at once', async () => {
    expect(BP.light.worldFixed).toBe(1)
    const t = bakeSetup()
    t.engine.render(bview(), BP, 'none', FRAMING, false)
    await waitFrames(t, 0)
    expect(t.frames[0]).toMatchObject({ kind: 'full', path: 'live', buildMs: 0 })
    // a slider the bake would have made anew (the light, a role's size) and one it would have made the colours of again: each a frame of the live
    // painter's, asked for at once and not after a bake
    const light = setParam(BP, 'light.azimuth', 20)
    const role = setParam(light, 'roles.block.width', 30)
    const colour = setParam(role, 'curve.warmHue', 20)
    for (const [params, kind] of [[light, 'full'], [role, 'full'], [colour, 'colour']] as const) {
      const n = t.frames.length
      t.engine.render(bview(), params, 'none', FRAMING, false)
      await waitFrames(t, n)
      expect(t.frames[t.frames.length - 1]).toMatchObject({ kind, path: 'live' })
    }
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests).toEqual([])
    expect(t.host.recolourRequests).toEqual([])
    expect(t.host.cancels).toBe(0)
    expect(t.baked()).toEqual([])
    expect(t.live.frameRequests.length).toBeGreaterThanOrEqual(4)
    expect(t.statuses.every((s) => s.path === 'live' && s.painting === null && s.why === null)).toBe(true)
    // a drag is the live orbit's, too
    t.engine.render(bview({ azimuth: 40, dragging: true }), colour, 'none', FRAMING, false)
    expect(t.frames[t.frames.length - 1].kind).toBe('reproject')
    t.engine.dispose()
  })

  it('stops a bake in the making when it is turned off, for real, and the live frames come at once: nothing waits for the bake, and it never lands', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    await waitFrames(t, 0) // (the first load's picture, the live painter's, with the bake in flight)
    expect(t.host.held).toBe(1)
    expect(t.statuses[t.statuses.length - 1]).toMatchObject({ path: 'live', painting: 0 })
    const n = t.frames.length
    const asked = t.live.frameRequests.length
    const painted = t.composites()
    t.engine.render(bview({ azimuth: 45 }), BP, 'none', FRAMING, false)
    // the host is told in the task of the render: terminated and made again, nothing in it to wait for, and the status line has no "Painting…"
    expect(t.host.cancels).toBe(1)
    expect(t.host.respawns).toBe(1)
    expect(t.host.held).toBe(0)
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'live', painting: null, why: null })
    // the live picture comes at once, with the bake never done: the strokes of the first load's frame (the live base, which the bake in the making never
    // replaced) through the new view, painted; then the model's own frame for the view the camera stopped at
    await waitFrames(t, n)
    expect(t.frames[n]).toMatchObject({ kind: 'reproject', path: 'live' })
    expect(t.composites()).toBeGreaterThan(painted)
    await vi.waitFor(() => expect(t.live.frameRequests.length).toBeGreaterThan(asked), { timeout: 60_000, interval: 5 })
    await waitFrames(t, n + 1)
    expect(t.frames[n + 1]).toMatchObject({ kind: 'full', path: 'live' })
    // and it stays off: nothing is baked, not even for a slider
    t.engine.render(bview({ azimuth: 45 }), setParam(BP, 'light.azimuth', 15), 'none', FRAMING, false)
    t.host.release()
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.baked()).toEqual([])
    expect(t.frames.every((f) => f.path === 'live')).toBe(true)
    expect(t.errors.filter((m) => m !== null)).toEqual([])
    t.engine.dispose()
  })

  it('leaves the baked picture for the live one when it is turned off after the bake landed: the next frame and every slider are the live painter’s, with no new bake or recolour', async () => {
    const t = bakeSetup()
    await t.ready()
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'baked', painting: null, why: null })
    const n = t.frames.length
    t.engine.render(bview({ azimuth: 45 }), BP, 'none', FRAMING, false)
    await waitFrames(t, n)
    expect(t.frames[n]).toMatchObject({ kind: 'full', path: 'live' })
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'live', painting: null, why: null })
    const m = t.frames.length
    t.engine.render(bview({ azimuth: 45 }), setParam(BP, 'curve.warmHue', 20), 'none', FRAMING, false)
    await waitFrames(t, m)
    expect(t.frames[m]).toMatchObject({ kind: 'colour', path: 'live' })
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.host.recolourRequests).toEqual([])
    t.engine.dispose()
  })

  it('does not start the bake that is waiting out its debounce when it is turned off', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING)
    expect(t.statuses[t.statuses.length - 1]).toMatchObject({ painting: 0 })
    t.engine.render(bview(), BP, 'none', FRAMING, false)
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'live', painting: null, why: null })
    await sleep(BAKE_DEBOUNCE_MS + 250)
    expect(t.host.bakeRequests).toEqual([])
    expect(t.host.cancels).toBe(0)
    t.engine.dispose()
  })

  it('asks for a bake of the moment when it is turned on, says "Painting…", and keeps the live picture until it lands', async () => {
    const t = bakeSetup({ manual: true })
    t.engine.render(bview(), BP, 'none', FRAMING, false)
    await waitFrames(t, 0)
    await sleep(BAKE_DEBOUNCE_MS + 100)
    expect(t.host.bakeRequests).toEqual([])
    // on, with the light moved while it was off
    const moved = setParam(BP, 'light.azimuth', 15)
    t.engine.render(bview(), moved, 'none', FRAMING, true)
    expect(t.statuses[t.statuses.length - 1]).toMatchObject({ path: 'live', painting: 0 })
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(1), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[0].params).toBe(moved)
    expect(t.host.bakeRequests[0].lightDir).toEqual(worldLightOf(moved))
    // the picture holds as the live painter's while the bake is made, a view moved included
    const n = t.frames.length
    t.engine.render(bview({ azimuth: 50 }), moved, 'none', FRAMING)
    await waitFrames(t, n)
    expect(t.frames.slice(n).every((f) => f.path === 'live')).toBe(true)
    expect(t.baked()).toEqual([])
    expect(t.statuses[t.statuses.length - 1].painting).not.toBeNull()
    // the bake lands and takes over
    t.host.release()
    await vi.waitFor(() => expect(t.frames[t.frames.length - 1].kind).toBe('baked'), { timeout: 120_000, interval: 5 })
    expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'baked', painting: null, why: null })
    t.engine.dispose()
  })

  it('never shows a stale bake when it is turned on again: the live picture holds if a slider moved while it was off, and the bake held is entered at once if none did', async () => {
    const t = bakeSetup({ manual: true })
    await t.ready()
    const go = async (params: PaintParams, bake: boolean) => {
      const n = t.frames.length
      t.engine.render(bview({ azimuth: 45 }), params, 'none', FRAMING, bake)
      await waitFrames(t, n)
      return t.frames[t.frames.length - 1]
    }
    expect(await go(BP, false)).toMatchObject({ kind: 'full', path: 'live' })
    // back on with nothing moved: the bake held is right for these params, and is the picture in the task of the render, with no new bake
    const n = t.frames.length
    t.engine.render(bview({ azimuth: 45 }), BP, 'none', FRAMING, true)
    expect(t.frames[n]).toMatchObject({ kind: 'baked', path: 'baked' })
    await sleep(BAKE_DEBOUNCE_MS + 100)
    expect(t.host.bakeRequests.length).toBe(1)
    // off, the light moved, on: the bake held is for the old light and is not shown; a new one is asked for and the live picture holds until it lands
    const moved = setParam(BP, 'light.azimuth', 15)
    expect(await go(BP, false)).toMatchObject({ path: 'live' })
    expect(await go(moved, false)).toMatchObject({ kind: 'full', path: 'live' })
    expect(await go(moved, true)).toMatchObject({ path: 'live' })
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[1].params).toBe(moved)
    expect(await go(moved, true)).toMatchObject({ path: 'live' })
    t.host.release()
    await vi.waitFor(() => expect(t.frames[t.frames.length - 1].kind).toBe('baked'), { timeout: 120_000, interval: 5 })
    expect(t.host.maxRunning).toBe(1)
    t.engine.dispose()
  })

  it('can be turned on and off over and over with one bake at a time and no blank frame: each stop paints a live picture at once, and the last bake lands', async () => {
    const t = bakeSetup({ manual: true })
    for (let i = 0; i < 4; i++) {
      const params = setParam(BP, 'light.azimuth', 10 + 5 * i)
      t.engine.render(bview(), params, 'none', FRAMING, true)
      await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(i + 1), { timeout: 60_000, interval: 5 })
      expect(t.host.held).toBe(1)
      const n = t.frames.length
      const painted = t.composites()
      t.engine.render(bview(), params, 'none', FRAMING, false)
      expect(t.host.held).toBe(0)
      expect(t.host.cancels).toBe(i + 1)
      // a frame is painted at once (the canvas is drawn again, never left cleared), and it is the live painter's
      await waitFrames(t, n)
      expect(t.frames[t.frames.length - 1]).toMatchObject({ path: 'live' })
      expect(t.composites()).toBeGreaterThan(painted)
      expect(t.statuses[t.statuses.length - 1]).toEqual({ path: 'live', painting: null, why: null })
    }
    t.engine.render(bview(), BP, 'none', FRAMING, true)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(5), { timeout: 60_000, interval: 5 })
    t.host.release()
    await vi.waitFor(() => expect(t.frames[t.frames.length - 1].kind).toBe('baked'), { timeout: 120_000, interval: 5 })
    expect(t.host.maxRunning).toBe(1)
    expect(t.baked().length).toBeGreaterThanOrEqual(1)
    expect(t.errors.filter((m) => m !== null)).toEqual([])
    t.engine.dispose()
  })

  it('keeps no more than the model’s worker and one for the bake however often it is turned on and off: each stop terminates the one it stops, and none is made while it is off', async () => {
    FakeWorker.all = []
    vi.stubGlobal('Worker', FakeWorker)
    await load('?')
    const gl = createPaintFakeGl({}, { width: 320, height: 240 })
    Object.assign(gl.canvas.canvas, { style: {} })
    const inner = createPaintEngine(gl.canvas.canvas, { onFrame: () => {}, onError: () => {} })
    const engine: PaintEngine = { ...inner, render: (v, p, d, a, b) => inner.render({ ...v, lightDir: worldLightOf(p) }, p, d, a, b) }
    engine.setScene(BSCENE, COLOURS)
    const alive = () => FakeWorker.all.filter((w) => !w.terminated).length
    try {
      // off from the start: the model's worker only, and no worker for a bake that is not wanted
      engine.render(bview(), BP, 'none', FRAMING, false)
      await sleep(BAKE_DEBOUNCE_MS + 150)
      expect(FakeWorker.all.length).toBe(1)
      for (let i = 0; i < 3; i++) {
        engine.render(bview(), BP, 'none', FRAMING, true)
        await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1].types()).toContain('bake'), { timeout: 10_000, interval: 5 })
        const working = FakeWorker.all[FakeWorker.all.length - 1]
        expect(alive()).toBe(2)
        engine.render(bview(), BP, 'none', FRAMING, false)
        expect(working.terminated).toBe(true)
        // (the worker made again, with the scene, is the one a next bake goes to)
        expect(alive()).toBe(2)
        expect(FakeWorker.all[FakeWorker.all.length - 1].types()).toEqual(['scene'])
      }
      expect(FakeWorker.all[0].terminated).toBe(false)
      expect(FakeWorker.all.length).toBe(1 + 1 + 3)
      // on and off again inside the debounce: no worker is stopped, none is made
      engine.render(bview(), BP, 'none', FRAMING, true)
      engine.render(bview(), BP, 'none', FRAMING, false)
      await sleep(BAKE_DEBOUNCE_MS + 150)
      expect(FakeWorker.all.length).toBe(5)
      expect(alive()).toBe(2)
    } finally {
      engine.dispose()
      expect(alive()).toBe(0)
      await load('?worker=0')
    }
  })
})

describe('the baked painting: the stage may be resized', () => {
  const FIGURE = buildFigure('@frame: none\n@bounds3d: x [-2, 2], y [-2, 2], z [0, 4]\n@camera: azimuth 20, elevation 30, zoom 1.5\nz = x^2 for x in [-2, 2], y in [-2, 2]')

  it('keeps the bake for a stage within a factor of two of the one the framing was made at, and bakes again for one past it', async () => {
    const t = bakeSetup({ manual: true })
    const first = heldFraming(null, FIGURE, { width: 3200, height: 240 })
    await t.ready(BP, first.framing)
    // a taller stage, and a shorter one (a landscape stage: the height is what sets the px), within the band: the same framing, so no bake, no cancel, nothing asked
    const within = heldFraming(first, FIGURE, { width: 3200, height: 400 })
    expect(within).toBe(first)
    t.engine.render(bview(), BP, 'none', within.framing)
    const shrunk = heldFraming(within, FIGURE, { width: 3200, height: 140 })
    expect(shrunk).toBe(first)
    t.engine.render(bview(), BP, 'none', shrunk.framing)
    await sleep(BAKE_DEBOUNCE_MS + 200)
    expect(t.host.bakeRequests.length).toBe(1)
    expect(t.host.cancels).toBe(0)
    expect(t.frames[t.frames.length - 1].path).toBe('baked')
    // past it (a stage 2.5 times as high): a new framing, and a bake for it, the old bake on screen meanwhile
    const larger = heldFraming(shrunk, FIGURE, { width: 3200, height: 600 })
    expect(larger).not.toBe(first)
    t.engine.render(bview(), BP, 'none', larger.framing)
    expect(t.frames[t.frames.length - 1].path).toBe('baked')
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    expect(t.host.bakeRequests[1].authored).toEqual(larger.framing)
    expect(t.host.bakeRequests[1].authored.worldPerPx).toBeLessThan(first.framing.worldPerPx / 2)
    t.engine.dispose()
  })

  it('bakes again for a stage that is too small, too', async () => {
    const t = bakeSetup()
    const first = heldFraming(null, FIGURE, { width: 3200, height: 240 })
    await t.ready(BP, first.framing)
    const small = heldFraming(first, FIGURE, { width: 3200, height: 100 })
    expect(small).not.toBe(first)
    t.engine.render(bview(), BP, 'none', small.framing)
    await vi.waitFor(() => expect(t.host.bakeRequests.length).toBe(2), { timeout: 60_000, interval: 5 })
    t.engine.dispose()
  })
})

describe('the baked painting: the underpainting follows a recolour', () => {
  it('writes the recoloured underpainting into the GPU’s colour buffers of the baked surfaces, one write each, with the colours the worker made', async () => {
    const t = bakeSetup()
    await t.ready()
    await sleep(60)
    const surfaces = t.host.bakes[0].surfaces
    const marks = surfaces.map((s, m) => (s ? m : -1)).filter((m) => m >= 0)
    expect(marks.length).toBeGreaterThanOrEqual(2)
    const lengths = new Set(marks.map((m) => colourData(surfaces[m]!).length))
    const writes = () => t.gl.fake.calls.filter((c) => c.fn === 'bufferSubData' && c.args[2] instanceof Float32Array && lengths.has((c.args[2] as Float32Array).length))
    const before = writes().length
    t.engine.render(bview(), setParam(BP, 'curve.warmHue', 20), 'none', FRAMING)
    await vi.waitFor(() => expect(t.host.recoloured.length).toBe(1), { timeout: 60_000, interval: 5 })
    await vi.waitFor(() => expect(writes().length).toBeGreaterThan(before), { timeout: 10_000, interval: 5 })
    const written = writes().slice(before)
    expect(written.length).toBeGreaterThanOrEqual(1)
    const colours = t.host.recoloured[0]
    const recoloured = marks.map((m) => Array.from(colourData({ ...surfaces[m]!, underFront: colours.surfaces[m]!.underFront, underBack: colours.surfaces[m]!.underBack })))
    const old = marks.map((m) => Array.from(colourData(surfaces[m]!)))
    for (const w of written) {
      const data = Array.from(w.args[2] as Float32Array)
      // each write is the recoloured underpainting of a baked surface, and not the colours the bake was made with
      expect(recoloured.some((r) => r.length === data.length && r.every((v, i) => v === data[i]))).toBe(true)
      expect(old.some((r) => r.length === data.length && r.every((v, i) => v === data[i]))).toBe(false)
    }
    t.engine.dispose()
  })
})

describe('the baked painting: the G-buffer at rest only', () => {
  it('starts no readback under a drag (the silhouettes read the canvas), and one when the camera stops', async () => {
    const t = bakeSetup()
    await t.ready()
    // let what the first frames asked for land
    await sleep(120)
    const passes = t.gbuffers()
    const reads = t.gl.reads.length
    for (let k = 1; k <= 30; k++) t.engine.render(bview({ azimuth: 30 + 3 * k, dragging: true }), BP, 'none', FRAMING)
    await sleep(120)
    expect(t.gbuffers()).toBe(passes)
    expect(t.gl.reads.length).toBe(reads)
    // the pointer is released: a frame at rest, and its G-buffer, for this view
    t.engine.render(bview({ azimuth: 120 }), BP, 'none', FRAMING)
    await vi.waitFor(() => expect(t.gbuffers()).toBeGreaterThan(passes), { timeout: 10_000, interval: 5 })
    t.engine.dispose()
  })

  it('gives a frame under a drag no G-buffer, even when one was read for its very view: the silhouettes read the canvas there (the frame is the one made before any readback landed, not the one made with it)', async () => {
    const t = bakeSetup()
    const v = bview()
    // the sphere and its table as the G-buffer: beyond the outline the silhouettes have another mark to read (the table)
    const g = sphereGBuffer(v.width, v.height, { view: v, params: BP, centre: [0, 0, 0], radius: 0.6, mark: 0, table: { z: -0.6, mark: 1 } })
    t.gl.setReadback((_a, _w, _h, dst) => {
      const out = dst as Float32Array
      for (let i = 0; i < g.width * g.height; i++) {
        const texel =
          g.mark[i] < 0
            ? [0, 0, 1e30, 0]
            : encodeFloatTexel({ normal: [g.normal[3 * i], g.normal[3 * i + 1], g.normal[3 * i + 2]], depth: g.depth[i], value: g.value[i], shadow: g.shadow[i] === 1, mark: g.mark[i] })
        out.set(texel, 4 * i)
      }
    })
    const params = setParam(BP, 'particles.dragDensity', 1)
    t.engine.render(v, params, 'none', FRAMING)
    await vi.waitFor(() => expect(t.baked().length).toBeGreaterThanOrEqual(2), { timeout: 120_000, interval: 5 })
    const bakedFrames = t.painted.filter((p) => p.kind === 'baked')
    // the first baked frame had no G-buffer (none had been read), the last has the one read for this view
    const without = bakedFrames[0].frame.strokes
    const withG = bakedFrames[bakedFrames.length - 1].frame.strokes
    expect(withG.count).toBe(without.count)
    expect(sumOf(withG.colour), 'the G-buffer reaches the silhouettes: the picture it makes differs').not.toBeCloseTo(sumOf(without.colour), 4)
    // the same view, dragging: the G-buffer for it is held, and is not used
    t.engine.render(v, params, 'none', FRAMING)
    expect(sumOf(t.painted[t.painted.length - 1].frame.strokes.colour)).toBeCloseTo(sumOf(withG.colour), 4)
    t.engine.render(bview({ dragging: true }), params, 'none', FRAMING)
    const dragged = t.painted[t.painted.length - 1].frame.strokes
    expect(dragged.count).toBe(without.count)
    expect(sumOf(dragged.colour)).toBeCloseTo(sumOf(without.colour), 4)
    expect(sumOf(dragged.colour)).not.toBeCloseTo(sumOf(withG.colour), 4)
    t.engine.dispose()
  })

  it('does not start a readback when a read that was begun at rest lands during a drag', async () => {
    const t = bakeSetup({ limits: { asyncReadback: true, fenceDelayPolls: 6 } })
    await t.ready()
    await sleep(200)
    // a frame at rest asks for its G-buffer, which is still with the GPU when the drag begins
    t.engine.render(bview({ azimuth: 80 }), BP, 'none', FRAMING)
    const passes = t.gbuffers()
    for (let k = 1; k <= 10; k++) t.engine.render(bview({ azimuth: 80 + 3 * k, dragging: true }), BP, 'none', FRAMING)
    await sleep(250)
    expect(t.gbuffers()).toBe(passes)
    t.engine.dispose()
  })
})
