import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parsePlaneForm } from '../parser/parseStatement'
import { authorToWorld, worldToAuthor } from './authorFrame'
import { cross3, dot3, length3, planeThrough, scale3, sub3 } from './construct3d'
import { canonicalPlane, planeFromEquation } from './plane'
import { DEFAULT_CAMERA, type Vec3 } from './project3d'

// Q1 — one internal plane, canonicalised. Every expected value is computed by
// hand in the AUTHOR frame and converted once, at the edge of the test.

const evaluate = (e: Parameters<typeof evalExpr>[0], vars: Record<string, number>) => evalExpr(e, vars)

function equation(text: string) {
  const form = parsePlaneForm(text)
  if (form.kind !== 'equation' && form.kind !== 'axis') throw new Error(`not an equation: ${text}`)
  if (form.kind === 'axis') throw new Error('the axis form is not read by planeFromEquation')
  return planeFromEquation(form.left, form.right, evaluate, form.source)
}

const author = (x: number, y: number, z: number): Vec3 => authorToWorld({ x, y, z })

function expectVec(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

describe('canonicalisation (Q1)', () => {
  it('turns a plane through three points at author z = 1 into the axis form z = 1', () => {
    const plane = planeThrough(author(0, 0, 1), author(1, 0, 1), author(0, 1, 1))
    // Author z is internal y. The axis form is EXACT — the same object
    // "plane z = 1" builds — which is what keeps every byte of its section.
    expect(canonicalPlane(plane, 'A-B-C')).toEqual({ kind: 'axis', axis: 'y', at: 1, source: 'A-B-C' })
  })

  it('normalises the sign, so at is the coordinate whichever way the normal points', () => {
    // Wound the other way the normal is -z; the plane is still z = 1.
    const plane = planeThrough(author(0, 0, 1), author(0, 1, 1), author(1, 0, 1))
    expect(plane.normal.y).toBe(-1)
    expect(canonicalPlane(plane, 'A-C-B')).toEqual({ kind: 'axis', axis: 'y', at: 1, source: 'A-C-B' })
  })

  it('reads "plane 0x + 0y + 2z = 2" as z = 1', () => {
    expect(canonicalPlane(equation('0x + 0y + 2z = 2'), '0x + 0y + 2z = 2')).toEqual({
      kind: 'axis',
      axis: 'y',
      at: 1,
      source: '0x + 0y + 2z = 2',
    })
    // And author x = -3 (internal z) from an equation with the sign flipped.
    expect(canonicalPlane(equation('-2x = 6'), '-2x = 6')).toEqual({ kind: 'axis', axis: 'z', at: -3, source: '-2x = 6' })
  })

  it('leaves a tilted plane general', () => {
    const plane = canonicalPlane(equation('x + z = 1'), 'x + z = 1')
    expect(plane.kind).toBe('general')
  })
})

describe("a general plane's frame (Q1)", () => {
  function general(text: string) {
    const plane = canonicalPlane(equation(text), text)
    if (plane.kind !== 'general') throw new Error(`${text} should be general`)
    return plane
  }

  it('faces the default camera, and (u, v, normal) is right-handed and orthonormal', () => {
    const plane = general('x + y + z = 1')
    expect(dot3(plane.normal, DEFAULT_CAMERA.direction)).toBeGreaterThan(0)
    expect(length3(plane.normal)).toBeCloseTo(1, 14)
    expect(length3(plane.u)).toBeCloseTo(1, 14)
    expect(length3(plane.v)).toBeCloseTo(1, 14)
    expect(dot3(plane.u, plane.v)).toBeCloseTo(0, 14)
    expectVec(cross3(plane.u, plane.v), plane.normal, 14)
    // Author (1, 1, 1)/sqrt 3, by hand.
    expectVec(worldToAuthor(plane.normal), { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) }, 14)
  })

  it('turns a normal written AWAY from the camera toward it', () => {
    // The same plane written with every sign flipped: its natural normal is
    // author (-1, -1, -1), which faces away from the standard camera (azimuth
    // 30, elevation 25 — every component of its direction is positive). The
    // frame must not depend on how the author wrote it.
    const flipped = general('-x - y - z = -1')
    expect(dot3(flipped.normal, DEFAULT_CAMERA.direction)).toBeGreaterThan(0)
    const plain = general('x + y + z = 1')
    expectVec(flipped.normal, plain.normal, 14)
    expectVec(flipped.u, plain.u, 14)
    expectVec(flipped.v, plain.v, 14)
  })

  it('takes v as the projection of author Z onto the plane, so a lifted section reads upright', () => {
    const plane = general('x + y + z = 1')
    const z = author(0, 0, 1)
    // Z minus its component along n = (1, 1, 1)/sqrt 3 is (-1, -1, 2)/3, of
    // length sqrt(6)/3; normalised, (-1, -1, 2)/sqrt 6.
    expectVec(worldToAuthor(plane.v), { x: -1 / Math.sqrt(6), y: -1 / Math.sqrt(6), z: 2 / Math.sqrt(6) }, 14)
    expect(dot3(plane.v, z)).toBeGreaterThan(0)
  })

  it('takes v as exactly author Z for a vertical plane', () => {
    const plane = general('x + y = 1')
    expect(worldToAuthor(plane.v)).toEqual({ x: 0, y: 0, z: 1 })
  })
})

