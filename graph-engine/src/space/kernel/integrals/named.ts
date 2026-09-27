// Named regions and volumes (S5). "R = region ..." binds a name to a shape,
// not to a value, so it lives outside the MathScope: the kernel collects every
// statement whose builder binds a name, once per spec (hidden or not), and
// "over R", "region: R" and "centroid: R" resolve through here.
//
// A name bound twice is an error on the later line, and the later one is used,
// as for definitions. A region defined as another region's name is followed;
// a cycle is refused.

import type { Statement } from '../../../parser/types'
import type { MathScope } from '../../../math/scope'
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

// The domain a named region stands for, followed through aliases
// ("S = region R"), never itself named.
export function namedRegionDomain(context: BuildContext, name: string): Domain {
  const seen: string[] = []
  let current = name
  for (;;) {
    if (seen.includes(current)) throw new Error(`the region "${name}" is defined in terms of itself (${[...seen, current].join(' → ')})`)
    seen.push(current)
    const entry = context.named.get(current)
    if (!entry) throw new Error(`no region named "${current}" — define one first, e.g. "${current} = region x in [0, 1], y in [0, x]"`)
    const { statement } = entry
    if (statement.kind !== 'space' || statement.form.form !== 'namedRegion') {
      throw new Error(`"${current}" is not a region`)
    }
    const domain = statement.form.domain
    if (domain.kind !== 'named') return domain
    current = domain.name
  }
}

// A domain with any name resolved, and the region's name when it has one.
export function resolveDomain(context: BuildContext, domain: Domain): { domain: Domain; name: string | null } {
  if (domain.kind !== 'named') return { domain, name: null }
  return { domain: namedRegionDomain(context, domain.name), name: domain.name }
}
