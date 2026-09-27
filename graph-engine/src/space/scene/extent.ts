// The data extent of a scene (the contract's SpaceScene.extent) and the robust
// z rule (SP5): when the 1st-99th percentile span of the z values is under a
// fifth of their full span, that percentile span is used instead, so a pole
// does not stretch the box. The same rule gives a height colour scale its
// domain.

import type { Box3, Mark, Range } from './types'

// Moves the k-th smallest of a[lo..hi] to a[k], with everything before it no
// larger and everything after it no smaller (quickselect, median-of-three
// pivots). An order statistic does not depend on how it is found, so the
// result is the same as sorting's; this is O(n) where a sort is O(n log n).
function select(a: Float64Array, k: number): number {
  let lo = 0
  let hi = a.length - 1
  while (hi > lo) {
    const mid = (lo + hi) >>> 1
    const x = a[lo]
    const y = a[mid]
    const z = a[hi]
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i++
      while (a[j] > pivot) j--
      if (i <= j) {
        const t = a[i]
        a[i] = a[j]
        a[j] = t
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]
}

// Linear interpolation between order statistics at q in [0, 1], as on a sorted
// copy: a[lo] + (a[lo + 1] - a[lo]) * frac.
function percentile(a: Float64Array, q: number): number {
  const at = q * (a.length - 1)
  const lo = Math.floor(at)
  const low = select(a, lo)
  if (lo + 1 >= a.length || at === lo) return low
  // After select, a[lo + 1..] holds the larger values; their minimum is the
  // next order statistic.
  let next = Infinity
  for (let i = lo + 1; i < a.length; i++) if (a[i] < next) next = a[i]
  return low + (next - low) * (at - lo)
}

// The robust range of the finite values, or null when there are none.
export function robustRange(values: Float64Array | readonly number[]): Range | null {
  let count = 0
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) count++
  if (count === 0) return null
  const work = new Float64Array(count)
  let k = 0
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    work[k++] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  const p1 = percentile(work, 0.01)
  const p99 = percentile(work, 0.99)
  if (p99 - p1 < 0.2 * (max - min)) return { min: p1, max: p99 }
  return { min, max }
}

class Accumulator {
  xMin = Infinity
  xMax = -Infinity
  yMin = Infinity
  yMax = -Infinity
  zs: Float64Array
  count = 0

  constructor(capacity: number) {
    this.zs = new Float64Array(capacity)
  }

  add(x: number, y: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    if (x < this.xMin) this.xMin = x
    if (x > this.xMax) this.xMax = x
    if (y < this.yMin) this.yMin = y
    if (y > this.yMax) this.yMax = y
    this.zs[this.count++] = z
  }

  addAll(p: Float64Array) {
    for (let i = 0; i + 2 < p.length; i += 3) this.add(p[i], p[i + 1], p[i + 2])
  }
}

function vertexCount(mark: Mark): number {
  switch (mark.kind) {
    case 'mesh':
    case 'lines':
    case 'points':
      return mark.positions.length / 3
    case 'arrows':
      return (2 * mark.tails.length) / 3
    case 'boxes':
      return (mark.mins.length + mark.maxs.length) / 3
  }
}

// x and y span every finite vertex; z is robust over all z values. Null when
// the scene has no finite vertex.
export function sceneExtent(marks: readonly Mark[]): Box3 | null {
  let capacity = 0
  for (const mark of marks) capacity += vertexCount(mark)
  const acc = new Accumulator(capacity)
  for (const mark of marks) {
    switch (mark.kind) {
      case 'mesh':
      case 'lines':
      case 'points':
        acc.addAll(mark.positions)
        break
      case 'arrows':
        for (let i = 0; i + 2 < mark.tails.length; i += 3) {
          const [x, y, z] = [mark.tails[i], mark.tails[i + 1], mark.tails[i + 2]]
          acc.add(x, y, z)
          acc.add(x + mark.vectors[i], y + mark.vectors[i + 1], z + mark.vectors[i + 2])
        }
        break
      case 'boxes':
        acc.addAll(mark.mins)
        acc.addAll(mark.maxs)
        break
    }
  }
  const z = robustRange(acc.zs.subarray(0, acc.count))
  if (!z) return null
  return { x: { min: acc.xMin, max: acc.xMax }, y: { min: acc.yMin, max: acc.yMax }, z }
}
