import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { parseConfigLine } from './parseConfig'

function parse(line: string) {
  const config = defaultConfig()
  parseConfigLine(line, config)
  return config
}

describe('@points', () => {
  it('accepts the new kind names', () => {
    expect(parse('@points: roots').points).toEqual(new Set(['x-intercept', 'y-intercept']))
    expect(parse('@points: extrema').points).toEqual(new Set(['local-max', 'local-min']))
    expect(parse('@points: inflections').points).toEqual(new Set(['inflection']))
    expect(parse('@points: intersections').points).toEqual(new Set(['intersection']))
  })

  it('accepts several groups at once', () => {
    expect(parse('@points: roots, extrema').points).toEqual(
      new Set(['x-intercept', 'y-intercept', 'local-max', 'local-min'])
    )
  })

  // Stored questions in the bank carry the v1 spelling, and the server
  // validates graph_spec with this parser — rejecting them would reject
  // existing content, so these stay accepted forever.
  it('keeps the v1 names working as aliases', () => {
    expect(parse('@points: intercepts').points).toEqual(new Set(['x-intercept', 'y-intercept']))
    expect(parse('@points: vertices').points).toEqual(new Set(['local-max', 'local-min']))
  })

  it('still handles none and all', () => {
    expect(parse('@points: none').points.size).toBe(0)
    expect(parse('@points: all').points.has('inflection')).toBe(true)
    expect(parse('@points: all').points.has('x-intercept')).toBe(true)
  })

  it('rejects an unknown kind by name', () => {
    expect(() => parse('@points: bananas')).toThrow(/bananas/)
  })
})

describe('@labels and @label-every', () => {
  it('parses the three label modes', () => {
    expect(parse('@labels: none').labels).toBe('none')
    expect(parse('@labels: coarse').labels).toBe('coarse')
    expect(parse('@labels: all').labels).toBe('all')
  })

  it('defaults to all', () => {
    expect(defaultConfig().labels).toBe('all')
  })

  it('parses a positive integer label interval', () => {
    expect(parse('@label-every: 5').labelEvery).toBe(5)
  })

  it('rejects a non-positive or fractional interval', () => {
    expect(() => parse('@label-every: 0')).toThrow()
    expect(() => parse('@label-every: 2.5')).toThrow()
  })
})

describe('@step-mode', () => {
  it('parses the three step modes', () => {
    expect(parse('@step-mode: nice').stepMode).toBe('nice')
    expect(parse('@step-mode: geometric').stepMode).toBe('geometric')
    expect(parse('@step-mode: fixed').stepMode).toBe('fixed')
  })

  it('defaults to nice', () => {
    expect(defaultConfig().stepMode).toBe('nice')
  })
})

describe('@xscale and @yscale', () => {
  it('default to linear on both axes', () => {
    expect(defaultConfig().scales).toEqual({ x: 'linear', y: 'linear' })
  })

  it('parse linear and log', () => {
    expect(parse('@xscale: log').scales.x).toBe('log')
    expect(parse('@xscale: linear').scales.x).toBe('linear')
    expect(parse('@yscale: log').scales.y).toBe('log')
    expect(parse('@yscale: linear').scales.y).toBe('linear')
  })

  it('are independent per axis', () => {
    expect(parse('@xscale: log').scales).toEqual({ x: 'log', y: 'linear' })
    expect(parse('@yscale: log').scales).toEqual({ x: 'linear', y: 'log' })
  })

  it('refuse anything else, naming the directive', () => {
    expect(() => parse('@xscale: ln')).toThrow('@xscale must be "linear" or "log", got "ln"')
    expect(() => parse('@yscale: ln')).toThrow('@yscale must be "linear" or "log", got "ln"')
  })
})

