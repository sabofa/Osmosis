// A resolved stack as the Paint Lab's parameters.
//
// It lives under settings/ because the painter's parameters are the one place style/
// reads space code (space/paint/params.ts, a plain data module): the boundary test
// (style/boundary.test.ts) lets settings/** import that file and nothing else from
// space/. style/layers.ts re-exports `toPaintParams`.

import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../../space/paint/params'
import { REGISTRY } from './registry'
import type { SettingValue } from './types'

const PAINT_PATHS = REGISTRY.filter((spec) => spec.path.startsWith('paint.'))

const same = (a: SettingValue | undefined, b: SettingValue | undefined) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b))

// The painter's parameters: the defaults, with every paint.* setting the stack changed.
// A fresh object every time, curves included, so a caller may edit what it gets.
export function toPaintParams(resolved: ReadonlyMap<string, SettingValue>): PaintParams {
  let params: PaintParams = structuredClone(DEFAULT_PAINT_PARAMS)
  for (const spec of PAINT_PATHS) {
    const value = resolved.get(spec.path)
    if (value === undefined || same(value, spec.default)) continue
    // setParam walks the dotted path under PaintParams (it is typed for numbers; a curve's
    // points and a choice go in the same way).
    const stored = Array.isArray(value) ? value.map(([x, y]) => [x, y]) : value
    params = setParam(params, spec.path.slice('paint.'.length), stored as unknown as number)
  }
  return params
}
