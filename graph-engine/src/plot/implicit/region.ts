// Regions (calc P3, task 4): one condition, three-valued per cell, and the leaves it cannot decide cut by the zero sets of its
// comparisons into the pieces that are inside.
//
//   const { tree, comparisons } = analyseCondition(condition)      the condition's skeleton and its comparisons H = a - b
//   subdivide(conditionClassifier(twin), root, ...)                 proven inside: whole; proven outside: dropped; the rest: leaves
//   clipLeaves({ leaves, comparisons, tree, fns, ... pool })        each leaf cut, its inside pieces' edges put in the pool (outline.ts)
//
// THE CONDITION is the statement's comparison or chain, its `and`/`or`/`not`, and its `if` clause, as one Expr (math/reserved.ts).
// Its COMPARISONS are the `__lt`, `__le`, ... calls of its skeleton, in depth-first left-to-right order; comparison k is `a op b` and
// its H is `a - b`, so it holds where `H op 0`. (Anything else in the skeleton is a truth value in its own right, nonzero true:
// `e != 0`.) The twin evaluates the whole condition once for a cell: [1, 1] with no undefined point in the box (verdict DEFINED or
// better) is proven true, [0, 0] is proven false, and anything else is ambiguous, an enclosure that may hold a NaN (PARTIAL), an
// integral (UNKNOWN) or both truth values. Undefined is outside: a cell that is empty (NaN at every point) or proven false is
// dropped, and a cell that is true wherever it is defined but may not be defined everywhere is cut by the domain edge, not kept.
//
// CUTTING A LEAF. A leaf is a pixel, and the zero set of each comparison crosses it as a few straight chords (contour.ts: bisected
// roots on the leaf's edges, shared with the leaf on the other side, paired the way the curve is, a piece drawn only where the twin
// vouches for it), and the domain's edge, a pole or a jump, as a chord between the stops found on its edges. The leaf and its chords
// make a small planar graph (the leaf's boundary split at every root and stop on it; the chords split where two cross) whose faces
// are the pieces the leaf is cut into, and each face is wholly inside or wholly out:
//  - the sign of H_k on a face comes from a corner of the leaf that is a vertex of it (the leaf corner's own H, which the cache holds),
//    else from the face across a chord (a zero chord of k flips it, any other chord keeps it, the domain chord of k stops it), else
//    from H at a point inside the face; an undefined corner makes the face undefined. Signs are never taken from a sample where a
//    corner or a neighbour can say, so two faces on either side of a chord always differ in the comparison it belongs to: the
//    chord is on the outline and not cancelled by a sample that was a hair off the zero set.
//  - the condition's truth on the face is the skeleton evaluated on the comparisons' truth there (compareValue, with NaN for
//    undefined; and/or/not as the kernel's: NaN in, NaN out). A face is kept only if that is 1.
// Nothing is guessed. What a leaf holds may not be known well enough to cut it: an edge with an undefined or unbounded stretch that
// was not located (`lost`: not a pole at an end of an edge, which is a corner's own), stops that do not pair, a root on its edge that
// no chord reaches (the contour left it unjoined). The leaf is then cut as well as it can be, and if that keeps nothing it is outside;
// if it keeps something (which might have undefined ground in it) the leaf is left out (counted in `unresolved`), and so is one where
// a sign that two corners or a neighbour contradict, and a leaf the budget stopped halving that is too wide for a chord (`refused`). A
// leaf left out is as good as outside: undefined is outside, and a false fill is the one thing a region may not draw. The loss is a
// leaf, a pixel at FULL: the leaves at the jumps of floor(x) (a leaf that holds a jump is one the contour does not pair either).
// (With a `not` in the condition a face that is false is inside and one that is undefined is not, so a leaf that is in doubt is left out
// whatever it keeps.)
//
// COST. Everything is counted on the caller's counter. A leaf costs one twin evaluation of each comparison's H over it, which says
// whether the comparison can change inside the leaf (it is constant where the enclosure excludes zero and the twin vouches that it
// is defined) and is the verdict the contouring of that comparison needs; the leaves a comparison may change in are contoured with
// it; and a leaf costs a scalar evaluation for a face none of its corners or neighbours can speak for.
import { sub } from '../../math/expr'
import { compileScalar } from '../../math/compile'
import { type CompiledInterval, compileInterval, CONTINUOUS, DEFINED, type Iv, iv } from '../../math/interval'
import { andValue, compareValue, type ComparisonOp, comparisonOp, notValue, orValue } from '../../math/reserved'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Bounds, Vec2 } from '../../scene/types'
import type { EvalCounter, PxScale } from '../sample/types'
import { type ContourFns, type Corner, contourLeaves, Crossings, newStats } from './contour'
import type { EdgePool } from './outline'
import { inView } from './statement'
import { CONTOUR, STATEMENT } from './tuning'
import type { Box, Cell, CellClass, Leaf } from './types'

