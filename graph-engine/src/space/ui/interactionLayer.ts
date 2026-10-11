// The interaction layer (plan E9, E10): the probe's and the pins' markers and
// drop lines as transient marks. Pure. They are never part of the SpaceScene:
// the renderer hands them to the backend's overlay, which draws them last,
// over everything, unclipped and outside the hidden-part pass, so the point
// being read and its drop lines are never hidden by the surface they measure.
//
// For a point p:
// - a ring marker, 10 px, in the hover colour;
// - dashed 1 px drop lines from p to the floor and to each back wall, the
//   walls the box frame draws (the ones behind the data from this camera);
// - small dots at the three feet.

import type { Box3, LineMark, Mark, PointMark, Vec3 } from '../scene/types'

export const MARKER_SIZE = 10
export const FOOT_SIZE = 4
export const DROP_WIDTH = 1
export const DROP_DASH: readonly number[] = [3, 3]

// The feet of p's drop lines: on the floor, on the x back wall and on the y
// back wall, chosen from the eye direction as box.ts chooses the walls
// (x = min when the eye is on the +x side, and so on; the floor is z = min
// seen from above).
export function dropFeet(p: Vec3, box: Box3, eye: Vec3): [Vec3, Vec3, Vec3] {
  const xBack = eye[0] > 0 ? box.x.min : box.x.max
  const yBack = eye[1] > 0 ? box.y.min : box.y.max
  const floor = eye[2] >= 0 ? box.z.min : box.z.max
  return [
    [p[0], p[1], floor],
    [xBack, p[1], p[2]],
    [p[0], yBack, p[2]],
  ]
}

// Which walls are behind, as a key: the layer is rebuilt when it changes.
export function wallKey(eye: Vec3): string {
  return `${eye[0] > 0 ? '-' : '+'}${eye[1] > 0 ? '-' : '+'}${eye[2] >= 0 ? '-' : '+'}`
}

export interface InteractionColors {
  // #rrggbb, through parser/colors.ts.
  marker: string
  ink: string
}

const SOURCE = { line: 0, statement: null }

// The marks for every point being read (the probe's and each pin's).
export function interactionMarks(points: readonly Vec3[], box: Box3, eye: Vec3, colors: InteractionColors): Mark[] {
  if (points.length === 0) return []
  const drops: Vec3[][] = []
  const feet: Vec3[] = []
  for (const p of points) {
    for (const foot of dropFeet(p, box, eye)) {
      drops.push([p, foot])
      feet.push(foot)
    }
  }
  const flat = (ps: readonly Vec3[]) => Float64Array.from(ps.flat())
  const lines: LineMark = {
    kind: 'lines',
    source: { ...SOURCE, object: 'interaction.drops' },
    positions: flat(drops.flat()),
    starts: Uint32Array.from(drops.map((_, i) => 2 * i)),
    params: null,
    style: { color: { author: colors.ink, slot: 0 }, width: DROP_WIDTH, dash: DROP_DASH, hidden: 'none' },
    pick: null,
  }
  const footDots: PointMark = {
    kind: 'points',
    source: { ...SOURCE, object: 'interaction.feet' },
    positions: flat(feet),
    style: { color: { author: colors.ink, slot: 0 }, size: FOOT_SIZE, shape: 'dot' },
  }
  const markers: PointMark = {
    kind: 'points',
    source: { ...SOURCE, object: 'interaction.markers' },
    positions: flat(points),
    // S6 plan V5: the same halo as a draggable point, so a hovered or pinned
    // marker is just as findable.
    style: { color: { author: colors.marker, slot: 0 }, size: MARKER_SIZE, shape: 'ring', halo: true },
  }
  return [lines, footDots, markers]
}

