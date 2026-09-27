import { describe, expect, it } from 'vitest'
import { classify } from './critical'
import { expectClose, kernelOf, labelOf, pointsOf, sceneOf, vertices } from './testing'

describe('classify: the second-derivative test by the Hessian’s eigenvalues', () => {
  it.each([
    ['both positive', [[2, 0], [0, 3]], 'min'],
    ['both negative', [[-2, 0], [0, -3]], 'max'],
    ['opposite signs', [[-6, 0], [0, 2]], 'saddle'],
    // eigenvalues 2 ± 3 = -1 and 5: the diagonal alone would say min
    ['opposite signs off the diagonal', [[2, 3], [3, 2]], 'saddle'],
    ['a zero Hessian', [[0, 0], [0, 0]], 'degenerate'],
    // tolerance 1e-9 x max(1, 5): 1e-12 is zero to it
    ['an eigenvalue within tolerance of zero', [[1e-12, 0], [0, 5]], 'degenerate'],
  ] as const)('%s', (_, hessian, kind) => {
    expect(classify(hessian)).toBe(kind)
  })
})

describe('critical: x^3 - 3x + y^2 on [-3, 3]^2', () => {
  // ∇f = (3x^2 - 3, 2y) = 0 at (±1, 0); the Hessian is diag(6x, 2):
  // (-1, 0) is a saddle with f = 2, (1, 0) a min with f = -2.
  const scene = sceneOf('critical: x^3 - 3x + y^2 over x in [-3, 3], y in [-3, 3]')

  it('finds exactly the saddle (-1, 0, 2) and the min (1, 0, -2), in lexicographic order', () => {
    expect(scene.errors).toEqual([])
    expect(scene.labels.map((l) => [l.source.object, l.text])).toEqual([
      ['s1.p0', 'saddle ≈ (−1, 0), f ≈ 2'],
      ['s1.p1', 'min ≈ (1, 0), f ≈ −2'],
    ])
    expectClose([...labelOf(scene, 's1.p0').position], [-1, 0, 2], 1e-12)
    expectClose([...labelOf(scene, 's1.p1').position], [1, 0, -2], 1e-12)
  })

  it('draws each kind in its own shape: the saddle a cross, the min a dot', () => {
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.min', 's1.saddle'])
    const saddle = pointsOf(scene, 's1.saddle')
    expect(saddle.style.shape).toBe('cross')
    expectClose(Array.from(saddle.positions), [-1, 0, 2], 1e-12)
    const min = pointsOf(scene, 's1.min')
    expect(min.style.shape).toBe('dot')
    expectClose(Array.from(min.positions), [1, 0, -2], 1e-12)
  })
})

describe('critical: one point each', () => {
  it('x^2 + y^2 has one min, at the origin', () => {
    const scene = sceneOf('critical: x^2 + y^2')
    expect(vertices(pointsOf(scene, 's1.min').positions)).toHaveLength(1)
    expectClose(Array.from(pointsOf(scene, 's1.min').positions), [0, 0, 0], 1e-12)
    expect(scene.labels.map((l) => l.text)).toEqual(['min ≈ (0, 0), f ≈ 0'])
  })

  it('4 - x^2 - y^2 has one max, a diamond at (0, 0, 4)', () => {
    const scene = sceneOf('critical: 4 - x^2 - y^2')
    expect(pointsOf(scene, 's1.max').style.shape).toBe('diamond')
    expectClose(Array.from(pointsOf(scene, 's1.max').positions), [0, 0, 4], 1e-12)
    expect(scene.labels.map((l) => l.text)).toEqual(['max ≈ (0, 0), f ≈ 4'])
  })

  it('x^4 + y^4 has a zero Hessian at the origin: degenerate, a ring labelled ?', () => {
    const scene = sceneOf('critical: x^4 + y^4')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.degenerate'])
    expect(pointsOf(scene, 's1.degenerate').style.shape).toBe('ring')
    expect(scene.labels.map((l) => l.text)).toEqual(['? ≈ (0, 0), f ≈ 0: the second-derivative test is inconclusive'])
  })

  it('(x - 0.3)^4 + (y + 0.2)^4, where the root is not a double: still one ?', () => {
    // Newton lands within rounding of (0.3, -0.2) (at 0.30000000000000004,
    // -0.19999999999999982), where the Hessian 12 diag((x - 0.3)^2,
    // (y + 0.2)^2) is about 1e-31 rather than 0: only the eigenvalue
    // tolerance calls it degenerate. (x^4 + y^4 lands on 0 exactly, where the
    // Hessian is 0 and no tolerance matters.)
    const scene = sceneOf('critical: (x - 0.3)^4 + (y + 0.2)^4')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.degenerate'])
    expect(vertices(pointsOf(scene, 's1.degenerate').positions)).toHaveLength(1)
    expect(scene.labels.map((l) => l.text)).toEqual(['? ≈ (0.3, −0.2), f ≈ 0: the second-derivative test is inconclusive'])
  })

  it('xy has a saddle at the origin', () => {
    const scene = sceneOf('critical: x*y')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.saddle'])
    expectClose(Array.from(pointsOf(scene, 's1.saddle').positions), [0, 0, 0], 1e-12)
  })
})

