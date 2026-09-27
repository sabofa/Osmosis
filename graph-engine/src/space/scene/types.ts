// The contract between the space kernel and every backend (spec: Track 3,
// "Revised 2026-09-26", SP3). The kernel builds one SpaceScene from a spec;
// a backend (today WebGL2, in space/gl/) uploads and draws it; picking and
// the DOM overlay read it. Nothing in here knows about WebGL, the DOM or
// three.js, and nothing here is mutated after the kernel returns it.
//
// Geometry is Float64 on the CPU so readouts and tests are exact. The
// backend converts to Float32 relative to the box centre at upload (SP2).
//
// The same spec, bindings and resolution give the same scene, typed arrays
// included, so tests assert on scenes. Pixels are GPU-dependent and are
// never asserted.

export interface Range {
  min: number
  max: number
}

export interface Box3 {
  x: Range
  y: Range
  z: Range
}

export type Vec3 = readonly [number, number, number]

// Where a mark came from, so a tool (track 7) can address it — the space
// equivalent of the figure renderer's data-statement / data-object.
export interface MarkSource {
  // 1-based line of the statement in the spec text.
  line: number
  // The statement's `name:` clause, when it has one.
  statement: string | null
  // Unique within the scene and stable across rebuilds of the same spec:
  // "s<line>" for a statement's primary mark, "s<line>.<part>" for the rest
  // (e.g. "s4.plane", "s4.point").
  object: string
}

// A colour as the author asked for it. The renderer resolves it against the
// theme: `author` (a colour name or #rrggbb, from the `color:` clause) wins;
// otherwise `slot` picks from the categorical series, so two surfaces in one
// scene are never the same colour. Slots are handed out in source order to
// the statements that draw something.
export interface ColorSpec {
  author: string | null
  slot: number
}

export type ColormapName = 'viridis' | 'cividis' | 'magma' | 'plasma' | 'gray' | 'balance'

// One colorbar's worth of mapping. A mesh refers to it by `id`.
export interface ColorScale {
  id: number
  // What the colour encodes, as the author wrote it ("height", "x*y", ...).
  title: string
  map: ColormapName
  domain: Range
  // Symmetric about zero; `map` is then a diverging map.
  diverging: boolean
}

// Mesh lines drawn in the fragment shader at u = u0 + k*du and v = v0 + k*dv,
// in the mesh's own (u, v) attribute units. For z = f(x, y), (u, v) = (x, y)
// and the steps are the x and y tick steps, so every mesh line is a trace at
// a readable value.
export interface MeshLines {
  u0: number
  du: number
  v0: number
  dv: number
}

export interface MeshStyle {
  color: ColorSpec
  opacity: number
  // Index of a ColorScale in SpaceScene.colorScales, or null for a flat colour.
  colorScale: number | null
  meshLines: MeshLines | null
}

// How a line's parts that are hidden behind a surface draw (SP4, pass 3).
export type HiddenStyle = 'dashed' | 'none'

export interface LineStyle {
  color: ColorSpec
  // CSS pixels.
  width: number
  // Dash pattern in CSS pixels, or null for solid.
  dash: readonly number[] | null
  hidden: HiddenStyle
}

export type PointShape = 'dot' | 'ring' | 'cross' | 'diamond' | 'square'

export interface PointStyle {
  color: ColorSpec
  // Diameter, CSS pixels.
  size: number
  shape: PointShape
}

export interface ArrowStyle {
  color: ColorSpec
  // CSS pixels: arrows read the same at every zoom.
  shaftWidth: number
  headSize: number
  hidden: HiddenStyle
}

export interface BoxStyle {
  color: ColorSpec
  opacity: number
  edges: boolean
}

