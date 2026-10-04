import type { FeatureKind } from '../parser/config'

export interface Vec2 {
  x: number
  y: number
}

export interface Bounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

// The identity of a plotted thing: which statement it came from and what it is
// within that statement ('curve', 'hole.0', 'asymptote.1', ...). Meant to let
// later work (the pen's wobble, a hover readout) key on it instead of on a list
// position. Today a curve's id is stable across rebuilds, but an
// 'asymptote.<k>' renumbers as poles enter and leave the view.
export interface MarkId {
  statement: number
  object: string
}

// A run of connected vertices: x, y interleaved in Float64 world coordinates,
// and the curve's parameter (x, y, θ or t) at each vertex. `closed` means the
// last vertex joins back to the first; the first vertex is not repeated.
export interface Chain {
  xy: Float64Array
  param: Float64Array
  closed: boolean
}

// How a curve is interrupted. `at` is in the curve's own parameter, not in x.
export type BreakKind = 'pole' | 'jump' | 'edge'
export interface Break {
  at: number
  kind: BreakKind
}

export type MarkRole = 'hole' | 'endpoint' | 'value' // P5 adds 'feature'

// Every drawable kind carries an optional `color` (a resolved name/hex string
// from the statement, see parser/colors.ts) — `null`/absent means "use the
// renderer's default for this kind".
export type SceneObject =
  // A plotted curve as chains of Float64 world-coordinate vertices, each with
  // its parameter. `breaks` are where the curve is mathematically interrupted
  // (a pole, a jump, the edge of its domain): the adaptive sampler
  // (plot/sample/) types every one it finds, at the parameter it located. One
  // curve per plotted statement, except that a construction statement can yield several
  // (one per circle); a circle is one closed chain with no breaks, and a
  // tangent or a regression line is one two-vertex chain across the view.
  | { kind: 'curve'; id: MarkId; chains: Chain[]; breaks: Break[]; dashed?: boolean; color?: string | null }
  // A typed point on a curve: a hole or an endpoint (or a plain value), open or
  // filled. Open means the curve does not take the value there, so the renderer
  // draws it as a ring whose centre hides the curve beneath. `exact` is the
  // same claim a point's is: the position is analytic, not read off samples.
  | { kind: 'mark'; id: MarkId; at: Vec2; role: MarkRole; fill: 'open' | 'filled'; exact: boolean; color?: string | null }
  // The filled outline of the stretch of a curve where it oscillates faster
  // than a pixel resolves: instead of a smear of ink, the extent it sweeps.
  | { kind: 'band'; id: MarkId; outline: Chain[]; color?: string | null }
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
      // Which kind of detected feature this point is, or null/absent for an
      // ordinary plotted point. The renderer marks each kind differently —
      // v1 drew all of them as the same anonymous outline dot, which is why
      // the @points modes were indistinguishable on screen.
      feature?: FeatureKind | null
      // Whether this position can be trusted digit for digit. True means it
      // is literal — coordinates the author typed — or analytically
      // resolved, e.g. a root bisected to convergence or an extremum found
      // as a root of f'. False/absent means it was read off a sampled curve,
      // so it is only as accurate as the sample spacing. This is a claim
      // about the position, not about where the point came from: an
      // author-typed "A = (2, 3)" is exact and a detected feature is exact,
      // while a point picked out of a drawn polyline is not. Hover reports
      // exact values differently (see hover.ts).
      exact?: boolean
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
  // A constructed line of unbounded extent — "the line through P parallel to
  // A-B", a perpendicular bisector, an angle bisector (a ray). Stored
  // UNCLIPPED, as a point and a direction: a construction line is a locus,
  // true everywhere along itself, and the part of it that should be drawn
  // depends entirely on where the view currently is. The renderer clips it to
  // the visible bounds every time it draws (see render/clipLine.ts), so the
  // line stays correct under pan and zoom instead of carrying a stale clip
  // from whatever the bounds happened to be when the scene was built.
  // `direction` need not be a unit vector; `extent` 'ray' draws only forward
  // from `through`.
  // `role: 'asymptote'` marks a guide rather than a construction: it is drawn
  // dashed, so it reads as "the curve approaches this" and not as part of the
  // curve.
  | { kind: 'line'; id?: MarkId; through: Vec2; direction: Vec2; extent: 'infinite' | 'ray'; role?: 'asymptote'; color?: string | null }
  // Flat triangle list (groups of 3 points) for a filled inequality region.
  | { kind: 'region'; triangles: Vec2[]; color?: string | null }
  // Not pre-evaluated like everything else here — fx/fy are the path's two
  // coordinates compiled through the shared kernel (math/compile.ts) over the
  // parameter, so the renderer can call them every frame to animate the point
  // along the path, cycling `from`..`to` over time. They close over the
  // document's definitions, @params and angle unit, so a path that calls a
  // "k(t) = ..." definition, sums, piecewise, primes or n! resolves on every
  // frame exactly as it did at build, and a mistake in the path is a compile
  // error on the statement's line at build, never a silent per-frame failure.
  | { kind: 'animatedPoint'; fx: (t: number) => number; fy: (t: number) => number; param: string; from: number; to: number; color?: string | null }
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
  // How much work the curve sampler did, summed over every sampled curve (locating,
  // classifying and sampling), for a status line or a test; absent when the scene
  // did not come from buildScene.
  stats?: { points: number; intervals: number }
}