describe('critical: degenerate points off the axes (the Hessian singular along a slanted direction)', () => {
  it('(x - y)^2 + x^4 has exactly one ?, at the origin — not five mins', () => {
    const scene = sceneOf('critical: (x - y)^2 + x^4')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.degenerate'])
    expect(vertices(pointsOf(scene, 's1.degenerate').positions)).toHaveLength(1)
    expect(scene.labels.map((l) => l.text)).toEqual(['? ≈ (0, 0), f ≈ 0: the second-derivative test is inconclusive'])
  })

  it('(x - y)^4 + (x + y)^2 has exactly one ?, not ten mins', () => {
    const scene = sceneOf('critical: (x - y)^4 + (x + y)^2')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.degenerate'])
    expect(vertices(pointsOf(scene, 's1.degenerate').positions)).toHaveLength(1)
  })

  it('(x + y - 0.3)^3 + (x - y + 0.1)^2 is ? at (0.1, 0.2), not a saddle', () => {
    // u = x + y - 0.3, v = x - y + 0.1: f = u^3 + v^2 is critical at u = v = 0,
    // where its Hessian diag(6u, 2) is singular.
    const scene = sceneOf('critical: (x + y - 0.3)^3 + (x - y + 0.1)^2')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1.degenerate'])
    expect(scene.labels.map((l) => l.text)).toEqual(['? ≈ (0.1, 0.2), f ≈ 0: the second-derivative test is inconclusive'])
  })
})

describe('critical: a point on the domain’s edge', () => {
  it('x^3 - x + y^2 over x in [1/sqrt(3), 1] finds the min at the edge x = 1/sqrt(3), f = -2/(3 sqrt 3)', () => {
    // Newton lands on 0.5773502691896257, one ulp below the edge
    // 1/sqrt(3) = 0.5773502691896258: an exact comparison dropped it.
    const scene = sceneOf('critical: x^3 - x + y^2 over x in [1/sqrt(3), 1], y in [-1, 1]')
    expect(scene.labels.map((l) => l.text)).toEqual(['min ≈ (0.5774, 0), f ≈ −0.3849'])
    expect(pointsOf(scene, 's1.min').positions[0]).toBe(1 / Math.sqrt(3))
  })
})

describe('critical: none found, and parameters', () => {
  it('x + y has none: a note, not an error', () => {
    const scene = sceneOf('critical: x + y')
    expect(scene.errors).toEqual([])
    expect(scene.marks).toEqual([])
    // x + y on [-5, 5]^2 ranges over [-10, 10]: the note sits at the centre of the floor.
    expect(labelOf(scene, 's1.note')).toMatchObject({ text: 'no critical points found in the domain', position: [0, 0, -10] })
  })

  it('follows a parameter: x^2 + a y^2 is a min at a = 1 and a saddle at a = -1', () => {
    const kernel = kernelOf(`@param a = 1 range [-2, 2]
critical: x^2 + a*y^2`)
    expect(kernel.scene().marks.map((m) => m.source.object)).toEqual(['s2.min'])
    expect(kernel.setValue('a', -1).marks.map((m) => m.source.object)).toEqual(['s2.saddle'])
  })
})
