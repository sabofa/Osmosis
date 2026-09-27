// The seam where S4a's marching tetrahedra meet the calculus of a surface.
//
// Two S4b statements need a level surface of F(x, y, z): "gradient: F at P
// surface" (the level surface through P) and a three-variable lagrange: (the
// constraint surface g = c). S4a meshes level surfaces (its plan, A1:
// kernel/geometry/marchingTets.ts), and is built in parallel. Until it
// merges, MESH_LEVEL_SURFACE is null:
// - gradient's "surface" clause is an error on its line (the arrow still
//   draws);
// - a three-variable lagrange: solves and marks its points, and draws no
//   constraint surface.
// At the merge, set MESH_LEVEL_SURFACE to an adapter over S4a's mesher; both
// statements then draw the surface with no other change.

import type { Box3 } from '../../scene/types'

export interface LevelSurfaceMesh {
  positions: Float64Array
  // Unit normals, per vertex.
  normals: Float64Array
  indices: Uint32Array
}

// F = c over the box at res cubes per axis, or null when F never takes c.
export type LevelSurfaceMesher = (F: (x: number, y: number, z: number) => number, c: number, box: Box3, res: number) => LevelSurfaceMesh | null

export const MESH_LEVEL_SURFACE: LevelSurfaceMesher | null = null

export const LEVEL_SURFACE_PENDING = 'the level surface arrives with phase S4a (marching tetrahedra)'
