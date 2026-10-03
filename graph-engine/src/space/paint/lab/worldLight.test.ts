import { describe, expect, it, vi } from 'vitest'
import { screenBasis } from '../../camera/turntable'
import { keyLightDirection } from '../../../../../review/src/paintLabCamera'
import { buildParticles, paintFrame } from '../model/index'
import { flatColours, meshGBuffer, paintView, quadMesh, sceneOf } from '../model/testing'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, setParam, type PaintParams } from '../params'
import { ROLES, type StrokeBatch } from '../types'

// A light fixed in the world (light.worldFixed 1, the default) is a lamp that stays on the motif while you walk around it, so
// what a particle is painted in does not depend on where the camera is; a light relative to the view (0) turns with
// the camera and paints it differently from every side.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
// A flat, tilted plane (normal (0, -0.485, 0.874)): one plane for the model, one normal, nothing that depends on the pixels: its
// colours are the light's and the particle's. A camera on its -y side sees it from the front.
const MESH = quadMesh({ origin: [-0.6, -0.45, -0.25], e1: [1.2, 0, 0], e2: [0, 0.9, 0.5], n: 8, index: 0 })
const SCENE = sceneOf([MESH])
const COLOURS = flatColours({ 0: [0.6, 0.1, 0.08] })
const PARTICLES = buildParticles(SCENE, COLOURS, P)

// The model's strokes of the plane from a camera at this azimuth, lit as the lab lights a view: through keyLightDirection.
function strokesFrom(azimuth: number, params: PaintParams): StrokeBatch {
  const base = paintView({ width: 400, height: 300, azimuth, elevation: 25, zoom: 160 })
  const lightDir = [...keyLightDirection(screenBasis({ azimuth, elevation: 25, zoom: 1 }), params.light)] as [number, number, number]
  const view = { ...base, lightDir }
  const g = meshGBuffer(400, 300, [{ mesh: MESH, mark: 0 }], { view, params })
  return paintFrame(SCENE, PARTICLES, view, g, params).strokes
}

// The colour of each block stroke, by the particle it is painted from.
function blockColours(batch: StrokeBatch): Map<number, [number, number, number]> {
  const block = ROLES.indexOf('block')
  const out = new Map<number, [number, number, number]>()
  for (let i = 0; i < batch.count; i++) {
    if (batch.role[i] === block) out.set(batch.seed[i], [batch.colour[3 * i], batch.colour[3 * i + 1], batch.colour[3 * i + 2]])
  }
  return out
}

const worst = (a: Map<number, number[]>, b: Map<number, number[]>): { matched: number; max: number; mean: number } => {
  let matched = 0
  let max = 0
  let sum = 0
  for (const [seed, ca] of a) {
    const cb = b.get(seed)
    if (!cb) continue
    matched++
    const d = Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1]), Math.abs(ca[2] - cb[2]))
    max = Math.max(max, d)
    sum += d
  }
  return { matched, max, mean: sum / Math.max(matched, 1) }
}

describe('the light fixed in the world', () => {
  // the camera at 255 and at 285 degrees: both in front of the plane, 30 degrees apart
  const fixed = setParam(P, 'light.worldFixed', 1)
  const relative = setParam(P, 'light.worldFixed', 0)

  it('paints a particle’s block stroke the same colour from two camera azimuths, within 1e-6', () => {
    const a = blockColours(strokesFrom(255, fixed))
    const b = blockColours(strokesFrom(285, fixed))
    const d = worst(a, b)
    expect(d.matched).toBeGreaterThan(150)
    expect(d.max).toBeLessThan(1e-6)
  })

  it('lights a view-relative light differently from every side: the same particles are painted other colours', () => {
    const a = blockColours(strokesFrom(255, relative))
    const b = blockColours(strokesFrom(285, relative))
    const d = worst(a, b)
    expect(d.matched).toBeGreaterThan(150)
    expect(d.mean).toBeGreaterThan(0.03)
    expect(d.max).toBeGreaterThan(0.08)
  })

  it('is the default, and a preset from before it existed, with no such key, resolves to it', () => {
    expect(P.light.worldFixed).toBe(1)
    const old = resolvePaintParams({ light: { azimuth: 20, elevation: 30, intensity: 1.1 } } as never)
    expect(old.light.worldFixed).toBe(1)
    expect(old.light.azimuth).toBe(20)
    expect(resolvePaintParams({ light: { worldFixed: 0 } } as never).light.worldFixed).toBe(0)
  })
})
