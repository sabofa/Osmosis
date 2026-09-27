import { describe, expect, it } from 'vitest'
import type { ArrowMark, LineMark, MeshMark, SpaceScene } from '../../scene/types'
import { labelText, markAt, sceneOf, vertices } from '../../testing/kernel'

function clean(spec: string): SpaceScene {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  return scene
}

const arrows = (scene: SpaceScene, object: string) => {
  const mark = markAt(scene, object) as ArrowMark
  expect(mark.kind).toBe('arrows')
  return { tails: vertices(mark.tails), vectors: vertices(mark.vectors), mark }
}

describe('cross:', () => {
  it('<1,0,0> x <0,1,0>: the result arrow is (0, 0, 1) and the area 1', () => {
    const scene = clean('cross: <1,0,0> x <0,1,0>')
    const result = arrows(scene, 's1')
    expect(result.tails).toEqual([[0, 0, 0]])
    expect(result.vectors).toEqual([[0, 0, 1]])
    expect(result.mark.style.color).toEqual({ author: null, slot: 0 })
    expect(labelText(scene)).toContain('area = |u × v| = 1')
  })

  it('<1,2,3> x <4,5,6> = (-3, 6, -3), area sqrt 54 = 7.348', () => {
    // (2*6 - 3*5, 3*4 - 1*6, 1*5 - 2*4) = (-3, 6, -3); |.| = sqrt(9 + 36 + 9) = sqrt 54
    const scene = clean('cross: <1,2,3> x <4,5,6>')
    expect(arrows(scene, 's1').vectors).toEqual([[-3, 6, -3]])
    expect(labelText(scene)).toContain('area = |u × v| = 7.348')
  })

  it('draws u and v from P in grey, and the parallelogram P, P+u, P+u+v, P+v with its outline', () => {
    const scene = clean('cross: <1,2,3> x <4,5,6>')
    const operands = arrows(scene, 's1.operands')
    expect(operands.tails).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ])
    expect(operands.vectors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
    expect(operands.mark.style.color).toEqual({ author: 'gray', slot: 0 })
    const face = markAt(scene, 's1.parallelogram') as MeshMark
    expect(vertices(face.positions)).toEqual([
      [0, 0, 0],
      [1, 2, 3],
      [5, 7, 9],
      [4, 5, 6],
    ])
    expect(face.style.opacity).toBe(0.3)
    // wound counter-clockwise about u x v, whose unit vector is every normal
    const s = Math.sqrt(54)
    expect(vertices(face.normals)[0].map((c) => c * s)).toEqual([-3, 6, -3].map((c) => expect.closeTo(c, 12)))
    const outline = markAt(scene, 's1.outline') as LineMark
    expect(vertices(outline.positions)).toEqual([
      [0, 0, 0],
      [1, 2, 3],
      [5, 7, 9],
      [4, 5, 6],
      [0, 0, 0],
    ])
  })

  it('marks the right angles between u x v and u, and u x v and v, as squares in the planes they span', () => {
    // With no @bounds3d the side is min(0.08 * 10, 0.25 * min(|u|, |v|, |u x v|)) = 0.25.
    const scene = clean('cross: <1,0,0> x <0,1,0>')
    const right = markAt(scene, 's1.right') as LineMark
    expect([...right.starts]).toEqual([0, 3])
    expect(vertices(right.positions)).toEqual([
      [0.25, 0, 0],
      [0.25, 0, 0.25],
      [0, 0, 0.25],
      [0, 0.25, 0],
      [0, 0.25, 0.25],
      [0, 0, 0.25],
    ])
  })

  it('at (1,1,1) moves every tail', () => {
    const scene = clean('cross: <1,0,0> × <0,1,0> at (1,1,1)')
    expect(arrows(scene, 's1').tails).toEqual([[1, 1, 1]])
    expect(arrows(scene, 's1.operands').tails).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ])
  })

  it('takes named operands, and names them in the readout', () => {
    const scene = clean('a = <1, 2, 3>\nb = <4, 5, 6>\ncross: a x b')
    expect(arrows(scene, 's3').vectors).toEqual([[-3, 6, -3]])
    expect(labelText(scene)).toEqual(expect.arrayContaining(['a', 'b', 'a × b', 'area = |a × b| = 7.348']))
  })

  it('refuses parallel operands', () => {
    expect(sceneOf('u = <1, 2, 3>\nv = <2, 4, 6>\ncross: u x v').errors).toEqual([{ line: 3, message: 'u and v are parallel; u × v = 0' }])
  })
})

