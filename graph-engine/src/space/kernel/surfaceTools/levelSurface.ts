// The seam where S4a's marching tetrahedra meet the calculus of a surface
// (integration J3).
//
// Two S4b statements draw a level surface of F(x, y, z): "gradient: F at P
// surface" (the level surface through P) and a three-variable lagrange: (the
// constraint surface g = c, whose vertices also seed its Newton solve). Both
// mesh it here, through S4a's mesher (kernel/geometry/marchingTets.ts and
// implicit.ts's levelMesh), so a level surface is the same object whichever
// statement asks for it:
// - F is sampled once on a res^3 grid over the box, and the triangle budget
//   is checked on the samples before anything is meshed (as implicit.ts
//   does);
// - every vertex is bisected onto the true F = c, and shared by edge key;
// - normals are the symbolic ∇F the caller compiled, normalised, with S4a's
//   fallbacks where it vanishes.
// res is S4a's: a res: clause as written (refused above the implicit limit),
// else @resolution clamped to it, else S4a A1's default of 64.

import type { GraphConfig } from '../../../parser/config'
import type { Box3 } from '../../scene/types'
import { checkBudget } from '../common'
import { DEFAULT_IMPLICIT_RES, levelMesh, type LevelField } from '../geometry/implicit'
import { countTriangles, implicitRes, sampleGrid } from '../geometry/marchingTets'

type Scalar3 = (x: number, y: number, z: number) => number

export interface LevelSurfaceMesh {
  positions: Float64Array
  // Unit normals, per vertex.
  normals: Float64Array
  indices: Uint32Array
}

// F with its symbolic gradient, as S4b compiles a three-variable target
// (target.ts, surface3).
export interface LevelSurfaceField {
  F: Scalar3
  grad: readonly [Scalar3, Scalar3, Scalar3]
}

// F = c over the box at res cubes per axis, or null when F never crosses c
// there.
export type LevelSurfaceMesher = (field: LevelSurfaceField, c: number, box: Box3, res: number) => LevelSurfaceMesh | null

// S4a's field shape (a scalar and an allocation-free gradient) over S4b's.
export function levelField(field: LevelSurfaceField): LevelField {
  const [gx, gy, gz] = field.grad
  const F = field.F
  return {
    f: (x, y, z) => F(x, y, z),
    grad: (out, x, y, z) => {
      out[0] = gx(x, y, z)
      out[1] = gy(x, y, z)
      out[2] = gz(x, y, z)
      return out
    },
  }
}

export const MESH_LEVEL_SURFACE: LevelSurfaceMesher = (field, c, box, res) => {
  const level = levelField(field)
  const grid = sampleGrid(level.f, box, res)
  checkBudget(countTriangles(grid, c), res)
  return levelMesh(level, grid, c)
}

// The cubes per axis a level surface is sampled at (see the header).
export function levelSurfaceRes(res: number | null, config: GraphConfig): number {
  return implicitRes(res, config.space.resolution, DEFAULT_IMPLICIT_RES)
}
