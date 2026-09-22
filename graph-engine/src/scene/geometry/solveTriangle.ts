import type { Vec2 } from '../types'
import type { AngleMode } from './derive'
import { GEOM_EPS } from './objects'

// Triangles solved from their measurements, in the five classic closed-form
// cases. No solver, no search: each case is a formula, so the same spec text
// produces the identical figure every run.
//
// Slots follow the textbook convention. Side `a` is opposite the first named
// vertex (so for "triangle ABC" it is B-C), side `b` is opposite the second,
// side `c` opposite the third; angle `a` is the angle *at* the first vertex.
// The parser's job is to turn "AB = 8" and "angle A = 90" into these slots.

export type SlotKey = 'a' | 'b' | 'c'
export type TriangleCase = 'SSS' | 'SAS' | 'ASA' | 'AAS' | 'RHS'

export interface TriangleSpec {
  names: [string, string, string]
  sides: Partial<Record<SlotKey, number>>
  angles: Partial<Record<SlotKey, number>>
}

export interface SolvedTriangle {
  kind: TriangleCase
  vertices: [Vec2, Vec2, Vec2]
}

const SLOTS: SlotKey[] = ['a', 'b', 'c']

// The two vertices a side runs between, for error messages: side `a` is the
// side opposite the first vertex, i.e. the one joining the other two.
function sideName(names: TriangleSpec['names'], slot: SlotKey): string {
  const index = SLOTS.indexOf(slot)
  return `${names[(index + 1) % 3]}${names[(index + 2) % 3]}`
}

function vertexName(names: TriangleSpec['names'], slot: SlotKey): string {
  return names[SLOTS.indexOf(slot)]
}

function toRadians(value: number, mode: AngleMode): number {
  return mode === 'degrees' ? (value * Math.PI) / 180 : value
}

function presentSlots(record: Partial<Record<SlotKey, number>>): SlotKey[] {
  return SLOTS.filter((slot) => record[slot] !== undefined)
}

// The one slot of the three that is *not* present. Only meaningful when
// exactly two are, which is every case that calls it.
function missingSlot(present: SlotKey[]): SlotKey {
  return SLOTS.find((slot) => !present.includes(slot)) as SlotKey
}

// D5 — the placement convention. The first named vertex at the origin, the
// second on the positive x-axis, the third in the upper half-plane.
//
// Without a fixed convention "deterministic" is not achievable: the
// measurements fix a triangle's shape, but nothing in them fixes where it
// sits or which way up it is. Every case here funnels through the three side
// lengths and then through this one function, so all five agree.
function place(a: number, b: number, c: number): [Vec2, Vec2, Vec2] {
  // Third vertex from the law of cosines at the first vertex, written as a
  // projection so no arccos is needed: x is how far along A-B the third
  // vertex projects, y is what is left over. y > 0 puts it in the upper
  // half-plane, which is the rest of D5.
  const x = (b * b + c * c - a * a) / (2 * c)
  const ySquared = b * b - x * x
  if (ySquared <= 0) {
    throw new Error(`Sides ${a}, ${b} and ${c} do not close into a triangle`)
  }
  return [
    { x: 0, y: 0 },
    { x: c, y: 0 },
    { x, y: Math.sqrt(ySquared) },
  ]
}

function assertTriangleInequality(spec: TriangleSpec, a: number, b: number, c: number): void {
  const tol = GEOM_EPS * Math.max(a, b, c)
  const pairs: [number, number, number, SlotKey][] = [
    [a, b, c, 'c'],
    [b, c, a, 'a'],
    [c, a, b, 'b'],
  ]
  for (const [p, q, r, longest] of pairs) {
    if (p + q <= r + tol) {
      throw new Error(
        `Sides ${a}, ${b} and ${c} violate the triangle inequality: ${p} + ${q} is not more than ` +
          `${r} (side ${sideName(spec.names, longest)}), so no triangle has these sides`
      )
    }
  }
}

// Whatever the case, the solver ends up with all three side lengths and then
// places them. Keeping every branch funnelled through here is what makes D5
// hold for all five cases rather than for the ones someone remembered.
function finish(spec: TriangleSpec, kind: TriangleCase, a: number, b: number, c: number): SolvedTriangle {
  assertTriangleInequality(spec, a, b, c)
  return { kind, vertices: place(a, b, c) }
}

