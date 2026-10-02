import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { PATH_POINTS, ROLES, type GBuffer, type PaintFrame, type StrokeBatch } from '../types'
import { lchToLab } from './colour'
import { analysisStride, buildContext, buildParticles, paintFrame } from './index'
import { LoadMixer } from './mix'
import { flatColours, lineMark, makeGBuffer, paintView, pointMark, quadMesh, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85) })

function frameAt(azimuth: number, params: PaintParams = P, size: [number, number] = [640, 480], zoom = 120): { frame: PaintFrame; g: GBuffer } {
  const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
  const view = paintView({ width: size[0], height: size[1], azimuth, elevation: 25, zoom })
  const g = sphereGBuffer(size[0], size[1], { view, params, table: { z: -1, mark: 1 } })
  return { frame: paintFrame(scene, buildParticles(scene, COLOURS, params), view, g, params), g }
}

const strokeKey = (b: StrokeBatch, i: number) => `${b.role[i]}/${b.seed[i]}`

describe('alpha: what the renderer multiplies (spec §3.7, renderer contract)', () => {
  const { frame } = frameAt(30)
  const b = frame.strokes

  it('is the glaze’s own absolute opacity, never over 0.34, and a fade for every other role', () => {
    let glazeMax = 0
    let glazeFull = 0
    let blockFull = 0
    for (let i = 0; i < b.count; i++) {
      const role = ROLES[b.role[i]]
      expect(b.alpha[i]).toBeGreaterThanOrEqual(0)
      expect(b.alpha[i]).toBeLessThanOrEqual(1 + 1e-6)
      if (role === 'glaze') {
        glazeMax = Math.max(glazeMax, b.alpha[i])
        if (b.alpha[i] > 0.339) glazeFull++
      }
      if (role === 'block' && b.alpha[i] > 0.97) blockFull++
    }
    expect(glazeMax).toBeLessThanOrEqual(0.34 + 1e-6)
    expect(glazeFull).toBeGreaterThan(5) // most of a glaze is the whole 0.34
    expect(blockFull).toBeGreaterThan(50) // most of a block-in stroke is whole
  })

  it('fades strokes in and out as the density threshold crosses them, so they do not pop', () => {
    const a = frameAt(30).frame.strokes
    const c = frameAt(34).frame.strokes
    const inA = new Map<string, number>()
    for (let i = 0; i < a.count; i++) if (ROLES[a.role[i]] === 'block') inA.set(strokeKey(a, i), a.alpha[i])
    const inC = new Map<string, number>()
    for (let i = 0; i < c.count; i++) if (ROLES[c.role[i]] === 'block') inC.set(strokeKey(c, i), c.alpha[i])
    let leaving = 0
    let leavingAlpha = 0
    let staying = 0
    let stayingAlpha = 0
    for (const [k, alpha] of inA) {
      if (inC.has(k)) {
        staying++
        stayingAlpha += alpha
      } else {
        leaving++
        leavingAlpha += alpha
      }
    }
    expect(leaving).toBeGreaterThan(20)
    expect(staying).toBeGreaterThan(300)
    // what is about to vanish is already fainter than what stays (some leave for other reasons, behind the limb, at whole alpha)
    expect(stayingAlpha / staying).toBeGreaterThan(0.75)
    expect(leavingAlpha / leaving).toBeLessThan(0.7)
    expect(leavingAlpha / leaving).toBeLessThan(stayingAlpha / staying - 0.2)
  })
})

