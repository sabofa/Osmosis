import { describe, expect, it } from 'vitest'
import { GUIDE } from '../../../style/settings/guide'
import { isRenderOnly } from '../../../../tools/sweepRenderOnly'

describe('isRenderOnly', () => {
  it('marks the renderer-only paint settings', () => {
    for (const path of ['paint.roles.block.bristles', 'paint.roles.dab.load', 'paint.roles.line.wet', 'paint.impasto.strength', 'paint.canvas.texture', 'paint.canvas.weave', 'paint.underpaint.opacity', 'paint.underpaint.streak', 'paint.light.shadows', 'paint.particles.dragDensity'])
      expect(isRenderOnly(path), path).toBe(true)
  })

  it('leaves the model settings alone', () => {
    for (const path of ['paint.roles.block.width', 'paint.roles.block.density', 'paint.canvas.tone.0', 'paint.light.azimuth', 'paint.particles.fadeHi', 'style.line.looseness', 'media.chalk.grain'])
      expect(isRenderOnly(path), path).toBe(false)
  })

  it('only ever marks registry paths of the painter', () => {
    const marked = GUIDE.filter((entry) => isRenderOnly(entry.path))
    expect(marked.length).toBeGreaterThan(50)
    for (const entry of marked) expect(entry.path.startsWith('paint.'), entry.path).toBe(true)
  })
})
