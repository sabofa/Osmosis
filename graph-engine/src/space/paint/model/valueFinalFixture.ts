// The frame under test for the value rule in the final picture (valueFinal*.test.ts): a sphere on a table, its strokes made and packed
// (the roles that lie on a surface, and the contours with `edges`), the lightness each stroke is painted at, and the family of the
// pixel it stands on.

import { ROLES, type GBuffer, type Oklab, type PaintView } from '../types'
import { resolvePaintParams, type PaintParams } from '../params'
import { lchToLab, linearToOklab } from './colour'
import { contourRuns, edgeStrokes } from './contours'
import { buildContext, buildParticles } from './index'
import { dabStrokes, particleStrokes, scumbleMask } from './roles'
import { packStrokes, type PaintCtx } from './strokes'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh, type ViewOpts } from './testing'
import { CAST_FADE } from './value'
import { gIndex } from './view'

export const CANVAS = lchToLab(0.9, 0.01, 85)

// ---- the frame under test: a sphere on a table, strokes made and packed ----

export interface Made {
  an: PaintCtx
  batch: ReturnType<typeof packStrokes>['batch']
  g: GBuffer
  view: PaintView
}

export const SCENE = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
const gbuffers = new Map<string, GBuffer>()
const particleSets = new Map<string, ReturnType<typeof buildParticles>>()

// The strokes of the roles that lie on a surface (and, with `edges`, the contour strokes), packed. (The particles of a seed and
// the G-buffer of a view are made once: the grid below is the same sphere in many frames, and a flat local colour is the same
// on every particle of the mesh.)
export function made(params: PaintParams, local: Oklab, viewOpts: ViewOpts, edges = false, size = [640, 480, 120]): Made {
  const view = paintView({ width: size[0], height: size[1], zoom: size[2], ...viewOpts })
  const key = JSON.stringify([viewOpts, size, params.light])
  let g = gbuffers.get(key)
  if (!g) {
    g = sphereGBuffer(size[0], size[1], { view, params, table: { z: -1, mark: 1 } })
    gbuffers.set(key, g)
  }
  const pkey = JSON.stringify([params.seed, params.particles])
  let set = particleSets.get(pkey)
  if (!set) {
    set = buildParticles(SCENE, flatColours({ 0: local, 1: CANVAS }), params)
    particleSets.set(pkey, set)
  }
  // the sphere's particles take the local colour (a flat colour is the same on every particle of the mesh)
  for (let i = 0; i < set.count; i++) if (set.mark[i] === 0) set.colour.set(local, 3 * i)
  const an = buildContext(SCENE, set, view, g, params)
  scumbleMask(an)
  particleStrokes(an)
  dabStrokes(an)
  if (edges) edgeStrokes(an, contourRuns(an))
  return { an, batch: packStrokes(an.drafts, params).batch, g, view }
}

// The lightness a stroke is painted at: the colour the renderer gets.
export const lightnessOf = (batch: Made['batch'], i: number): number => linearToOklab(batch.colour[3 * i], batch.colour[3 * i + 1], batch.colour[3 * i + 2])[0]

export interface Spread {
  maxShadow: number
  minLight: number
  nShadow: number
  nLight: number
}

// The darkest light-family stroke against the lightest shadow-family stroke on the sphere (the table's own strokes are
// of another local colour). The terminator's own soft edge, and the fade a cast shadow takes over in, belong to neither.
export function spreadOf(m: Made, params: PaintParams, roles: string[] = []): Spread {
  const ts = params.value.terminatorSoftness
  const s: Spread = { maxShadow: -1, minLight: 2, nShadow: 0, nLight: 0 }
  for (let i = 0; i < m.batch.count; i++) {
    const d = m.an.drafts[i]
    const role = ROLES[d.role]
    if (role === 'edge' || role === 'line' || (roles.length > 0 && !roles.includes(role))) continue
    const gi = gIndex(m.an.fc, d.mx, d.my)
    if (gi < 0 || m.an.fc.g.mark[gi] !== 0) continue
    const nl = m.an.plan.nl[gi]
    const shadow = m.an.fc.g.shadow[gi] === 1
    const L = lightnessOf(m.batch, i)
    if (nl <= -ts / 2 || (shadow && nl >= ts / 2 + CAST_FADE)) {
      s.nShadow++
      s.maxShadow = Math.max(s.maxShadow, L)
    } else if (!shadow && nl >= ts / 2) {
      s.nLight++
      s.minLight = Math.min(s.minLight, L)
    }
  }
  return s
}

// ---- the final picture: strokes ----

// The scenario of the review: a key light at azimuth 30 degrees and elevation 5 (relative to a camera at elevation 2 degrees),
// where the table is nearly at a graze, a cast shadow stretches far across it, and small slivers of core shadow sit beside
// the half-tones.
export const SCENARIO = { elevation: 2, lightAzimuth: 30, lightElevation: 5 }
export const AZIMUTHS = [200, 20, 110, 290, 340]
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
export const LOCALS: [string, Oklab][] = [
  ['terracotta', lchToLab(0.56, 0.14, 38)],
  ['pale yellow', lchToLab(0.9, 0.12, 95)],
  ['dark blue', lchToLab(0.35, 0.12, 260)],
  ['grey', lchToLab(0.6, 0, 0)],
  ['saturated green', lchToLab(0.72, 0.22, 145)],
]

// The smallest margin of the grid: seeds x views x local colours.
export function gridMargin(overrides: Partial<PaintParams>, seeds: number[], azimuths: number[]): { margin: number; at: string; shadows: number; lights: number } {
  let margin = Number.POSITIVE_INFINITY
  let at = ''
  let shadows = Number.POSITIVE_INFINITY
  let lights = Number.POSITIVE_INFINITY
  for (const seed of seeds) {
    const params = resolvePaintParams({ ...overrides, seed })
    for (const [name, local] of LOCALS) {
      for (const azimuth of azimuths) {
        const s = spreadOf(made(params, local, { ...SCENARIO, azimuth }), params)
        shadows = Math.min(shadows, s.nShadow)
        lights = Math.min(lights, s.nLight)
        if (s.minLight - s.maxShadow < margin) {
          margin = s.minLight - s.maxShadow
          at = `seed ${seed}, ${name}, azimuth ${azimuth}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`
        }
      }
    }
  }
  return { margin, at, shadows, lights }
}

