// Named regions and volumes (S5). "R = region ..." and "V = volume ..." bind
// a name to a shape, not to a value, so they live outside the MathScope: the
// kernel collects every statement whose builder binds a name, once per spec
// (hidden or not), and "over R", "region: R", "volume: V" and "centroid: R"
// resolve through here.
//
// A name bound twice is an error on the later line, and the later one is used,
// as for definitions. A shape defined as another's name is followed; a cycle
// is refused.

import type { Statement } from '../../../parser/types'
import type { MathScope } from '../../../math/scope'
import type { VolumeSolid } from '../../grammar/keywords/integrals'
import type { Domain } from '../../grammar/types'
import type { SceneError } from '../../scene/types'
import { builderFor, type BuildContext, type NamedStatement } from '../registry'

export function collectNamed(
  statements: readonly Statement[],
  lines: readonly number[],
  scope: MathScope,
): { named: Map<string, NamedStatement>; errors: SceneError[] } {
  const named = new Map<string, NamedStatement>()
  const errors: SceneError[] = []
  statements.forEach((statement, i) => {
    const name = builderFor(statement)?.binds?.(statement) ?? null
    if (name === null) return
    const line = lines[i] ?? 0
    const earlier = named.get(name)
    if (earlier) errors.push({ line, message: `"${name}" is named twice (lines ${earlier.line} and ${line}) — the later one is used` })
    if (scope.functions.has(name) || scope.params.index.has(name)) {
      errors.push({ line, message: `"${name}" names both a shape and a definition or @param — rename one` })
    }
    named.set(name, { line, statement })
  })
  return { named, errors }
}

export type NamedShape = { kind: 'region'; domain: Domain } | { kind: 'volume'; solid: VolumeSolid }

function shapeOf(statement: Statement): NamedShape | null {
  if (statement.kind !== 'space') return null
  if (statement.form.form === 'namedRegion') return { kind: 'region', domain: statement.form.domain }
  if (statement.form.form === 'namedVolume') return { kind: 'volume', solid: statement.form.solid }
  return null
}

// The shape a name stands for, followed through aliases ("S = region R",
// "W = volume V") until it is written out.
function follow(context: BuildContext, name: string, want: NamedShape['kind']): NamedShape {
  const seen: string[] = []
  let current = name
  for (;;) {
    if (seen.includes(current)) throw new Error(`the ${want} "${name}" is defined in terms of itself (${[...seen, current].join(' → ')})`)
    seen.push(current)
    const entry = context.named.get(current)
    if (!entry) {
      const example = want === 'region' ? 'region x in [0, 1], y in [0, x]' : 'volume x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]'
      throw new Error(`no ${want} named "${current}" — define one first, e.g. "${current} = ${example}"`)
    }
    const shape = shapeOf(entry.statement)
    if (!shape) throw new Error(`"${current}" is not a ${want}`)
    if (shape.kind !== want) throw new Error(`"${current}" is a ${shape.kind}, not a ${want}`)
    const next = shape.kind === 'region' ? (shape.domain.kind === 'named' ? shape.domain.name : null) : shape.solid.kind === 'named' ? shape.solid.name : null
    if (next === null) return shape
    current = next
  }
}

// The domain a named region stands for, never itself named.
export function namedRegionDomain(context: BuildContext, name: string): Domain {
  const shape = follow(context, name, 'region')
  if (shape.kind !== 'region') throw new Error(`"${name}" is a volume, not a region`)
  return shape.domain
}

// A domain with any name resolved, and the region's name when it has one.
export function resolveDomain(context: BuildContext, domain: Domain): { domain: Domain; name: string | null } {
  if (domain.kind !== 'named') return { domain, name: null }
  return { domain: namedRegionDomain(context, domain.name), name: domain.name }
}

// A volume's solid with any name resolved, and the volume's name when it has one.
export function resolveSolid(context: BuildContext, solid: VolumeSolid): { solid: Exclude<VolumeSolid, { kind: 'named' }>; name: string | null } {
  if (solid.kind !== 'named') return { solid, name: null }
  const shape = follow(context, solid.name, 'volume')
  if (shape.kind !== 'volume' || shape.solid.kind === 'named') throw new Error(`"${solid.name}" is a region, not a volume`)
  return { solid: shape.solid, name: solid.name }
}

// Either kind of shape, by name, for centroid: (which takes both).
export function namedShape(context: BuildContext, name: string): NamedShape & { name: string } {
  const entry = context.named.get(name)
  const shape = entry ? shapeOf(entry.statement) : null
  if (!shape) throw new Error(`no region or volume named "${name}" — define one first, e.g. "${name} = region x in [0, 1], y in [0, x]"`)
  if (shape.kind === 'region') return { kind: 'region', domain: namedRegionDomain(context, name), name }
  return { ...resolveSolid(context, { kind: 'named', name }), kind: 'volume', name }
}
