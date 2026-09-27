// The data extent of a scene (the contract's SpaceScene.extent) and the robust
// z rule (SP5): when the 1st-99th percentile span of the z values is under a
// fifth of their full span, that percentile span is used instead, so a pole
// does not stretch the box. The same rule gives a height colour scale its
// domain.

import type { Box3, Mark, Range } from './types'

// Linear interpolation between order statistics, at q in [0, 1].
function percentile(sorted: Float64Array, q: number): number {
  const at = q * (sorted.length - 1)
  const lo = Math.floor(at)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

// The robust range of the finite values, or null when there are none.
export function robustRange(values: Float64Array | readonly number[]): Range | null {
  let count = 0
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) count++
  if (count === 0) return null
  const sorted = new Float64Array(count)
  let k = 0
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) sorted[k++] = values[i]
  sorted.sort()
  const min = sorted[0]
  const max = sorted[count - 1]
  const p1 = percentile(sorted, 0.01)
  const p99 = percentile(sorted, 0.99)
  if (p99 - p1 < 0.2 * (max - min)) return { min: p1, max: p99 }
  return { min, max }
}

class Accumulator {
  xMin = Infinity
  xMax = -Infinity
  yMin = Infinity
  yMax = -Infinity
  zs: number[] = []

  add(x: number, y: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    if (x < this.xMin) this.xMin = x
    if (x > this.xMax) this.xMax = x
    if (y < this.yMin) this.yMin = y
    if (y > this.yMax) this.yMax = y
    this.zs.push(z)
  }

  addAll(p: Float64Array) {
    for (let i = 0; i + 2 < p.length; i += 3) this.add(p[i], p[i + 1], p[i + 2])
  }
}

// x and y span every finite vertex; z is robust over all z values. Null when
// the scene has no finite vertex.
export function sceneExtent(marks: readonly Mark[]): Box3 | null {
  const acc = new Accumulator()
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
  const z = robustRange(acc.zs)
  if (!z) return null
  return { x: { min: acc.xMin, max: acc.xMax }, y: { min: acc.yMin, max: acc.yMax }, z }
}
