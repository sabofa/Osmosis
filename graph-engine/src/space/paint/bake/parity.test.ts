import { describe, expect, it, vi } from 'vitest'
import { lchToLab } from '../model/colour'
import { resolvePaintParams } from '../params'
import { parityAtAuthored, type ParityResult } from './parity'

vi.setConfig({ testTimeout: 300_000 })

// THE PARITY OF THE BAKED FRAME WITH THE PER-FRAME MODEL'S at the authored view (spec §14 accepts look differences from the world's planes: only gross
// bounds are held here, the real numbers are what PARITY_PRINT=1 prints and the task's report states).

const show = (name: string, r: ParityResult): void => {
  if (!process.env.PARITY_PRINT) return
  const f = (v: number, d = 3): string => v.toFixed(d)
  const roles = Object.entries(r.byRole).filter(([, c]) => c.model + c.baked > 0).map(([k, c]) => `${k} ${c.model}/${c.baked}`).join(', ')
  console.log(
    `${name}: particles drawn by either ${r.particlesEither}, by both ${r.particlesBoth}; role agreement ${f(r.roleAgreement)}; ` +
      `pairs ${r.pairs}, stroke dE ${f(r.strokeDeltaE, 4)} (${Object.entries(r.strokeDeltaEByRole).map(([k, v]) => `${k} ${f(v as number, 4)}`).join(', ')}); ` +
      `strokes model ${r.modelStrokes}, baked ${r.bakedStrokes}, ratio ${f(r.countRatio)}, surface ratio ${f(r.surfaceRatio)}, visible surface ${r.bakedVisible} (ratio ${f(r.visibleRatio)}) (model/baked by role: ${roles}); ` +
      `underpainting ${r.underpaintPixels} px, dE ${f(r.underpaintDeltaE, 4)} (by mark ${Object.entries(r.underpaintDeltaEByMark).map(([k, v]) => `${k}: ${f(v as number, 4)}`).join(', ')}), only model ${r.underpaintOnlyModel}, only baked ${r.underpaintOnlyBaked}`,
  )
}

describe('the baked frame against the per-frame model, at the authored view', () => {
  it('agrees within gross bounds on the sphere and the table with their cast shadow: roles, colours, stroke count, underpainting', () => {
    const r = parityAtAuthored()
    show('sphere + table, az 20 el 25, light -35/39', r)
    expect(r.particlesBoth).toBeGreaterThan(500)
    expect(r.roleAgreement).toBeGreaterThanOrEqual(0.6)
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
      expect(r.roleAgreement, name).toBeGreaterThanOrEqual(0.6)
      expect(r.strokeDeltaE, name).toBeLessThanOrEqual(0.08)
      expect(r.countRatio, name).toBeGreaterThanOrEqual(0.5)
      expect(r.countRatio, name).toBeLessThanOrEqual(2)
      expect(r.underpaintDeltaE, name).toBeLessThanOrEqual(0.08)
    }
  })
})
