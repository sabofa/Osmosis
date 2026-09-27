// 4x4 matrices, column-major (GL convention): element (row r, column c) is
// m[c * 4 + r]. Only what space's camera needs.
//
// Float64 on purpose. The camera's CPU work (projecting labels, rays for
// picking, zooming about the cursor) is tested to 1e-9, which Float32 cannot
// hold; the GL layer converts to Float32 at the moment it uploads a uniform.

export type Mat4 = Float64Array

export function identity(): Mat4 {
  const m = new Float64Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

// a * b: applying the result applies b first, then a.
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

// The inverse by cofactors, or null when the matrix is singular.
export function invert(m: Mat4): Mat4 | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m
  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (det === 0 || !Number.isFinite(det)) return null
  const k = 1 / det
  const out = new Float64Array(16)
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * k
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * k
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * k
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * k
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * k
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * k
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * k
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * k
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * k
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * k
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * k
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * k
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * k
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * k
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * k
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * k
  return out
}

type V3 = readonly [number, number, number]

// A view matrix from an eye and an orthonormal right/up/back basis (back
// points from the scene toward the eye). The turntable supplies the basis
// itself rather than deriving it from an up hint, so it never degenerates.
export function lookFrom(eye: V3, right: V3, up: V3, back: V3): Mat4 {
  const m = new Float64Array(16)
  m[0] = right[0]
  m[4] = right[1]
  m[8] = right[2]
  m[1] = up[0]
  m[5] = up[1]
  m[9] = up[2]
  m[2] = back[0]
  m[6] = back[1]
  m[10] = back[2]
  m[12] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2])
  m[13] = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2])
  m[14] = -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2])
  m[15] = 1
  return m
}

// glOrtho: eye space (looking down -z) to clip space; near maps to NDC -1.
export function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const m = new Float64Array(16)
  m[0] = 2 / (right - left)
  m[5] = 2 / (top - bottom)
  m[10] = -2 / (far - near)
  m[12] = -(right + left) / (right - left)
  m[13] = -(top + bottom) / (top - bottom)
  m[14] = -(far + near) / (far - near)
  m[15] = 1
  return m
}

// gluPerspective, vertical field of view in radians.
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2)
  const m = new Float64Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

// m * (p, 1), returned homogeneous as [x, y, z, w].
export function transformPoint(m: Mat4, p: V3): [number, number, number, number] {
  const [x, y, z] = p
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ]
}

// m * (x, y, z, w) for a full homogeneous vector.
export function transformVec4(m: Mat4, x: number, y: number, z: number, w: number): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ]
}
