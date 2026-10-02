import { describe, expect, it, vi } from 'vitest'
import { normalise, TABLE_SIZE } from '../colormaps'
import type { SceneColours, Oklab, StrokeBatch } from './types'
import { buildParticles, paintFrame } from './model/index'
import { lchToLab } from './model/colour'
import { arrowMark, flatColours, graphMesh, lineMark, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './model/testing'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from './params'
import {
  coloursFromData,
  colourDataOf,
  type FrameResponse,
  paperKey,
  PaintSession,
  plainScene,
  transferList,
  type PaperWanted,
  type SessionRequest,
  type SessionResponse,
} from './session'
import type { SpaceScene } from '../scene/types'

// A session runs the whole model and a paper; give every test room on a shared machine.
vi.setConfig({ testTimeout: 120_000 })

const P = DEFAULT_PAINT_PARAMS
const SPHERE = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85) })
const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 90 })
const gbuffer = (params: PaintParams = P) => sphereGBuffer(400, 300, { view, params, table: { z: -1, mark: 1 } })
const WANT: PaperWanted = { weave: 'duck', seed: 1, tone: [0.93, 0.004, 0.022], texture: 1, halve: true }

let ids = 0
const request = (overrides: Partial<SessionRequest> = {}): SessionRequest => ({
  id: ++ids,
  sceneId: 1,
  kind: 'full',
  params: P,
  view,
  gbuffer: gbuffer(),
  debug: 'none',
  havePaper: paperKey(WANT),
  paper: WANT,
  ...overrides,
})

const ok = (r: SessionResponse): FrameResponse => {
  if (!r.ok || r.kind === 'paper') throw new Error(JSON.stringify(r))
  return r
}

const sameBatch = (a: StrokeBatch, b: StrokeBatch) => {
  expect(a.count).toBe(b.count)
  for (const key of Object.keys(a) as (keyof StrokeBatch)[]) {
    if (key !== 'count') expect(Array.from(a[key] as ArrayLike<number>), String(key)).toEqual(Array.from(b[key] as ArrayLike<number>))
  }
}

const fresh = (): PaintSession => {
  const s = new PaintSession()
  s.setScene(1, plainScene(scene), colourDataOf(scene, SPHERE))
  return s
}

describe('handing a scene over to a worker', () => {
  it('plainScene takes the closures out, so the scene can be cloned, and leaves the geometry alone', () => {
    const saddle = graphMesh((x, y) => x * y, { half: 1, n: 6 })
    const withClosures: SpaceScene = sceneOf([{ ...saddle, pick: { kind: 'graph', f: () => 0, fx: () => 0, fy: () => 0 } }, { ...lineMark([[0, 0, 0], [1, 1, 1]]), pick: { param: 't', r: () => [0, 0, 0] as [number, number, number], dr: () => [0, 0, 0] as [number, number, number] } }])
    expect(() => structuredClone(withClosures)).toThrow()
    const plain = plainScene(withClosures)
    const clone = structuredClone(plain)
    expect(clone.marks.length).toBe(2)
    expect(plain.marks[0].kind === 'mesh' && plain.marks[0].pick).toBe(null)
    expect(plain.marks[0].kind === 'mesh' && plain.marks[0].positions).toBe((withClosures.marks[0] as typeof saddle).positions)
    expect(Array.from(clone.marks[0].kind === 'mesh' ? clone.marks[0].positions : [])).toEqual(Array.from(saddle.positions))
    // the scene it was given is not changed
    expect((withClosures.marks[0] as typeof saddle).pick).not.toBe(null)
  })

  it('colourDataOf and coloursFromData answer as the colours do: every mark, and every value of a colour scale', () => {
    const scales = [
      { id: 0, title: 'height', map: 'viridis' as const, domain: { min: -1, max: 3 }, diverging: false },
      { id: 1, title: 'x*y', map: 'balance' as const, domain: { min: -2, max: 5 }, diverging: true },
    ]
    const sc: SpaceScene = { ...sceneOf([sphereMesh(), tableMesh()]), colorScales: scales }
    // a colour scale IS a 256-entry table read at the value's rounded position
    const tables = scales.map((_s, k) => Array.from({ length: TABLE_SIZE }, (_, i): Oklab => lchToLab(0.3 + (0.5 * i) / TABLE_SIZE, 0.02 + 0.1 * ((i * 7) % 11) / 11, (i * 13 + k * 90) % 360)))
    const none: Oklab = [0.7, 0, 0]
    const colours: SceneColours = {
      markColour: (i) => lchToLab(0.5 + 0.1 * i, 0.1, 40 * (i + 1)),
      scaleColour: (id, v) => {
        const s = scales[id]
        if (!s) return null
        const t = normalise(v, s)
        return t === null ? none : tables[id][Math.round(t * (TABLE_SIZE - 1))]
      },
    }
    const data = coloursFromData(structuredClone(colourDataOf(sc, colours)))
    for (let i = 0; i < 2; i++) expect(data.markColour(i)).toEqual(colours.markColour(i))
    for (const id of [0, 1]) {
      // inside the domain, beyond it, exactly on its ends, at zero, and not a number
      for (let k = -40; k <= 140; k++) {
        const v = -3 + (k / 140) * 9
        expect(data.scaleColour(id, v), `scale ${id} at ${v}`).toEqual(colours.scaleColour(id, v))
      }
      for (const v of [-1, 3, -2, 5, 0, Number.NaN, 1e9, -1e9]) expect(data.scaleColour(id, v), `scale ${id} at ${v}`).toEqual(colours.scaleColour(id, v))
    }
    expect(data.scaleColour(7, 0.5)).toBe(null)
  })
})

