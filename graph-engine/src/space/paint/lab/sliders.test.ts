import { describe, expect, it } from 'vitest'
import { CURVE_SCHEMA, DEFAULT_PAINT_PARAMS, getParam, PARAM_SCHEMA, setParam } from '../params'
import { applySlider, changedCurves, changedPaths, decimalsFor, getCurve, groupSchema, isToggle, labGroups, setCurve } from '../../../../../review/src/paintLabParams'

// The lab's sliders are generated from PARAM_SCHEMA; applySlider is the one
// place a raw input value (a drag, a typed number) becomes a parameter.

describe('applySlider', () => {
  it('clamps to the spec range', () => {
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'light.azimuth', 500), 'light.azimuth')).toBe(180)
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'light.azimuth', -500), 'light.azimuth')).toBe(-180)
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'light.intensity', -3), 'light.intensity')).toBe(0)
  })

  it('snaps to the step, a multiple of the step from the minimum, with no float residue', () => {
    // step 0.01 from 0: 0.436 -> 44 steps -> exactly 0.44, 0.4349 -> 43 steps -> 0.43.
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'light.intensity', 0.436), 'light.intensity')).toBe(0.44)
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'light.intensity', 0.4349), 'light.intensity')).toBe(0.43)
    // canvas L: min 0.1, step 0.005. (0.9326 - 0.1) / 0.005 = 166.5 -> 167 steps -> 0.935; 0.9321 -> 166 -> 0.93.
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'canvas.tone.0', 0.9326), 'canvas.tone.0')).toBe(0.935)
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'canvas.tone.0', 0.9321), 'canvas.tone.0')).toBe(0.93)
    // max per unit²: min 50, step 10. 904 is 85.4 steps (900), 906 is 85.6 steps (910).
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'particles.maxPerUnit2', 904), 'particles.maxPerUnit2')).toBe(900)
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'particles.maxPerUnit2', 906), 'particles.maxPerUnit2')).toBe(910)
    // A whole-number slider: the seed.
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'seed', 7.4), 'seed')).toBe(7)
  })

  it('takes the numeric text of an input', () => {
    expect(getParam(applySlider(DEFAULT_PAINT_PARAMS, 'light.ambient', '0.35'), 'light.ambient')).toBe(0.35)
  })

  it('ignores what is not a number, an unknown path, and returns the same object', () => {
    for (const raw of ['abc', '', NaN, Infinity, '  ']) {
      expect(applySlider(DEFAULT_PAINT_PARAMS, 'light.ambient', raw as never), String(raw)).toBe(DEFAULT_PAINT_PARAMS)
    }
    expect(applySlider(DEFAULT_PAINT_PARAMS, 'light.nonsense', 0.5)).toBe(DEFAULT_PAINT_PARAMS)
  })

  it('returns the same object when the value ends up unchanged, so nothing re-renders for nothing', () => {
    expect(applySlider(DEFAULT_PAINT_PARAMS, 'light.azimuth', DEFAULT_PAINT_PARAMS.light.azimuth)).toBe(DEFAULT_PAINT_PARAMS)
    // 0.181 snaps to the 0.18 the ambient already is.
    expect(applySlider(DEFAULT_PAINT_PARAMS, 'light.ambient', 0.181)).toBe(DEFAULT_PAINT_PARAMS)
  })

  it('addresses one entry of a tuple and touches nothing else', () => {
    const next = applySlider(DEFAULT_PAINT_PARAMS, 'edges.wContrast.1', 0.6)
    expect(next.edges.wContrast).toEqual([0.32, 0.6, 0.36])
    expect(next.edges.wCurvature).toEqual(DEFAULT_PAINT_PARAMS.edges.wCurvature)
  })

  it('returns a new object and never mutates its input', () => {
    const next = applySlider(DEFAULT_PAINT_PARAMS, 'light.azimuth', -42)
    expect(next).not.toBe(DEFAULT_PAINT_PARAMS)
    expect(DEFAULT_PAINT_PARAMS.light.azimuth).toBe(-35)
    expect(next.light.azimuth).toBe(-42)
  })
})

describe('decimalsFor', () => {
  it('is the number of decimals a step needs', () => {
    expect([1, 0.5, 0.1, 0.01, 0.005, 0.001, 10].map(decimalsFor)).toEqual([0, 1, 1, 2, 3, 3, 0])
  })
})

describe('isToggle', () => {
  it('is a 0..1 step-1 slider (the world-light and shadows switches) and nothing else', () => {
    const shadows = PARAM_SCHEMA.find((s) => s.path === 'light.shadows')!
    expect(isToggle(shadows)).toBe(true)
    expect(PARAM_SCHEMA.filter(isToggle).map((s) => s.path)).toEqual(['light.worldFixed', 'light.shadows'])
  })
})

