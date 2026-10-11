// The 2D engine's MathScope (calc P1). Built by space's own scope builder,
// imported unchanged, so a definition means the same thing in every engine:
// one-parameter and multi-parameter definitions, constants, @param values,
// and the same clash reports — a name defined twice, a @param that is also a
// definition, and whatever space decides about a definition named after a
// built-in, pi or e. Definitions are order-independent, as they always were
// in 2D.

import type { MathScope } from '../math/scope'
import type { GraphConfig } from '../parser/config'
import type { Statement } from '../parser/types'
import type { SceneError } from '../scene/types'
import { buildScope } from '../space/kernel/scope'

// `lines` carries parseSpec's statementLines so a clash names its line; without
// it every error says line 0, as the 2D scene's errors did before calc P1.
export function buildPlotScope(statements: readonly Statement[], config: GraphConfig, lines?: readonly number[]): { scope: MathScope; errors: SceneError[] } {
  return buildScope(statements, lines ?? statements.map(() => 0), config.bindings, config.angle)
}