describe('log axes need a positive @bounds range', () => {
  function parseAll(...lines: string[]) {
    const config = defaultConfig()
    for (const l of lines) parseConfigLine(l, config)
    return config
  }

  it('refuses a log x axis whose range reaches zero or below', () => {
    const msg = '@xscale: log needs a positive x range in @bounds, got "0, 10"'
    expect(() => parseAll('@bounds: 0,10,1,5', '@xscale: log')).toThrow(msg)
    expect(() => parseAll('@xscale: log', '@bounds: 0,10,1,5')).toThrow(msg)
    expect(() => parseAll('@xscale: log', '@bounds: -3,10,1,5')).toThrow(/@xscale: log needs a positive x range/)
  })

  it('refuses a log y axis the same way', () => {
    const msg = '@yscale: log needs a positive y range in @bounds, got "-1, 5"'
    expect(() => parseAll('@bounds: 1,10,-1,5', '@yscale: log')).toThrow(msg)
    expect(() => parseAll('@yscale: log', '@bounds: 1,10,-1,5')).toThrow(msg)
  })

  it('accepts a positive range, in either directive order', () => {
    expect(parseAll('@bounds: 0.1,10,1,5', '@xscale: log').scales.x).toBe('log')
    expect(parseAll('@xscale: log', '@bounds: 0.1,10,1,5').bounds).toEqual({ xMin: 0.1, xMax: 10, yMin: 1, yMax: 5 })
    expect(parseAll('@bounds: 1,10,0.1,5', '@yscale: log').scales.y).toBe('log')
    expect(parseAll('@yscale: log', '@bounds: 1,10,0.1,5').scales.y).toBe('log')
  })

  it('only checks the log axis: the other stays free to cross zero', () => {
    expect(() => parseAll('@xscale: log', '@bounds: 0.1,10,-5,5')).not.toThrow()
    expect(() => parseAll('@yscale: log', '@bounds: -5,5,0.1,10')).not.toThrow()
  })

  it('leaves linear axes alone with zero or negative bounds', () => {
    expect(() => parseAll('@bounds: -10,0,-5,0')).not.toThrow()
    expect(() => parseAll('@xscale: linear', '@yscale: linear', '@bounds: -10,10,-5,5')).not.toThrow()
  })

  it('a log axis with no @bounds is fine', () => {
    const config = parseAll('@xscale: log')
    expect(config.bounds).toBeNull()
  })
})

describe('@point-labels', () => {
  it('parses off and coords', () => {
    expect(parse('@point-labels: coords').pointLabels).toBe('coords')
    expect(parse('@point-labels: off').pointLabels).toBe('off')
  })
})

describe('@scale', () => {
  it('defaults to a figure that is drawn to scale', () => {
    expect(defaultConfig().toScale).toBe(true)
  })

  it('accepts the spelling the spec uses', () => {
    expect(parse('@scale: false').toScale).toBe(false)
    expect(parse('@scale: true').toScale).toBe(true)
  })

  it('accepts this parser\u2019s own on/off spelling too', () => {
    expect(parse('@scale: off').toScale).toBe(false)
    expect(parse('@scale: on').toScale).toBe(true)
  })

  it('rejects anything else, naming both spellings', () => {
    expect(() => parse('@scale: maybe')).toThrow(/true.*false|on.*off/)
  })
})

describe('@givens', () => {
  it('defaults to the top-left corner', () => {
    expect(defaultConfig().givens).toBe('top-left')
  })

  it('accepts each corner and each side', () => {
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right']) {
      expect(parse(`@givens: ${position}`).givens).toBe(position)
    }
  })

  it('rejects anything else, naming the positions it takes', () => {
    expect(() => parse('@givens: middle')).toThrow(/top-left/)
  })
})

describe('@givens-title', () => {
  it('is null unless the spec sets one', () => {
    expect(parse('@grid: off').givensTitle).toBeNull()
  })

  it('keeps the heading verbatim, case and spaces included', () => {
    expect(parse('@givens-title: Problem 14').givensTitle).toBe('Problem 14')
  })

  it('treats an empty heading as none at all', () => {
    expect(parse('@givens-title:').givensTitle).toBeNull()
  })
})