describe('the equation form (Q2)', () => {
  it('reads 2x + y - z = 3 as normal (2, 1, -1) through a point that satisfies it', () => {
    const plane = equation('2x + y - z = 3')
    const n = worldToAuthor(plane.normal)
    // Parallel to (2, 1, -1): the cross product vanishes.
    expectVec(cross3(n, { x: 2, y: 1, z: -1 }), { x: 0, y: 0, z: 0 }, 14)
    const p = worldToAuthor(plane.point)
    expect(2 * p.x + p.y - p.z).toBeCloseTo(3, 12)
  })

  it('reads the same plane from either side of the "="', () => {
    const a = equation('2x + y = z + 3')
    const b = equation('2x + y - z = 3')
    expect(Math.abs(dot3(a.normal, b.normal))).toBeCloseTo(1, 14)
    expect(dot3(sub3(a.point, b.point), b.normal)).toBeCloseTo(0, 12)
  })

  it('refuses an equation that is not linear, quoting it', () => {
    expect(() => equation('x^2 + y = 1')).toThrow('plane x^2 + y = 1 is not a plane — it must be linear in x, y, z')
    // Linear at every integer probe the plan names, and still not a plane:
    // x(x - 1)(x - 2) vanishes at x = 0, 1, 2.
    expect(() => equation('x*(x - 1)*(x - 2) + y = 1')).toThrow(/is not a plane — it must be linear in x, y, z/)
  })

  it('refuses an equation with no variable in it', () => {
    expect(() => equation('0x + 0y + 0z = 1')).toThrow(
      'plane 0x + 0y + 0z = 1 is not a plane — x, y and z all have coefficient 0, so it fixes no direction'
    )
  })
})

describe('what canonicalisation keeps', () => {
  it('puts a general plane through the foot of the origin, however it was written', () => {
    const through = canonicalPlane(planeThrough(author(1, 0, 0), author(0, 1, 0), author(0, 0, 1)), 'X-Y-Z')
    const written = canonicalPlane(equation('x + y + z = 1'), 'x + y + z = 1')
    if (through.kind !== 'general' || written.kind !== 'general') throw new Error('expected general planes')
    // The foot of the origin on x + y + z = 1 is (1, 1, 1)/3.
    expectVec(worldToAuthor(through.point), { x: 1 / 3, y: 1 / 3, z: 1 / 3 }, 14)
    expectVec(through.point, written.point, 14)
    expectVec(through.normal, written.normal, 14)
    expect(dot3(scale3(through.normal, 1), through.u)).toBeCloseTo(0, 14)
  })
})
