import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import { resolveBox } from '../../frame/bounds'
import { choose, evenly, judge } from './lagrange'
import { arrowsOf, expectClose, expectParallel, kernelOf, labelOf, lineOf, meshOf, pointsOf, sceneOf, vertices } from './testing'

// max x + y on x^2 + y^2 = 1: ∇f = (1, 1) = λ(2x, 2y), so x = y = 1/(2λ) and
// 2/(4λ^2) = 1: λ = √2/2 at (√2/2, √2/2), where f = √2. The min is the
// opposite point, with λ = -√2/2.
const H = Math.SQRT1_2
const R2 = Math.SQRT2

describe('lagrange: max x + y subject to x^2 + y^2 = 1', () => {
  // Beside z = x + y, which sizes the box (the box pass, J1).
  const scene = sceneOf('lagrange: max x + y subject to x^2 + y^2 = 1\nz = x + y')

  it('finds (√2/2, √2/2), f = √2, λ = √2/2 — once', () => {
    expect(scene.errors).toEqual([])
    const lifted = vertices(pointsOf(scene, 's1.points').positions)
    expect(lifted).toHaveLength(1)
    expectClose([...lifted[0]], [H, H, R2], 1e-12)
    expect(labelOf(scene, 's1.p0').text).toBe('max ≈ (0.7071, 0.7071), f ≈ 1.414, λ ≈ 0.7071')
  })

  it('draws the constraint on the floor, and lifted onto z = f', () => {
    // x + y on [-5, 5]^2 ranges over [-10, 10]: the floor is -10.
    for (const [x, y, z] of vertices(lineOf(scene, 's1.constraint').positions)) {
      expect(z).toBe(-10)
      expect(Math.abs(x * x + y * y - 1)).toBeLessThanOrEqual(1e-8)
    }
    for (const [x, y, z] of vertices(lineOf(scene, 's1').positions)) expect(Math.abs(z - (x + y))).toBeLessThanOrEqual(1e-15)
  })

  it("draws f's level curve through the point, x + y = √2, on the floor", () => {
    for (const [x, y, z] of vertices(lineOf(scene, 's1.level0').positions)) {
      expect(z).toBe(-10)
      expect(Math.abs(x + y - R2)).toBeLessThanOrEqual(1e-8)
    }
  })

  it("marks the point on the floor with ∇f (0.15 x the floor's span 10 = 1.5 long) and ∇g (0.6 x 1.5 = 0.9), parallel", () => {
    expectClose(Array.from(pointsOf(scene, 's1.floorPoints').positions), [H, H, -10], 1e-12)
    for (const [object, length] of [
      ['s1.gradf0', 1.5],
      ['s1.gradg0', 0.9],
    ] as const) {
      const arrow = arrowsOf(scene, object)
      expectClose(Array.from(arrow.tails), [H, H, -10], 1e-12)
      const v = Array.from(arrow.vectors)
      expectParallel(v, [1, 1, 0], 1e-12)
      expect(v[0]).toBeGreaterThan(0)
      expect(Math.abs(Math.hypot(...v) - length)).toBeLessThanOrEqual(1e-12)
    }
    expect([labelOf(scene, 's1.gradf0.label').text, labelOf(scene, 's1.gradg0.label').text]).toEqual(['∇f', '∇g'])
  })
})

describe('the lifted constraint (I3)', () => {
  it('is sampled, carrying its arc length, and cut to the box: under @bounds3d z [-1, 1], x + y on the circle of radius 2 stays in [-1, 1]', () => {
    const scene = sceneOf(`@bounds3d: z [-1, 1]
lagrange: max x + y subject to x^2 + y^2 = 4`)
    const lifted = lineOf(scene, 's2')
    for (const [x, y, z] of vertices(lifted.positions)) {
      expect(Math.abs(z)).toBeLessThanOrEqual(1 + 1e-12)
      expect(Math.abs(z - (x + y))).toBeLessThanOrEqual(1e-12)
    }
    const params = Array.from(lifted.params!)
    for (let k = 0; k < lifted.starts.length; k++) {
      const end = k + 1 < lifted.starts.length ? lifted.starts[k + 1] : params.length
      for (let i = lifted.starts[k] + 1; i < end; i++) expect(params[i]).toBeGreaterThan(params[i - 1])
    }
    // The circle leaves z in [-1, 1] and comes back: more than one piece.
    expect(lifted.starts.length).toBeGreaterThan(1)
  })
})