// ---------------------------------------------------------------------------------------------------------------
// The condition
// ---------------------------------------------------------------------------------------------------------------

// One comparison of a condition: it holds where `h op 0`, h = a - b of the comparison `a op b`.
export interface Comparison {
  h: Expr
  op: ComparisonOp
}

export type Tree = { kind: 'cmp'; k: number } | { kind: 'and' | 'or'; a: Tree; b: Tree } | { kind: 'not'; a: Tree }

export interface Condition {
  tree: Tree
  comparisons: Comparison[]
  // for each comparison, whether it is under an odd number of `not`s: then the zero set belongs to the condition where the
  // comparison's operator does not include it (`not x < 1` is `x >= 1`: its boundary is solid), so a boundary is dashed when
  // its operator is strict and the comparison is not negated, or inclusive and negated
  negated: boolean[]
}

// The skeleton of a condition and its comparisons (depth first, left to right: the order sampleRegion expects of its `comparisons`).
export function analyseCondition(condition: Expr): Condition {
  const comparisons: Comparison[] = []
  const negated: boolean[] = []
  const walk = (e: Expr, neg: boolean): Tree => {
    if (e.kind === 'call') {
      const op = comparisonOp(e.name)
      if (op && e.args.length === 2) {
        comparisons.push({ h: sub(e.args[0], e.args[1]), op })
        negated.push(neg)
        return { kind: 'cmp', k: comparisons.length - 1 }
      }
      if ((e.name === '__and' || e.name === '__or') && e.args.length === 2) {
        const a = walk(e.args[0], neg)
        const b = walk(e.args[1], neg)
        return { kind: e.name === '__and' ? 'and' : 'or', a, b }
      }
      if (e.name === '__not' && e.args.length === 1) return { kind: 'not', a: walk(e.args[0], !neg) }
    }
    // a truth value in its own right: nonzero is true
    comparisons.push({ h: e, op: '!=' })
    negated.push(neg)
    return { kind: 'cmp', k: comparisons.length - 1 }
  }
  const tree = walk(condition, false)
  return { tree, comparisons, negated }
}

export function comparisonsOf(condition: Expr): Comparison[] {
  return analyseCondition(condition).comparisons
}

// The condition's truth (1, 0, or NaN where it is undefined) from the truth of each comparison.
export function truthOf(tree: Tree, t: ArrayLike<number>): number {
  switch (tree.kind) {
    case 'cmp':
      return t[tree.k]
    case 'and':
      return andValue(truthOf(tree.a, t), truthOf(tree.b, t))
    case 'or':
      return orValue(truthOf(tree.a, t), truthOf(tree.b, t))
    case 'not':
      return notValue(truthOf(tree.a, t))
  }
}

// One scratch for every classifier: an enclosure is read at once, and twin evaluations do not overlap (the twin's contract).
const SCRATCH: Iv = iv()

// The classifier of a region (quadtree.ts): the twin of the whole condition, called with both boxes, once for a cell and nothing
// else. It does not touch a counter: subdivide counts one evaluation for each call and estimates every level from that.
//  - drop: the condition is proven false (a truth interval of [0, 0]: whatever may be undefined in the box is outside too), or
//    undefined at every point (empty);
//  - keep-whole: it is proven true ([1, 1], or any interval that excludes zero) with no point of the box undefined (DEFINED or
//    CONTINUOUS: a PARTIAL or UNKNOWN verdict may be a NaN, which is not inside);
//  - split: anything else. The verdict is written on the cell, so a leaf says whether the condition may be undefined in it.
export function conditionClassifier(twin: CompiledInterval, out: Iv = SCRATCH): (cell: Cell) => CellClass {
  return (cell) => {
    twin(out, cell.x0, cell.x1, cell.y0, cell.y1)
    cell.verdict = out.v
    if (out.lo > out.hi) return 'drop'
    if (out.lo === 0 && out.hi === 0) return 'drop'
    if ((out.lo > 0 || out.hi < 0) && out.v >= DEFINED) return 'keep-whole'
    return 'split'
  }
}

// The scalar and the twin of each comparison's H, the way contour.ts takes them (no gradient: a region's leaves are cut by their
// chords, and a crossing node of its boundary is drawn from the corners' saddle).
export function compileComparisons(comparisons: readonly Comparison[], scope: MathScope): ContourFns[] {
  return comparisons.map((c) => ({ H: compileScalar(c.h, ['x', 'y'], scope), Hi: compileInterval(c.h, ['x', 'y'], scope), grad: null, hess: null }))
}

