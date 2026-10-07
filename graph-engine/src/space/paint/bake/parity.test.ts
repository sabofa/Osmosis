import { describe, expect, it, vi } from 'vitest'
import { lchToLab } from '../model/colour'
import { flatColours, meshGBuffer, paintView, sphereGBuffer } from '../model/testing'
import type { MeshMark } from '../../scene/types'
import { resolvePaintParams } from '../params'
import { LIGHT, saddleColours, saddleScene, sparse, TERRACOTTA, veilScene } from './bakeFixture'
import { parityAtAuthored, parityOfScene, type ParityResult } from './parity'

vi.setConfig({ testTimeout: 300_000 })

// THE PARITY OF THE BAKED FRAME WITH THE PER-FRAME MODEL'S at the authored view (spec §14 accepts look differences from the world's planes: only gross
// bounds are held here, the real numbers are what PARITY_PRINT=1 prints and the task's report states).

const show = (name: string, r: ParityResult): void => {
  if (!process.env.PARITY_PRINT) return
  const f = (v: number, d = 3): string => v.toFixed(d)
  const pairs = Object.entries(r.pairsByRole).map(([k, v]) => `${k} model ${v.model} / baked ${v.baked} (visible ${v.bakedVisible}) / both ${v.both}`).join('; ')
  console.log(`${name}: (particle, role) pairs: ${pairs}`)
  const roles = Object.entries(r.byRole).filter(([, c]) => c.model + c.baked > 0).map(([k, c]) => `${k} ${c.model}/${c.baked}`).join(', ')
  console.log(
    `${name}: particles drawn by either ${r.particlesEither}, by both ${r.particlesBoth}; role agreement ${f(r.roleAgreement)}; ` +
      `pairs ${r.pairs}, stroke dE ${f(r.strokeDeltaE, 4)} (${Object.entries(r.strokeDeltaEByRole).map(([k, v]) => `${k} ${f(v as number, 4)}`).join(', ')}); ` +
      `strokes model ${r.modelStrokes}, baked ${r.bakedStrokes}, ratio ${f(r.countRatio)}, surface ratio ${f(r.surfaceRatio)}, visible surface ${r.bakedVisible} (ratio ${f(r.visibleRatio)}) (model/baked by role: ${roles}); ` +
      `underpainting ${r.underpaintPixels} px, dE ${f(r.underpaintDeltaE, 4)} (by mark ${Object.entries(r.underpaintDeltaEByMark).map(([k, v]) => `${k}: ${f(v as number, 4)}`).join(', ')}), only model ${r.underpaintOnlyModel}, only baked ${r.underpaintOnlyBaked}`,
  )
}

// The share of the model's (particle, role) pairs of each surface role that the baked frame draws too (of the roles the model draws 40 of or more: a role of a few strokes is noise): the baked
// frame draws what faces the eye and the model what the G-buffer shows, so the model's pairs are what is asked of it.
const recallByRole = (r: ParityResult, min = 40): Record<string, number> =>
  Object.fromEntries(Object.entries(r.pairsByRole).filter(([, v]) => v.model >= min).map(([k, v]) => [k, v.both / v.model]))

const showRecall = (name: string, r: ParityResult, min = 40): void => {
  if (process.env.PARITY_PRINT) console.log(`${name}: pair recall by role ${Object.entries(recallByRole(r, min)).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')}; strokes model ${r.modelStrokes}, baked ${r.bakedStrokes}`)
}

// (a small scene has fewer strokes: its floor is 20 pairs)
const expectRecall = (name: string, r: ParityResult, min = 40): void => {
  const recall = recallByRole(r, min)
  expect(Object.keys(recall).length, name).toBeGreaterThanOrEqual(2)
  for (const [role, v] of Object.entries(recall)) expect(v, `${name}: ${role}`).toBeGreaterThanOrEqual(0.9)
}