describe('groupSchema', () => {
  const groups = groupSchema(PARAM_SCHEMA, CURVE_SCHEMA)

  it('is one group per schema group, in the order each first appears, holding every slider and curve once', () => {
    expect(groups.map((g) => g.title)).toEqual([
      'General', 'Light', 'Environment', 'Stroke detection', 'Brush-load mix', 'Value plan', 'Lighting curve', 'Edges',
      'Stroke: block', 'Stroke: form', 'Stroke: scumble', 'Stroke: glaze', 'Stroke: reflected', 'Stroke: dab', 'Stroke: edge', 'Stroke: line',
      'Particles', 'Underpainting', 'Impasto & canvas', 'Curves',
    ])
    expect(groups.flatMap((g) => g.specs.map((s) => s.path)).sort()).toEqual(PARAM_SCHEMA.map((s) => s.path).sort())
    expect(groups.flatMap((g) => g.curves.map((c) => c.path)).sort()).toEqual(CURVE_SCHEMA.map((c) => c.path).sort())
  })

  it('joins the runs of one group: Edges is 5 weights x 3 kinds plus 10 more = 25, Brush-load mix 26 + 3 balances = 29', () => {
    expect(groups.find((g) => g.title === 'Edges')!.specs).toHaveLength(25)
    expect(groups.find((g) => g.title === 'Brush-load mix')!.specs).toHaveLength(29)
    expect(groups.find((g) => g.title === 'Light')!.specs).toHaveLength(8)
    expect(groups.find((g) => g.title === 'Environment')!.specs).toHaveLength(5)
    expect(groups.find((g) => g.title === 'Stroke detection')!.specs).toHaveLength(9)
    expect(groups.find((g) => g.title === 'Stroke: dab')!.specs).toHaveLength(10)
  })

  it('the Curves group is the six curve editors and no sliders', () => {
    const curves = groups.find((g) => g.title === 'Curves')!
    expect(curves.specs).toHaveLength(0)
    expect(curves.curves.map((c) => c.path)).toEqual([
      'curves.lightResponse', 'curves.value', 'curves.lAdjust', 'curves.cAdjust', 'curves.hAdjust', 'curves.mixAmount',
    ])
  })
})

describe('labGroups', () => {
  const groups = labGroups(PARAM_SCHEMA, CURVE_SCHEMA)

  it('puts Light, Environment and Curves near the top, and the stroke groups last', () => {
    expect(groups.map((g) => g.title)).toEqual([
      'General', 'Light', 'Environment', 'Curves', 'Value plan', 'Lighting curve', 'Brush-load mix', 'Edges', 'Stroke detection',
      'Stroke: block', 'Stroke: form', 'Stroke: scumble', 'Stroke: glaze', 'Stroke: reflected', 'Stroke: dab', 'Stroke: edge', 'Stroke: line',
      'Particles', 'Underpainting', 'Impasto & canvas',
    ])
  })

  it('orders the rows of a group as the parameters are laid out: strength first, the balances after colormapScale and before the role multipliers', () => {
    const mix = groups.find((g) => g.title === 'Brush-load mix')!.specs.map((s) => s.path)
    expect(mix[0]).toBe('mix.strength')
    const at = (path: string) => mix.indexOf(path)
    expect(at('mix.hueBias')).toBe(at('mix.colormapScale') + 1)
    expect(at('mix.valueBias')).toBe(at('mix.hueBias') + 2)
    expect(at('mix.roleBlock')).toBe(at('mix.valueBias') + 1)
    expect(mix).toHaveLength(29)
  })

  it('keeps every slider and curve, and puts a group it does not know about after the known ones', () => {
    expect(groups.flatMap((g) => g.specs.map((s) => s.path)).sort()).toEqual(PARAM_SCHEMA.map((s) => s.path).sort())
    const extra = labGroups([...PARAM_SCHEMA, { path: 'seed', label: 'Another', group: 'Zebra', min: 0, max: 1, step: 1 }], CURVE_SCHEMA)
    expect(extra[extra.length - 1].title).toBe('Zebra')
  })
})

describe('curves in the params', () => {
  it('getCurve reads a curve by its path, and setCurve returns new params with that curve replaced', () => {
    expect(getCurve(DEFAULT_PAINT_PARAMS, 'curves.hAdjust')).toEqual([[0, 0], [1, 0]])
    const next = setCurve(DEFAULT_PAINT_PARAMS, 'curves.hAdjust', [[0, 0], [0.5, 12], [1, 0]])
    expect(next).not.toBe(DEFAULT_PAINT_PARAMS)
    expect(next.curves.hAdjust).toEqual([[0, 0], [0.5, 12], [1, 0]])
    expect(next.curves.lAdjust).toBe(DEFAULT_PAINT_PARAMS.curves.lAdjust)
    expect(DEFAULT_PAINT_PARAMS.curves.hAdjust).toEqual([[0, 0], [1, 0]])
  })

  it('changedCurves lists the curves that differ from the defaults, and none at the defaults', () => {
    expect(changedCurves(DEFAULT_PAINT_PARAMS)).toEqual([])
    const p = setCurve(setCurve(DEFAULT_PAINT_PARAMS, 'curves.hAdjust', [[0, 0], [1, 5]]), 'curves.value', [[0, 0], [0.5, 0.6], [1, 1]])
    expect(changedCurves(p).sort()).toEqual(['curves.hAdjust', 'curves.value'])
  })
})

describe('changedPaths', () => {
  it('is empty at the defaults, even for the 1/3 defaults that sit off their step', () => {
    expect(changedPaths(DEFAULT_PAINT_PARAMS)).toEqual([])
  })

  it('lists exactly the sliders that differ from the defaults, tuple entries by index', () => {
    let p = setParam(DEFAULT_PAINT_PARAMS, 'light.azimuth', -20)
    p = setParam(p, 'edges.wFocal.2', 0.5)
    p = setParam(p, 'roles.dab.density', 0.3)
    expect(changedPaths(p).sort()).toEqual(['edges.wFocal.2', 'light.azimuth', 'roles.dab.density'])
  })
})
