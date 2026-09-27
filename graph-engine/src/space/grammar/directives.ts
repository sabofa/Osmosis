// Space's own directives (SP7), delegated to from parser/parseConfig.ts. Each
// line replaces the whole directive ("last value wins", as for every
// directive): a later "@camera: azimuth 0" resets elevation and zoom to their
// defaults. @view stays the solid-figure camera and is not handled here.
//
//   @bounds3d: x [-3, 3], y [-3, 3], z [0, 10]    any subset, any order, min < max
//   @aspect: equal | auto | a:b:c                   positive ratios
//   @projection: orthographic | perspective
//   @camera: azimuth <deg>, elevation <deg>, zoom <k>   any subset; |elevation| <= 89.5; zoom > 0
//   @frame: box | axes | none
//   @ticks3d: x <step>, y <step>, z <step>          any subset; a step written as a
//                                                   rational multiple of pi is marked so
//   @titles: x "…", y "…", z "…"
//   @colormap: viridis | cividis | magma | plasma | gray | balance
//   @resolution: <integer 8-400>
//   @depthcue: on | off
//   @param ...                                      see params.ts

import { splitTopLevelComma } from '../../parser/grammarUtil'
import { parseExprString } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { DEFAULT_CAMERA, defaultSpaceConfig, type Binding, type SpaceConfig, type TickStep } from '../config'
import type { Range } from '../scene/types'
import { constantValue, parseParamLine, type Angle } from './params'
import { isColormapName, unknownColormap } from './style'

// What a directive writes: GraphConfig's two space fields, structurally, so
// the grammar does not import parser/config.ts.
export interface SpaceDirectiveTarget {
  space: SpaceConfig
  bindings: Binding[]
  // @angle, which trig in a directive's constants reads (GraphConfig has it;
  // parseSpec applies every @angle line before the other lines).
  angle?: Angle
}

type Axis = 'x' | 'y' | 'z'

// "x <text>, y <text>" -> per-axis text, refusing unknown and repeated axes.
function perAxis(directive: string, value: string, pattern: RegExp, shape: string): Map<Axis, RegExpExecArray> {
  const found = new Map<Axis, RegExpExecArray>()
  for (const part of splitTopLevelComma(value)) {
    const match = pattern.exec(part.trim())
    if (!match) throw new Error(`@${directive} expects ${shape}, got "${part.trim()}"`)
    const axis = match[1] as Axis
    if (found.has(axis)) throw new Error(`@${directive} gives ${axis} twice`)
    found.set(axis, match)
  }
  return found
}

function parseBounds(value: string, angle: Angle): SpaceConfig['bounds'] {
  const axes = perAxis('bounds3d', value, /^(\w+)\s*\[(.*)\]$/, '"x [a, b]"')
  const bounds: SpaceConfig['bounds'] = { x: null, y: null, z: null }
  for (const [axis, match] of axes) {
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') throw new Error(`@bounds3d takes x, y or z, got "${axis}"`)
    const ends = splitTopLevelComma(match[2])
    if (ends.length !== 2) throw new Error(`@bounds3d ${axis} expects "[a, b]", got "[${match[2]}]"`)
    const range: Range = { min: constantValue(ends[0], `@bounds3d ${axis}`, angle), max: constantValue(ends[1], `@bounds3d ${axis}`, angle) }
    if (!(range.min < range.max)) throw new Error(`@bounds3d ${axis}: the minimum must be less than the maximum, got [${range.min}, ${range.max}]`)
    bounds[axis] = range
  }
  return bounds
}

function parseAspect(value: string): SpaceConfig['aspect'] {
  if (value === 'equal') return { kind: 'equal' }
  if (value === 'auto') return { kind: 'auto' }
  const parts = value.split(':').map((p) => p.trim())
  if (parts.length !== 3 || parts.some((p) => !/^(\d+\.?\d*|\.\d+)$/.test(p))) {
    throw new Error(`@aspect must be "equal", "auto" or three ratios "a:b:c", got "${value}"`)
  }
  const [x, y, z] = parts.map(Number.parseFloat)
  if (!(x > 0 && y > 0 && z > 0)) throw new Error(`@aspect ratios must be positive, got "${value}"`)
  return { kind: 'ratio', x, y, z }
}

function parseCamera(value: string, angle: Angle): SpaceConfig['camera'] {
  const camera = { ...DEFAULT_CAMERA }
  const keys = new Set<string>()
  for (const part of splitTopLevelComma(value)) {
    const match = /^(\w+)\s+(.+)$/.exec(part.trim())
    const key = match?.[1]
    if (!match || (key !== 'azimuth' && key !== 'elevation' && key !== 'zoom')) {
      throw new Error(`@camera takes azimuth, elevation or zoom, e.g. "@camera: azimuth 40, elevation 25, zoom 1", got "${part.trim()}"`)
    }
    if (keys.has(key)) throw new Error(`@camera gives ${key} twice`)
    keys.add(key)
    camera[key] = constantValue(match[2], `@camera ${key}`, angle)
  }
  if (Math.abs(camera.elevation) > 89.5) throw new Error(`@camera elevation must be within -89.5 to 89.5 degrees, got ${camera.elevation}`)
  if (!(camera.zoom > 0)) throw new Error(`@camera zoom must be positive, got ${camera.zoom}`)
  return camera
}

