import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../params'
import { createPaintFakeGl, timeline } from '../gl/fakePaintGl'
import { encodeFloatTexel } from '../gl/gbuffer'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import type { PaintDebugMode, PaintFrame, PaintView, StrokeBatch } from '../types'
import type { EngineEvents, FrameStats, PaintEngine } from '../../../../../review/src/paintLabEngine'

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

function withPicture() {
  const painted: { frame: PaintFrame; kind: FrameStats['kind'] }[] = []
  const crossfades: number[] = []
  const snapshot = { canvas: { width: 0, height: 0 }, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  const gl = createPaintFakeGl({}, { width: 320, height: 240 })
  Object.assign(gl.canvas.canvas, { style: {} })
  const frames: FrameStats[] = []
  const errors: (string | null)[] = []
  const engine = createPaintEngine(
    gl.canvas.canvas,
    { onFrame: (f) => frames.push(f), onError: (m) => errors.push(m), onCrossfade: () => crossfades.push(frames.length), onPaint: (frame, kind) => painted.push({ frame, kind }) },
    { snapshot },
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

  it('does not paint a model frame over a newer re-projected picture, and keeps its strokes for the next re-projection', async () => {
    vi.useFakeTimers()
    try {
      const { engine, frames, painted, go } = withPicture()
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
      // the model's frame (for zoom 230) was made but is older than the picture on screen: not painted, not reported
      expect(kinds(frames)).toEqual(['full', 'reproject', 'reproject'])
      expect(painted.map((p) => p.kind)).toEqual(['full', 'reproject', 'reproject'])
      // its strokes are the ones the next re-projection starts from
      go(sphereView({ azimuth: 66, dragging: true }), P)
      const fromAdopted = painted[painted.length - 1].frame.strokes
      expect(fromAdopted.colour).not.toBe(painted[0].frame.strokes.colour)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
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
