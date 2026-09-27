// "cylindrical:" and "spherical:" (plan A5; SP9 row 2.7): one coordinate as a
// function of the other two.
//
//   cylindrical: <r | theta | z> = <expr in the other two> [for <ranges>]
//   spherical: <rho | theta | phi> = <expr in the other two> [for <ranges>]
//
// theta is the azimuth from +x toward +y; phi is measured from +z (OpenStax).
// "for" gives one or both of the other two coordinates' ranges; the rest keep
// their defaults (kernel/geometry/coordinateSurfaces.ts). The style is a
// parametric surface's: opacity:, colormap:, mesh: and res:.

import { parseForRange, splitTopLevelComma } from '../../../parser/grammarUtil'
import { parseExprString } from '../../../parser/parseExpr'
import { varNames } from '../../../math/expr'
import { splitStyle } from '../style'
import type { SpaceForm } from '../types'
import { keywordStyle } from './shared'

export const COORDINATES = {
  cylindrical: ['r', 'theta', 'z'],
  spherical: ['rho', 'theta', 'phi'],
} as const

type System = keyof typeof COORDINATES

function parseCoordinateSurface(system: System, text: string): SpaceForm {
  const { rest, clauses } = splitStyle(text)
  const body = rest.trim()
  const coordinates: readonly string[] = COORDINATES[system]
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=(.+)$/.exec(body)
  if (!match) throw new Error(`Expected "${system}: ${coordinates[0]} = 2" — one coordinate as a function of the other two — got "${system}: ${body}"`)
  const solved = match[1]
  if (!coordinates.includes(solved)) {
    throw new Error(`${system}: expects ${coordinates[0]}, ${coordinates[1]} or ${coordinates[2]} on the left, got "${solved}"`)
  }
  const others = coordinates.filter((c) => c !== solved)
  const forIdx = match[2].indexOf(' for ')
  const exprText = forIdx === -1 ? match[2] : match[2].slice(0, forIdx)
  const expr = parseExprString(exprText)
  if (varNames(expr).has(solved)) throw new Error(`${system}: ${solved} = … gives ${solved} from ${others.join(' and ')} — it cannot read ${solved}`)
  const ranges = forIdx === -1 ? [] : splitTopLevelComma(match[2].slice(forIdx + ' for '.length)).map((part) => parseForRange(part.trim()))
  if (ranges.length > 2) throw new Error(`${system}: takes at most two ranges, one for each of ${others.join(' and ')}`)
  for (const [i, range] of ranges.entries()) {
    if (!others.includes(range.param)) throw new Error(`${system}: ${solved} = … ranges over ${others.join(' and ')}, not ${range.param}`)
    if (ranges.findIndex((r) => r.param === range.param) !== i) throw new Error(`${system}: ${range.param} is given two ranges`)
  }
  return {
    form: 'coordinateSurface',
    system,
    solved,
    body: expr,
    ranges,
    style: keywordStyle(clauses, ['opacity', 'colormap', 'mesh', 'res'], system),
  }
}

export function parseCylindrical(text: string): SpaceForm {
  return parseCoordinateSurface('cylindrical', text)
}

export function parseSpherical(text: string): SpaceForm {
  return parseCoordinateSurface('spherical', text)
}
