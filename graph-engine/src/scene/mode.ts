import type { Statement } from '../parser/types'

// A spec is rendered in 3D as soon as any statement has depth to it — an
// explicit/parametric surface, or a z component on a point/segment/ray/curve.
// Everything else (2D-shaped statements) still plots fine inside a 3D scene,
// lifted onto the z=0 plane, so mixed specs "just work".
export function isThreeD(statements: Statement[]): boolean {
  return statements.some((s) => {
    if (s.kind === 'surface' || s.kind === 'parametricSurface') return true
    if (s.kind === 'point') return s.z !== null
    if (s.kind === 'segment' || s.kind === 'ray') return s.z1 !== null || s.z2 !== null
    if (s.kind === 'parametric') return s.fz !== null
    return false
  })
}