describe('@view', () => {
  it('defaults to standard, a view in general position, not isometric', () => {
    // Exact isometric looks along a cube's space diagonal and puts two of its
    // corners on one point (phase 6b), so it is kept by name only.
    expect(defaultConfig().view).toBe('standard')
  })

  it('takes each named viewpoint', () => {
    for (const name of ['standard', 'isometric', 'front', 'top', 'side'] as const) {
      const config = defaultConfig()
      parseConfigLine(`@view: ${name}`, config)
      expect(config.view).toBe(name)
    }
  })

  it('rejects an unknown viewpoint, naming the ones that exist', () => {
    const config = defaultConfig()
    expect(() => parseConfigLine('@view: orbit', config)).toThrow(/standard, isometric, front, top, side/)
  })
})

describe('space directives and @param (S1, K7)', () => {
  it('the defaults: space config and no bindings', () => {
    const config = defaultConfig()
    expect(config.space).toEqual({
      bounds: { x: null, y: null, z: null },
      aspect: null,
      projection: 'orthographic',
      camera: { azimuth: 40, elevation: 25, zoom: 1 },
      frame: 'box',
      ticks: { x: null, y: null, z: null },
      titles: { x: 'x', y: 'y', z: 'z' },
      colormap: 'viridis',
      resolution: null,
      depthcue: true,
    })
    expect(config.bindings).toEqual([])
  })

  it('delegates every SP7 key to space', () => {
    const config = parse('@bounds3d: x [-3, 3], z [0, 10]')
    expect(config.space.bounds).toEqual({ x: { min: -3, max: 3 }, y: null, z: { min: 0, max: 10 } })
    expect(parse('@aspect: 1:1:0.5').space.aspect).toEqual({ kind: 'ratio', x: 1, y: 1, z: 0.5 })
    expect(parse('@aspect: 2:1').space.aspect).toEqual({ kind: 'ratioXY', x: 2, y: 1 })
    expect(parse('@projection: perspective').space.projection).toBe('perspective')
    expect(parse('@frame: axes').space.frame).toBe('axes')
    expect(parse('@colormap: magma').space.colormap).toBe('magma')
    expect(parse('@resolution: 120').space.resolution).toBe(120)
    expect(parse('@depthcue: off').space.depthcue).toBe(false)
    expect(parse('@titles: x "t (s)", z "E (J)"').space.titles).toEqual({ x: 't (s)', y: 'y', z: 'E (J)' })
  })

  it('@camera: azimuth -30 keeps the default elevation 25 and zoom 1', () => {
    expect(parse('@camera: azimuth -30').space.camera).toEqual({ azimuth: -30, elevation: 25, zoom: 1 })
  })

  it('@ticks3d: x pi/2, z 0.5 marks the pi multiple by structure', () => {
    expect(parse('@ticks3d: x pi/2, z 0.5').space.ticks).toEqual({
      x: { value: Math.PI / 2, pi: { num: 1, den: 2 } },
      y: null,
      z: { value: 0.5, pi: null },
    })
  })

  it('@ticks3d never infers pi from a float', () => {
    expect(parse('@ticks3d: x 1.5707963267948966').space.ticks.x).toEqual({ value: 1.5707963267948966, pi: null })
  })

  it('@param has no colon', () => {
    expect(parse('@param a = 1 range [0, 5] step 0.1').bindings).toEqual([
      { name: 'a', value: 1, min: 0, max: 5, step: 0.1, integer: false, line: 0 },
    ])
    expect(parse('@param n = 8 range [1, 30] integer').bindings).toEqual([
      { name: 'n', value: 8, min: 1, max: 30, step: null, integer: true, line: 0 },
    ])
  })

  it('@param: with a colon is accepted too, and a source line is kept when given', () => {
    const config = defaultConfig()
    parseConfigLine('@param: a = 1 range [0, 5]', config, 7)
    expect(config.bindings).toEqual([{ name: 'a', value: 1, min: 0, max: 5, step: null, integer: false, line: 7 }])
  })

  it('@view is still the solid-figure directive, untouched by space', () => {
    const config = parse('@view: top')
    expect(config.view).toBe('top')
    expect(config.space).toEqual(defaultConfig().space)
  })

  it('refuses a bad space directive by name', () => {
    expect(() => parse('@bounds3d: x [3, -3]')).toThrow(/bounds3d/)
    expect(() => parse('@frame: cube')).toThrow(/@frame/)
    expect(() => parse('@param a = 9 range [0, 5]')).toThrow(/outside/)
  })
})
