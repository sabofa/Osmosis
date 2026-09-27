// Surface normals (K10, SP2). Analytic first: (-f_x, -f_y, 1) for z = f and
// r_u x r_v for a parametric surface, from compiled symbolic derivatives.
// Where the analytic normal is not finite or is zero (a sphere's pole, the
// centre of a polar domain), the fallback is the area-weighted mean of the
// face normals around that POINT: every vertex at the same position (a pole
// row, a polar centre) pools its incident faces, so the mean is symmetric.
// Only if that too is zero is the normal the zero vector.

// Normalises normals[3v..3v+2] in place; true when it had a direction.
export function normalizeAt(normals: Float64Array, v: number): boolean {
  const x = normals[3 * v]
  const y = normals[3 * v + 1]
  const z = normals[3 * v + 2]
  const len = Math.sqrt(x * x + y * y + z * z)
  if (!(len > 0) || !Number.isFinite(len)) return false
  normals[3 * v] = x / len
  normals[3 * v + 1] = y / len
  normals[3 * v + 2] = z / len
  return true
}

// Fills the normals of the `needy` vertices from the faces in `indices`.
export function fallbackNormals(positions: Float64Array, normals: Float64Array, indices: Uint32Array, needy: readonly number[]): void {
  if (needy.length === 0) return
  const key = (v: number) => `${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`

  // One group per position that holds a needy vertex.
  const groupOfKey = new Map<string, number>()
  for (const v of needy) {
    const k = key(v)
    if (!groupOfKey.has(k)) groupOfKey.set(k, groupOfKey.size)
  }
  const n = positions.length / 3
  const group = new Int32Array(n).fill(-1)
  for (let v = 0; v < n; v++) group[v] = groupOfKey.get(key(v)) ?? -1

  // Sum each face's cross product (twice its area, along its normal) into
  // every distinct group among its corners.
  const sums = new Float64Array(3 * groupOfKey.size)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]
    const b = indices[t + 1]
    const c = indices[t + 2]
    const ga = group[a]
    const gb = group[b]
    const gc = group[c]
    if (ga < 0 && gb < 0 && gc < 0) continue
    const e1x = positions[3 * b] - positions[3 * a]
    const e1y = positions[3 * b + 1] - positions[3 * a + 1]
    const e1z = positions[3 * b + 2] - positions[3 * a + 2]
    const e2x = positions[3 * c] - positions[3 * a]
    const e2y = positions[3 * c + 1] - positions[3 * a + 1]
    const e2z = positions[3 * c + 2] - positions[3 * a + 2]
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    // each distinct group once
    if (ga >= 0) {
      sums[3 * ga] += cx
      sums[3 * ga + 1] += cy
      sums[3 * ga + 2] += cz
    }
    if (gb >= 0 && gb !== ga) {
      sums[3 * gb] += cx
      sums[3 * gb + 1] += cy
      sums[3 * gb + 2] += cz
    }
    if (gc >= 0 && gc !== ga && gc !== gb) {
      sums[3 * gc] += cx
      sums[3 * gc + 1] += cy
      sums[3 * gc + 2] += cz
    }
  }

  for (const v of needy) {
    const g = groupOfKey.get(key(v))!
    normals[3 * v] = sums[3 * g]
    normals[3 * v + 1] = sums[3 * g + 1]
    normals[3 * v + 2] = sums[3 * g + 2]
    if (!normalizeAt(normals, v)) {
      normals[3 * v] = 0
      normals[3 * v + 1] = 0
      normals[3 * v + 2] = 0
    }
  }
}