function positiveInteger(e: Expr): number | null {
  return e.kind === 'num' && Number.isInteger(e.value) && e.value > 0 ? e.value : null
}

function isPi(e: Expr): boolean {
  return e.kind === 'var' && e.name === 'pi'
}

// k/m with both positive integers, or k alone.
function rational(e: Expr): { num: number; den: number } | null {
  const k = positiveInteger(e)
  if (k !== null) return { num: k, den: 1 }
  if (e.kind === 'binary' && e.op === '/') {
    const num = positiveInteger(e.left)
    const den = positiveInteger(e.right)
    if (num !== null && den !== null) return { num, den }
  }
  return null
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

// A step written as a rational multiple of pi, read off the Expr's structure:
// pi, k*pi (or pi*k, 2pi), pi/m, k*pi/m, (k/m)*pi. Never from the float.
export function piMultiple(e: Expr): { num: number; den: number } | null {
  let found: { num: number; den: number } | null = null
  if (isPi(e)) found = { num: 1, den: 1 }
  else if (e.kind === 'binary' && e.op === '*') {
    if (isPi(e.right)) found = rational(e.left)
    else if (isPi(e.left)) found = rational(e.right)
  } else if (e.kind === 'binary' && e.op === '/') {
    const den = positiveInteger(e.right)
    const top = den === null ? null : piMultiple(e.left)
    if (den !== null && top !== null && top.den === 1) found = { num: top.num, den }
  }
  if (!found) return null
  const g = gcd(found.num, found.den)
  return { num: found.num / g, den: found.den / g }
}

function parseTicks(value: string, angle: Angle): SpaceConfig['ticks'] {
  const axes = perAxis('ticks3d', value, /^([xyz])\s+(.+)$/, '"x <step>" with x, y or z')
  const ticks: SpaceConfig['ticks'] = { x: null, y: null, z: null }
  for (const [axis, match] of axes) {
    const expr = parseExprString(match[2])
    const step = constantValue(match[2], `@ticks3d ${axis}`, angle)
    if (!(step > 0)) throw new Error(`@ticks3d ${axis}: a step must be positive, got ${step}`)
    const tick: TickStep = { value: step, pi: piMultiple(expr) }
    ticks[axis] = tick
  }
  return ticks
}

function parseTitles(value: string): SpaceConfig['titles'] {
  const titles = defaultSpaceConfig().titles
  const seen = new Set<Axis>()
  let rest = value.trim()
  while (rest.length > 0) {
    const match = /^([xyz])\s+"([^"]*)"\s*(,\s*|$)/.exec(rest)
    if (!match) throw new Error(`@titles expects quoted titles, e.g. '@titles: x "t (s)", y "x (m)"', got "${rest}"`)
    const axis = match[1] as Axis
    if (seen.has(axis)) throw new Error(`@titles gives ${axis} twice`)
    seen.add(axis)
    titles[axis] = match[2]
    rest = rest.slice(match[0].length)
  }
  return titles
}

// Handles one "@key: value" directive if it is space's, and says whether it
// was. Throws, naming the directive, on a bad value.
export function parseSpaceDirective(key: string, value: string, target: SpaceDirectiveTarget, line = 0): boolean {
  const space = target.space
  const angle = target.angle ?? 'radians'
  switch (key) {
    case 'bounds3d':
      space.bounds = parseBounds(value, angle)
      return true
    case 'aspect':
      space.aspect = parseAspect(value)
      return true
    case 'projection':
      if (value !== 'orthographic' && value !== 'perspective') {
        throw new Error(`@projection must be "orthographic" or "perspective", got "${value}"`)
      }
      space.projection = value
      return true
    case 'camera':
      space.camera = parseCamera(value, angle)
      return true
    case 'frame':
      if (value !== 'box' && value !== 'axes' && value !== 'none') throw new Error(`@frame must be box, axes or none, got "${value}"`)
      space.frame = value
      return true
    case 'ticks3d':
      space.ticks = parseTicks(value, angle)
      return true
    case 'titles':
      space.titles = parseTitles(value)
      return true
    case 'colormap':
      if (!isColormapName(value)) throw unknownColormap(value)
      space.colormap = value
      return true
    case 'resolution': {
      const n = Number(value)
      if (!/^\d+$/.test(value) || n < 8 || n > 400) throw new Error(`@resolution must be a whole number from 8 to 400, got "${value}"`)
      space.resolution = n
      return true
    }
    case 'depthcue':
      if (value !== 'on' && value !== 'off') throw new Error(`@depthcue must be "on" or "off", got "${value}"`)
      space.depthcue = value === 'on'
      return true
    case 'param': {
      const binding = parseParamLine(value, line, angle)
      if (target.bindings.some((b) => b.name === binding.name)) {
        throw new Error(`@param ${binding.name} is defined twice`)
      }
      target.bindings.push(binding)
      return true
    }
    default:
      return false
  }
}