describe('project:', () => {
  it('<3,4,0> onto <1,0,0>: projection (3, 0, 0), perpendicular part (3,0,0) to (3,4,0), component 3, angle 53.13°', () => {
    const scene = clean('@angle: degrees\nproject: <3,4,0> onto <1,0,0>')
    const proj = arrows(scene, 's2')
    expect(proj.tails).toEqual([[0, 0, 0]])
    expect(proj.vectors).toEqual([[3, 0, 0]])
    expect(proj.mark.style.shaftWidth).toBe(3)
    const perp = markAt(scene, 's2.perpendicular') as LineMark
    expect(vertices(perp.positions)).toEqual([
      [3, 0, 0],
      [3, 4, 0],
    ])
    expect(perp.style.dash).not.toBeNull()
    // cos theta = 3/5, theta = 53.130...°
    // one readout, so the two numbers never print over each other
    expect(labelText(scene)).toContain('comp_v u = 3 · θ = 53.13°')
    const anchors = scene.labels.map((l) => l.position.join(','))
    expect(new Set(anchors).size).toBe(anchors.length)
    // The right angle sits at the projection's tip, between -v and the
    // perpendicular part; its side is min(0.08 * 10, 0.25 * min(|proj|, |perp|))
    // = min(0.8, 0.75) = 0.75.
    const right = markAt(scene, 's2.right') as LineMark
    expect(vertices(right.positions)).toEqual([
      [2.25, 0, 0],
      [2.25, 0.75, 0],
      [3, 0.75, 0],
    ])
  })

  it('reports the angle in radians as a decimal by default', () => {
    expect(labelText(clean('project: <3,4,0> onto <1,0,0>'))).toContain('comp_v u = 3 · θ = 0.9273')
  })

  it('draws u and v from P, and takes names and "at"', () => {
    const scene = clean('u = <3, 4, 0>\nv = <1, 0, 0>\nproject: u onto v at (0, 0, 1)')
    expect(arrows(scene, 's3.operands').vectors).toEqual([
      [3, 4, 0],
      [1, 0, 0],
    ])
    expect(arrows(scene, 's3').tails).toEqual([[0, 0, 1]])
    expect(labelText(scene)).toContain('comp_v u = 3 · θ = 0.9273')
  })

  it('a negative component points the projection backward', () => {
    const scene = clean('project: <-3,4,0> onto <2,0,0>')
    // + 0 turns the -0 of 0 * (-3/2) into 0
    expect(arrows(scene, 's1').vectors.map((v) => v.map((c) => c + 0))).toEqual([[-3, 0, 0]])
    // cos θ = -6 / (5 * 2), θ = 2.214
    expect(labelText(scene)).toContain('comp_v u = −3 · θ = 2.214')
  })

  it('refuses a zero vector in its own words', () => {
    expect(sceneOf('project: <1,2,3> onto <0,0,0>').errors[0].message).toMatch(/<0,0,0> is the zero vector — there is nothing to project onto/)
    expect(sceneOf('project: <0,0,0> onto <1,0,0>').errors[0].message).toMatch(/<0,0,0> is the zero vector/)
  })
})

describe('fix round 1: project: near-parallel and parallel operands', () => {
  it('reads a tiny angle from atan2(|u × v|, u·v): <1, 1e-8, 0> onto <1, 0, 0> is θ = 1e-8, not 0', () => {
    // (the expression grammar has no 1e-8: that reads as 1·e - 8)
    expect(labelText(clean('project: <1, 10^(-8), 0> onto <1, 0, 0>'))).toContain('comp_v u = 1 · θ = 1×10⁻⁸')
  })

  it('draws no perpendicular part and no right angle when u is parallel to v up to rounding', () => {
    // (0.1, 0.2, 0.3) = (0.3, 0.6, 0.9)/3: u - proj_v u is ~1e-17, not a part
    const scene = clean('project: <0.1,0.2,0.3> onto <0.3,0.6,0.9>')
    expect(scene.marks.map((m) => m.source.object)).toEqual(['s1', 's1.operands'])
    expect(labelText(scene)).toContain('comp_v u = 0.3742 · θ = 0')
  })
})
