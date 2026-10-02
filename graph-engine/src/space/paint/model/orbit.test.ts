import { describe, expect, it, vi } from 'vitest'
import { resolvePaintParams } from '../params'
import { ROLES, type StrokeBatch } from '../types'
import { lchToLab, linearToOklab } from './colour'
import { buildParticles, paintFrame } from './index'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

// The conditions of the review that found it (the particle supply the model first shipped with).
const P = resolvePaintParams({ particles: { maxPerUnit2: 900 } })
const COLOURS = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85) })
const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
const particles = buildParticles(scene, COLOURS, P)

// `fixedLight`: the light direction of another view (the light stays where it was in the world as the camera moves).
function frameAt(azimuth: number, fixedLight?: [number, number, number]): StrokeBatch {
  const view = { ...paintView({ width: 640, height: 480, azimuth, elevation: 25, zoom: 120 }) }
  if (fixedLight) view.lightDir = fixedLight
  const g = sphereGBuffer(640, 480, { view, table: { z: -1, mark: 1 } })
  return paintFrame(scene, particles, view, g, P).strokes
}

// The fraction of the matched light-invariant surface strokes of two frames whose colour is within `tolerance` (OKLab).
function calm(a: StrokeBatch, b: StrokeBatch, tolerance: number): { matched: number; share: number } {
  const SURFACE = new Set(['block', 'scumble', 'glaze', 'reflected'])
  const at = new Map<string, number>()
  for (let i = 0; i < b.count; i++) at.set(`${b.role[i]}/${b.seed[i]}`, i)
  let matched = 0
  let ok = 0
  for (let i = 0; i < a.count; i++) {
    if (!SURFACE.has(ROLES[a.role[i]])) continue
    const j = at.get(`${a.role[i]}/${a.seed[i]}`)
    if (j === undefined) continue
    const [la, aa, ba] = oklabOf(a, i)
    const [lb, ab, bb] = oklabOf(b, j)
    matched++
    if (Math.hypot(la - lb, aa - ab, ba - bb) < tolerance) ok++
  }
  return { matched, share: ok / matched }
}

const oklabOf = (b: StrokeBatch, i: number) => linearToOklab(b.colour[3 * i], b.colour[3 * i + 1], b.colour[3 * i + 2])

describe('the brush-load mix under orbit (spec §3.8: the same stroke is the same colour, a little further round)', () => {
  // Block, scumble, glaze and reflected strokes are light-invariant surface strokes: a stroke rides the
  // surface, so its colour holds as the camera moves. (Form and dab strokes follow the light, and edges and
  // lines are re-traced, by design.) The mix used to chain its loads in depth-sorted painting order, so a
  // 0.5 degree orbit recoloured 72% of the strokes by more than 0.015: the paint boiled.
  it('changes the colour of at least 95% of the matched surface strokes by under 0.005 (OKLab) at a 0.5 degree orbit', () => {
    const { matched, share } = calm(frameAt(30), frameAt(30.5), 0.005)
    expect(matched).toBeGreaterThan(400)
    expect(share).toBeGreaterThanOrEqual(0.95)
  })

  it('adds nothing of its own: the share of calm strokes with the mix on is within 1% of the share with the mix off', () => {
    // what is left over is the lighting and the planes the value plan is made of, which follow the view; the mix must not add to it
    const off = resolvePaintParams({ particles: { maxPerUnit2: 900 }, mix: { strength: 0 } })
    const frames = (params: typeof P) => [30, 30.5].map((az) => {
      const view = paintView({ width: 640, height: 480, azimuth: az, elevation: 25, zoom: 120 })
      return paintFrame(scene, particles, view, sphereGBuffer(640, 480, { view, table: { z: -1, mark: 1 } }), params).strokes
    })
    const [a, b] = frames(P)
    const [c, d] = frames(off)
    const on = calm(a, b, 0.005)
    const without = calm(c, d, 0.005)
    expect(on.matched).toBeGreaterThan(400)
    expect(on.share).toBeGreaterThanOrEqual(without.share - 0.01)
    // and at the old chained mixer's own yardstick (0.015) nearly nothing moves
    expect(calm(a, b, 0.015).share).toBeGreaterThan(0.97)
  })

  it('is the same frame twice (the mix is a function of the strokes, not of the order they were made in)', () => {
    const a = frameAt(30)
    const b = frameAt(30)
    expect(Array.from(a.colour)).toEqual(Array.from(b.colour))
  })
})
