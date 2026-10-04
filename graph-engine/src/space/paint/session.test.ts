import { describe, expect, it, vi } from 'vitest'
import { normalise, TABLE_SIZE } from '../colormaps'
import { colourisePaper, generatePaper } from '../../style/papers/generate/index'
import type { SceneColours, Oklab, StrokeBatch } from './types'
import { buildParticles, paintFrame } from './model/index'
import { lchToLab } from './model/colour'
import { arrowMark, flatColours, graphMesh, lineMark, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './model/testing'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from './params'
import { bakePainting } from './bake/index'
import type { AuthoredFraming, BakedPainting } from './bake/types'
import { worldLight } from './model/valueFinalFixture'
import {
  bakePercent,
  bakeTransferList,
  coloursFromData,
  colourDataOf,
  recolourTransferList,
  type BakeAnswer,
  type BakeRequest,
  type RecolourRequest,
  withColours,
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
const WANT: PaperWanted = { weave: 'duck', seed: 1, tone: [0.93, 0.004, 0.022], texture: 1, ratio: 1 }

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

// The first index at which two images differ (NaN, the mark of an empty pixel, equals NaN), or -1.
const firstDifference = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return 0
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i
  return -1
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
    // the underpainting comes with it: three floats for every pixel of the G-buffer
    const g = gbuffer()
    expect(r.underpaint).toHaveLength(3 * g.width * g.height)
    expect(firstDifference(r.underpaint, direct.underpaint)).toBe(-1)
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
    // a colour frame carries the underpainting made again, as a full frame makes it
    expect(firstDifference(again.underpaint, full.underpaint)).toBe(-1)
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

  it('sends the paper when the page does not hold the one wanted, at two texels to the CSS px, and not otherwise', () => {
    const session = fresh()
    expect(ok(session.frame(request())).paper).toBe(null)
    const first = ok(session.frame(request({ havePaper: '' }))).paper!
    expect(first.key).toBe(paperKey(WANT))
    expect(first.size).toBe(512)
    expect(first.rgba.length).toBe(512 * 512 * 4)
    expect(first.height.length).toBe(512 * 512)
    // the whole 1024 tile at two device px to the CSS px, and 512 x ratio texels between: a tile always has two texels to the CSS px
    const whole = ok(session.frame(request({ havePaper: '', paper: { ...WANT, ratio: 2 } }))).paper!
    expect(whole.size).toBe(1024)
    expect(ok(session.frame(request({ havePaper: '', paper: { ...WANT, ratio: 1.25 } }))).paper!.size).toBe(640)
    expect(ok(session.frame(request({ havePaper: '', paper: { ...WANT, ratio: 1.5 } }))).paper!.size).toBe(768)
    // (a tile of another size is another paper)
    expect(paperKey({ ...WANT, ratio: 1.25 })).not.toBe(paperKey(WANT))
    expect(paperKey({ ...WANT, ratio: 1.0001 })).toBe(paperKey(WANT))
    // a new tone is a new colouring of the same weave: its key differs, and so do its texels
    const toned: PaperWanted = { ...WANT, tone: [0.7, 0.02, 0.05] }
    const second = ok(session.frame(request({ havePaper: paperKey(WANT), paper: toned }))).paper!
    expect(second.key).toBe(paperKey(toned))
    expect(Array.from(second.rgba.subarray(0, 64))).not.toEqual(Array.from(first.rgba.subarray(0, 64)))
    // a recolour carries the paper too
    expect(ok(session.frame(request({ kind: 'colour', gbuffer: null, havePaper: paperKey(WANT), paper: toned }))).paper?.key).toBe(paperKey(toned))
  })

  it('makes the paper as the weave’s own colour with no relief lit into it: the renderer lights the weave once', () => {
    // A tile colourised with its own grazing light (the paper module's pictures are) and then lit again by the
    // composite showed the weave's shading twice and read as burlap (a grey standard deviation of 16 of 255, against the
    // mockup canvas's 3). The session's tile is the flat colour: exactly colourisePaper at texture 0.
    const session = fresh()
    const paper = ok(session.frame(request({ havePaper: '', paper: { ...WANT, weave: 'linen', ratio: 2 } }))).paper!
    const tile = generatePaper('linen', { texture: WANT.texture, seed: String(WANT.seed), size: 1024 })
    const flat = colourisePaper(tile, WANT.tone, 0)
    expect(Array.from(paper.rgba.subarray(0, 4096))).toEqual(Array.from(flat.subarray(0, 4096)))
    const lit = colourisePaper(tile, WANT.tone, 1)
    expect(Array.from(lit.subarray(0, 4096))).not.toEqual(Array.from(flat.subarray(0, 4096)))
    // and the cloth's own brightness is a few levels (8 of 255), not the lit weave's sixteen
    const grey = (rgba: Uint8ClampedArray) => {
      let s = 0
      let s2 = 0
      const n = rgba.length / 4
      for (let i = 0; i < n; i++) {
        const g = (rgba[4 * i] + rgba[4 * i + 1] + rgba[4 * i + 2]) / 3
        s += g
        s2 += g * g
      }
      return Math.sqrt(s2 / n - (s / n) ** 2)
    }
    expect(grey(paper.rgba)).toBeLessThan(10)
    expect(grey(lit)).toBeGreaterThan(14)
  })

  it('scales the texture as the cloth’s contrast: no texture is a flat tone, and the height is flat too', () => {
    const session = fresh()
    const flat = ok(session.frame(request({ havePaper: '', paper: { ...WANT, texture: 0 } }))).paper!
    expect(new Set(Array.from(flat.rgba.subarray(0, 4000))).size).toBeLessThan(5)
    expect(Math.max(...flat.height.subarray(0, 1000))).toBe(Math.min(...flat.height.subarray(0, 1000)))
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
    const r = ok(session.frame(request({ havePaper: '', debug: 'edges', paper: { ...WANT, ratio: 2 } })))
    const list = transferList(r)
    const buffers = new Set(list)
    expect(buffers.has(r.strokes.path.buffer as ArrayBuffer)).toBe(true)
    expect(buffers.has(r.strokes.colour.buffer as ArrayBuffer)).toBe(true)
    expect(buffers.has(r.underpaint.buffer as ArrayBuffer)).toBe(true)
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

// ---- the baked painting ----

describe('the baked painting in the session', () => {
  // a small sphere alone: a bake is heavy and the machine shared
  const bakeScene = sceneOf([sphereMesh({ radius: 1, nu: 20, nv: 14 })])
  const SP = { ...P, particles: { ...P.particles, maxPerUnit2: 250 } }
  const LIGHT = worldLight(-35, 39)
  const AUTHORED: AuthoredFraming = { eye: [6, -2, 3], viewDir: [-0.9, 0.3, -0.45], ortho: false, worldPerPx: 1 / 150 }
  const bakeReq = (over: Partial<BakeRequest> = {}): BakeRequest => ({ id: ++ids, sceneId: 1, params: SP, lightDir: LIGHT, authored: AUTHORED, ...over })
  const recolourReq = (key: string, params: PaintParams, over: Partial<RecolourRequest> = {}): RecolourRequest => ({ id: ++ids, sceneId: 1, key, params, ...over })
  const made = (a: BakeAnswer): BakedPainting => {
    if (!a.ok) throw new Error(JSON.stringify(a))
    return a.baked
  }
  // The bake a session makes, made directly (no session, the colours as the session gets them: through the colour tables).
  const direct = (params: PaintParams): BakedPainting => {
    const hit = DIRECT.get(params)
    if (hit) return hit
    const colours = coloursFromData(colourDataOf(bakeScene, SPHERE))
    const baked = bakePainting(bakeScene, buildParticles(bakeScene, colours, params), colours, LIGHT, params, AUTHORED)
    DIRECT.set(params, baked)
    return baked
  }
  const DIRECT = new Map<PaintParams, BakedPainting>()
  const bytesEqual = (a: ArrayBufferView, b: ArrayBufferView): boolean => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0
  const arraysOf = (b: BakedPainting): Map<string, ArrayBufferView> => {
    const out = new Map<string, ArrayBufferView>()
    for (const [k, v] of Object.entries(b)) if (ArrayBuffer.isView(v)) out.set(k, v)
    b.surfaces.forEach((s, m) => {
      if (s) for (const [k, v] of Object.entries(s)) if (ArrayBuffer.isView(v)) out.set(`surfaces[${m}].${k}`, v)
    })
    return out
  }
  const session = (): PaintSession => {
    const s = new PaintSession()
    s.setScene(1, plainScene(bakeScene), colourDataOf(bakeScene, SPHERE))
    return s
  }
  const COLOUR_CHANGE = setParam(SP, 'curve.warmHue', 20)

  it('makes the painting the bake makes (bit for bit, key included), and reports its progress as whole percents, each once, from 0 to 100', () => {
    const s = session()
    const percents: number[] = []
    const a = s.bake(bakeReq(), (p) => percents.push(p))
    const baked = made(a)
    expect(a.ok && a.bakeMs).toBeGreaterThan(0)
    expect(a.ok && a.particlesMs).toBeGreaterThan(0)
    expect(baked.count).toBeGreaterThan(100)
    const want = direct(SP)
    expect(baked.key).toBe(want.key)
    const got = arraysOf(baked)
    for (const [k, v] of arraysOf(want)) expect(bytesEqual(got.get(k)!, v), k).toBe(true)
    expect(percents[0]).toBe(0)
    expect(percents[percents.length - 1]).toBe(100)
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThan(percents[i - 1])
    expect(percents.every((p) => Number.isInteger(p))).toBe(true)
    // the particles it built are held: the next bake of the scene builds none
    const b = s.bake(bakeReq({ params: setParam(SP, 'light.intensity', 0.8) }))
    expect(b.ok && b.particlesMs).toBe(0)
  })

  it('maps the phases to a percent that only grows (a phase’s end is its successor’s start)', () => {
    const phases = ['plan', 'planes', 'edges', 'strokes', 'underpaint', 'pack'] as const
    let last = -1
    for (const phase of phases) {
      for (const done of [0, 0.25, 0.5, 1]) {
        const p = bakePercent({ phase, done })
        expect(p).toBeGreaterThanOrEqual(last)
        last = p
      }
    }
    expect(bakePercent({ phase: 'plan', done: 0 })).toBe(0)
    expect(bakePercent({ phase: 'pack', done: 1 })).toBe(100)
    expect(bakePercent({ phase: 'plan', done: 1 })).toBe(bakePercent({ phase: 'planes', done: 0 }))
    expect(bakePercent({ phase: 'strokes', done: -1 })).toBe(bakePercent({ phase: 'strokes', done: 0 }))
  })

  it('recolours the bake it holds under colour-only params: only the colour arrays, equal to a fresh bake’s, bit for bit', () => {
    const s = session()
    const baked = made(s.bake(bakeReq()))
    const r = s.recolour(recolourReq(baked.key, COLOUR_CHANGE))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const fresh = direct(COLOUR_CHANGE)
    expect(bytesEqual(r.colours.colour, fresh.colour)).toBe(true)
    expect(bytesEqual(r.colours.dataColour, fresh.dataColour)).toBe(true)
    r.colours.surfaces.forEach((u, m) => {
      const f = fresh.surfaces[m]
      if (!f) return expect(u).toBeNull()
      expect(bytesEqual(u!.underFront, f.underFront)).toBe(true)
      expect(f.underBack === null ? u!.underBack === null : bytesEqual(u!.underBack!, f.underBack)).toBe(true)
    })
    // and it really changed the colours
    expect(bytesEqual(r.colours.colour, baked.colour)).toBe(false)
    // the page's copy with the colours swapped in is the fresh bake in every array
    const page = withColours(structuredClone(baked), r.colours)
    const want = arraysOf(fresh)
    for (const [k, v] of arraysOf(page)) expect(bytesEqual(v, want.get(k)!), k).toBe(true)
    // a recolour of the recolour, back to the first colours, is the first bake's colours
    const back = s.recolour(recolourReq(baked.key, SP))
    expect(back.ok && bytesEqual(back.colours.colour, direct(SP).colour)).toBe(true)
  })

  it('shares by identity every array of the page’s bake that is not a colour (withColours), so what is keyed to them stays', () => {
    const s = session()
    const baked = made(s.bake(bakeReq()))
    const r = s.recolour(recolourReq(baked.key, COLOUR_CHANGE))
    if (!r.ok) throw new Error('no recolour')
    const next = withColours(baked, r.colours)
    expect(next).not.toBe(baked)
    expect(next.worldPath).toBe(baked.worldPath)
    expect(next.areaPerParticle).toBe(baked.areaPerParticle)
    expect(next.key).toBe(baked.key)
    expect(next.colour).toBe(r.colours.colour)
    baked.surfaces.forEach((surface, m) => {
      if (!surface) return
      const n = next.surfaces[m]!
      expect(n.positions).toBe(surface.positions)
      expect(n.alphaFront).toBe(surface.alphaFront)
      expect(n.underFront).toBe(r.colours.surfaces[m]!.underFront)
    })
  })

  it('answers needBake for a bake it does not hold: none yet, another key, another scene, params that are more than colour, a scene or colours set again', () => {
    const s = session()
    expect(s.recolour(recolourReq('nothing', COLOUR_CHANGE))).toMatchObject({ ok: false, needBake: true })
    const baked = made(s.bake(bakeReq()))
    expect(s.recolour(recolourReq('another key', COLOUR_CHANGE))).toMatchObject({ ok: false, needBake: true })
    expect(s.recolour(recolourReq(baked.key, COLOUR_CHANGE, { sceneId: 2 }))).toMatchObject({ ok: false, needBake: true })
    // the light's intensity is something the bake reads
    expect(s.recolour(recolourReq(baked.key, setParam(SP, 'light.intensity', 0.7)))).toMatchObject({ ok: false, needBake: true })
    // (a change a frame reads is not more than colour)
    expect(s.recolour(recolourReq(baked.key, setParam(SP, 'particles.dragDensity', 0.5))).ok).toBe(true)
    // a colour change of the scene: the bake is of the colours it was given
    s.setColours(1, colourDataOf(bakeScene, flatColours({ 0: lchToLab(0.5, 0.1, 100), 1: lchToLab(0.9, 0.01, 85) })))
    expect(s.recolour(recolourReq(baked.key, COLOUR_CHANGE))).toMatchObject({ ok: false, needBake: true })
    const again = made(s.bake(bakeReq()))
    s.setScene(1, plainScene(bakeScene), colourDataOf(bakeScene, SPHERE))
    expect(s.recolour(recolourReq(again.key, COLOUR_CHANGE))).toMatchObject({ ok: false, needBake: true })
    made(s.bake(bakeReq()))
    s.forget(1)
    expect(s.recolour(recolourReq(baked.key, COLOUR_CHANGE))).toMatchObject({ ok: false, needBake: true })
  })

  it('holds one bake: a bake of another scene replaces it', () => {
    const s = session()
    s.setScene(2, plainScene(bakeScene), colourDataOf(bakeScene, SPHERE))
    const first = made(s.bake(bakeReq()))
    made(s.bake(bakeReq({ sceneId: 2 })))
    expect(s.recolour(recolourReq(first.key, COLOUR_CHANGE))).toMatchObject({ ok: false, needBake: true })
  })

  it('reports an unset scene as an error, never throws', () => {
    const s = session()
    expect(s.bake(bakeReq({ sceneId: 9 }))).toMatchObject({ ok: false, error: expect.stringContaining('scene 9') })
    expect(s.recolour(recolourReq('x', SP, { sceneId: 9 }))).toMatchObject({ ok: false, needBake: true })
  })

  it('still recolours after the bake has been handed over to the page (the transferred arrays are gone from the session; the ones its recipes read are copied)', () => {
    const s = session()
    const answer = s.bake(bakeReq())
    if (!answer.ok) throw new Error('no bake')
    const list = bakeTransferList(answer.baked)
    expect(new Set(list).size).toBe(list.length)
    // the arrays the session's recipes read are not handed over
    for (const surface of answer.baked.surfaces) {
      if (!surface) continue
      for (const key of ['positions', 'local', 'uFront', 'alphaFront', 'famFront'] as const) expect(list, key).not.toContain(surface[key].buffer)
    }
    expect(list).toContain(answer.baked.worldPath.buffer)
    expect(list).toContain(answer.baked.colour.buffer)
    // the page's side of the post: transferred buffers move, the rest are copied
    const page = structuredClone(answer, { transfer: list })
    if (!page.ok) throw new Error('no clone')
    expect(answer.baked.worldPath.byteLength).toBe(0) // gone from the session's own painting
    const fresh = direct(SP)
    const got = arraysOf(page.baked)
    for (const [k, v] of arraysOf(fresh)) expect(bytesEqual(got.get(k)!, v), k).toBe(true)
    // and the session recolours its (now partly empty) painting as if nothing had happened
    const r = s.recolour(recolourReq(answer.baked.key, COLOUR_CHANGE))
    if (!r.ok) throw new Error('no recolour')
    const want = direct(COLOUR_CHANGE)
    expect(bytesEqual(r.colours.colour, want.colour)).toBe(true)
    r.colours.surfaces.forEach((u, m) => u && expect(bytesEqual(u.underFront, want.surfaces[m]!.underFront)).toBe(true))
    // the colour arrays go back handed over too, and a second recolour after that works as well
    const list2 = recolourTransferList(r.colours)
    expect(list2).toContain(r.colours.colour.buffer)
    expect(new Set(list2).size).toBe(list2.length)
    const sent = structuredClone(r, { transfer: list2 })
    expect(r.colours.colour.byteLength).toBe(0)
    const swapped = withColours(page.baked, sent.colours)
    expect(bytesEqual(swapped.colour, want.colour)).toBe(true)
    expect(bytesEqual(swapped.surfaces[0]!.underFront, want.surfaces[0]!.underFront)).toBe(true)
    const r2 = s.recolour(recolourReq(answer.baked.key, setParam(SP, 'curve.warmHue', 35)))
    expect(r2.ok && bytesEqual(r2.colours.colour, direct(setParam(SP, 'curve.warmHue', 35)).colour)).toBe(true)
  })
})
