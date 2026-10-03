import { describe, expect, it, vi } from 'vitest'
import { parametricMesh } from '../../testing/marks'
import { DEFAULT_PAINT_PARAMS } from '../params'
import type { GBuffer, PaintFrame, ParticleSet, StrokeBatch } from '../types'
import { lchToLab } from './colour'
import { buildParticles, paintFrame } from './index'
import { flatColours, paintView, planeGBuffer, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './testing'
import { buildUnderpaintField, underpaintImage } from './underpaint'
import { GRID_VIEWS, LOCALS, made } from './valueFinalFixture'

// THE FRAME-HASH GUARD (the baked painting, plan Global Constraints). The bake is a second model beside the per-frame one,
// and the per-frame model must not move while it is built: paintFrame, recolourFrame and buildParticles give byte-identical
// results. Every array of a fixture's stroke batch and underpainting, and every particle array, is hashed (FNV-1a over its
// bytes) and pinned here. This file was written and committed at the base, before any change; a hash that moves is the
// per-frame model moving, which is only ever a deliberate decision, never a side effect of the bake. (The pre-existing
// arrays only: the arrays a later task adds to a set or a batch are not in the lists below.)
//
// To re-pin after a deliberate change to the per-frame model: run `FRAME_HASH_PRINT=1 npx vitest run model/frameHash` and
// paste the printed table over PINNED.

vi.setConfig({ testTimeout: 120_000 })

type Hashable = ArrayBufferView | undefined

// 32-bit FNV-1a over the bytes of an array, and the array's byte length (so an empty array and a missing one differ).
function fnv(a: Hashable): string {
  if (!a) return 'none'
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${bytes.length}`
}

const BATCH_ARRAYS = [
  'role', 'layer', 'path', 'width', 'depth', 'colour', 'alpha', 'load', 'impasto', 'bristles', 'bristleVar', 'dry', 'wet', 'endSoft', 'edge',
  'seed', 'worldPath', 'worldNormal',
] as const satisfies readonly (keyof StrokeBatch)[]

const PARTICLE_ARRAYS = [
  'mark', 'position', 'normal', 'tangent', 'colour', 'colormapped', 'opacity', 'rank', 'cell', 'seed',
] as const satisfies readonly (keyof ParticleSet)[]

function hashBatch(prefix: string, b: StrokeBatch, out: Record<string, string>): void {
  out[`${prefix}.count`] = String(b.count)
  for (const k of BATCH_ARRAYS) out[`${prefix}.${k}`] = fnv(b[k])
}

function hashParticles(prefix: string, set: ParticleSet, out: Record<string, string>): void {
  out[`${prefix}.count`] = String(set.count)
  for (const k of PARTICLE_ARRAYS) out[`${prefix}.${k}`] = fnv(set[k])
}

const COLOURS = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.9, 0.01, 85), 2: lchToLab(0.74, 0.12, 95) })
const P = DEFAULT_PAINT_PARAMS

// Fixture 1: a sphere on a table, the sphere G-buffer (with the table and its cast shadow), a whole paintFrame.
function sphereFrame(): { frame: PaintFrame; g: GBuffer } {
  const scene = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 })])
  const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100 })
  const g = sphereGBuffer(400, 300, { view, params: P, table: { z: -1, mark: 1 } })
  return { frame: paintFrame(scene, buildParticles(scene, COLOURS, P), view, g, P), g }
}

// Fixture 2: a plane under a sphere that shadows it (the plane G-buffer: bare canvas, a cast shadow and its edge).
function planeFrame(): { frame: PaintFrame; g: GBuffer } {
  const centre: [number, number, number] = [0.2, 0.1, 1.1]
  const scene = sceneOf([tableMesh({ z: 0, half: 3, index: 0 }), sphereMesh({ radius: 0.7, centre, index: 1 })])
  const view = paintView({ width: 400, height: 300, azimuth: 40, elevation: 32, zoom: 90, lightAzimuth: 35, lightElevation: 40 })
  const g = planeGBuffer(400, 300, { view, params: P, mark: 0, occluder: { centre, radius: 0.7 } })
  return { frame: paintFrame(scene, buildParticles(scene, COLOURS, P), view, g, P), g }
}

// The sphere-and-torus scene whose particles are pinned.
function torusMesh(index: number) {
  return parametricMesh(
    (u, v) => [(2 + 0.7 * Math.cos(v)) * Math.cos(u) + 3.5, (2 + 0.7 * Math.cos(v)) * Math.sin(u), 0.7 * Math.sin(v)],
    (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)],
    0, 2 * Math.PI, 0, 2 * Math.PI, 40, 24, { line: index + 1 },
  )
}
const SPHERE_TORUS = sceneOf([sphereMesh({ radius: 1, index: 0 }), torusMesh(1)])

const computed: Record<string, string> = {}

describe('the frame-hash guard', () => {
  it('pins the stroke batch and underpainting of a sphere-on-a-table frame', () => {
    const { frame } = sphereFrame()
    hashBatch('sphere', frame.strokes, computed)
    computed['sphere.underpaint'] = fnv(frame.underpaint)
    expect(frame.strokes.count).toBeGreaterThan(300)
    expect(pick('sphere.')).toEqual(PINNED_SPHERE)
  })

  it('pins the stroke batch and underpainting of a plane-and-cast-shadow frame', () => {
    const { frame } = planeFrame()
    hashBatch('plane', frame.strokes, computed)
    computed['plane.underpaint'] = fnv(frame.underpaint)
    expect(frame.strokes.count).toBeGreaterThan(50)
    expect(pick('plane.')).toEqual(PINNED_PLANE)
  })

  it('pins the value-final fixture’s default frame: its packed strokes (surface, edge and line) and its underpainting', () => {
    // (a smaller canvas than the fixture's 640 x 480: the same frame, cheaper)
    const m = made(P, LOCALS[0][1], GRID_VIEWS[0].opts, true, [320, 240, 60])
    hashBatch('final', m.batch, computed)
    computed['final.underpaint'] = fnv(underpaintImage(buildUnderpaintField(m.an, m.g), P, m.an.env))
    expect(m.batch.count).toBeGreaterThan(200)
    expect(pick('final.')).toEqual(PINNED_FINAL)
  })

  it('pins the particles of a sphere-and-torus scene (the arrays that existed before the bake)', () => {
    const set = buildParticles(SPHERE_TORUS, COLOURS, P)
    hashParticles('particles', set, computed)
    expect(set.count).toBeGreaterThan(1000)
    expect(pick('particles.')).toEqual(PINNED_PARTICLES)
  })

  if (process.env.FRAME_HASH_PRINT) {
    it('prints the table', () => {
      console.log(JSON.stringify(computed, null, 2))
    })
  }
})

function pick(prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(computed)) if (k.startsWith(prefix)) out[k] = computed[k]
  return out
}

// ---- the pinned hashes (taken at paint's ea5ba5c, values rounds 2-4, in a scratch export of it with no bake, and equal at the merged head; the same on every run) ----
const PINNED_SPHERE: Record<string, string> = {
  'sphere.count': '617',
  'sphere.role': '36cfd667:617',
  'sphere.layer': '70a97ef9:617',
  'sphere.path': '09588581:39488',
  'sphere.width': 'd90ee071:19744',
  'sphere.depth': 'b8f57f55:2468',
  'sphere.colour': 'dfc046e4:7404',
  'sphere.alpha': 'ca2f9572:2468',
  'sphere.load': 'ad300dff:2468',
  'sphere.impasto': 'acb141b7:2468',
  'sphere.bristles': '8eb77f42:2468',
  'sphere.bristleVar': '63fe092a:2468',
  'sphere.dry': 'fe0fa382:2468',
  'sphere.wet': 'e43395d2:2468',
  'sphere.endSoft': '22091a1d:2468',
  'sphere.edge': 'd2b7b71c:617',
  'sphere.seed': '06b9de90:2468',
  'sphere.worldPath': 'ff9b8b65:59232',
  'sphere.worldNormal': '807d7201:7404',
  'sphere.underpaint': '9145bb34:360000',
}
const PINNED_PLANE: Record<string, string> = {
  'plane.count': '130',
  'plane.role': 'f458ac30:130',
  'plane.layer': '2ae6569f:130',
  'plane.path': '4fe9b3fe:8320',
  'plane.width': '0d3cd828:4160',
  'plane.depth': '74cc5c2a:520',
  'plane.colour': '64430537:1560',
  'plane.alpha': 'b0de849d:520',
  'plane.load': '90c6d799:520',
  'plane.impasto': '93a6cf1b:520',
  'plane.bristles': '0d345692:520',
  'plane.bristleVar': 'c09fe8e1:520',
  'plane.dry': '5e9cfbb8:520',
  'plane.wet': 'c0b0736d:520',
  'plane.endSoft': 'adf251cb:520',
  'plane.edge': 'bbdfb23a:130',
  'plane.seed': '9ceaf9fe:520',
  'plane.worldPath': 'abb56423:12480',
  'plane.worldNormal': 'c7d5e8a8:1560',
  'plane.underpaint': '0443a7ab:360000',
}
const PINNED_FINAL: Record<string, string> = {
  'final.count': '279',
  'final.role': '99744041:279',
  'final.layer': '3c7fdc5f:279',
  'final.path': '8dc1e0d7:17856',
  'final.width': '75754d23:8928',
  'final.depth': '9fea166d:1116',
  'final.colour': '76c14638:3348',
  'final.alpha': '882a756e:1116',
  'final.load': 'ec1ff336:1116',
  'final.impasto': '8e5de564:1116',
  'final.bristles': 'dbd11555:1116',
  'final.bristleVar': '4df3a793:1116',
  'final.dry': 'cdfc024a:1116',
  'final.wet': '7dc673cf:1116',
  'final.endSoft': '0f9a80fa:1116',
  'final.edge': '17732209:279',
  'final.seed': '7bf1d5fe:1116',
  'final.worldPath': '8e38bbd8:26784',
  'final.worldNormal': 'b859a138:3348',
  'final.underpaint': 'b26f80eb:230400',
}
const PINNED_PARTICLES: Record<string, string> = {
  'particles.count': '96540',
  'particles.mark': 'f7c03295:386160',
  'particles.position': '1d00e776:1158480',
  'particles.normal': 'ec2d58e5:1158480',
  'particles.tangent': 'da1e12a9:1158480',
  'particles.colour': 'e6d35b81:1158480',
  'particles.colormapped': '623e4df5:96540',
  'particles.opacity': '98a6ef25:386160',
  'particles.rank': '00ab0b2d:386160',
  'particles.cell': 'e72dd8f8:386160',
  'particles.seed': '8c0eb4fa:386160',
}
