import { describe, expect, it } from 'vitest'
import { GUIDE, guideAt } from './guide'
import { REGISTRY, settingAt } from './registry'
import { UNITS } from './units'

// ---------------------------------------------------------------------------
// The guide is the table plus the prose
// ---------------------------------------------------------------------------

describe('the guide is the registry with its prose', () => {
  it('has one entry per registry setting, in the registry’s order', () => {
    expect(GUIDE.map((entry) => entry.path)).toEqual(REGISTRY.map((spec) => spec.path))
  })

  it('carries every table field of the setting as the registry has it', () => {
    for (const spec of REGISTRY) {
      const entry = guideAt(spec.path)!
      const { meaning, interactions, ...table } = entry
      expect(typeof meaning, spec.path).toBe('string')
      expect(Array.isArray(interactions), spec.path).toBe(true)
      expect(table, spec.path).toEqual(spec)
    }
  })

  it('finds nothing for a path that is not a setting', () => {
    for (const path of ['', 'paint', 'paint.value', 'paint.value.nope', 'toString', '__proto__']) expect(guideAt(path), path).toBeUndefined()
  })

  it('leaves the table without prose: the registry’s specs have no meaning and no interactions', () => {
    for (const spec of REGISTRY) {
      expect('meaning' in spec, spec.path).toBe(false)
      expect('interactions' in spec, spec.path).toBe(false)
    }
    expect(settingAt('style.line.looseness')).not.toHaveProperty('meaning')
  })

  it('does not freeze or change a spec of the registry when it copies it', () => {
    for (const spec of REGISTRY) {
      expect(guideAt(spec.path), spec.path).not.toBe(spec)
      expect(Object.isFrozen(spec), spec.path).toBe(true)
    }
  })

  it('has every unit in the table, and the guide’s entry says the same', () => {
    expect(Object.keys(UNITS)).toHaveLength(69)
    for (const spec of REGISTRY) {
      expect(spec.unit, spec.path).toBe(UNITS[spec.path])
      expect(guideAt(spec.path)!.unit, spec.path).toBe(UNITS[spec.path])
    }
  })
})