describe('lagrange: min and extrema', () => {
  it('min finds (-√2/2, -√2/2), f = -√2, λ = -√2/2', () => {
    const scene = sceneOf('lagrange: min x + y subject to x^2 + y^2 = 1')
    expectClose(Array.from(pointsOf(scene, 's1.points').positions), [-H, -H, -R2], 1e-12)
    expect(scene.labels.filter((l) => l.kind === 'annotation').map((l) => l.text)).toEqual(['min ≈ (−0.7071, −0.7071), f ≈ −1.414, λ ≈ −0.7071'])
  })

  it('extrema finds both, in lexicographic order', () => {
    const scene = sceneOf('lagrange: extrema x + y subject to x^2 + y^2 = 1')
    expectClose(Array.from(pointsOf(scene, 's1.points').positions), [-H, -H, -R2, H, H, R2], 1e-12)
    expect(scene.labels.filter((l) => l.kind === 'annotation').map((l) => l.text)).toEqual([
      'min ≈ (−0.7071, −0.7071), f ≈ −1.414, λ ≈ −0.7071',
      'max ≈ (0.7071, 0.7071), f ≈ 1.414, λ ≈ 0.7071',
    ])
  })
})

// Integration J3: the constraint surface is S4a's marching-tetrahedra mesh of
// g = c, drawn, and its vertices seed Newton (up to 64, evenly spaced).
describe('lagrange in three variables draws S4a’s constraint surface', () => {
  it('the sphere x^2 + y^2 + z^2 = 9: every vertex at |p| = 3 within 1e-8, at opacity 0.35, and the max is still (1, 2, 2)', () => {
    const scene = sceneOf('lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9 res: 16')
    expect(scene.errors).toEqual([])
    const mesh = meshOf(scene, 's1.constraint')
    expect(mesh.style.opacity).toBe(0.35)
    for (const p of vertices(mesh.positions)) expect(Math.abs(Math.hypot(...p) - 3)).toBeLessThanOrEqual(1e-8)
    expectClose(Array.from(pointsOf(scene, 's1').positions), [1, 2, 2], 1e-12)
  })

  it('honours res: the mesh is S4a’s level surface g = 9 at 12 and at 20 cubes per axis, vertex for vertex', () => {
    const counts: number[] = []
    for (const res of [12, 20]) {
      const constraint = meshOf(sceneOf(`lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9 res: ${res}`), 's1.constraint')
      const level = meshOf(sceneOf(`contour: x^2 + y^2 + z^2 level 9 res: ${res}`), 's1.level1')
      expect(Array.from(constraint.positions)).toEqual(Array.from(level.positions))
      expect(Array.from(constraint.indices)).toEqual(Array.from(level.indices))
      counts.push(constraint.positions.length)
    }
    expect(counts[1]).toBeGreaterThan(counts[0])
  })

  it('refuses a res: over S4a’s limit for an implicit surface', () => {
    expect(sceneOf('lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9 res: 300').errors).toEqual([
      { line: 1, message: 'res 300 is over the 160 cubes per axis an implicit surface is sampled at — lower the resolution' },
    ])
  })
})

describe('lagrange in three variables', () => {
  // ∇f = (1, 2, 2) = λ(2x, 2y, 2z): x = 1/(2λ), y = z = 1/λ, and
  // (1/4 + 2)/λ^2 = 9 gives λ = 1/2 at (1, 2, 2), f = 1 + 4 + 4 = 9.
  const scene = sceneOf('lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 9')

  it('finds (1, 2, 2), f = 9, λ = 1/2', () => {
    expect(scene.errors).toEqual([])
    expectClose(Array.from(pointsOf(scene, 's1').positions), [1, 2, 2], 1e-12)
    expect(labelOf(scene, 's1.p0').text).toBe('max ≈ (1, 2, 2), f ≈ 9, λ ≈ 0.5')
  })

  it('marks it with ∇f (0.15 x 10 = 1.5 long) and ∇g (0.9), both along (1, 2, 2)', () => {
    for (const [object, length] of [
      ['s1.gradf0', 1.5],
      ['s1.gradg0', 0.9],
    ] as const) {
      const v = Array.from(arrowsOf(scene, object).vectors)
      expectParallel(v, [1, 2, 2], 1e-12)
      expect(v[0]).toBeGreaterThan(0)
      expect(Math.abs(Math.hypot(...v) - length)).toBeLessThanOrEqual(1e-12)
    }
  })
})

describe('lagrange over a domain', () => {
  it('keeps only the solutions inside it: with x <= 0.2, Newton from the arc’s end reaches (√2/2, √2/2), which is dropped', () => {
    const scene = sceneOf('lagrange: extrema x + y subject to x^2 + y^2 = 1 over x in [-1, 0.2], y in [-1, 1]')
    expectClose(Array.from(pointsOf(scene, 's1.points').positions), [-H, -H, -R2], 1e-12)
    // The one solution left is the least f takes on the arc, and no more:
    // the arc's end at x = 0.2 is higher.
    expect(labelOf(scene, 's1.p0').text).toBe('min ≈ (−0.7071, −0.7071), f ≈ −1.414, λ ≈ −0.7071')
  })
})

