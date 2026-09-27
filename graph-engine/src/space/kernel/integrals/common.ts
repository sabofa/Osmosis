// What the S5 builders share: approximate values and their readouts, the
// floor a region is drawn on, and the tolerance that decides when a sampled
// piece (a boundary edge, a wall, a face) has collapsed.

import type { GraphConfig } from '../../../parser/config'
import type { Statement } from '../../../parser/types'
import { APPROX, formatApprox, formatNumber, supportedDigits, MAX_DIGITS } from '../../pick/format'
import type { LabelAnchor, Vec3 } from '../../scene/types'
import type { SpaceForm } from '../../grammar/types'
import type { BuildContext } from '../registry'

// A numeric answer. `error` is the method's estimate of |value - true value|,
// or null when the method has none (a mesh sum), which prints 4 digits.
export interface Approx {
  value: number
  error: number | null
}

export function approxText(a: Approx): string {
  return a.error === null ? formatApprox(a.value) : formatApprox(a.value, a.error)
}

// "≈ (0.6667, 0.3333)": each coordinate to the digits its own estimate supports.
export function approxTupleText(values: readonly Approx[]): string {
  const parts = values.map((a) => formatNumber(a.value, a.error === null ? 4 : Math.min(MAX_DIGITS, supportedDigits(a.value, a.error))))
  return `${APPROX} (${parts.join(', ')})`
}

// A piece is collapsed when its size is at most this fraction of the whole
// figure's (a length against the diagonal, an area against the diagonal
// squared): a side x = 1 whose bounds meet, the centre r = 0, a wall of zero
// height. Real pieces are many orders above it.
export const COLLAPSED_REL = 1e-9

// Where a region is drawn: the box floor when @bounds3d states z, else the
// xy-plane. The kernel builds before the frame's automatic bounds exist, and
// the xy-plane is where the region lives.
export function floorHeight(config: GraphConfig): number {
  return config.space.bounds.z?.min ?? 0
}

export function part(context: BuildContext, name: string): BuildContext['source'] {
  return { ...context.source, object: `${context.source.object}.${name}` }
}

// The statement's readout: an annotation anchored at `position`.
export function readoutLabel(context: BuildContext, position: Vec3, text: string): LabelAnchor {
  return { source: part(context, 'readout'), position, text, kind: 'annotation' }
}

// The form a builder was registered for.
export function formOf<F extends SpaceForm['form']>(statement: Statement, form: F): Extract<SpaceForm, { form: F }> {
  if (statement.kind !== 'space' || statement.form.form !== form) throw new Error(`not a ${form}: ${statement.kind}`)
  return statement.form as Extract<SpaceForm, { form: F }>
}