describe('the analysis stride', () => {
  it('decimates only a G-buffer over 100,000 pixels, to about 64,000: by 2 at 256k, 3 at 576k', () => {
    const fake = (w: number, h: number) => ({ width: w, height: h }) as GBuffer
    expect(analysisStride(fake(320, 312))).toBe(1) // 99,840
    expect(analysisStride(fake(400, 251))).toBe(2) // 100,400: just over
    expect(analysisStride(fake(640, 400))).toBe(2) // 256,000: a 1280x800 view read back at scale 2
    expect(analysisStride(fake(960, 600))).toBe(3) // 576,000
  })

  it('runs the analysis on every second pixel of a big G-buffer and hands the debug views back full size', () => {
    const size: [number, number] = [1000, 700] // a 500 x 350 G-buffer: 175,000 pixels
    const run = frameAt(30, P, size, 150)
    const g = run.g
    expect(g.width * g.height).toBeGreaterThan(100_000)
    const d = run.frame.debug
    expect(d.value.length).toBe(g.width * g.height)
    expect(d.planes.length).toBe(g.width * g.height)
    expect(d.zones.length).toBe(g.width * g.height)
    // empty where the G-buffer is empty and filled where it is filled (at the decimated sampling points)
    let filled = 0
    let mismatched = 0
    for (let y = 0; y < g.height; y += 2) {
      for (let x = 0; x < g.width; x += 2) {
        const i = y * g.width + x
        if (g.mark[i] >= 0) filled++
        // a pixel's debug value is its decimation block's: empty where the sampled pixel is
        const sx = Math.min(g.width - 1, 2 * Math.floor(x / 2) + 1)
        const sy = Math.min(g.height - 1, 2 * Math.floor(y / 2) + 1)
        if ((g.mark[sy * g.width + sx] >= 0) !== (d.zones[i] !== 255)) mismatched++
      }
    }
    expect(filled).toBeGreaterThan(5000)
    expect(mismatched).toBe(0)
    // the strokes are still in CSS px of the full view
    const b = run.frame.strokes
    expect(b.count).toBeGreaterThan(300)
    for (let i = 0; i < b.count; i++) {
      for (let k = 0; k < PATH_POINTS; k++) {
        expect(b.path[2 * PATH_POINTS * i + 2 * k]).toBeGreaterThan(-200)
        expect(b.path[2 * PATH_POINTS * i + 2 * k]).toBeLessThan(1200)
      }
    }
    // and it is deterministic
    const again = frameAt(30, P, size, 150)
    expect(Array.from(again.frame.strokes.colour)).toEqual(Array.from(b.colour))
    // the context says so
    const scene = sceneOf([sphereMesh()])
    const view = paintView({ width: size[0], height: size[1], azimuth: 30, elevation: 25, zoom: 150 })
    const an = buildContext(scene, buildParticles(scene, COLOURS, P), view, g, P)
    expect(an.stride).toBe(2)
    expect(an.fc.g.scale).toBe(g.scale * 2)
    expect(an.fc.g.width).toBe(Math.ceil(g.width / 2))
  })
})

describe('what a plane looks like, with a veil in front of it', () => {
  it('takes the colour of the mesh the G-buffer shows, not of the translucent sheet seen at the same pixels', () => {
    // camera along +x, the sphere at the origin, a blue veil at x = 2 covering it
    const TERRA = lchToLab(0.56, 0.14, 38)
    const BLUE = lchToLab(0.7, 0.1, 250)
    const veil = quadMesh({ origin: [2, -1.2, -1.2], e1: [0, 2.4, 0], e2: [0, 0, 2.4], opacity: 0.4, index: 1 })
    const scene = sceneOf([sphereMesh({ radius: 1 }), veil])
    const view = paintView({ width: 640, height: 480, azimuth: 0, elevation: 0, zoom: 150 })
    const g = sphereGBuffer(640, 480, { view })
    const set = buildParticles(scene, flatColours({ 0: TERRA, 1: BLUE }), P)
    const an = buildContext(scene, set, view, g, P)
    // the veil is seen over the sphere, at pixels whose plane is the sphere's
    let veilOverSphere = 0
    for (let k = 0; k < an.vis.count; k++) {
      if (set.opacity[an.vis.idx[k]] < 1 && an.planes.plane[an.vis.gi[k]] >= 0) veilOverSphere++
    }
    expect(veilOverSphere).toBeGreaterThan(50)
    // every plane's colour is the sphere's flat terracotta, with none of the veil's blue in it
    let withColour = 0
    for (let p = 0; p < an.planes.planes.length; p++) {
      if (an.planeHasColour[p] !== 1) continue
      withColour++
      for (let c = 0; c < 3; c++) expect(an.planeColour[3 * p + c]).toBeCloseTo(TERRA[c], 4)
    }
    expect(withColour).toBeGreaterThanOrEqual(3)
  })
})

describe('the debug views are built when read, from the frame they belong to', () => {
  it('hands back the same array on every read, and still the right one after a later frame has used the scratch space', () => {
    const first = frameAt(30)
    const value = first.frame.debug.value
    expect(first.frame.debug.value).toBe(value)
    const zones = first.frame.debug.zones
    const planes = first.frame.debug.planes
    // a different view: the analysis arrays are reused for it
    frameAt(75)
    const again = frameAt(30)
    // reading the first frame's views now gives what they gave when they were fresh
    expect(first.frame.debug.zones).toBe(zones)
    const fresh = again.frame.debug
    expect(Array.from(zones)).toEqual(Array.from(fresh.zones))
    expect(Array.from(planes)).toEqual(Array.from(fresh.planes))
    expect(Array.from(value)).toEqual(Array.from(fresh.value))
    // a frame whose views are read only after another frame was made still has its own
    const lateA = frameAt(30)
    frameAt(100)
    expect(Array.from(lateA.frame.debug.zones)).toEqual(Array.from(fresh.zones))
  }, 60_000)
})