describe('lagrange when the constraint runs out of the domain (I4)', () => {
  it('max x^2 + y^2 subject to x + y = 1: the one solution is the constrained MIN, not a max', () => {
    // ∇f = (2x, 2y) = λ(1, 1): (1/2, 1/2), f = 1/2, λ = 1; along the line f
    // grows to 41 at (-4, 5).
    const scene = sceneOf('lagrange: max x^2 + y^2 subject to x + y = 1')
    expect(labelOf(scene, 's1.p0').text).toBe("local min ≈ (0.5, 0.5), f ≈ 0.5, λ ≈ 1 — f is larger toward the domain's edge")
  })

  it('max x + y subject to xy = 1: (1, 1) is a local min on its branch, and f is larger toward the edge', () => {
    // ∇f = (1, 1) = λ(y, x): (1, 1) with f = 2 and (-1, -1) with f = -2; the
    // branch through (1, 1) reaches f = 5.2 at (0.2, 5).
    const scene = sceneOf('lagrange: max x + y subject to x*y = 1')
    expect(labelOf(scene, 's1.p0').text).toBe("local min ≈ (1, 1), f ≈ 2, λ ≈ 1 — f is larger toward the domain's edge")
  })

  it('in three variables, max xyz subject to x + y + z = 3: (1, 1, 1) is a local max; (-1, -1, 5) in the box has f = 5', () => {
    const scene = sceneOf('lagrange: max x*y*z subject to x + y + z = 3')
    expect(labelOf(scene, 's1.p0').text).toBe("local max ≈ (1, 1, 1), f ≈ 1, λ ≈ 1 — f is larger toward the domain's edge")
  })
})

describe('the floor arrows are sized by the floor (I6)', () => {
  it('min x^2 + y^2 subject to x + y = 1 over [-5, 5]^2: ∇f 1.5 and ∇g 0.9 long, and the frame stays the data’s', () => {
    // Sized by the box's largest span (z runs to 50) they were 7.5 long, and
    // the frame grew to [-5, 6]. Beside z = x^2 + y^2 (the box pass, J1).
    const spec = 'lagrange: min x^2 + y^2 subject to x + y = 1\nz = x^2 + y^2'
    const scene = sceneOf(spec)
    for (const [object, length] of [
      ['s1.gradf0', 1.5],
      ['s1.gradg0', 0.9],
    ] as const) {
      expect(Math.abs(Math.hypot(...Array.from(arrowsOf(scene, object).vectors)) - length)).toBeLessThanOrEqual(1e-12)
    }
    // Since the box pass (J1) nothing a tool draws sizes the frame: it is the
    // surface's, [-5, 5]^2.
    const frame = resolveBox(parseSpec(spec).config.space, scene.extent)
    expect([frame.x, frame.y]).toEqual([
      { min: -5, max: 5 },
      { min: -5, max: 5 },
    ])
  })
})

describe('lagrange: a solution on the domain’s edge (M1)', () => {
  it('with the edge 1e-12 short of the max (√2/2, √2/2), the max is kept, clamped onto the edge', () => {
    // A solution on the edge lands a rounding error either side of it; here
    // it is 1e-12 outside, within the merge distance 1e-7 x the diagonal. An
    // exact comparison dropped it and left the min, judged "local min".
    const scene = sceneOf('lagrange: max x + y subject to x^2 + y^2 = 1 over x in [-1, sqrt(2)/2 - 0.000000000001], y in [-1, 1]')
    expect(scene.errors).toEqual([])
    expect(labelOf(scene, 's1.p0').text).toBe('max ≈ (0.7071, 0.7071), f ≈ 1.414, λ ≈ 0.7071')
    expect(pointsOf(scene, 's1.points').positions[0]).toBe(Math.sqrt(2) / 2 - 1e-12)
  })
})

describe('lagrange: refusals', () => {
  it('an infeasible constraint is an error on its line', () => {
    expect(sceneOf('lagrange: max x + y subject to x^2 + y^2 = -1').errors).toEqual([
      { line: 1, message: 'lagrange: no constrained extremum found; try a tighter @bounds3d' },
    ])
  })
})