function validate(spec: TriangleSpec, mode: AngleMode): { sides: Partial<Record<SlotKey, number>>; angles: Partial<Record<SlotKey, number>> } {
  const angles: Partial<Record<SlotKey, number>> = {}
  for (const slot of presentSlots(spec.sides)) {
    const value = spec.sides[slot] as number
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Side ${sideName(spec.names, slot)} must be a positive length, got ${value}`)
    }
  }
  for (const slot of presentSlots(spec.angles)) {
    const given = spec.angles[slot] as number
    const radians = toRadians(given, mode)
    if (!Number.isFinite(radians) || radians <= 0 || radians >= Math.PI) {
      throw new Error(
        `Angle ${vertexName(spec.names, slot)} must be between 0 and 180 degrees (0 and pi radians), got ${given}`
      )
    }
    angles[slot] = radians
  }
  return { sides: spec.sides, angles }
}

function solveSSS(spec: TriangleSpec, sides: Record<SlotKey, number>): SolvedTriangle {
  return finish(spec, 'SSS', sides.a, sides.b, sides.c)
}

// Two sides with the angle between them: the third side straight from the law
// of cosines, and then the ordinary SSS placement.
function solveSAS(spec: TriangleSpec, sides: Partial<Record<SlotKey, number>>, angle: number, at: SlotKey): SolvedTriangle {
  const [p, q] = SLOTS.filter((slot) => slot !== at).map((slot) => sides[slot] as number)
  const opposite = Math.sqrt(p * p + q * q - 2 * p * q * Math.cos(angle))
  const all = { ...sides, [at]: opposite } as Record<SlotKey, number>
  return finish(spec, 'SAS', all.a, all.b, all.c)
}

// Two angles and a side. ASA and AAS differ only in which side was given —
// between the two angles or not — and are reported separately because that is
// what the author wrote, but both solve the same way: the third angle by
// subtraction, then the law of sines.
function solveTwoAngles(
  spec: TriangleSpec,
  angles: Partial<Record<SlotKey, number>>,
  givenAngles: SlotKey[],
  sideSlot: SlotKey
): SolvedTriangle {
  const third = missingSlot(givenAngles)
  const sum = (angles[givenAngles[0]] as number) + (angles[givenAngles[1]] as number)
  if (sum >= Math.PI - GEOM_EPS) {
    const shown = givenAngles.map((slot) => vertexName(spec.names, slot)).join(' and ')
    throw new Error(`Angles ${shown} already sum to 180 degrees or more, so they leave no angle for ${vertexName(spec.names, third)}`)
  }
  const all = { ...angles, [third]: Math.PI - sum } as Record<SlotKey, number>

  // Law of sines: every side over the sine of its opposite angle is the same.
  const ratio = (spec.sides[sideSlot] as number) / Math.sin(all[sideSlot])
  const sides = {
    a: ratio * Math.sin(all.a),
    b: ratio * Math.sin(all.b),
    c: ratio * Math.sin(all.c),
  }
  return finish(spec, sideSlot === third ? 'ASA' : 'AAS', sides.a, sides.b, sides.c)
}

// Two sides and a *non*-included angle. Unique only when that angle is the
// right angle, in which case its opposite side is the hypotenuse and the
// third side is Pythagoras. Everything else is SSA and is refused.
function solveNonIncluded(
  spec: TriangleSpec,
  sides: Partial<Record<SlotKey, number>>,
  angle: number,
  at: SlotKey,
  otherSide: SlotKey
): SolvedTriangle {
  const isRightAngle = Math.abs(angle - Math.PI / 2) <= GEOM_EPS
  const hypotenuse = sides[at] as number
  const leg = sides[otherSide] as number

  if (!isRightAngle) {
    const givenSides = SLOTS.filter((slot) => sides[slot] !== undefined)
      .map((slot) => `${sideName(spec.names, slot)} = ${sides[slot]}`)
      .join(' and ')
    throw new Error(
      `SSA is ambiguous and is not solved here: ${givenSides} with angle ${vertexName(spec.names, at)} ` +
        `(which is not between them) can admit zero, one or two different triangles, so there is no single ` +
        `figure to draw. Draw it as a construction instead: place the angle at its vertex, draw a ray along ` +
        `one arm, and intersect a circle of radius ${hypotenuse} centred on the far endpoint with that ray. ` +
        `That yields both triangles at once, which is the picture that answers why the case cannot be determined.`
    )
  }

  if (hypotenuse <= leg) {
    throw new Error(
      `The hypotenuse ${sideName(spec.names, at)} = ${hypotenuse} must be longer than the leg ` +
        `${sideName(spec.names, otherSide)} = ${leg}, since it is opposite the right angle at ${vertexName(spec.names, at)}`
    )
  }

  const third = missingSlot([at, otherSide])
  const all = { ...sides, [third]: Math.sqrt(hypotenuse * hypotenuse - leg * leg) } as Record<SlotKey, number>
  return finish(spec, 'RHS', all.a, all.b, all.c)
}

export function solveTriangle(spec: TriangleSpec, mode: AngleMode): SolvedTriangle {
  const { sides, angles } = validate(spec, mode)
  const givenSides = presentSlots(sides)
  const givenAngles = presentSlots(angles)
  const total = givenSides.length + givenAngles.length

  if (total !== 3) {
    throw new Error(
      `A triangle needs exactly 3 measurements, got ${total} ` +
        `(${givenSides.length} side${givenSides.length === 1 ? '' : 's'}, ${givenAngles.length} angle${givenAngles.length === 1 ? '' : 's'})`
    )
  }

  if (givenSides.length === 3) return solveSSS(spec, sides as Record<SlotKey, number>)

  if (givenAngles.length === 3) {
    throw new Error(
      `Three angles (AAA) fix a triangle's shape but not its size — every scaled copy satisfies them. ` +
        `Give at least one side length.`
    )
  }

  if (givenSides.length === 2) {
    const at = givenAngles[0]
    const unknownSide = missingSlot(givenSides)
    // The given angle is *included* exactly when its vertex is the one
    // opposite the side that was not given: side `a` is opposite vertex `a`,
    // so an angle at `a` sits between sides `b` and `c`.
    if (at === unknownSide) return solveSAS(spec, sides, angles[at] as number, at)
    return solveNonIncluded(spec, sides, angles[at] as number, at, givenSides.find((slot) => slot !== at) as SlotKey)
  }

  return solveTwoAngles(spec, angles, givenAngles, givenSides[0])
}
