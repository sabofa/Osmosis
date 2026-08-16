import type { FunctionTable } from '../parser/evalExpr'
import type { Expr } from '../parser/types'

export interface Vec2 {
  x: number
  y: number
}

// Every drawable kind carries an optional `color` (a resolved name/hex string
// from the statement, see parser/colors.ts) — `null`/absent means "use the
// renderer's default for this kind".
export type SceneObject =
  | { kind: 'curve'; points: Vec2[]; color?: string | null }
  // labelDirection is a unit vector suggesting which way the label should
  // sit from the point — used for a polygon vertex (buildScene.ts's
  // buildPolygon sets it pointing away from the polygon's own centroid) so
  // the label lands outside the shape instead of the fixed default
  // up-right offset, which for a vertex on the shape's near/left side
  // often points straight into whatever's already drawn there (an
  // angle:/right-angle: mark always sits *inside* the shape at its
  // vertex). null/absent keeps the default fixed offset, e.g. for a plain
  // "A = (x, y)" point with no shape to be "outside" of.
  // maxLabelOffset caps how far (in world units) the label is allowed to
  // sit from the point — same "everything needs a limit" reasoning as the
  // angle:/tick:/right-angle: marks already have (see SceneRenderer.ts's
  // ANGLE_ARC_MAX_FRACTION etc.): a polygon vertex's label is normally
  // offset by a fixed *pixel* distance, which at a zoomed-out-enough view
  // becomes a world distance bigger than the polygon itself, scattering
  // labels away from (at a small enough shape, effectively on top of) their
  // own vertices instead of scaling down with the shape. null/absent means
  // no cap, e.g. for a plain "A = (x, y)" point with no shape to size the
  // limit against.
  | {
      kind: 'point'
      label: string | null
      position: Vec2
      style?: 'solid' | 'outline'
      color?: string | null
      labelDirection?: Vec2 | null
      maxLabelOffset?: number | null
    }
  | { kind: 'segment'; from: Vec2; to: Vec2; dashed?: boolean; color?: string | null }
  // A batch of independent segment pairs rendered as one THREE.LineSegments
  // (one draw call, one geometry) instead of many separate 'segment' objects
  // — used for anything that naturally produces dozens to hundreds of little
  // segments in one go (a traced implicit boundary, a region's boundary, a
  // slope field's ticks), where one THREE.Object3D per segment was the
  // actual cause of drag/pan lag, not the math generating them.
  | { kind: 'segments'; pairs: [Vec2, Vec2][]; dashed?: boolean; color?: string | null }
  | { kind: 'ray'; from: Vec2; to: Vec2; label?: string | null; color?: string | null }
  // Flat triangle list (groups of 3 points) for a filled inequality region.
  | { kind: 'region'; triangles: Vec2[]; color?: string | null }
  // Not pre-evaluated like everything else here — fx/fy stay as expressions
  // so the renderer can re-evaluate them every frame to animate the point
  // along the path, cycling `from`..`to` over time. `functions` is carried
  // along too so a path that calls a "k(t) = ..." definition (see
  // parser/types.ts) still resolves correctly on every one of those
  // per-frame re-evaluations, not just the one-off build pass.
  | { kind: 'animatedPoint'; fx: Expr; fy: Expr; param: string; from: number; to: number; color?: string | null; functions: FunctionTable }
  // Geometry annotations (see parser/types.ts's angle:/tick:/right-angle:) —
  // circle/polygon reuse 'curve'/'segments'/'point' above instead of adding
  // their own kinds, since a circle is just a closed sampled curve and a
  // polygon is just a batch of straight edges plus labeled vertex points.
  // These three are genuinely new shapes with no existing equivalent.
  // vertex/from/to carry resolved world coordinates (buildScene.ts's
  // named-point pass) rather than the original A/B/C names — the renderer
  // that turns these into actual arc/tick/square geometry (SceneRenderer.ts,
  // via render/geometryMarks.ts) only needs positions, and doing the
  // name lookup once in buildScene keeps that renderer free of any
  // dependency on how points got named.
  | { kind: 'angleMark'; vertex: Vec2; from: Vec2; to: Vec2; label: string | null; color?: string | null }
  | { kind: 'tickMark'; from: Vec2; to: Vec2; count: number; color?: string | null }
  | { kind: 'rightAngleMark'; vertex: Vec2; from: Vec2; to: Vec2; color?: string | null }

export interface SceneError {
  line: number
  message: string
}

export interface Regression {
  slope: number
  intercept: number
  r: number
}

export interface Scene {
  objects: SceneObject[]
  errors: SceneError[]
  regression: Regression | null
}
