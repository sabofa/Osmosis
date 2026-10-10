import type { AuthorMapping, FocusTarget } from '../view2d/focus'
import { authorToWorld } from './authorFrame'
import { cameraFor, type ViewName } from './project3d'

// Where an author's coordinates land in a rendered figure.
//
// A figure is drawn through ONE affine map from its "world" plane (the plane
// the author wrote in, or the camera's picture plane for a solid figure) to
// view units, which are also the SVG viewBox's units:
//
//   view = ((w.x - centre.x) * scale, -(w.y - centre.y) * scale)
//
// exactly document.ts's `fitProjection`. The frame carries that map's
// parameters and nothing else, so it is cheap to keep and cannot disagree
// with the drawing.
//
//   plane  The world IS the author's plane: author (x, y) -> world (x, y).
//   space  A solid figure. Author (X, Y, Z) -> the solid engine's internal
//          frame (authorFrame.ts) -> the figure's camera -> the world plane.
//
// The two kinds do not convert into each other: a plane target on a space
// frame, or a space target on a plane frame, has nowhere to land (null).
// A `view` target already is in view units and passes through unchanged.

export type FigureFrame =
  | { kind: 'plane'; scale: number; centre: { x: number; y: number } }
  | { kind: 'space'; scale: number; centre: { x: number; y: number }; view: ViewName }

type Point = { x: number; y: number }

function toView(frame: FigureFrame, world: Point): Point {
  return { x: (world.x - frame.centre.x) * frame.scale, y: -(world.y - frame.centre.y) * frame.scale }
}

export function authorToView(frame: FigureFrame, target: FocusTarget): Point | null {
  switch (target.kind) {
    case 'view':
      return { x: target.u, y: target.v }
    case 'plane':
      return frame.kind === 'plane' ? toView(frame, target) : null
    case 'space':
      return frame.kind === 'space'
        ? toView(frame, cameraFor(frame.view).project(authorToWorld({ x: target.x, y: target.y, z: target.z })))
        : null
  }
}

// The author's plane point under a view point. A solid figure's picture plane
// does not determine a point in space, so a space frame has no inverse.
export function viewToAuthorPlane(frame: FigureFrame, p: Point): Point | null {
  if (frame.kind !== 'plane') return null
  return { x: p.x / frame.scale + frame.centre.x, y: -p.y / frame.scale + frame.centre.y }
}

export function figureMapping(frame: FigureFrame): AuthorMapping {
  return { toContent: (target) => authorToView(frame, target) }
}
