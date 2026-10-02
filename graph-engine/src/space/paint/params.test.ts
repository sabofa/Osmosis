import { describe, expect, it } from 'vitest'
import tuning from './tuning.json'
import { DEFAULT_PAINT_PARAMS, getParam, PARAM_SCHEMA, resolvePaintParams, setParam } from './params'

describe('paint params', () => {
  it('every slider path resolves to a number inside its range at the defaults', () => {
    for (const spec of PARAM_SCHEMA) {
      const v = getParam(DEFAULT_PAINT_PARAMS, spec.path)
      expect(typeof v, spec.path).toBe('number')
      expect(v, spec.path).toBeGreaterThanOrEqual(spec.min)
      expect(v, spec.path).toBeLessThanOrEqual(spec.max)
    }
  })

  it('has a slider for every number the painter has but one: particles.dragDensity, which moved nothing', () => {
    const leaves: string[] = []
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number') leaves.push(path)
      else if (Array.isArray(v)) {
        if (!Array.isArray(v[0])) v.forEach((x, i) => walk(x, `${path}.${i}`))
      } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k)
    }
    walk(DEFAULT_PAINT_PARAMS, '')
    const sliders = new Set(PARAM_SCHEMA.map((s) => s.path))
    expect(leaves.filter((l) => !sliders.has(l))).toEqual(['particles.dragDensity'])
    // the lab re-projects while dragging (nothing is thinned), so there is no "Density while dragging" to offer ...
    expect(PARAM_SCHEMA.some((s) => /drag/i.test(s.path) || /drag/i.test(s.label))).toBe(false)
    // ... but a preset saved when there was one still resolves to the value it held
    expect(resolvePaintParams({ particles: { dragDensity: 0.4 } }).particles.dragDensity).toBe(0.4)
    expect(DEFAULT_PAINT_PARAMS.particles.dragDensity).toBe(1)
  })

  it('slider paths are unique', () => {
    const paths = PARAM_SCHEMA.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('resolve merges deep, tuples by index, ignores unknown keys and wrong types', () => {
    const p = resolvePaintParams({
      light: { azimuth: -20 },
      edges: { wContrast: [0.5] },
      bogus: 1,
      mix: { strength: 'loud' },
    } as never)
    expect(p.light.azimuth).toBe(-20)
    expect(p.light.elevation).toBe(DEFAULT_PAINT_PARAMS.light.elevation)
    expect(p.edges.wContrast).toEqual([0.5, 0.52, 0.36])
    expect(p.mix.strength).toBe(1)
    expect((p as unknown as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('resolve never mutates the defaults', () => {
    resolvePaintParams({ light: { azimuth: 99 } })
    expect(DEFAULT_PAINT_PARAMS.light.azimuth).toBe(56)
  })

  it('setParam returns a new object and addresses tuple entries', () => {
    const next = setParam(DEFAULT_PAINT_PARAMS, 'edges.wFocal.2', 0.5)
    expect(next.edges.wFocal[2]).toBe(0.5)
    expect(DEFAULT_PAINT_PARAMS.edges.wFocal[2]).toBe(0.06)
  })

  it('the saved tuning layers over the defaults', () => {
    const p = resolvePaintParams(tuning as never)
    expect(p.seed).toBe(typeof (tuning as { seed?: number }).seed === 'number' ? (tuning as { seed: number }).seed : 1)
  })

  it('has the zoom and underpainting parameters, with the defaults the spec gives, in their groups', () => {
    const p = DEFAULT_PAINT_PARAMS
    expect([p.particles.zoomGrowMax, p.particles.zoomStrokeScale, p.particles.zoomBigMax, p.underpaint.opacity, p.underpaint.streak]).toEqual([3, 0.35, 4, 0.85, 0.4])
    const spec = (path: string) => PARAM_SCHEMA.find((s) => s.path === path)
    expect(spec('particles.zoomGrowMax')).toMatchObject({ group: 'Particles', min: 1 })
    expect(spec('particles.zoomStrokeScale')).toMatchObject({ group: 'Particles', min: 0, max: 1 })
    expect(spec('particles.zoomBigMax')).toMatchObject({ group: 'Particles', min: 1 })
    expect(spec('underpaint.opacity')).toMatchObject({ group: 'Underpainting', min: 0, max: 1 })
    expect(spec('underpaint.streak')).toMatchObject({ group: 'Underpainting', min: 0, max: 1 })
  })

  it('has the defaults that make the lab look like the approved mockup: its key light, its zone steps, its linen at half texture', () => {
    const p = DEFAULT_PAINT_PARAMS
    // the mockup's CAMLIGHT (-0.74, 0.45, 0.50) in screen right, up and toward the viewer: 56 degrees to the left, 27 up
    expect([p.light.azimuth, p.light.elevation]).toEqual([56, 27])
    const lx = -Math.sin((56 * Math.PI) / 180) * Math.cos((27 * Math.PI) / 180)
    const ly = Math.sin((27 * Math.PI) / 180)
    const lz = Math.cos((56 * Math.PI) / 180) * Math.cos((27 * Math.PI) / 180)
    expect([lx, ly, lz].map((v) => Math.round(v * 100) / 100)).toEqual([-0.74, 0.45, 0.5])
    // the mockup's plan values: the half-tone ramp 0.52..0.72, the light ramp 0.85..0.94, the core 0.24, the cast shadow 0.32
    expect([p.value.halfLo, p.value.halfHi, p.value.lightLo, p.value.lightHi, p.value.corePlateau, p.value.castPlateau]).toEqual([0.52, 0.72, 0.85, 0.94, 0.24, 0.32])
    // the mockup painted on fine primed linen, and the weave reads at half the generator's default texture
    expect([p.canvas.weave, p.canvas.texture]).toEqual(['linen', 0.5])
    // and a brush never more than 4 times the size it was tuned at
    expect(p.particles.zoomBigMax).toBe(4)
  })

  it('resolves the underpainting from an override, and clamps nothing it was not asked to', () => {
    const q = resolvePaintParams({ underpaint: { opacity: 0.5 }, particles: { zoomGrowMax: 2 } })
    expect([q.underpaint.opacity, q.underpaint.streak, q.particles.zoomGrowMax, q.particles.zoomStrokeScale, q.particles.zoomBigMax]).toEqual([0.5, 0.4, 2, 0.35, 4])
  })
  it('has the value plan of the classical form-shadow model (spec §12), in the Value plan group, with defaults in painter order', () => {
    const v = DEFAULT_PAINT_PARAMS.value
    const spec = (path: string) => PARAM_SCHEMA.find((s) => s.path === path)
    for (const k of ['lightTurn', 'lightSoftness', 'terminatorSoftness', 'coreWidth', 'corePlateau', 'reflectedShare', 'reflectedSoftness', 'castPlateau', 'castContact']) {
      expect(spec(`value.${k}`), k).toMatchObject({ group: 'Value plan' })
    }
    expect(spec('value.reflectedShare')).toMatchObject({ min: 0, max: 0.9 })
    // the reflected light is a share of the way from the core to the darkest half-tone, about 0.4
    expect(v.reflectedShare).toBeCloseTo(0.4, 12)
    // the terminator is the crispest of the three transitions, the turn to light the widest
    expect(v.terminatorSoftness).toBeLessThan(v.reflectedSoftness)
    expect(v.reflectedSoftness).toBeLessThan(v.lightSoftness)
    // the shadow family sits under the half-tones by construction: core < cast <= reflectedMax < halfLo, contact below the plateau
    expect(v.castContact).toBeLessThanOrEqual(v.castPlateau)
    expect(v.corePlateau + v.reflectedShare * (v.halfLo - v.corePlateau)).toBeLessThan(v.halfLo)
    expect(v.castPlateau).toBeLessThanOrEqual(v.corePlateau + v.reflectedShare * (v.halfLo - v.corePlateau))
    // the old reflected ramp and the old zone steps are gone from the contract
    for (const gone of ['reflectedLo', 'reflectedHi', 'halfAt', 'lightAt', 'soft']) {
      expect(gone in v, gone).toBe(false)
      expect(spec(`value.${gone}`), gone).toBeUndefined()
    }
  })

  it('resolves a saved preset that still carries the old value parameters: the unknown keys are ignored, the rest applies', () => {
    const old = { value: { reflectedLo: 0.34, reflectedHi: 0.48, halfAt: 0.37, lightAt: 0.93, soft: 0.07, corePlateau: 0.2, castPlateau: 0.3 }, light: { azimuth: 10 } }
    const p = resolvePaintParams(old as never)
    expect(p.value.corePlateau).toBe(0.2)
    expect(p.value.castPlateau).toBe(0.3)
    expect(p.light.azimuth).toBe(10)
    // the new parameters keep their defaults, and the old keys do not come back
    expect(p.value.reflectedShare).toBe(DEFAULT_PAINT_PARAMS.value.reflectedShare)
    expect(p.value.lightTurn).toBe(DEFAULT_PAINT_PARAMS.value.lightTurn)
    for (const gone of ['reflectedLo', 'reflectedHi', 'halfAt', 'lightAt', 'soft']) expect(gone in p.value, gone).toBe(false)
    expect(p.value).toEqual({ ...DEFAULT_PAINT_PARAMS.value, corePlateau: 0.2, castPlateau: 0.3 })
  })
})
