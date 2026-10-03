import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../params'
import { createPaintFakeGl, timeline } from '../gl/fakePaintGl'
import { encodeFloatTexel } from '../gl/gbuffer'
import { edgeFade, matchStrokes } from '../liveOrbit'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { reprojectStrokes } from '../reproject'
import type { Scratch as ScratchClass } from '../scratch'
import { PaintSession, type FrameResponse, type SceneColourData, type SessionRequest, type SessionResponse } from '../session'
import { PATH_POINTS, ROLES, type PaintDebugMode, type PaintFrame, type PaintView, type StrokeBatch } from '../types'
import type { SpaceScene } from '../../scene/types'
import type { EngineEvents, EngineOptions, FrameStats, ModelHost, PaintEngine } from '../../../../../review/src/paintLabEngine'

// The Paint Lab's engine: one frame at a time, newest request wins, a colour-only change is a
// colour frame, a Showcase tile is copied when it is painted. It runs here on the fake GL and on
// the page's own thread (?worker=0); a Worker that fails falls back to that.
vi.setConfig({ testTimeout: 120_000 })

let createPaintEngine: typeof import('../../../../../review/src/paintLabEngine').createPaintEngine

// paintLabState reads the page's URL when it is imported.
async function load(search: string) {
  vi.resetModules()
  vi.stubGlobal('location', { search, href: `http://lab/paint-lab.html${search}` })
  ;({ createPaintEngine } = await import('../../../../../review/src/paintLabEngine'))
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
    return new Promise((resolve) => {
      this.waiting.push(() => {
        const response = this.session.frame(request)
        this.running--
        if (response.ok && response.kind !== 'paper') this.responses.push(response)
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
    go(sphereView({ azimuth: 40, dragging: true }), P) // the model starts a frame for it ...
    engine.setScene(SCENE, flatColours({ 0: [0.4, 0.1, -0.1], 1: [0.9, 0.01, 0.02] })) // ... and the theme changes
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
