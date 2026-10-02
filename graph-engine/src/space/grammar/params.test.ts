import { describe, expect, it } from 'vitest'
import type { Binding } from '../config'
import { defaultSpaceConfig } from '../config'
import { parseSpaceDirective } from './directives'
import { parseParamLine } from './params'

describe('parseParamLine', () => {
  it('a = 1 range [0, 5] step 0.1', () => {
    expect(parseParamLine('a = 1 range [0, 5] step 0.1', 3)).toEqual({ name: 'a', value: 1, min: 0, max: 5, step: 0.1, integer: false, line: 3 })
  })

  it('n = 8 range [1, 30] integer', () => {
    expect(parseParamLine('n = 8 range [1, 30] integer')).toEqual({ name: 'n', value: 8, min: 1, max: 30, step: null, integer: true, line: 0 })
  })

  it('expressions in the value and the range, and step/integer in either order', () => {
    expect(parseParamLine('w = pi range [0, 2*pi]')).toMatchObject({ value: Math.PI, min: 0, max: 2 * Math.PI })
    expect(parseParamLine('k = 2 range [0, 10] integer step 2')).toMatchObject({ step: 2, integer: true })
  })

  it('a built-in function\'s name may be a parameter\'s: it shadows the built-in in the document (@param gamma, a Lorentz factor)', () => {
    expect(parseParamLine('gamma = 2 range [1, 5]', 2)).toEqual({ name: 'gamma', value: 2, min: 1, max: 5, step: null, integer: false, line: 2 })
    for (const name of ['gamma', 'erf', 'cbrt', 'step', 'choose', 'gcd', 'root', 'sin', 'hypot', 'abs']) {
      expect(parseParamLine(`${name} = 1 range [0, 5]`), name).toMatchObject({ name, value: 1 })
    }
  })

  const refusals: [string, RegExp][] = [
    // a malformed range
    ['a = 1', /range/],
    ['a = 1 range [0]', /two bounds/],
    ['a = 1 range 0, 5', /range/],
    // min >= max
    ['a = 1 range [5, 5]', /less than/],
    // the value outside the range
    ['a = 7 range [0, 5]', /outside/],
    // a non-positive step
    ['a = 1 range [0, 5] step 0', /step/],
    ['a = 1 range [0, 5] step -1', /step/],
    // reserved names: coordinates, parameters, constants (a built-in function's
    // name is not reserved: it is the document's own, below)
    ['x = 1 range [0, 5]', /reserved/],
    ['theta = 1 range [0, 5]', /reserved/],
    ['phi = 1 range [0, 5]', /reserved/],
    ['pi = 1 range [0, 5]', /reserved/],
    ['e = 1 range [0, 5]', /reserved/],
    // an integer parameter needs whole numbers
    ['n = 2.5 range [0, 5] integer', /whole/],
    // trailing junk
    ['a = 1 range [0, 5] slowly', /slowly/],
  ]
  for (const [text, message] of refusals) {
    it(`refuses "${text}"`, () => {
      expect(() => parseParamLine(text)).toThrow(message)
    })
  }

  it('refuses a duplicate @param', () => {
    const t = { space: defaultSpaceConfig(), bindings: [] as Binding[] }
    parseSpaceDirective('param', 'a = 1 range [0, 5]', t, 1)
    expect(() => parseSpaceDirective('param', 'a = 2 range [0, 5]', t, 2)).toThrow(/twice/)
  })
})