// ---------------------------------------------------------------------------------------------------------------
// Finding the leaf a point is in
// ---------------------------------------------------------------------------------------------------------------

// The leaves of a quadtree are a grid of one size (a leaf the doubles could not halve may be smaller): a point is looked up in the
// bucket of the cell it falls in and its neighbours. A point on a shared edge is in every leaf that has it.
export class LeafGrid {
  private readonly leaves: readonly Leaf[]
  private readonly w: number
  private readonly h: number
  private readonly x0: number
  private readonly y0: number
  private readonly buckets = new Map<string, number[]>()

  constructor(leaves: readonly Leaf[]) {
    this.leaves = leaves
    let w = 0
    let h = 0
    let x0 = Infinity
    let y0 = Infinity
    for (const l of leaves) {
      w = Math.max(w, l.x1 - l.x0)
      h = Math.max(h, l.y1 - l.y0)
      x0 = Math.min(x0, l.x0)
      y0 = Math.min(y0, l.y0)
    }
    this.w = w > 0 ? w : 1
    this.h = h > 0 ? h : 1
    this.x0 = x0
    this.y0 = y0
    leaves.forEach((l, i) => {
      const key = `${this.col((l.x0 + l.x1) / 2)},${this.row((l.y0 + l.y1) / 2)}`
      const list = this.buckets.get(key)
      if (list) list.push(i)
      else this.buckets.set(key, [i])
    })
  }

  private col(x: number): number {
    return Math.floor((x - this.x0) / this.w)
  }

  private row(y: number): number {
    return Math.floor((y - this.y0) / this.h)
  }

