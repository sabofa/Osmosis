import { describe, expect, it } from 'vitest'
import { classifyChange } from '../model/index'
import { CURVE_SCHEMA, PARAM_SCHEMA, setParam, type PaintParams } from '../params'
import { getCurve, setCurve } from '../../../../../review/src/paintLabParams'
import { bakeKey, classifyBakeChange, lengthFactorsMoved, lightKeyOf, VIEW_ONLY } from './index'
import { fixture, LIGHT, P, sparse, sphereColours, sphereScene, type Fixture } from './bakeFixture'

// What a change of parameters asks of a baked painting that is on screen (bake/index.ts classifyBakeChange): the lab's rule for "recolour, bake again
// or nothing". It must agree with the model's own classes (model/index.ts classifyChange) where they speak of the same thing, and with the bake's key
// everywhere.

// The new value of a slider: its maximum, or its minimum where it is at the maximum.
const moved = (path: string): PaintParams => {
  const spec = PARAM_SCHEMA.find((s) => s.path === path)!
  const current = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], P) as number
  return setParam(P, path, current === spec.max ? spec.min : spec.max)
}

// A small bake, made once when a test needs it (the key reads the scene, the particles and the baked lengths).
let made: Fixture | null = null
const small = (): Fixture => (made ??= fixture(sphereScene(), sphereColours(), sparse(60)))

const isViewOnly = (path: string): boolean => VIEW_ONLY.some((v) => path === v || path.startsWith(`${v}.`))

describe('classifyBakeChange', () => {
  it('is "same" for nothing, and for the same params object', () => {
    expect(classifyBakeChange(P, P)).toBe('same')
    expect(classifyBakeChange(P, { ...P })).toBe('same')
  })

  it('agrees with classifyChange and the key for every slider: colour sliders are a colour change, renderer sliders and the ones a frame reads are none, the rest are a bake', () => {
    const counts = { colour: 0, same: 0, bake: 0 }
    for (const spec of PARAM_SCHEMA) {
      const next = moved(spec.path)
      const got = classifyBakeChange(P, next)
      counts[got]++
      const model = classifyChange(P, next)
      // the model's class says what a per-frame frame needs; the bake's says what a baked painting needs
      if (model === 'colour') expect(got, spec.path).toBe('colour')
      else if (model === 'render' || model === 'same') expect(got, spec.path).toBe('same')
      else expect(got, spec.path).toBe(isViewOnly(spec.path) ? 'same' : 'bake')
    }
    // (the schema has sliders of every kind)
    expect(counts.colour).toBeGreaterThan(5)
    expect(counts.same).toBeGreaterThan(5)
    expect(counts.bake).toBeGreaterThan(20)
  })

  it('moves with the key for EVERY slider and EVERY curve (not a sample): a bake is needed exactly when the key moves, and a colour change is the key\'s own colour-only set', () => {
    const f = small()
    const keyOf = (params: PaintParams): string => bakeKey(f.scene, f.light, params, f.authored, f.particles, f.colours)
    const base = f.params
    const k0 = keyOf(base)
    const changes: [string, PaintParams][] = PARAM_SCHEMA.map((spec) => {
      const current = spec.path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], base) as number
      return [spec.path, setParam(base, spec.path, current === spec.max ? spec.min : spec.max)]
    })
    for (const c of CURVE_SCHEMA) {
      // a bend in the middle of the curve's range, whatever its range
      const points = getCurve(base, c.path)
      const mid = (c.yMin + c.yMax) / 2 + (c.yMax - c.yMin) * 0.3
      changes.push([c.path, setCurve(base, c.path, [points[0], [0.5, mid], points[points.length - 1]])])
    }
    const mismatches: string[] = []
    let colours = 0
    let bakes = 0
    for (const [path, next] of changes) {
      const class_ = classifyBakeChange(base, next)
      // (what the lab asks of the bake: a change of what it reads, or of a baked length's bucket, which a frame-only slider can move: roles.*.density grows strokes)
      const needs = class_ === 'bake' || lengthFactorsMoved(f.baked.areaPerParticle, f.baked.referenceWorldPerPx, base, next)
      if (class_ === 'colour') colours++
      if (needs) bakes++
      if (needs !== (keyOf(next) !== k0)) mismatches.push(`${path}: lab ${needs ? 'bakes' : 'does not'} (${class_}), key ${keyOf(next) !== k0 ? 'moves' : 'stays'}`)
    }
    expect(mismatches).toEqual([])
    // (every slider and every curve was looked at, and the schema has all kinds)
    expect(changes.length).toBe(PARAM_SCHEMA.length + CURVE_SCHEMA.length)
    expect(colours).toBeGreaterThan(5)
    expect(bakes).toBeGreaterThan(20)
  })

  it('is "bake" for a particle or load-cell parameter (the particles and their cells are what the bake is made of), though "mix" is a colour group', () => {
    expect(classifyBakeChange(P, setParam(P, 'mix.loadCell', 40))).toBe('bake')
    expect(classifyBakeChange(P, setParam(P, 'particles.maxPerUnit2', 500))).toBe('bake')
    expect(classifyBakeChange(P, { ...P, seed: P.seed + 1 })).toBe('bake')
    expect(classifyBakeChange(P, setParam(P, 'mix.strength', 0.3))).toBe('colour')
  })

  it('says "bake" when a colour and a non-colour parameter move together, and "colour" when a colour one moves with a frame one', () => {
    const both = setParam(setParam(P, 'curve.warmHue', 20), 'light.intensity', 0.7)
    expect(classifyBakeChange(P, both)).toBe('bake')
    const withFrame = setParam(setParam(P, 'curve.warmHue', 20), 'particles.dragDensity', 0.5)
    expect(classifyBakeChange(P, withFrame)).toBe('colour')
    const withRender = setParam(setParam(P, 'curve.warmHue', 20), 'impasto.strength', 1.9)
    expect(classifyBakeChange(P, withRender)).toBe('colour')
  })
})

