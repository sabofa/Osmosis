// Builds the spec's MathScope once (K2, K8): its functions and constants from
// every definition — the existing functionDef (one parameter) and
// constantDef, and space's function and vectorFunction — hidden or not, and
// its parameters from the @param bindings. Clashes need the whole spec, so
// they are found here, each an error on the definition's line:
// - a binding that is also a definition's name (the parameter shadows it);
// - a name defined twice (the later definition is used);
// - a definition named after a built-in, pi or e (refused, so the built-in
//   keeps its meaning).

import type { Statement } from '../../parser/types'
import { BUILTIN_NAMES } from '../../math/compile'
import { makeScope, type MathFunction, type MathScope } from '../../math/scope'
import type { Binding } from '../config'
import type { SceneError } from '../scene/types'

function definition(statement: Statement): [string, MathFunction] | null {
  switch (statement.kind) {
    case 'functionDef':
      return [statement.name, { params: [statement.param], body: statement.body }]
    case 'constantDef':
      return [statement.name, { params: [], body: statement.value }]
    case 'space':
      if (statement.form.form === 'function' || statement.form.form === 'vectorFunction') {
        return [statement.form.name, { params: statement.form.params, body: statement.form.body }]
      }
      return null
    default:
      return null
  }
}

export function buildScope(
  statements: readonly Statement[],
  lines: readonly number[],
  bindings: readonly Binding[],
  angle: MathScope['angle']
): { scope: MathScope; errors: SceneError[] } {
  const errors: SceneError[] = []
  const functions = new Map<string, MathFunction>()
  const definedAt = new Map<string, number>()
  const bindingLine = new Map(bindings.map((b) => [b.name, b.line]))

  statements.forEach((statement, i) => {
    const entry = definition(statement)
    if (!entry) return
    const [name, fn] = entry
    const line = lines[i] ?? 0
    // A built-in, pi and e keep their meaning: the definition is refused.
    if (BUILTIN_NAMES.has(name)) {
      errors.push({ line, message: `"${name}" is a built-in function — a definition cannot take its name` })
      return
    }
    if (name === 'pi' || name === 'e') {
      errors.push({ line, message: `"${name}" is a constant — a definition cannot take its name` })
      return
    }
    const earlier = definedAt.get(name)
    if (earlier !== undefined) {
      errors.push({ line, message: `"${name}" is defined twice (lines ${earlier} and ${line}) — the later definition is used` })
    }
    const param = bindingLine.get(name)
    if (param !== undefined) {
      errors.push({ line, message: `"${name}" is both a @param (line ${param}) and a definition — rename one; the @param is used` })
    }
    definedAt.set(name, line)
    functions.set(name, fn)
  })

  const scope = makeScope({ functions, params: bindings.map((b) => [b.name, b.value] as const), angle })
  return { scope, errors }
}