// What a pick of a surface re-evaluates, so a readout is the true function at
// the hit rather than a triangle's interpolation (SP6). Functions are
// compiled closures: a scene is in-memory data, not a serialisation format.
export type SurfacePick =
  | {
      kind: 'graph'
      f: (x: number, y: number) => number
      fx: (x: number, y: number) => number
      fy: (x: number, y: number) => number
    }
  | {
      kind: 'parametric'
      param: readonly [string, string]
      r: (u: number, v: number) => Vec3
      // r_u and r_v from symbolic derivatives (S3, optional): picking refines
      // a hit on the true surface by Newton with them. Without them a hit
      // stays at the triangle's (u, v).
      ru?: (u: number, v: number) => Vec3
      rv?: (u: number, v: number) => Vec3
      // A coordinate surface's readout row (S4a): the hit in its own
      // system, e.g. { label: '(r, θ, z)', value: '(2, 1.571, 1)' }.
      coordinates?: (p: Vec3) => { label: string; value: string }
    }
  | {
      kind: 'implicit'
      F: (x: number, y: number, z: number) => number
      grad: (x: number, y: number, z: number) => Vec3
    }

export interface CurvePick {
  param: string
  r: (t: number) => Vec3
  dr: (t: number) => Vec3
}

export interface MeshMark {
  kind: 'mesh'
  source: MarkSource
  // xyz per vertex.
  positions: Float64Array
  // Unit normal per vertex (xyz); a zero vector where the normal is undefined.
  normals: Float64Array
  indices: Uint32Array
  // One value per vertex for the colormap, or null.
  scalars: Float64Array | null
  // (u, v) per vertex for mesh lines and picking, or null.
  uv: Float64Array | null
  style: MeshStyle
  pick: SurfacePick | null
}

export interface LineMark {
  kind: 'lines'
  source: MarkSource
  // xyz per vertex.
  positions: Float64Array
  // Vertex index at which each polyline starts, ascending; polyline i runs to
  // starts[i + 1] - 1, the last one to the final vertex.
  starts: Uint32Array
  // The curve parameter at each vertex (t), or null.
  params: Float64Array | null
  style: LineStyle
  pick: CurvePick | null
}

// How a point defined by one or two parameters is dragged (S3, optional; SP6
// "Drag"): its position and the 3 x k Jacobian of its position with respect
// to its parameters, both at any parameter values (not only the live ones),
// from the symbolic derivatives. Dragging solves for the values that put the
// point under the cursor.
export interface PointDrag {
  // The bindings it moves, in source order (one or two).
  params: readonly string[]
  position(values: Float64Array): Vec3
  // Row-major: [d x/d p0, d x/d p1, d y/d p0, ...], 3 x params.length.
  jacobian(values: Float64Array): Float64Array
}

export interface PointMark {
  kind: 'points'
  source: MarkSource
  positions: Float64Array
  style: PointStyle
  // Present when the point's coordinates read one or two bindings.
  drag?: PointDrag
}

export interface ArrowMark {
  kind: 'arrows'
  source: MarkSource
  // xyz per arrow.
  tails: Float64Array
  vectors: Float64Array
  style: ArrowStyle
}

export interface BoxMark {
  kind: 'boxes'
  source: MarkSource
  // xyz per box.
  mins: Float64Array
  maxs: Float64Array
  style: BoxStyle
}

export type Mark = MeshMark | LineMark | PointMark | ArrowMark | BoxMark

export type LabelKind = 'point' | 'annotation'

// Text anchored at an author-space point, drawn by the DOM overlay.
export interface LabelAnchor {
  source: MarkSource
  position: Vec3
  text: string
  kind: LabelKind
}

export interface SceneError {
  // 1-based source line; 0 only when no single line is to blame.
  line: number
  message: string
}

export interface SpaceScene {
  marks: Mark[]
  labels: LabelAnchor[]
  colorScales: ColorScale[]
  // The data extent, for automatic bounds: the box pass's FIRST pass only
  // (integration J1, kernel/index.ts). Box-dependent statements (a plane, an
  // implicit surface, every S4b tool, ...) are left out, so resolveBox over
  // this extent is the box they were built in; `region:` adds only its x and
  // y. Null when nothing but box-dependent statements draws. z is the empty
  // range (min +Infinity, max -Infinity: no data, which resolveBox treats as
  // absent) when only regions draw.
  // x and y span every finite vertex and label. z is robust against poles
  // (SP5) over SAMPLED marks only — meshes, curves (lines carrying their
  // parameter) and boxes: when the 1st-99th percentile span of their z values
  // is under a fifth of the full span, that percentile span is used. Authored
  // geometry — points, segments (lines without a parameter), arrows and
  // labels — then extends z exactly, so it is never clipped.
  extent: Box3 | null
  errors: SceneError[]
}