  // The indices of the leaves whose closed box holds the point.
  at(x: number, y: number): number[] {
    const out: number[] = []
    const c = this.col(x)
    const r = this.row(y)
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const i of this.buckets.get(`${c + di},${r + dj}`) ?? []) {
          const l = this.leaves[i]
          if (x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1) out.push(i)
        }
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cutting the leaves
// ---------------------------------------------------------------------------------------------------------------

export interface ClipInput {
  // the leaves to cut, in the order they are cut: the picture first, so that a spend that runs out leaves the overscan and not the view
  leaves: readonly Leaf[]
  comparisons: readonly Comparison[]
  tree: Tree
  fns: readonly ContourFns[]
  px: PxScale
  // the root of the quadtree
  clip: Box
  // the picture
  view: Bounds
  counter: EvalCounter
  // the most the counter may read when this stage stops (absolute: the statement's budget)
  limit: { points: number; intervals: number }
  pool: EdgePool
  // the widest a leaf the budget stopped halving may be and still be cut (default CONTOUR.maxBudgetLeafPx); a region passes its own
  maxBudgetLeafPx?: number
}

export interface ClipStats {
  // the leaves cut (looked at and decided), and how many of them kept something
  leaves: number
  kept: number
  faces: number
  // leaves left out because what they hold could not be cut (see the header), and why
  unresolved: number
  lostEdges: number
  unpairedStops: number
  uncoveredRoots: number
  contradictions: number
  // leaves the quadtree left too coarse to cut (the budget stopped it; wider than the caller's maxBudgetLeafPx)
  refused: number
  // faces whose sign was read at a point inside them
  sampled: number
  // the spend ran out: the leaves not reached are not in the outline
  capped: boolean
  // a leaf of the picture was left out for want of spend or because it was too coarse: the picture may be missing a piece there
  starvedInView: boolean
  // a leaf that kept something is in the picture
  keptInView: boolean
  // the contourings' own counts, one for each comparison that was contoured
  contours: { corners: number; definedCorners: number; crossings: number; poles: number; undefinedLeaves: number }[]
}

function newClipStats(): ClipStats {
  return { leaves: 0, kept: 0, faces: 0, unresolved: 0, lostEdges: 0, unpairedStops: 0, uncoveredRoots: 0, contradictions: 0, refused: 0, sampled: 0, capped: false, starvedInView: false, keptInView: false, contours: [] }
}

export interface Piece {
  a: Vec2
  b: Vec2
  k: number
}

// What the leaves are, before any is cut: which of them are worked on, what each comparison can do inside each, and the contour of each
// comparison over the leaves it can change in, as the pieces that lie in each leaf. (The `if` clause of an implicit curve reads the
// same, for the leaves its curve passes through: implicit.ts.)
export interface LeafAnalysis {
  stats: ClipStats
  // the leaves worked on, as indices into the input; everything below is by position in this list
  todo: number[]
  relevant: Uint8Array[]
  verdict: Uint8Array[]
  constant: Float64Array[]
  crs: (Crossings | null)[]
  // leaves the contouring did not reach (its budget ran out)
  unprocessed: Uint8Array
  // the pieces of the zero sets in each leaf: chords across it (k >= 0, the comparison) and pieces along its edges (k = -1 - comparison)
  pieces: Piece[][]
}

export function analyseLeaves(inp: Omit<ClipInput, 'pool'>, pool: EdgePool | null): LeafAnalysis {
  const { leaves, comparisons, fns, px, clip, view, counter, limit } = inp
  const maxWide = inp.maxBudgetLeafPx ?? CONTOUR.maxBudgetLeafPx
  const m = comparisons.length
  const stats = newClipStats()

  // which leaves are cut: not the ones the budget stopped halving that are too wide for a chord, and not more than the twin budget buys
  const wide = (l: Leaf) => l.stop === 'budget' && ((l.x1 - l.x0) * px.x > maxWide || (l.y1 - l.y0) * px.y > maxWide)
  // (a leaf costs the twin of each comparison over it and, later, what its contouring spends: STATEMENT.intervalsPerLeaf, so the twin
  // of the leaves is not bought with what their contour needs)
  const afford = m === 0 ? leaves.length : Math.max(0, Math.floor((limit.intervals - counter.intervals) / (m + STATEMENT.intervalsPerLeaf)))
  const todo: number[] = []
  for (let i = 0; i < leaves.length; i++) {
    if (wide(leaves[i])) {
      stats.refused++
      stats.capped = true
      if (inView(leaves[i], view)) stats.starvedInView = true
    } else if (todo.length >= afford) {
      stats.capped = true
      if (inView(leaves[i], view)) stats.starvedInView = true
    } else todo.push(i)
  }
  const n = todo.length

  // --- the twin of each comparison over each leaf: what can change inside it
  // relevant: the enclosure holds zero or the twin cannot say H is defined (a pole, a domain edge, an integral); else H has the one sign
  const relevant: Uint8Array[] = comparisons.map(() => new Uint8Array(n))
  const verdict: Uint8Array[] = comparisons.map(() => new Uint8Array(n))
  const constant: Float64Array[] = comparisons.map(() => new Float64Array(n))
  const scratch = iv()
  for (let p = 0; p < n; p++) {
    const l = leaves[todo[p]]
    for (let k = 0; k < m; k++) {
      counter.intervals++
      fns[k].Hi(scratch, l.x0, l.x1, l.y0, l.y1)
      verdict[k][p] = scratch.v
      if (scratch.lo > scratch.hi) {
        // empty: undefined at every point of the leaf
        constant[k][p] = Number.NaN
      } else if ((scratch.lo > 0 || scratch.hi < 0) && scratch.v >= DEFINED) {
        constant[k][p] = scratch.lo > 0 ? 1 : -1
      } else relevant[k][p] = 1
    }
  }

  // --- the contour of each comparison over the leaves it can change in
  const crs: (Crossings | null)[] = comparisons.map(() => null)
  const unprocessed = new Uint8Array(n)
  const grid = new LeafGrid(todo.map((i) => leaves[i]))
  const pieces: Piece[][] = Array.from({ length: n }, () => [])
  // the roots and ends of pieces of comparison k that a chord of k (or a zero edge) reaches, by leaf position
  for (let k = 0; k < m; k++) {
    const pos: number[] = []
    const mine: Leaf[] = []
    for (let p = 0; p < n; p++) {
      if (!relevant[k][p]) continue
      pos.push(p)
      mine.push({ ...leaves[todo[p]], verdict: verdict[k][p] as Leaf['verdict'] })
    }
    if (mine.length === 0) continue
    // (the contour is not given the last of the budget: cutting the leaves it reached costs points of its own)
    const budget = { points: (limit.points - counter.points) * (1 - STATEMENT.reserve), intervals: (limit.intervals - counter.intervals) * (1 - STATEMENT.reserve) }
    if (budget.points <= 0 || budget.intervals <= 0) {
      stats.capped = true
      for (const p of pos) unprocessed[p] = 1
      continue
    }
    const cr = new Crossings(fns[k], px, counter, newStats())
    crs[k] = cr
    const res = contourLeaves(mine, fns[k], { px, clip }, counter, budget, cr)
    stats.contours.push({ corners: cr.stats.corners, definedCorners: cr.stats.definedCorners, crossings: cr.stats.crossings, poles: cr.stats.poles, undefinedLeaves: cr.stats.undefinedLeaves })
    if (res.capped) {
      stats.capped = true
      // the contour takes the leaves in order and stops at the first it cannot pay for
      for (let j = cr.stats.leaves; j < pos.length; j++) unprocessed[pos[j]] = 1
    }
    for (const s of res.segments) {
      const mx = (s.a.x + s.b.x) / 2
      const my = (s.a.y + s.b.y) / 2
      for (const q of grid.at(mx, my)) {
        const l = leaves[todo[q]]
        const along = (s.a.x === s.b.x && (s.a.x === l.x0 || s.a.x === l.x1)) || (s.a.y === s.b.y && (s.a.y === l.y0 || s.a.y === l.y1))
        if (along) {
          // a piece along an edge of the leaf is the zero set itself there (the axis of y >= 0 on a grid line): not a chord across the leaf
          pool?.zero(s.a, s.b, k)
          pieces[q].push({ a: s.a, b: s.b, k: -1 - k })
        } else pieces[q].push({ a: s.a, b: s.b, k })
      }
    }
  }
  return { stats, todo, relevant, verdict, constant, crs, unprocessed, pieces }
}

export function clipLeaves(inp: ClipInput): ClipStats {
  const { leaves, comparisons, tree, fns, view, counter, limit, pool } = inp
  const analysis = analyseLeaves(inp, pool)
  const { stats, todo, relevant, verdict, constant, crs, unprocessed, pieces } = analysis
  const n = todo.length
  const negated = hasNot(tree)
  // cutting a leaf costs points (a face's sign read at a point inside it) and no twin evaluation: the edges it reads are the contour's
  const over = () => counter.points >= limit.points

  // --- the leaves
  for (let p = 0; p < n; p++) {
    const l = leaves[todo[p]]
    if (unprocessed[p]) {
      if (inView(l, view)) stats.starvedInView = true
      continue
    }
    if (over()) {
      stats.capped = true
      for (let q = p; q < n; q++) if (inView(leaves[todo[q]], view)) stats.starvedInView = true
      break
    }
    stats.leaves++
    const faces = cutLeaf(p, l, { comparisons, tree, fns, crs, relevant, verdict, constant, pieces: pieces[p], counter, stats, hasNot: negated })
    if (faces === null) {
      stats.unresolved++
      continue
    }
    if (faces.length > 0) {
      stats.kept++
      if (inView(l, view)) stats.keptInView = true
    }
    for (const f of faces) {
      stats.faces++
      for (let i = 0; i < f.pts.length; i++) pool.add(f.pts[i], f.pts[(i + 1) % f.pts.length], f.cmps[i])
    }
  }
  return stats
}

// A kept piece of a leaf: its vertices counter-clockwise, and for the edge from vertex i to i + 1 the comparisons whose zero set it is a
// chord of (null: an edge of the leaf, or of the domain's edge).
interface Face {
  pts: Vec2[]
  cmps: (readonly number[] | null)[]
}

interface Stage {
  comparisons: readonly Comparison[]
  tree: Tree
  fns: readonly ContourFns[]
  crs: readonly (Crossings | null)[]
  relevant: readonly Uint8Array[]
  verdict: readonly Uint8Array[]
  constant: readonly Float64Array[]
  pieces: readonly Piece[]
  counter: EvalCounter
  stats: ClipStats
  hasNot: boolean
}

function hasNot(t: Tree): boolean {
  switch (t.kind) {
    case 'cmp':
      return false
    case 'not':
      return true
    default:
      return hasNot(t.a) || hasNot(t.b)
  }
}

// A chord of the leaf's graph: from vertex u to v. `owner` is the comparison whose zero set it is (zero) or whose domain edge it is.
interface Chord {
  u: number
  v: number
  k: number
  domain: boolean
}

const UNKNOWN_SIGN = 2

// Where segment a-b and segment c-d cross, as the parameter along each, if they cross properly (inside both).
export function crossAt(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (den === 0) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return t > 0 && t < 1 && u > 0 && u < 1 ? { t, u } : null
}

function signedArea(p: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

function insidePolygon(c: Vec2, p: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > c.y !== p[j].y > c.y && c.x < ((p[j].x - p[i].x) * (c.y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside
  }
  return inside
}

// A point inside a face: the centroid if it is, else the centre of an ear (a convex corner whose triangle holds no other vertex).
function interiorPoint(poly: readonly Vec2[]): Vec2 {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const cr = p.x * q.y - q.x * p.y
    a += cr
    cx += (p.x + q.x) * cr
    cy += (p.y + q.y) * cr
  }
  if (a !== 0) {
    const c = { x: cx / (3 * a), y: cy / (3 * a) }
    if (insidePolygon(c, poly)) return c
  }
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n]
    const q = poly[i]
    const r = poly[(i + 1) % n]
    if ((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) <= 0) continue
    const c = { x: (p.x + q.x + r.x) / 3, y: (p.y + q.y + r.y) / 3 }
    if (insidePolygon(c, poly)) return c
  }
  return { x: poly.reduce((s, v) => s + v.x, 0) / n, y: poly.reduce((s, v) => s + v.y, 0) / n }
}