describe('lengthFactorsMoved', () => {
  const area = new Float32Array([0, 0.0004, 0.002])
  const perPx = 1 / 150

  it('is false for the same params and for params that only move what the length does not read', () => {
    expect(lengthFactorsMoved(area, perPx, P, P)).toBe(false)
    expect(lengthFactorsMoved(area, perPx, P, setParam(P, 'particles.dragDensity', 0.4))).toBe(false)
    expect(lengthFactorsMoved(area, perPx, P, setParam(P, 'curve.warmHue', 20))).toBe(false)
  })

  it('moves when a growth or size-follow slider crosses a bucket of a mark’s baked length (and is what the key holds)', () => {
    const f = small()
    const next = [0.1, 0.5, 2, 4, 8, 16].map((v) => setParam(f.params, 'particles.zoomGrowMax', v)).find((p) => lengthFactorsMoved(f.baked.areaPerParticle, f.baked.referenceWorldPerPx, f.params, p))
    expect(next, 'a zoom growth that crosses a bucket').toBeDefined()
    const keyOf = (params: PaintParams): string => bakeKey(f.scene, f.light, params, f.authored, f.particles, f.colours)
    // (the key holds the bucketed factors of the fixture's own areas: it moves when they do)
    const moves = lengthFactorsMoved(f.baked.areaPerParticle, f.baked.referenceWorldPerPx, f.params, setParam(f.params, 'particles.zoomGrowMax', next!.particles.zoomGrowMax))
    expect(keyOf(setParam(f.params, 'particles.zoomGrowMax', next!.particles.zoomGrowMax)) !== keyOf(f.params)).toBe(moves)
  })
})

describe('lightKeyOf', () => {
  it('is the light as the key holds it: unit, to 1e-6, no negative zero', () => {
    expect(lightKeyOf([2, 0, 0])).toBe('1000000,0,0')
    expect(lightKeyOf([-1e-9, 3, 4])).toBe('0,600000,800000')
    expect(lightKeyOf(LIGHT)).toBe(lightKeyOf(LIGHT.map((v) => v * 7)))
    expect(lightKeyOf([1, 1, 1])).not.toBe(lightKeyOf([1, 1, 1.00001]))
    // a light the key does not tell apart (it rounds to 1e-6) has one string
    expect(lightKeyOf([1, 0, 0])).toBe(lightKeyOf([1, 1e-8, 0]))
  })

  it('agrees with the key: two lights of one string give one key, two of two strings give two', () => {
    const f = small()
    const keyOf = (light: [number, number, number]): string => bakeKey(f.scene, light, f.params, f.authored, f.particles, f.colours)
    const a: [number, number, number] = [...LIGHT]
    const b: [number, number, number] = [LIGHT[0] + 1e-9, LIGHT[1], LIGHT[2]]
    const c: [number, number, number] = [LIGHT[0] + 1e-3, LIGHT[1], LIGHT[2]]
    expect(lightKeyOf(a) === lightKeyOf(b)).toBe(keyOf(a) === keyOf(b))
    expect(lightKeyOf(a) === lightKeyOf(c)).toBe(keyOf(a) === keyOf(c))
    expect(lightKeyOf(a)).not.toBe(lightKeyOf(c))
  })
})