describe('the paint session', () => {
  it('makes the frame the model makes for the same scene, view, G-buffer and parameters', () => {
    const session = fresh()
    const r = ok(session.frame(request()))
    expect(r.kind).toBe('full')
    const direct = paintFrame(scene, buildParticles(scene, SPHERE, P), view, gbuffer(), P)
    sameBatch(r.strokes, direct.strokes)
    expect(r.stats).toEqual(direct.stats)
    expect(Array.from(r.debug!.edgeSegments)).toEqual(Array.from(direct.debug.edgeSegments))
  })

  it('recolours when only colour parameters changed, giving what a full frame gives, with no G-buffer', () => {
    const session = fresh()
    ok(session.frame(request()))
    const warm = setParam(setParam(P, 'curve.warmHue', 20), 'environment.chroma', 0.08)
    const again = ok(session.frame(request({ kind: 'colour', params: warm, gbuffer: null })))
    expect(again.kind).toBe('colour')
    expect(again.debug).toBe(null)
    expect(again.timing.particlesMs).toBe(0)
    const full = ok(fresh().frame(request({ params: warm, gbuffer: gbuffer(warm) })))
    sameBatch(again.strokes, full.strokes)
    // and a second colour change is a recolour of the same first frame
    const cool = setParam(P, 'mix.strength', 1.5)
    sameBatch(ok(session.frame(request({ kind: 'colour', params: cool, gbuffer: null }))).strokes, ok(fresh().frame(request({ params: cool, gbuffer: gbuffer(cool) }))).strokes)
  })

  it('recolours for a change of the relief or the canvas too: no stroke moves under it', () => {
    const session = fresh()
    ok(session.frame(request()))
    const params = setParam(setParam(P, 'impasto.strength', 2), 'canvas.texture', 0.4)
    const again = ok(session.frame(request({ kind: 'colour', params, gbuffer: null })))
    const full = ok(fresh().frame(request({ params, gbuffer: gbuffer(params) })))
    sameBatch(again.strokes, full.strokes)
  })

  it('sends only the paper for a paper request, and does not touch the frame it holds', () => {
    const session = fresh()
    ok(session.frame(request()))
    const toned: PaperWanted = { ...WANT, texture: 0.5 }
    const r = session.frame(request({ kind: 'paper', gbuffer: null, havePaper: paperKey(WANT), paper: toned }))
    expect(r).toMatchObject({ ok: true, kind: 'paper' })
    expect(r.ok && r.kind === 'paper' ? r.paper?.key : null).toBe(paperKey(toned))
    expect(r.ok && r.kind === 'paper' ? r.timing.modelMs : -1).toBe(0)
    // the paper the page holds already: nothing to send
    const none = session.frame(request({ kind: 'paper', gbuffer: null, havePaper: paperKey(toned), paper: toned }))
    expect(none.ok && none.kind === 'paper' ? none.paper : 'x').toBe(null)
    // the frame it holds still recolours
    expect(session.frame(request({ kind: 'colour', params: setParam(P, 'curve.lSlope', 0.9), gbuffer: null }))).toMatchObject({ ok: true, kind: 'colour' })
    expect(transferList(r)).toHaveLength(1)
  })

  it('answers needFull when there is nothing to recolour, or the change is more than colour', () => {
    const session = fresh()
    const empty = session.frame(request({ kind: 'colour', gbuffer: null }))
    expect(empty).toMatchObject({ ok: false, needFull: true })
    ok(session.frame(request()))
    // the light, a stroke's size, the particles, the seed, the debug view: all need the analysis again
    for (const params of [setParam(P, 'light.azimuth', 50), setParam(P, 'roles.block.width', 30), setParam(P, 'particles.maxPerUnit2', 1500), setParam(P, 'seed', 4), setParam(P, 'mix.loadCell', 1)]) {
      expect(session.frame(request({ kind: 'colour', params, gbuffer: null }))).toMatchObject({ ok: false, needFull: true })
    }
    expect(session.frame(request({ kind: 'colour', debug: 'edges', gbuffer: null }))).toMatchObject({ ok: false, needFull: true })
    // another scene
    session.setScene(2, plainScene(scene), colourDataOf(scene, SPHERE))
    expect(session.frame(request({ kind: 'colour', sceneId: 2, gbuffer: null }))).toMatchObject({ ok: false, needFull: true })
    // new colours for the scene it recoloured from: its frame is gone
    ok(session.frame(request()))
    session.setColours(1, colourDataOf(scene, flatColours({ 0: lchToLab(0.4, 0.1, 200) })))
    expect(session.frame(request({ kind: 'colour', gbuffer: null }))).toMatchObject({ ok: false, needFull: true })
  })

  it('builds the particles once for a scene and its seed, and again when the seed, the packing or the colours change', () => {
    const session = fresh()
    const first = ok(session.frame(request()))
    expect(first.timing.particlesMs).toBeGreaterThan(0)
    expect(ok(session.frame(request({ params: setParam(P, 'roles.block.width', 30) }))).timing.particlesMs).toBe(0)
    const reseeded = setParam(P, 'seed', 3)
    expect(ok(session.frame(request({ params: reseeded, gbuffer: gbuffer(reseeded) }))).timing.particlesMs).toBeGreaterThan(0)
    const denser = setParam(reseeded, 'particles.maxPerUnit2', 1200)
    expect(ok(session.frame(request({ params: denser, gbuffer: gbuffer(denser) }))).timing.particlesMs).toBeGreaterThan(0)
    session.setColours(1, colourDataOf(scene, flatColours({ 0: lchToLab(0.4, 0.1, 200) })))
    expect(ok(session.frame(request({ params: denser, gbuffer: gbuffer(denser) }))).timing.particlesMs).toBeGreaterThan(0)
  })

  it('keeps a scene’s own particles: alternating between two scenes rebuilds neither', () => {
    const session = fresh()
    const other = sceneOf([sphereMesh({ radius: 0.7 }), tableMesh({ z: -1, half: 3, index: 1 })])
    session.setScene(2, plainScene(other), colourDataOf(other, SPHERE))
    ok(session.frame(request()))
    ok(session.frame(request({ sceneId: 2 })))
    expect(ok(session.frame(request())).timing.particlesMs).toBe(0)
    expect(ok(session.frame(request({ sceneId: 2 }))).timing.particlesMs).toBe(0)
  })

  it('sends the paper when the page does not hold the one wanted, halved or whole, and not otherwise', () => {
    const session = fresh()
    expect(ok(session.frame(request())).paper).toBe(null)
    const first = ok(session.frame(request({ havePaper: '' }))).paper!
    expect(first.key).toBe(paperKey(WANT))
    expect(first.size).toBe(512)
    expect(first.rgba.length).toBe(512 * 512 * 4)
    expect(first.height.length).toBe(512 * 512)
    // the full tile for a display with more device pixels
    const whole = ok(session.frame(request({ havePaper: '', paper: { ...WANT, halve: false } }))).paper!
    expect(whole.size).toBe(1024)
    // a new tone is a new colouring of the same weave: its key differs, and so do its texels
    const toned: PaperWanted = { ...WANT, tone: [0.7, 0.02, 0.05] }
    const second = ok(session.frame(request({ havePaper: paperKey(WANT), paper: toned }))).paper!
    expect(second.key).toBe(paperKey(toned))
    expect(Array.from(second.rgba.subarray(0, 64))).not.toEqual(Array.from(first.rgba.subarray(0, 64)))
    // a recolour carries the paper too
    expect(ok(session.frame(request({ kind: 'colour', gbuffer: null, havePaper: paperKey(WANT), paper: toned }))).paper?.key).toBe(paperKey(toned))
  })

  it('builds only the debug arrays the view in use reads', () => {
    const session = fresh()
    const none = ok(session.frame(request({ debug: 'none' }))).debug!
    expect([none.value, none.zones, none.planes]).toEqual([null, null, null])
    expect(none.edgeSegments.length % 4).toBe(0)
    const g = gbuffer()
    const value = ok(session.frame(request({ debug: 'value', gbuffer: gbuffer() }))).debug!
    expect(value.value!.length).toBe(g.width * g.height)
    expect([value.zones, value.planes]).toEqual([null, null])
    expect(ok(session.frame(request({ debug: 'zones', gbuffer: gbuffer() }))).debug!.zones!.length).toBe(g.width * g.height)
    expect(ok(session.frame(request({ debug: 'planes', gbuffer: gbuffer() }))).debug!.planes!.length).toBe(g.width * g.height)
    const edges = ok(session.frame(request({ debug: 'edges', gbuffer: gbuffer() }))).debug!
    expect(edges.planes!.length).toBe(g.width * g.height)
    expect(edges.edgeClass.length).toBe(edges.edgeSegments.length / 4)
  })

  it('reports an unset scene and a missing G-buffer as errors, never throws', () => {
    const session = fresh()
    expect(session.frame(request({ sceneId: 9 }))).toMatchObject({ ok: false, error: expect.stringContaining('scene 9') })
    expect(session.frame(request({ gbuffer: null }))).toMatchObject({ ok: false, error: expect.stringContaining('G-buffer') })
    session.forget(1)
    expect(session.hasScene(1)).toBe(false)
  })

  it('hands back the arrays it made, but not the generator’s cached paper height', () => {
    const session = fresh()
    const r = ok(session.frame(request({ havePaper: '', debug: 'edges', paper: { ...WANT, halve: false } })))
    const list = transferList(r)
    const buffers = new Set(list)
    expect(buffers.has(r.strokes.path.buffer as ArrayBuffer)).toBe(true)
    expect(buffers.has(r.strokes.colour.buffer as ArrayBuffer)).toBe(true)
    expect(buffers.has(r.debug!.planes!.buffer as ArrayBuffer)).toBe(true)
    expect(buffers.has(r.paper!.rgba.buffer as ArrayBuffer)).toBe(true)
    expect(buffers.has(r.paper!.height.buffer as ArrayBuffer)).toBe(false)
    expect(new Set(list).size).toBe(list.length)
    expect(transferList({ id: 1, ok: false, needFull: true })).toEqual([])
    // a lines-and-arrows scene works through the session as well
    const marks = sceneOf([lineMark([[0, -1, 0], [0, 1, 1]]), arrowMark([0, 0, 0], [1, 0, 0.5], { index: 1 })])
    const s2 = new PaintSession()
    s2.setScene(5, plainScene(marks), colourDataOf(marks, SPHERE))
    expect(ok(s2.frame(request({ sceneId: 5, gbuffer: gbuffer() }))).stats.byRole.line).toBeGreaterThan(1)
  })
})