// Fix round 1 (Important 1): judge and choose took max and min by spreading
// every sample into Math.max, and Node's argument limit (~120k) threw
// "Maximum call stack size exceeded" on a fine constraint mesh.
describe('lagrange on a fine constraint mesh (fix round 1)', () => {
  // ∇f = (1, 2, 2) = λ(2x, 2y, 2z): x = 1/(2λ), y = z = 1/λ, and
  // (1/4 + 2)/λ^2 = 20 gives λ = 3/√80 at (2√5/3, 4√5/3, 4√5/3), f = 6√5.
  const R5 = Math.sqrt(5)

  it('res: 160 on x^2 + y^2 + z^2 = 20 draws and finds (2√5/3, 4√5/3, 4√5/3), f = 6√5, λ = 3/√80', { timeout: 60000 }, () => {
    const scene = sceneOf('lagrange: max x + 2y + 2z subject to x^2 + y^2 + z^2 = 20 res: 160')
    expect(scene.errors).toEqual([])
    // Past the argument limit that broke the spread.
    expect(meshOf(scene, 's1.constraint').positions.length / 3).toBeGreaterThan(150000)
    expectClose(Array.from(pointsOf(scene, 's1').positions), [(2 * R5) / 3, (4 * R5) / 3, (4 * R5) / 3], 1e-12)
    expect(labelOf(scene, 's1.p0').text).toBe('max ≈ (1.491, 2.981, 2.981), f ≈ 13.42, λ ≈ 0.3354')
  })

  it('judge takes the max, the min and the tie scale from 300,000 samples', () => {
    const samples = Array.from({ length: 300000 }, (_, i) => ({ at: [i], f: i === 1000 ? -7 : i % 100 }))
    const s = (f: number) => ({ at: [0], lambda: 0, f })
    expect(judge([{ s: s(99), kind: 'max' }], samples, 0).map((k) => k.kind)).toEqual(['max'])
    expect(judge([{ s: s(-7), kind: 'min' }], samples, 0).map((k) => k.kind)).toEqual(['min'])
    expect(judge([{ s: s(98), kind: 'max' }], samples, 0)[0].note).toBe(" — f is larger toward the domain's edge")
  })

  it('choose keeps the max of 300,000 solutions', () => {
    const solutions = Array.from({ length: 300000 }, (_, i) => ({ at: [i], lambda: 0, f: i === 5 ? 2 : 1 }))
    expect(choose(solutions, 'max').map((k) => k.s.at[0])).toEqual([5])
  })
})

describe('lagrange with a parameter (M3)', () => {
  it('rebuilds when the level reads one: k = 2 moves the max to (√2, √2), f = 2√2', () => {
    const kernel = kernelOf(`@param k = 1 range [0.5, 3]
lagrange: max x + y subject to x^2 + y^2 = k^2`)
    expectClose(Array.from(pointsOf(kernel.scene(), 's2.points').positions), [H, H, R2], 1e-12)
    const scene = kernel.setValue('k', 2)
    expectClose(Array.from(pointsOf(scene, 's2.points').positions), [R2, R2, 2 * R2], 1e-12)
  })
})

describe('lagrange helpers', () => {
  it('evenly takes up to n items spread through the list', () => {
    expect(evenly([0, 1, 2, 3, 4, 5, 6, 7], 4)).toEqual([0, 2, 4, 6])
    expect(evenly([0, 1], 4)).toEqual([0, 1])
  })

  it('choose keeps a tie within 1e-9 of the best, and nothing else', () => {
    const s = (f: number) => ({ at: [f], lambda: 0, f })
    expect(choose([s(1), s(1 + 1e-12), s(0.5)], 'max').map((k) => k.s.f)).toEqual([1, 1 + 1e-12])
    expect(choose([s(1), s(0.5), s(0.5)], 'min').map((k) => k.s.f)).toEqual([0.5, 0.5])
    expect(choose([s(1), s(0.7), s(0.5)], 'extrema').map((k) => k.kind)).toEqual(['max', 'min'])
    expect(choose([s(0.7)], 'extrema').map((k) => k.kind)).toEqual(['extremum'])
    expect(choose([s(0.7)], 'max').map((k) => k.kind)).toEqual(['max'])
  })

  it('judge: a max stands when no sample exceeds it; otherwise its neighbours name it', () => {
    const s = (x: number, f: number) => ({ at: [x], lambda: 0, f })
    const samples = [0, 1, 2, 3, 4].map((x) => ({ at: [x], f: [0, 1, 0, 1, 3][x] }))
    expect(judge([{ s: s(4, 3), kind: 'max' }], samples, 1.5)).toEqual([{ s: s(4, 3), kind: 'max', note: '' }])
    expect(judge([{ s: s(1, 1), kind: 'max' }], samples, 1.5)).toEqual([{ s: s(1, 1), kind: 'local max', note: " — f is larger toward the domain's edge" }])
    expect(judge([{ s: s(2, 0), kind: 'max' }], samples, 1.5)).toEqual([{ s: s(2, 0), kind: 'local min', note: " — f is larger toward the domain's edge" }])
    expect(judge([{ s: s(3, 1), kind: 'min' }], samples, 1.5)).toEqual([
      { s: s(3, 1), kind: 'critical point on the constraint', note: " — f is smaller toward the domain's edge" },
    ])
  })
})
