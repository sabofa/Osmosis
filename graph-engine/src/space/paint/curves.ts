// Editable curves for the Paint Lab (Ben, 2026-10-02: "color curves, lighting
// curves, value curve…"). A curve is a list of control points over x in 0..1,
// interpolated by a monotone cubic (Fritsch–Carlson), so it never overshoots
// between points and a curve that rises stays rising. The defaults are the
// identity (or a flat line) so the formulas in the spec stay the look until
// Ben moves a point.

export type CurvePoints = [number, number][]

// Value of the curve at x (clamped to the first/last point outside their x).
// Points must be sorted by x with distinct x; fewer than two points give the
// single y (or 0).
export function evalCurve(points: CurvePoints, x: number): number {
  const n = points.length
  if (n === 0) return 0
  if (n === 1 || x <= points[0][0]) return points[0][1]
  if (x >= points[n - 1][0]) return points[n - 1][1]
  // Secant slopes and Fritsch–Carlson tangents.
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0]))
  const m: number[] = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  let k = 0
  while (x > points[k + 1][0]) k++
  const [x0, y0] = points[k]
  const [x1, y1] = points[k + 1]
  const h = x1 - x0
  const t = (x - x0) / h
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[k + 1]
}

// One curve editor in the Paint Lab.
export interface CurveSpec {
  path: string // dotted path into PaintParams.curves
  label: string
  group: string
  // What x means and the y range the editor allows.
  xLabel: string
  yMin: number
  yMax: number
  yLabel: string
}
