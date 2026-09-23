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
  it('defaults to isometric, the viewpoint a textbook drawing uses', () => {
    expect(defaultConfig().view).toBe('isometric')
  })

  it('takes each named viewpoint', () => {
    for (const name of ['isometric', 'front', 'top', 'side'] as const) {
      const config = defaultConfig()
      parseConfigLine(`@view: ${name}`, config)
      expect(config.view).toBe(name)
    }
  })

  it('rejects an unknown viewpoint, naming the ones that exist', () => {
    const config = defaultConfig()
    expect(() => parseConfigLine('@view: orbit', config)).toThrow(/isometric, front, top, side/)
  })
})