const MAX_CHORDS = 16

// One leaf, cut: its inside faces, or null if what it holds cannot be cut.
function cutLeaf(p: number, leaf: Leaf, st: Stage): Face[] | null {
  const { comparisons, tree, fns, crs, counter, stats } = st
  const m = comparisons.length
  const { x0, x1, y0, y1 } = leaf
  const relK: number[] = []
  for (let k = 0; k < m; k++) if (st.relevant[k][p]) relK.push(k)
  // Something about the leaf is not known: an edge with an undefined or unbounded stretch that was not located, stops that do not pair, a
  // root no chord reaches. The leaf is cut as well as it can be; if that keeps anything the leaf is left out (what is kept might have
  // undefined ground in it), and if it keeps nothing it is outside, unless the condition has a `not` (a face that is false is inside it,
  // and one that is undefined is not, and which this leaf's is, is the thing not known).
  let doubt = false

  // --- vertices: the corners are 0 to 3, counter-clockwise from (x0, y0)
  const ids = new Map<string, number>()
  const vp: Vec2[] = []
  const vertex = (q: Vec2): number => {
    const key = `${q.x},${q.y}`
    let id = ids.get(key)
    if (id === undefined) {
      id = vp.length
      ids.set(key, id)
      vp.push({ x: q.x, y: q.y })
    }
    return id
  }
  vertex({ x: x0, y: y0 })
  vertex({ x: x1, y: y0 })
  vertex({ x: x1, y: y1 })
  vertex({ x: x0, y: y1 })

  // which edge of the leaf (0 bottom, 1 right, 2 top, 3 left) a vertex is strictly inside, or -1
  const edgeOf = (q: Vec2): number => {
    if (q.y === y0 && q.x > x0 && q.x < x1) return 0
    if (q.x === x1 && q.y > y0 && q.y < y1) return 1
    if (q.y === y1 && q.x > x0 && q.x < x1) return 2
    if (q.x === x0 && q.y > y0 && q.y < y1) return 3
    return -1
  }
  const onEdges: number[][] = [[], [], [], []]
  const note = (q: Vec2): number => {
    const id = vertex(q)
    const e = edgeOf(q)
    if (e >= 0 && !onEdges[e].includes(id)) onEdges[e].push(id)
    return id
  }

  // --- what each relevant comparison holds on the leaf's edges: roots and stops
  const cornersK: Corner[][] = []
  const stopsK: Vec2[][] = []
  const rootsK: Vec2[][] = []
  for (const k of relK) {
    const cr = crs[k] as Crossings
    const c = [cr.corner(x0, y0), cr.corner(x1, y0), cr.corner(x1, y1), cr.corner(x0, y1)]
    cornersK[k] = c
    stopsK[k] = []
    rootsK[k] = []
    const continuous = st.verdict[k][p] === CONTINUOUS
    for (let e = 0; e < 4; e++) {
      const info = cr.edge(c[e], c[(e + 1) % 4], continuous)
      if (info.lost) {
        stats.lostEdges++
        doubt = true
      }
      const horizontal = e === 0 || e === 2
      const fixed = e === 0 ? y0 : e === 1 ? x1 : e === 2 ? y1 : x0
      for (const r of info.roots) {
        rootsK[k].push(r)
        note(r)
      }
      for (const t of info.stops) {
        const q = horizontal ? { x: t, y: fixed } : { x: fixed, y: t }
        stopsK[k].push(q)
        note(q)
      }
    }
  }

  // --- the chords: the pieces the contouring drew in this leaf, and the domain's edge between a comparison's two stops
  const chords: Chord[] = []
  const reached: Set<string>[] = comparisons.map(() => new Set<string>())
  for (const pc of st.pieces) {
    if (pc.k < 0) {
      // along an edge of the leaf: the zero set there; its ends are reached
      const k = -1 - pc.k
      reached[k].add(`${pc.a.x},${pc.a.y}`)
      reached[k].add(`${pc.b.x},${pc.b.y}`)
      continue
    }
    const u = note(pc.a)
    const v = note(pc.b)
    if (u === v) continue
    reached[pc.k].add(`${pc.a.x},${pc.a.y}`)
    reached[pc.k].add(`${pc.b.x},${pc.b.y}`)
    chords.push({ u, v, k: pc.k, domain: false })
  }
  for (const k of relK) {
    if (stopsK[k].length === 0) continue
    if (stopsK[k].length !== 2) {
      stats.unpairedStops++
      doubt = true
      continue
    }
    const u = vertex(stopsK[k][0])
    const v = vertex(stopsK[k][1])
    if (u !== v) chords.push({ u, v, k, domain: true })
  }
  // a root on an edge of the leaf that no chord of its comparison reaches is a crossing the contour left unjoined (a root at a corner of
  // the leaf is not: a curve that touches the leaf at its corner and no more has no chord)
  for (const k of relK) {
    for (const r of rootsK[k]) {
      if (!reached[k].has(`${r.x},${r.y}`) && vertex(r) > 3) {
        stats.uncoveredRoots++
        doubt = true
      }
    }
  }
  if (chords.length > MAX_CHORDS) return null

  // --- chords that cross are cut where they do
  const cuts: { t: number; id: number }[][] = chords.map(() => [])
  for (let i = 0; i < chords.length; i++) {
    for (let j = i + 1; j < chords.length; j++) {
      const a = chords[i]
      const b = chords[j]
      if (a.k === b.k && a.domain === b.domain) continue
      const hit = crossAt(vp[a.u], vp[a.v], vp[b.u], vp[b.v])
      if (!hit) continue
      const q = { x: vp[a.u].x + hit.t * (vp[a.v].x - vp[a.u].x), y: vp[a.u].y + hit.t * (vp[a.v].y - vp[a.u].y) }
      const id = vertex(q)
      cuts[i].push({ t: hit.t, id })
      cuts[j].push({ t: hit.u, id })
    }
  }

  // --- the graph: the leaf's boundary and the chords, each edge once
  interface GEdge {
    u: number
    v: number
    ks: number[] | null
    domain: number
  }
  const gedges: GEdge[] = []
  const gkey = new Map<string, number>()
  const addEdge = (u: number, v: number, k: number, domain: boolean): void => {
    if (u === v) return
    const key = u < v ? `${u}:${v}` : `${v}:${u}`
    const at = gkey.get(key)
    if (at !== undefined) {
      const e = gedges[at]
      if (k >= 0 && !domain && !(e.ks ?? []).includes(k)) e.ks = [...(e.ks ?? []), k]
      if (k >= 0 && domain) e.domain = k
      return
    }
    gkey.set(key, gedges.length)
    gedges.push({ u, v, ks: k >= 0 && !domain ? [k] : null, domain: k >= 0 && domain ? k : -1 })
  }
  // the boundary, counter-clockwise: corner, the vertices on the edge in order along it, next corner
  for (let e = 0; e < 4; e++) {
    const along = (id: number): number => {
      const q = vp[id]
      return e === 0 ? q.x - x0 : e === 1 ? q.y - y0 : e === 2 ? x1 - q.x : y1 - q.y
    }
    const inner = [...onEdges[e]].sort((a, b) => along(a) - along(b))
    const seq = [e, ...inner, (e + 1) % 4]
    for (let i = 0; i + 1 < seq.length; i++) addEdge(seq[i], seq[i + 1], -1, false)
  }
  chords.forEach((c, i) => {
    const seq = [c.u, ...cuts[i].sort((a, b) => a.t - b.t).map((q) => q.id), c.v]
    for (let j = 0; j + 1 < seq.length; j++) addEdge(seq[j], seq[j + 1], c.k, c.domain)
  })

  // --- the faces: half-edge 2e runs u to v of edge e, 2e + 1 back. The next half-edge of a face (kept on the left) is the first one
  // clockwise from the way back at the vertex it arrives at.
  const nh = gedges.length * 2
  const from = (h: number): number => (h & 1 ? gedges[h >> 1].v : gedges[h >> 1].u)
  const to = (h: number): number => (h & 1 ? gedges[h >> 1].u : gedges[h >> 1].v)
  const out: number[][] = vp.map(() => [])
  for (let h = 0; h < nh; h++) out[from(h)].push(h)
  const slot = new Int32Array(nh)
  for (const list of out) {
    list.sort((a, b) => Math.atan2(vp[to(a)].y - vp[from(a)].y, vp[to(a)].x - vp[from(a)].x) - Math.atan2(vp[to(b)].y - vp[from(b)].y, vp[to(b)].x - vp[from(b)].x))
    list.forEach((h, i) => {
      slot[h] = i
    })
  }
  const next = (h: number): number => {
    const list = out[to(h)]
    return list[(slot[h ^ 1] + list.length - 1) % list.length]
  }
  const faceOf = new Int32Array(nh).fill(-1)
  const loops: number[][] = []
  for (let h0 = 0; h0 < nh; h0++) {
    if (faceOf[h0] >= 0) continue
    const loop: number[] = []
    let h = h0
    do {
      faceOf[h] = -2
      loop.push(h)
      h = next(h)
    } while (h !== h0 && loop.length <= nh)
    if (h !== h0) return null
    // a loop of positive area is a face; the one of negative area is the outside of the leaf
    const area = signedArea(loop.map((q) => vp[from(q)]))
    for (const q of loop) faceOf[q] = area > 0 ? loops.length : -3
    if (area > 0) loops.push(loop)
  }
  const nf = loops.length
  if (nf === 0) return null

  // --- the sign of each comparison's H on each face
  const sign: number[][] = comparisons.map(() => new Array<number>(nf).fill(UNKNOWN_SIGN))
  for (let k = 0; k < m; k++) if (!st.relevant[k][p]) sign[k].fill(st.constant[k][p])
  const faceVerts = loops.map((loop) => loop.map((h) => from(h)))
  for (const k of relK) {
    // a corner that is itself a stop of k (the domain edge of sqrt x at x = 0, which is a corner of the leaf left of it) is on the cut,
    // not on a side of it: it says nothing of the face
    const cut = new Set(stopsK[k].map(vertex))
    for (let f = 0; f < nf; f++) {
      for (const id of faceVerts[f]) {
        if (id > 3 || cut.has(id)) continue
        const v = cornersK[k][id].v
        // an infinity at a corner is a pole's signed zero (1/x at x = 0): it does not say which side of the pole the face is
        const e = v !== v ? Number.NaN : v === 0 || !Number.isFinite(v) ? UNKNOWN_SIGN : v > 0 ? 1 : -1
        if (e === UNKNOWN_SIGN) continue
        const cur = sign[k][f]
        if (cur === UNKNOWN_SIGN) sign[k][f] = e
        else if (!(cur === e || (cur !== cur && e !== e))) {
          stats.contradictions++
          return null
        }
      }
    }
    // across a chord: a zero chord of k flips the sign, the domain's edge of k stops it, any other chord keeps it
    for (let pass = 0; pass <= nf; pass++) {
      let changed = false
      for (let e = 0; e < gedges.length; e++) {
        const g = gedges[e]
        if (g.ks === null && g.domain < 0) continue
        if (g.domain === k) continue
        const fa = faceOf[2 * e]
        const fb = faceOf[2 * e + 1]
        if (fa < 0 || fb < 0 || fa === fb) continue
        const flip = (g.ks ?? []).includes(k)
        const sa = sign[k][fa]
        const sb = sign[k][fb]
        if (sa !== UNKNOWN_SIGN && sb === UNKNOWN_SIGN) {
          sign[k][fb] = flip ? -sa : sa
          changed = true
        } else if (sb !== UNKNOWN_SIGN && sa === UNKNOWN_SIGN) {
          sign[k][fa] = flip ? -sb : sb
          changed = true
        } else if (sa !== UNKNOWN_SIGN && sb !== UNKNOWN_SIGN && sa === sa && sb === sb && flip !== (sa !== sb)) {
          // a zero chord has H of one sign on one side and the other on the other: the corners and the contour disagree
          stats.contradictions++
          return null
        }
      }
      if (!changed) break
    }
    // what no corner and no neighbour spoke for is read at a point inside the face
    for (let f = 0; f < nf; f++) {
      if (sign[k][f] !== UNKNOWN_SIGN) continue
      const c = interiorPoint(faceVerts[f].map((id) => vp[id]))
      counter.points++
      stats.sampled++
      const v = fns[k].H(c.x, c.y)
      sign[k][f] = v !== v ? Number.NaN : v === 0 ? 0 : v > 0 ? 1 : -1
    }
  }

  // --- the faces that are inside
  const t = new Float64Array(m)
  const faces: Face[] = []
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < m; k++) t[k] = compareValue(comparisons[k].op as ComparisonOp, sign[k][f], 0)
    if (truthOf(tree, t) !== 1) continue
    const pts: Vec2[] = []
    const cmps: (readonly number[] | null)[] = []
    for (const h of loops[f]) {
      pts.push(vp[from(h)])
      cmps.push(gedges[h >> 1].ks)
    }
    faces.push({ pts, cmps })
  }
  if (doubt && (faces.length > 0 || st.hasNot)) return null
  return faces
}
