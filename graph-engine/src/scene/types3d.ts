export interface Vec3 {
  x: number
  y: number
  z: number
}

export type SceneObject3D =
  | { kind: 'curve3d'; points: Vec3[] }
  | { kind: 'point3d'; label: string | null; position: Vec3 }
  | { kind: 'segment3d'; from: Vec3; to: Vec3 }
  | { kind: 'ray3d'; from: Vec3; to: Vec3 }
  // Row-major grid of vertices (rows * cols), rendered as a triangulated surface.
  | { kind: 'surface3d'; rows: number; cols: number; positions: Vec3[] }

export interface Scene3DError {
  line: number
  message: string
}

export interface Scene3D {
  objects: SceneObject3D[]
  errors: Scene3DError[]
}
