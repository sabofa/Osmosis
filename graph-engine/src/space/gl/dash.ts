// Dash lengths (plan G9 "Lines"). Pure.
//
// A dashed line needs, at every vertex, the screen-space length of its
// polyline up to that vertex, so the dash pattern runs continuously across
// segments. It is recomputed on the CPU when the camera, the size or the
// scene changes, and only for marks with a dash; a mark over 50,000 vertices
// uses a per-segment phase instead. S3's hidden-part pass reuses it.

// Above this many vertices a dashed mark restarts its pattern per segment.
export const CUMULATIVE_DASH_LIMIT = 50_000

export type ScreenProjector = (x: number, y: number, z: number) => { x: number; y: number }

// Per vertex, CSS px along its own polyline from the polyline's first vertex,
// restarting at 0 at every entry of `starts`.
export function cumulativeScreenLength(positions: Float64Array, starts: Uint32Array, project: ScreenProjector): Float32Array {
  const count = Math.floor(positions.length / 3)
  const out = new Float32Array(count)
  let polyline = 0
  let nextStart = starts.length > 1 ? starts[1] : count
  let total = 0
  let prev: { x: number; y: number } | null = null
  for (let i = 0; i < count; i++) {
    // A while, not an if: an empty polyline repeats its start.
    while (i === nextStart) {
      polyline++
      nextStart = polyline + 1 < starts.length ? starts[polyline + 1] : count
      prev = null
    }
    const s = project(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    if (prev === null || i === starts[polyline]) {
      total = 0
    } else {
      const step = Math.hypot(s.x - prev.x, s.y - prev.y)
      if (Number.isFinite(step)) total += step
    }
    out[i] = total
    prev = s
  }
  return out
}

// A dash pattern as the shader takes it: two on/off pairs, CSS px. An odd
// pattern repeats itself once (SVG's rule: [5] is [5, 5]); past four entries
// the pattern is truncated to its first two pairs.
export function dashUniform(dash: readonly number[] | null): { pattern: [number, number, number, number]; total: number } | null {
  if (!dash || dash.length === 0) return null
  const clean = dash.map((d) => (Number.isFinite(d) && d > 0 ? d : 0))
  const even = clean.length % 2 === 1 ? [...clean, ...clean] : clean
  const four = [...even, ...even].slice(0, 4)
  const pattern: [number, number, number, number] = [four[0], four[1], four[2], four[3]]
  const total = pattern[0] + pattern[1] + pattern[2] + pattern[3]
  return total > 0 ? { pattern, total } : null
}
