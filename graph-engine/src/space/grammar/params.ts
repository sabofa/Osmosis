// "@param a = 1 range [0, 5] step 0.1" and "@param n = 8 range [1, 30]
// integer" (SP6): one binding, a name usable in every expression in the spec.
// The value and the range are expressions over constants only (pi, e and the
// built-ins). A clash with a defined function or constant needs the whole
// spec, so the kernel reports it.

import { splitTopLevelComma } from '../../parser/grammarUtil'
import { parseExprString } from '../../parser/parseExpr'
import { BUILTIN_NAMES, compileScalar } from '../../math/compile'
import { makeScope } from '../../math/scope'
import type { Binding } from '../config'

// The unit trig reads constants in: the spec's @angle, whichever line it is on.
export type Angle = 'radians' | 'degrees'

// Coordinates and the parameter names space's forms bind, plus the constants.
const RESERVED = new Set(['x', 'y', 'z', 't', 'u', 'v', 'r', 'theta', 'rho', 'phi', 'pi', 'e'])

const SHAPE = '"@param a = 1 range [0, 5]", optionally followed by "step 0.1" and/or "integer"'

// A constant expression's value: pi, e and built-ins, no names.
export function constantValue(text: string, what: string, angle: Angle = 'radians'): number {
  let value: number
  try {
    value = compileScalar(parseExprString(text), [], makeScope({ angle }))()
  } catch (err) {
    throw new Error(`${what}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!Number.isFinite(value)) throw new Error(`${what} is not a finite number: "${text.trim()}"`)
  return value
}

export function parseParamLine(rest: string, line = 0, angle: Angle = 'radians'): Binding {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+?)\s+range\s*\[([^\]]*)\](.*)$/.exec(rest.trim())
  if (!match) throw new Error(`Expected ${SHAPE}, got "@param ${rest.trim()}"`)
  const [, name, valueText, rangeText, tail] = match

  if (BUILTIN_NAMES.has(name)) throw new Error(`@param ${name}: "${name}" is a built-in function`)
  if (RESERVED.has(name)) throw new Error(`@param ${name}: "${name}" is reserved (a coordinate, a parameter name space binds, or a constant)`)

  const bounds = splitTopLevelComma(rangeText)
  if (bounds.length !== 2) throw new Error(`@param ${name}: a range has two bounds, "[min, max]", got "[${rangeText}]"`)
  const min = constantValue(bounds[0], `@param ${name}'s minimum`, angle)
  const max = constantValue(bounds[1], `@param ${name}'s maximum`, angle)
  if (!(min < max)) throw new Error(`@param ${name}: the minimum must be less than the maximum, got [${min}, ${max}]`)
  const value = constantValue(valueText, `@param ${name}'s value`, angle)
  if (value < min || value > max) throw new Error(`@param ${name} = ${value} is outside its range [${min}, ${max}]`)

  let step: number | null = null
  let integer = false
  let options = tail.trim()
  while (options.length > 0) {
    const stepMatch = /^step\s+(\S+)\s*/.exec(options)
    const integerMatch = /^integer(\s+|$)/.exec(options)
    if (stepMatch && step === null) {
      step = constantValue(stepMatch[1], `@param ${name}'s step`, angle)
      if (!(step > 0)) throw new Error(`@param ${name}: the step must be positive, got ${step}`)
      options = options.slice(stepMatch[0].length)
    } else if (integerMatch && !integer) {
      integer = true
      options = options.slice(integerMatch[0].length)
    } else {
      throw new Error(`@param ${name}: unexpected "${options}" — expected ${SHAPE}`)
    }
  }

  if (integer && ![value, min, max, step ?? 1].every(Number.isInteger)) {
    throw new Error(`@param ${name}: an integer parameter needs a whole-number value, range and step`)
  }
  return { name, value, min, max, step, integer, line }
}