describe('a stroke’s personal jitter of the mix', () => {
  const lab = lchToLab(0.55, 0.12, 40)
  const first = (jit?: { jit0: number; jit1: number }, jitter?: number) =>
    new LoadMixer(resolvePaintParams({ mix: { roleEdge: 1 } })).mix({ role: 'edge', cell: 5, u: 0.6, x: 0, y: 0, lab, colormapped: false, seed: 5, jitter, ...jit })

  it('takes the two draws it is given, or draws them from its seed', () => {
    const none = first(undefined, 0)
    // zero draws are no jitter at all
    expect(first({ jit0: 0, jit1: 0 }).lab).toEqual(none.lab)
    // other draws move the colour
    expect(first({ jit0: 1.5, jit1: -1 }).lab).not.toEqual(none.lab)
    // and move it by the draw times 2 degrees of hue and 4% chroma (times the strength): a hue of +3 degrees
    const a = first({ jit0: 1, jit1: 0 }).lab
    const b = first({ jit0: 0, jit1: 0 }).lab
    const hue = (l: number[]) => (Math.atan2(l[2], l[1]) * 180) / Math.PI
    expect(hue(a) - hue(b)).toBeCloseTo(2, 3)
    // from the seed it is deterministic, and the seed's own draws are not zero
    expect(first().lab).toEqual(first().lab)
    expect(first().lab).not.toEqual(none.lab)
  })
})

describe('frames of every shape', () => {
  it('gives an empty scene an empty frame, and a scene of data marks alone its lines', () => {
    const empty = sceneOf([])
    const view = paintView({ width: 320, height: 240 })
    const g = makeGBuffer(view, 2, () => null)
    const f = paintFrame(empty, buildParticles(empty, COLOURS, P), view, g, P)
    expect(f.strokes.count).toBe(0)
    expect(f.stats.strokes).toBe(0)
    expect(f.stats.loads).toBe(0)
    expect(f.debug.value.length).toBe(g.width * g.height)
    expect(f.debug.edgeClass.length).toBe(0)
    // marks only: a polyline and a point, nothing opaque
    const marks = sceneOf([lineMark([[0, -1, 0], [0, 1, 0], [0, 1, 1]], { index: 0 }), pointMark([[0, 0, 0.5]], { index: 1 })])
    const m = paintFrame(marks, buildParticles(marks, COLOURS, P), view, g, P)
    expect(m.stats.byRole.line).toBeGreaterThan(2)
    expect(m.stats.byRole.block).toBe(0)
    expect(m.stats.byRole.edge).toBe(0)
    expect(m.strokes.count).toBe(m.stats.byRole.line)
  })

  it('paints through a perspective camera as well: strokes on the sphere, nothing broken', () => {
    const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
    const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 120, perspective: true })
    const g = sphereGBuffer(640, 480, { view, table: { z: -1, mark: 1 } })
    const f = paintFrame(scene, buildParticles(scene, COLOURS, P), view, g, P)
    for (const role of ['block', 'form', 'glaze', 'edge'] as const) expect(f.stats.byRole[role], role).toBeGreaterThan(0)
    const b = f.strokes
    let bad = 0
    for (let i = 0; i < b.count; i++) {
      for (let k = 0; k < 2 * PATH_POINTS; k++) if (!Number.isFinite(b.path[2 * PATH_POINTS * i + k])) bad++
      for (let c = 0; c < 3; c++) if (!Number.isFinite(b.colour[3 * i + c])) bad++
      if (!(b.depth[i] > 0)) bad++
    }
    expect(bad).toBe(0)
    // block strokes start on the sphere or in its shadow, as with the orthographic camera
    let onFigure = 0
    let checked = 0
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'block') continue
      const gx = Math.floor(((b.path[2 * PATH_POINTS * i + 6] + b.path[2 * PATH_POINTS * i + 8]) / 2) / g.scale)
      const gy = Math.floor(((b.path[2 * PATH_POINTS * i + 7] + b.path[2 * PATH_POINTS * i + 9]) / 2) / g.scale)
      const gi = gy * g.width + gx
      checked++
      if (gi >= 0 && gi < g.mark.length && (g.mark[gi] === 0 || (g.mark[gi] === 1 && g.shadow[gi] === 1))) onFigure++
    }
    expect(checked).toBeGreaterThan(300)
    expect(onFigure / checked).toBeGreaterThan(0.95)
  })

  it('draws fewer strokes while dragging, by particles.dragDensity', () => {
    const params = resolvePaintParams({ particles: { dragDensity: 0.4 } })
    const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
    const set = buildParticles(scene, COLOURS, params)
    const count = (dragging: boolean) => {
      const view = paintView({ width: 640, height: 480, azimuth: 30, elevation: 25, zoom: 120, dragging })
      const g = sphereGBuffer(640, 480, { view, table: { z: -1, mark: 1 } })
      return paintFrame(scene, set, view, g, params).stats.byRole.block
    }
    const still = count(false)
    const moving = count(true)
    expect(moving).toBeLessThan(still * 0.55)
    expect(moving).toBeGreaterThan(still * 0.25)
  })
})