describe('the baked frame against the per-frame model, at the authored view', () => {
  it('agrees within gross bounds on the sphere and the table with their cast shadow: roles, colours, stroke count, underpainting', () => {
    const r = parityAtAuthored()
    show('sphere + table, az 20 el 25, light -35/39', r)
    showRecall('sphere + table', r)
    expect(r.particlesBoth).toBeGreaterThan(500)
    expectRecall('sphere + table', r)
    expect(r.pairs).toBeGreaterThan(500)
    expect(r.strokeDeltaE).toBeLessThanOrEqual(0.08)
    expect(r.countRatio).toBeGreaterThanOrEqual(0.5)
    expect(r.countRatio).toBeLessThanOrEqual(2)
    expect(r.visibleRatio).toBeGreaterThanOrEqual(0.5)
    expect(r.visibleRatio).toBeLessThanOrEqual(2)
    expect(r.underpaintPixels).toBeGreaterThan(5000)
    expect(r.underpaintDeltaE).toBeLessThanOrEqual(0.08)
  })

  it('holds at other authored views and lights (the report\'s table)', () => {
    const cases: [string, Parameters<typeof parityAtAuthored>[0]][] = [
      ['az 60 el 40, light 30/45', { azimuth: 60, elevation: 40, light: [30, 45] }],
      ['az 200 el 10, light 110/20', { azimuth: 200, elevation: 10, light: [110, 20] }],
      ['pale yellow, az 20 el 25', { local: lchToLab(0.9, 0.12, 95) }],
      ['seed 3, az 20 el 25', { params: resolvePaintParams({ seed: 3 }) }],
    ]
    for (const [name, opts] of cases) {
      const r = parityAtAuthored(opts)
      show(name, r)
      showRecall(name, r)
      expectRecall(name, r)
      expect(r.strokeDeltaE, name).toBeLessThanOrEqual(0.08)
      expect(r.countRatio, name).toBeGreaterThanOrEqual(0.5)
      expect(r.countRatio, name).toBeLessThanOrEqual(2)
      expect(r.underpaintDeltaE, name).toBeLessThanOrEqual(0.08)
    }
  })

  it('holds for a veil: a flat translucent sheet over a sphere, with its border pass', () => {
    const params = sparse(500)
    const view = { ...paintView({ width: 640, height: 480, azimuth: 30, elevation: 50, zoom: 120 }), lightDir: LIGHT }
    // (the sphere is in the G-buffer, the veil is not)
    const gbuffer = sphereGBuffer(view.width, view.height, { view, params, radius: 0.6, mark: 0 })
    const r = parityOfScene({ scene: veilScene(), colours: flatColours({ 0: TERRACOTTA, 1: lchToLab(0.7, 0.1, 250) }), view, gbuffer, zoom: 120, params })
    show('veil over a sphere, az 30 el 50', r)
    showRecall('veil', r, 20)
    expect(r.particlesBoth).toBeGreaterThan(100)
    expectRecall('veil', r, 20)
    expect(r.strokeDeltaE).toBeLessThanOrEqual(0.08)
    expect(r.countRatio).toBeGreaterThanOrEqual(0.5)
    expect(r.countRatio).toBeLessThanOrEqual(2)
  })

  it('holds for an open sheet: a saddle, seen from either side of its folds', () => {
    const params = sparse(700)
    for (const [az, el] of [[20, 25], [200, 10]] as const) {
      const view = { ...paintView({ width: 640, height: 480, azimuth: az, elevation: el, zoom: 150 }), lightDir: LIGHT }
      const scene = saddleScene()
      const gbuffer = meshGBuffer(view.width, view.height, [{ mesh: scene.marks[0] as MeshMark, mark: 0 }], { view, params })
      const r = parityOfScene({ scene, colours: saddleColours(), view, gbuffer, zoom: 150, params })
      const name = `saddle, az ${az} el ${el}`
      show(name, r)
      showRecall(name, r, 20)
      expect(r.particlesBoth, name).toBeGreaterThan(200)
      expectRecall(name, r, 20)
      expect(r.strokeDeltaE, name).toBeLessThanOrEqual(0.08)
      expect(r.countRatio, name).toBeGreaterThanOrEqual(0.5)
      expect(r.countRatio, name).toBeLessThanOrEqual(2)
    }
  })
})
