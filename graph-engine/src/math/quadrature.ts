// Adaptive Gauss-Kronrod 7-15 quadrature, nested for iterated integrals (K4).
// Every result carries `error`, an honest estimate of |value - true value|,
// and `absolute`, the integral of |f|; a display prints only the digits the
// error supports, prefixed "≈". An exact form is never inferred from a float.
//
// The rule that governs everything here: never report a wrong confident
// number. A refusal, or fewer digits, is always acceptable. So:
//
// 1. A panel's error is QUADPACK's qk15 estimate,
//      resasc * min(1, (200 |K - G| / resasc)^1.5),
//    with its rounding floor (50 ulps of resabs), not the raw |K - G|.
// 2. Nested errors propagate honestly: an outer panel's error adds the inner
//    integrals' errors integrated with its own Kronrod weights, never the
//    largest inner error times the range. That part is fixed: splitting the
//    outer panel cannot shrink it, so a level stops refining once the rest
//    is small beside it (1/sqrt(1 - x^2 - y^2): every inner integral ends at
//    float resolution, 1e-8 from its value). So is a panel whose K - G is
//    within what its inner errors can move it: it is resolved to its noise.
// 3. Every level starts from two panels split at the golden section, so no
//    level's nodes fall on another's dyadic nodes (a kink |x - y| on a node
//    fools both rules). A panel's ends are sampled too (one float inside a
//    range's limits, and every split point): where the value there leaves
//    both the 15-point and the 7-point extrapolations of the panel, beyond
//    their disagreement and the noise, a kink may sit between the end and
//    the first node, where both rules see a straight line (|x - y| with the
//    outer node 0.001 from the inner limit), and the panel keeps that gap
//    times the miss as error.
// 4. The outermost result is computed a second time from one-panel starts,
//    an independently placed partition, at a looser target; the reported
//    error is at least their difference, and their combined errors plus it
//    when they disagree: a bump one partition's nodes step over, the other's
//    may land on. (What no node of either sees, no rule can report.) The
//    pair is tried at QUAD_REL first; one that runs out of evaluations hands
//    on to a looser target (QUAD_COARSE_REL), honest to fewer digits.
// 5. Divergence is found by decay, never by width or exhaustion: halving
//    toward a singular point, the shell each split sheds (its other half)
//    must shrink for an integrable singularity (x^-p: a ratio 2^(p-1) < 1).
//    QUAD_DIVERGE_RUN shells in a row that do not shrink (1/x: ln 2 each;
//    tan to the float pi/2, whose pole is 6e-17 beyond the end, the same) is
//    divergence; "not shrinking" allows for the noise of nodes an ulp from
//    where they belong. A panel narrowed to float resolution is kept, with an
//    error its own size, or on a singular point, the geometric tail of its
//    shells; when they shrink too slowly for that tail to mean anything
//    (x^-0.99, 1/(x ln^2 x)), the integral did not settle ('slow'), which is
//    never divergence.
// 6. Nodes never land on a panel's ends (they are nudged one float inward),
//    so 1/sqrt(1 - x) is never evaluated at 1; one that lands on a pole by
//    coincidence (1/sqrt|x - y|, the inner node at y = x) moves one float
//    toward its panel's centre. An infinity that stays splits the range
//    there, which then is an end of both halves; QUAD_POLE_SPLITS of those at
//    one level is divergence (exp(1/x) is infinite at every node below
//    0.0014), unless the shells shed there were shrinking (x^-0.99 overflows
//    below 1e-310): 'slow'. A NaN whose neighbours agree is a removable point
//    (sin(x)/x at 0) and takes their value, at whichever level the NaN spans
//    (at x = 0, every y).
// 7. A panel on a limit of the range, where a region's edge puts algebraic
//    behaviour (sqrt(1 - x^2)), is also tried with the power rule
//    x = limit + h u^m: m = 2, and the m its lineage's steady shell ratio
//    names (x^(-2/3): 3; (1 - x^2)^(-0.7): 3.33). Its estimate stands when its error, plus how far
//    its view of the panel is from the plain rule's (a bump the plain nodes
//    caught and its own stepped over stays as error), is the smaller.
// 8. Around a singular point inside a panel the shells swing with where it
//    falls; once its lineage has narrowed onto a simple number (0, 0.5), the
//    panel is split there, so each side is a singular end rule 5 judges.
//
// Nested integrals (integrate2, integrate3) fail with a QuadratureError that
// says why and where, per level: 'diverges', 'slow', 'undefined' (NaN in the
// integrand), 'bound' (NaN in a bound, level and side named), 'budget' (the
// evaluations, QUAD_BUDGET for every level, pass and rung of one integral, or
// a level's panels, ran out: "did not settle", never divergence). integrate1
// is guarded only when given a budget.

import {
  QUAD_BUDGET,
  QUAD_CHECK_REL,
  QUAD_COARSE_CHECK_REL,
  QUAD_COARSE_REL,
  QUAD_DECAY,
  QUAD_DIVERGE_NEAR_REL,
  QUAD_ANCHOR_DIGITS,
  QUAD_ANCHOR_STEPS,
  QUAD_DIVERGE_RUN,

  QUAD_FIRST_RUNG_SHARE,
  QUAD_INNER_FRACTION,
  QUAD_INNER_MAX_PANELS,
  QUAD_MAX_PANELS,
  QUAD_NARROW_REL,
  QUAD_NODE_NOISE,
  QUAD_POWER_MAX,
  QUAD_POLE_SPLITS,
  QUAD_REL,
  QUAD_REMOVABLE_REL,
  QUAD_ROUNDING,
  QUAD_REGULAR_BAND,
  QUAD_SLOW_RATIO,
  QUAD_STEADY_REL,
  QUAD_TOL,
  QUAD_UNSETTLED_REL,
} from './tolerance'

export interface QuadResult {
  value: number
  error: number
  // The integral of |f|, the scale a value is small or large against.
  absolute: number
}

export type QuadFailure = 'diverges' | 'slow' | 'undefined' | 'bound' | 'budget'

// Why a nested integral has no value, and where: `at[level]` is the
// coordinate of that level (outer first) where it happened, null where the
// level cannot say, undefined where it never learned.
export class QuadratureError extends Error {
  readonly reason: QuadFailure
  readonly at: (number | null | undefined)[] = []
  // 'bound': the level whose range it is, and which end.
  bound: { level: number; side: 'lower' | 'upper' } | null = null
  constructor(reason: QuadFailure) {
    super(`quadrature: ${reason}`)
    this.name = 'QuadratureError'
    this.reason = reason
  }
}

// An infinity at a node of `level`, at x: that level splits there, or — in
// its first panels, before it has refined anything — leaves it to the level
// outside, whose node it then is (exp(1/x) is infinite at every y).
class Pole {
  readonly level: number
  readonly x: number
  constructor(level: number, x: number) {
    this.level = level
    this.x = x
  }
}

// Evaluations left, shared by every level of one pass.
export interface QuadBudget {
  left: number
}

export function quadBudget(evaluations: number = QUAD_BUDGET): QuadBudget {
  return { left: evaluations }
}

// Kronrod nodes on [-1, 1] (non-negative half, largest first), and the
// Kronrod and Gauss weights (QUADPACK's qk15, each written as the shortest
// decimal of the double nearest QUADPACK's 33-digit value). The Gauss nodes
// are the odd-indexed Kronrod nodes and the centre.
const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945,
  0.5860872354676911, 0.4058451513773972, 0.20778495500789848, 0,
]
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592,
  0.1690047266392679, 0.19035057806478542, 0.20443294007529889, 0.20948214108472782,
]
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694]
// |Kronrod weight - Gauss weight| at each node (a Gauss weight is 0 off the
// Gauss nodes): how far an error at that node can move K - G.
const WDIFF = [...WGK.slice(0, 7).map((w, i) => (i % 2 === 1 ? Math.abs(w - WG[(i - 1) / 2]) : w)), Math.abs(WGK[7] - WG[3])]
// The nodes on [-1, 1] in the order a panel stores its values: -x0, x0,
// -x1, x1, ..., centre; the Gauss nodes among them; and the Lagrange weights
// that extrapolate the 15-point and the 7-point interpolants to t = -1, 1.
const NODES = [...XGK.slice(0, 7).flatMap((x) => [-x, x]), 0]
const GAUSS = [2, 3, 6, 7, 10, 11, 14]
function lagrange(indices: readonly number[], t: number): Float64Array {
  const w = new Float64Array(15)
  for (const k of indices) {
    let l = 1
    for (const j of indices) if (j !== k) l *= (t - NODES[j]) / (NODES[k] - NODES[j])
    w[k] = l
  }
  return w
}
const ALL = NODES.map((_, k) => k)
const EXTRAPOLATE = {
  left: { k15: lagrange(ALL, -1), g7: lagrange(GAUSS, -1) },
  right: { k15: lagrange(ALL, 1), g7: lagrange(GAUSS, 1) },
}
const GOLDEN = (Math.sqrt(5) - 1) / 2
const UNDERFLOW = Number.MIN_VALUE / Number.EPSILON

// The next float from x toward `toward`.
const F64 = new Float64Array(1)
const I64 = new BigInt64Array(F64.buffer)
function nextToward(x: number, toward: number): number {
  if (x === toward || Number.isNaN(x) || Number.isNaN(toward)) return x
  if (x === 0) return toward > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE
  F64[0] = x
  I64[0] += toward > x === x > 0 ? 1n : -1n
  return F64[0]
}

// The spacing of floats at x.
function ulp(x: number): number {
  return Math.abs(nextToward(x, Infinity) - x)
}

// The simplest number in [lo, hi] (fewest significant digits): where a
// singular point narrowed to that panel is said to be (0, not 9.3e-10).
function simplest(lo: number, hi: number): number {
  return simplestWith(lo, hi)[0]
}

// The simplest number in [lo, hi] and how many significant digits it has.
function simplestWith(lo: number, hi: number): [number, number] {
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo <= 0 && hi >= 0) return [0, 0]
  const mid = (lo + hi) / 2
  for (let digits = 1; digits <= 17; digits++) {
    const v = Number(mid.toPrecision(digits))
    if (v >= lo && v <= hi) return [v, digits]
  }
  return [mid, 17]
}

// A lineage of panels halved toward one singular point: the shell the last
// split shed and how many shells in a row have not shrunk; the end the
// carrier kept, and whether every carrier of the lineage kept that same end
// (anchored: a singular end, x^-p at 0 — else the point is inside, |x - c|^-p,
// and the shells swing with where c falls); and the shells measured while wide
// enough for their nodes to be exact: the last two ratios (null: none — a
// lineage begun in rounding noise says nothing about a singularity), and
// the first and latest of them, `steps` halvings apart. Also the last shell
// with its sign, the signed ratios of the last three, and the exponents of
// the power rule (rule 7) that failed to help the lineage on a limit.
interface Chain {
  shell: number
  run: number
  end: number
  anchored: boolean
  ratio: number | null
  prev: number | null
  first: number | null
  latest: number | null
  steps: number
  signed: number
  q: number | null
  prevQ: number | null
  tried: number[]
}

// How fast a lineage's shells shrink, pessimistically: at a singular end,
// the larger of its last two ratios; around an inside point, their mean
// over the lineage (at least 4 halvings). Null where not known.
function decay(chain: Chain | null): number | null {
  if (!chain || chain.ratio === null) return null
  if (chain.anchored) return Math.max(chain.ratio, chain.prev ?? chain.ratio)
  if (chain.first === null || chain.latest === null || chain.steps < 4 || !(chain.first > 0)) return null
  return (chain.latest / chain.first) ** (1 / chain.steps)
}

// What is left of a lineage past its last shell, when its shells shrink by
// r: their geometric tail — three times over around an inside point, whose
// shells swing by up to that with where the point falls.
function tail(chain: Chain, r: number): number {
  const shell = chain.anchored ? chain.shell : 3 * Math.max(chain.shell, chain.latest ?? 0)
  return (shell * r) / (1 - r)
}

interface Panel {
  a: number
  b: number
  value: number
  error: number
  // The part of `error` splitting this panel cannot shrink (rule 2).
  fixed: number
  absolute: number
  // Too narrow to split (float resolution): kept, its error settled.
  frozen: boolean
  // Its rule's values at its nodes, kept for a panel on a limit of the range
  // (rule 7 reads them back).
  nodes: Float64Array | null
  // Set on the half of a split that carries the larger error on.
  chain: Chain | null
  // The integrand at the panel's ends, with the inner error each carries
  // (NaN where not sampled or not finite).
  ends: End
}

interface End {
  fa: number
  ea: number
  fb: number
  eb: number
}

// One level of a pass: its index, its range, the shared budget, how it
// starts, and a channel an inner level fills with its integral's error and
// |f| integral for the node just evaluated.
interface Level {
  index: number
  a: number
  b: number
  budget: QuadBudget
  golden: boolean
  refining: boolean
  poles: number
  channel: { error: number; absolute: number }
}

function newLevel(index: number, a: number, b: number, budget: QuadBudget, golden: boolean): Level {
  return { index, a, b, budget, golden, refining: false, poles: 0, channel: { error: 0, absolute: Number.NaN } }
}

function fail(reason: QuadFailure, index: number, at: number | null): QuadratureError {
  const err = new QuadratureError(reason)
  err.at[index] = at
  return err
}

// Where a level diverges near x: the nearer limit when x is within
// QUAD_DIVERGE_NEAR_REL of the range from it, else x itself.
function divergentAt(x: number, level: Level): number {
  const limit = Math.abs(x - level.a) <= Math.abs(x - level.b) ? level.a : level.b
  return Math.abs(x - limit) <= QUAD_DIVERGE_NEAR_REL * Math.abs(level.b - level.a) ? limit : x
}

// f at a node of a guarded level, with the inner error and |f| integral the
// node carries. NaN — here, or across an inner range (sin(x)/x at x = 0 is
// NaN at every y) — is removable when its neighbours agree, else refused. An
// infinity: a Pole. A failure from an inner level learns this level's
// coordinate on its way out.
function evaluate(f: (x: number) => number, x: number, level: Level, out: Float64Array): void {
  if (--level.budget.left < 0) throw new QuadratureError('budget')
  level.channel.error = 0
  level.channel.absolute = Number.NaN
  let v: number
  try {
    v = f(x)
  } catch (err) {
    if (err instanceof Pole && err.level > level.index) throw new Pole(level.index, x)
    if (!(err instanceof QuadratureError) || err.at[level.index] !== undefined) throw err
    if (err.reason !== 'undefined') {
      if (err.reason === 'bound') err.at[level.index] = x
      else if (err.reason === 'diverges' || err.reason === 'slow') {
        // An inner level that located it owns the place; else this one does.
        const inner = err.at.some((p, i) => i > level.index && typeof p === 'number')
        err.at[level.index] = inner ? null : divergentAt(x, level)
      }
      throw err
    }
    v = removable(f, x, level, err)
  }
  if (Number.isNaN(v)) v = removable(f, x, level, null)
  if (!Number.isFinite(v)) throw new Pole(level.index, x)
  out[0] = v
  out[1] = level.channel.error
  out[2] = Number.isNaN(level.channel.absolute) ? Math.abs(v) : level.channel.absolute
}

// A NaN at x whose two neighbours (1e-7 of the range either side) are finite
// and agree to QUAD_REMOVABLE_REL is a removable point: their mean, carrying
// the larger of their inner errors plus half their difference. Otherwise the
// NaN is refused here: `cause`, an inner level's refusal, or a new one.
function removable(f: (x: number) => number, x: number, level: Level, cause: QuadratureError | null): number {
  const d = 1e-7 * Math.max(Math.abs(level.b - level.a), Math.abs(x))
  const side = (p: number): [number, number, number] | null => {
    level.channel.error = 0
    level.channel.absolute = Number.NaN
    try {
      const v = f(p)
      return [v, level.channel.error, Number.isNaN(level.channel.absolute) ? Math.abs(v) : level.channel.absolute]
    } catch (err) {
      if (err instanceof QuadratureError && err.reason === 'budget') throw err
      return null
    }
  }
  const [l, r] = [side(x - d), side(x + d)]
  const agree = (p: number, q: number) => Math.abs(p - q) <= QUAD_REMOVABLE_REL * Math.max(Math.abs(p), Math.abs(q), Number.MIN_VALUE)
  if (l && r && Number.isFinite(l[0]) && Number.isFinite(r[0]) && agree(l[0], r[0])) {
    level.channel.error = Math.max(l[1], r[1]) + Math.abs(l[0] - r[0]) / 2
    level.channel.absolute = (l[2] + r[2]) / 2
    return (l[0] + r[0]) / 2
  }
  if (cause) {
    cause.at[level.index] = x
    throw cause
  }
  throw fail('undefined', level.index, x)
}

// f at a panel's end, for its check (rule 3): [value, inner error], the
// value NaN where f is not finite there or has no value (a bound that is
// not a number one float inside its limit); never a refusal but 'budget'.
function sample(f: (x: number) => number, x: number, level: Level | null): [number, number] {
  if (!level) {
    const v = f(x)
    return [Number.isFinite(v) ? v : Number.NaN, 0]
  }
  if (--level.budget.left < 0) throw new QuadratureError('budget')
  level.channel.error = 0
  level.channel.absolute = Number.NaN
  try {
    const v = f(x)
    return Number.isFinite(v) ? [v, level.channel.error] : [Number.NaN, 0]
  } catch (err) {
    if (err instanceof QuadratureError && err.reason === 'budget') throw err
    return [Number.NaN, 0]
  }
}

const NODE = new Float64Array(3)

// Scratch arrays for the rules, taken and given back in stack order: a rule
// at one level runs every level inside it before it gives its own back.
const SCRATCH: Float64Array[] = []
let scratchTop = 0
function take(): Float64Array {
  return (SCRATCH[scratchTop++] ??= new Float64Array(15))
}

// The qk15 panel on [a, b]: value, qk15 error plus the inner errors under
// the Kronrod weights, and the |f| integral. Nodes stay strictly inside.
function kronrod(f: (x: number) => number, a: number, b: number, level: Level | null, ends: End, keep: boolean): Panel {
  const centre = (a + b) / 2
  const half = (b - a) / 2
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const xs = take()
  try {
    for (let k = 0; k < 15; k++) {
      const x = centre + half * NODES[k]
      xs[k] = x <= lo ? nextToward(lo, hi) : x >= hi ? nextToward(hi, lo) : x
    }
    return rule(f, a, b, xs, null, half, level, ends, keep)
  } finally {
    scratchTop--
  }
}

// The same panel on a limit of the range, with x = limit + (other - limit) u^m
// for u in [0, 1]: algebraic behaviour at the limit, (x - limit)^(k/m) —
// with m = 2, the edge of a disc, sqrt(1 - x^2), or 1/sqrt(1 - x); with m = 3,
// x^(-2/3) — becomes smooth in u. Null where that rule cannot be had (an
// infinity at one of its nodes). Its far end is checked as a plain panel's
// is, in u (f there weighs m (b - a)); at the limit its first node is 2e-5
// of the panel away or nearer, too near to hide a kink worth the name, and
// f there may be singular.
function power(f: (x: number) => number, a: number, b: number, atA: boolean, m: number, level: Level | null, ends: End): Panel | null {
  const limit = atA ? a : b
  const other = atA ? b : a
  const xs = take()
  const jac = take()
  try {
    for (let k = 0; k < 15; k++) {
      const u = (1 + NODES[k]) / 2
      const x = limit + (other - limit) * u ** m
      xs[k] = x === limit ? nextToward(limit, other) : x
      jac[k] = m * (b - a) * u ** (m - 1)
    }
    const [fo, eo] = atA ? [ends.fb, ends.eb] : [ends.fa, ends.ea]
    const inU = { fa: Number.NaN, ea: 0, fb: fo * m * (b - a), eb: eo * Math.abs(m * (b - a)) }
    return { ...rule(f, a, b, xs, jac, 0.5, level, inU, true), ends }
  } catch (err) {
    if (err instanceof Pole || (err instanceof QuadratureError && err.reason !== 'budget')) return null
    throw err
  } finally {
    scratchTop -= 2
  }
}

// Barycentric weights of the 15 nodes on [-1, 1], and the interpolant of a
// rule's node values at t.
const BARY = NODES.map((t, j) => 1 / NODES.reduce((p, s, i) => (i === j ? p : p * (t - s)), 1))
function interpolate(values: Float64Array, t: number): number {
  let num = 0
  let den = 0
  for (let j = 0; j < 15; j++) {
    const d = t - NODES[j]
    if (d === 0) return values[j]
    const w = BARY[j] / d
    num += w * values[j]
    den += w
  }
  return num / den
}

// How far the power rule's view of a panel is from the plain rule's, in
// integral terms: its interpolant, read back at the plain rule's nodes,
// against the values found there, under the Kronrod weights.
function mismatch(plain: Panel, pow: Panel, m: number, atA: boolean): number {
  if (!plain.nodes || !pow.nodes) return Infinity
  const { a, b } = plain
  const [limit, other] = atA ? [a, b] : [b, a]
  const centre = (a + b) / 2
  const half = (b - a) / 2
  let sum = 0
  for (let k = 0; k < 15; k++) {
    const u = ((centre + half * NODES[k] - limit) / (other - limit)) ** (1 / m)
    const f = interpolate(pow.nodes, 2 * u - 1) / (m * (b - a) * u ** (m - 1))
    sum += WGK[k === 14 ? 7 : k >> 1] * Math.abs(plain.nodes[k] - f)
  }
  return sum * Math.abs(half)
}

// The exponent that makes a singular end x^-p smooth, from its lineage's
// steady shell ratio q = 2^(p-1): m = 1 / (1 - p), up to QUAD_POWER_MAX
// (x^(-2/3): 3; (1 - x^2)^(-0.7): 3.33). p is taken as the nearest sixtieth
// (halves, thirds, quarters, fifths, tenths) when the ratio puts it within
// 0.005 of one: an m off by 1e-3 leaves u^0.0003, which the rule sees.
function exponentOf(chain: Chain | null): number | null {
  if (!chain || !chain.anchored || chain.q === null || chain.prevQ === null) return null
  const q = chain.q
  if (!(q > 0.5 + QUAD_REGULAR_BAND && q < 1) || Math.abs(q - chain.prevQ) > QUAD_STEADY_REL * q) return null
  const measured = 1 + Math.log2(q)
  const nice = Math.round(measured * 60) / 60
  const p = Math.abs(nice - measured) <= 0.005 ? nice : measured
  const m = 1 / (1 - p)
  return m <= QUAD_POWER_MAX && Math.abs(m - 2) > 1e-9 ? m : null
}

// A 15-point Kronrod rule: f at the nodes `xs` (times `jac`, the change of
// variable's derivative, when there is one) on a panel `half` wide either
// side of its centre in the rule's variable; qk15's error, the inner errors,
// and — for a plain panel with sampled ends — the ends' check (rule 3).
function rule(
  f: (x: number) => number,
  a: number,
  b: number,
  xs: Float64Array,
  jac: Float64Array | null,
  half: number,
  level: Level | null,
  ends: End | null,
  keep: boolean
): Panel {
  try {
    const values = take()
    const errors = take()
    let innerError = 0
    let innerNoise = 0
    let innerAbs = 0
    const centre = (a + b) / 2
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    for (let k = 0; k < 15; k++) {
      const i = k === 14 ? 7 : k >> 1
      const w = WGK[i]
      const dw = WDIFF[i]
      const j = jac ? jac[k] : 1
      if (level) {
        try {
          evaluate(f, xs[k], level, NODE)
        } catch (err) {
          // A node on a pole by coincidence (1/sqrt|x - y| with the inner node
          // at y = x exactly): one float toward the centre is not on it.
          const x = nextToward(xs[k], centre)
          if (!(err instanceof Pole) || err.level !== level.index || !(x > lo && x < hi)) throw err
          evaluate(f, x, level, NODE)
        }
        values[k] = NODE[0] * j
        errors[k] = NODE[1] * Math.abs(j)
        innerError += w * errors[k]
        innerNoise += dw * errors[k]
        innerAbs += w * NODE[2] * Math.abs(j)
      } else {
        values[k] = f(xs[k]) * j
        innerAbs += w * Math.abs(values[k])
      }
    }
    const fc = values[14]
    let resk = WGK[7] * fc
    let resg = WG[3] * fc
    let resabs = WGK[7] * Math.abs(fc)
    for (let i = 0; i < 7; i++) {
      const sum = values[2 * i] + values[2 * i + 1]
      resk += WGK[i] * sum
      if (i % 2 === 1) resg += WG[(i - 1) / 2] * sum
      resabs += WGK[i] * (Math.abs(values[2 * i]) + Math.abs(values[2 * i + 1]))
    }
    const reskh = resk / 2
    let resasc = WGK[7] * Math.abs(fc - reskh)
    for (let i = 0; i < 7; i++) resasc += WGK[i] * (Math.abs(values[2 * i] - reskh) + Math.abs(values[2 * i + 1] - reskh))
    const width = Math.abs(half)
    resabs *= width
    resasc *= width
    const raw = Math.abs((resk - resg) * half)
    const floor = resabs > UNDERFLOW / (50 * Number.EPSILON) ? 50 * Number.EPSILON * resabs : 0
    // Resolved to its noise: a K - G the inner errors can account for is
    // theirs, and the panel is as good as splitting can make it (rule 2).
    const resolved = innerNoise > 0 && raw <= innerNoise * width
    let error = raw
    if (resolved) error = Math.max(raw, floor)
    else {
      if (resasc !== 0 && error !== 0) error = resasc * Math.min(1, (200 * error / resasc) ** 1.5)
      error = Math.max(floor, error)
    }
    // The ends' check (rule 3). Only a value within the nodes' own scale is a
    // kink's: a singular end (1/sqrt(x) at 1e-323) is the lineage's business.
    let hidden = 0
    if (ends) {
      let scale = 0
      for (let k = 0; k < 15; k++) scale = Math.max(scale, Math.abs(values[k]))
      const gap = width * (1 - XGK[0])
      const miss = (value: number, err: number, weights: { k15: Float64Array; g7: Float64Array }) => {
        if (Number.isNaN(value)) return 0
        let p15 = 0
        let p7 = 0
        let noise = err
        for (let k = 0; k < 15; k++) {
          p15 += weights.k15[k] * values[k]
          p7 += weights.g7[k] * values[k]
          noise += Math.abs(weights.k15[k]) * errors[k]
        }
        if (Math.abs(value) > 2 * scale + noise) return 0
        return Math.max(0, Math.abs(value - p15) - Math.abs(p15 - p7) - noise) * gap
      }
      hidden = miss(ends.fa, ends.ea, EXTRAPOLATE.left) + miss(ends.fb, ends.eb, EXTRAPOLATE.right)
    }
    return {
      a,
      b,
      value: resk * half,
      error: error + hidden + innerError * width,
      fixed: innerError * width + (resolved ? error : 0),
      absolute: innerAbs * width,
      frozen: false,
      nodes: keep ? Float64Array.from(values) : null,
      chain: null,
      ends: ends ?? { fa: Number.NaN, ea: 0, fb: Number.NaN, eb: 0 },
    }
  } finally {
    scratchTop -= 2
  }
}

// Where a level was refining when it stopped: the panel it was splitting,
// when narrow — a limit exactly when the panel ends there.
function locate(pa: number, pb: number, a: number, b: number): number | null {
  if (Math.abs(pb - pa) > QUAD_NARROW_REL * Math.abs(b - a)) return null
  if (pa === a || pa === b) return pa
  if (pb === a || pb === b) return pb
  return simplest(pa, pb)
}

function adapt(f: (x: number) => number, a: number, b: number, tol: number, rel: number, maxPanels: number, level: Level | null): QuadResult {
  let splitting: [number, number] = [a, b]
  // Where a lineage of halvings has narrowed to, for a refusal.
  const pointOf = (pa: number, pb: number) => (level ? divergentAt(simplest(pa, pb), level) : 0)
  // The panels covering [pa, pb]: one, or — where a node is infinite inside
  // it — split there, recursively, up to QUAD_POLE_SPLITS per level. Then it
  // is divergence, or, when the shells shed there were shrinking, 'slow'.
  const cover = (pa: number, pb: number, chain: Chain | null, ends: End): Panel[] => {
    try {
      return [kronrod(f, pa, pb, level, ends, pa === a || pb === b)]
    } catch (err) {
      if (!(err instanceof Pole) || !level || err.level !== level.index) throw err
      if (level.index > 0 && !level.refining) throw err
      const x = err.x
      if (++level.poles > QUAD_POLE_SPLITS || !(x > Math.min(pa, pb) && x < Math.max(pa, pb))) {
        const r = decay(chain)
        const shrinking = r !== null && r < QUAD_DECAY
        throw fail(shrinking ? 'slow' : 'diverges', level.index, divergentAt(x, level))
      }
      // A half with no float inside it (the pole a float from the end) is
      // the lineage's remainder: frozen, its error the lineage's tail.
      const halves = [
        [pa, x, { ...ends, fb: Number.NaN, eb: 0 }],
        [x, pb, { ...ends, fa: Number.NaN, ea: 0 }],
      ] as const
      return halves.flatMap(([p, q, e]) =>
        nextToward(p, q) === q ? [freeze({ a: p, b: q, value: 0, error: 0, fixed: 0, absolute: 0, frozen: false, nodes: null, chain, ends: e }, true)] : cover(p, q, chain, e),
      )
    }
  }
  // A panel on one limit of the range, where the region's edge puts its
  // algebraic behaviour, is also tried with the squared substitution; the
  // estimate with the smaller error stands.
  // Rule 7: a panel on one limit of the range, where the region's edge puts
  // its algebraic behaviour, is also tried with the power rule — m = 2, and
  // the exponent its lineage's ratio names — the estimate with the smaller
  // error standing. `failed` gathers, for the lineage, the tries that did not
  // help, which it does not repeat.
  let failed: number[] = []
  const onLimit = (p: Panel, chain: Chain | null): Panel => {
    const [onA, onB] = [p.a === a, p.b === b]
    if (onA === onB || p.error - p.fixed <= rel * Math.abs(p.value)) return p
    const tried = chain?.tried ?? []
    let best = p
    for (const m of [2, exponentOf(chain)]) {
      if (m === null || tried.includes(m)) continue
      const q = power(f, p.a, p.b, onA, m, level, p.ends)
      // Its error carries how far its view of the panel is from the plain
      // rule's: a bump the plain nodes caught, which the power rule's nodes
      // step over, is kept as error, never dropped.
      const miss = q ? mismatch(p, q, m, onA) : Infinity
      if (q && q.error - q.fixed + miss < best.error - best.fixed) best = { ...q, error: q.error + miss, chain: p.chain, ends: p.ends }
      else failed.push(m)
    }
    return best
  }
  // A panel at float resolution: kept, with an error its own size — or, on a
  // singular point, the geometric tail of its shells when they shrink fast
  // enough to bound it, else 'slow' (rule 5).
  const freeze = (p: Panel, unknown = false): Panel => {
    let error = Math.max(p.error, Math.abs(p.value))
    const r = decay(p.chain)
    if (unknown && r === null && level) throw fail('slow', level.index, pointOf(p.a, p.b))
    if (r !== null && p.chain && level) {
      if (!(r < QUAD_SLOW_RATIO)) throw fail('slow', level.index, pointOf(p.a, p.b))
      error = Math.max(error, tail(p.chain, r))
    }
    return { ...p, frozen: true, error, fixed: error }
  }
  try {
    const cut = a + (b - a) * GOLDEN
    const [fa, ea] = sample(f, nextToward(a, b), level)
    const [fb, eb] = sample(f, nextToward(b, a), level)
    let panels: Panel[]
    if (level?.golden) {
      const [fc, ec] = sample(f, cut, level)
      panels = [...cover(a, cut, null, { fa, ea, fb: fc, eb: ec }), ...cover(cut, b, null, { fa: fc, ea: ec, fb, eb })]
    } else panels = cover(a, b, null, { fa, ea, fb, eb })
    panels = panels.map((p) => onLimit(p, null))
    if (level) level.refining = true
    for (;;) {
      let value = 0
      let magnitude = 0
      let own = 0
      let fixed = 0
      let worst = -1
      let worstOwn = 0
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i]
        value += p.value
        magnitude += Math.abs(p.value)
        fixed += p.fixed
        const e = p.error - p.fixed
        own += e
        if (!p.frozen && e > worstOwn) {
          worst = i
          worstOwn = e
        }
      }
      if (!Number.isFinite(own + fixed)) break
      const target = Math.max(tol, rel * Math.abs(value), QUAD_ROUNDING * magnitude)
      // What splitting cannot shrink sets how far the rest is worth taking.
      if (worst < 0 || own <= Math.max(target - fixed, 0.1 * fixed)) break
      if (panels.length >= maxPanels) {
        if (level && own + fixed > Math.max(tol, QUAD_UNSETTLED_REL * Math.abs(value))) {
          splitting = [panels[worst].a, panels[worst].b]
          throw new QuadratureError('budget')
        }
        break
      }
      const parent = panels[worst]
      const { a: pa, b: pb } = parent
      splitting = [pa, pb]
      const mid = (pa + pb) / 2
      // Float resolution: no float strictly inside one of the halves.
      if (mid === pa || mid === pb || nextToward(pa, pb) === mid || nextToward(mid, pb) === pb) {
        panels[worst] = freeze(parent)
        continue
      }
      const [fm, em] = sample(f, mid, level)
      const { ends } = parent
      failed = []
      const children = [...cover(pa, mid, parent.chain, { ...ends, fb: fm, eb: em }), ...cover(mid, pb, parent.chain, { ...ends, fa: fm, ea: em })].map((p) =>
        onLimit(p, parent.chain),
      )
      if (children.length === 2 && level) {
        // The half with the larger error carries the lineage on; the other
        // is the shell it shed.
        const [left, right] = children
        const [carrier, shell] = left.error - left.fixed >= right.error - right.fixed ? [left, right] : [right, left]
        const size = Math.abs(shell.value)
        const last = parent.chain
        const ratio = !last ? null : last.shell > 0 ? size / last.shell : size > 0 ? Infinity : 0
        // Nodes an ulp from where they belong move a shell h wide by about
        // ulp/h of itself: a change below that is no change (rule 5).
        const noise = (QUAD_NODE_NOISE * ulp(Math.max(Math.abs(pa), Math.abs(pb)))) / Math.abs(shell.b - shell.a)
        const kept = last !== null && ratio !== null && ratio >= Math.min(QUAD_DECAY, 1 - noise)
        const exact = noise < 1e-2
        const end = carrier === left ? pa : pb
        const first = last?.first ?? (exact ? size : null)
        const anchored = !last || (last.anchored && last.end === end)
        const q = last && last.signed !== 0 && exact ? shell.value / last.signed : null
        carrier.chain = {
          shell: size,
          run: kept ? last.run + 1 : 0,
          end,
          anchored,
          ratio: last && !exact ? last.ratio : ratio,
          prev: last && !exact ? last.prev : (last?.ratio ?? null),
          first,
          latest: exact ? size : (last?.latest ?? null),
          steps: last && last.first !== null ? last.steps + (exact ? 1 : 0) : 0,
          signed: shell.value,
          q: q ?? last?.q ?? null,
          prevQ: q !== null ? (last?.q ?? null) : (last?.prevQ ?? null),
          tried: [...(last?.tried ?? []), ...failed],
        }
        if (carrier.chain.run >= QUAD_DIVERGE_RUN) throw fail('diverges', level.index, pointOf(carrier.a, carrier.b))
        // Around a point inside, where the shells swing: once the lineage
        // has narrowed QUAD_ANCHOR_STEPS halvings onto a simple number (0,
        // 0.5), split there, so each side is a singular end the rules above
        // judge steadily (1/x on [-1, 1] from a golden start).
        if (!anchored && carrier.chain.steps >= QUAD_ANCHOR_STEPS) {
          const [point, digits] = simplestWith(carrier.a, carrier.b)
          const [lo, hi] = carrier.a < carrier.b ? [carrier.a, carrier.b] : [carrier.b, carrier.a]
          if (digits <= QUAD_ANCHOR_DIGITS && point > lo && point < hi && nextToward(lo, point) !== point && nextToward(point, hi) !== hi) {
            const [ca, cb] = [carrier.a, carrier.b]
            const i = children.indexOf(carrier)
            children.splice(i, 1, ...cover(ca, point, null, { ...carrier.ends, fb: Number.NaN, eb: 0 }), ...cover(point, cb, null, { ...carrier.ends, fa: Number.NaN, ea: 0 }))
          }
        }
      }
      panels.splice(worst, 1, ...children)
    }
    let value = 0
    let error = 0
    let absolute = 0
    for (const p of panels) {
      value += p.value
      error += p.error
      absolute += p.absolute
    }
    return { value, error, absolute }
  } catch (err) {
    if (err instanceof QuadratureError && err.reason === 'budget' && level && err.at[level.index] === undefined) {
      err.at[level.index] = locate(splitting[0], splitting[1], a, b)
    }
    throw err
  }
}

// The integral of f from a to b, to an absolute error target `tol` (or
// QUAD_REL of its value). With a budget it is guarded as a nested level is;
// without, an integrand that is not finite gives a result that is not.
export function integrate1(f: (x: number) => number, a: number, b: number, tol: number = QUAD_TOL, budget?: QuadBudget): QuadResult {
  if (a === b) return { value: 0, error: 0, absolute: 0 }
  if (!budget) return adapt(f, a, b, tol, QUAD_REL, QUAD_MAX_PANELS, null)
  const level = newLevel(0, a, b, budget, false)
  return settleOuter(() => adapt(f, a, b, tol, QUAD_REL, QUAD_MAX_PANELS, level), level)
}

// A Pole that reached the outermost level from its first panels is its own.
function settleOuter(run: () => QuadResult, outer: Level): QuadResult {
  try {
    return run()
  } catch (err) {
    if (err instanceof Pole) throw fail('diverges', 0, divergentAt(err.x, outer))
    throw err
  }
}

// The target an inner integral is held to, absolutely: its share of the
// outer target (QUAD_REL of its own value also applies).
function innerTolerance(tol: number, a: number, b: number): number {
  return (QUAD_INNER_FRACTION * tol) / Math.max(Math.abs(b - a), 1e-300)
}

// An inner level's range at an outer node: a bound that is not a number is
// the bound's fault; an infinite one is a pole of the outer level.
function range(lo: number, hi: number, level: number, outer: number, x: number): [number, number] {
  for (const [v, side] of [
    [lo, 'lower'],
    [hi, 'upper'],
  ] as const) {
    if (Number.isNaN(v)) {
      const err = new QuadratureError('bound')
      err.bound = { level, side }
      throw err
    }
    if (!Number.isFinite(v)) throw new Pole(outer, x)
  }
  return [lo, hi]
}

// The outermost range: not a number is the bound's; infinite, divergence.
function outerRange(a: number, b: number): void {
  for (const [v, side] of [
    [a, 'lower'],
    [b, 'upper'],
  ] as const) {
    if (Number.isNaN(v)) {
      const err = new QuadratureError('bound')
      err.bound = { level: 0, side }
      throw err
    }
    if (!Number.isFinite(v)) throw new QuadratureError('diverges')
  }
}

// The targets a nested integral is tried at, most digits first: each rung
// a pass from golden starts and its cross-check from one-panel starts, with
// at most `share` of the evaluations still left. A rung that runs out hands
// on to the next, looser one, whose answer is honest to fewer digits.
const RUNGS = [
  { rel: QUAD_REL, check: QUAD_CHECK_REL, share: QUAD_FIRST_RUNG_SHARE },
  { rel: QUAD_COARSE_REL, check: QUAD_COARSE_CHECK_REL, share: 1 },
]

type Pass = (golden: boolean, rel: number, budget: QuadBudget) => QuadResult

function crossChecked(pass: Pass, budget: QuadBudget | undefined): QuadResult {
  const total = budget ?? quadBudget()
  let exhausted: QuadratureError | null = null
  for (const rung of RUNGS) {
    const allowance = quadBudget(Math.floor(Math.max(total.left, 0) * rung.share))
    const given = allowance.left
    try {
      return reconciled(pass, rung.rel, rung.check, allowance)
    } catch (err) {
      if (!(err instanceof QuadratureError) || err.reason !== 'budget') throw err
      exhausted = err
    } finally {
      total.left -= given - Math.max(allowance.left, 0)
    }
  }
  throw exhausted ?? new QuadratureError('budget')
}

// Rule 4: the pass, and the cross-check from one-panel starts at the looser
// `check` target, from one allowance. The error is at least their
// difference, and their errors plus it when they disagree. Without the
// cross-check there is no answer at this rung; any refusal by either is
// believed over a number.
function reconciled(pass: Pass, rel: number, check: number, allowance: QuadBudget): QuadResult {
  const main = pass(true, rel, allowance)
  const other = pass(false, check, allowance)
  const difference = Math.abs(main.value - other.value)
  const error = difference > main.error + other.error ? difference + main.error + other.error : Math.max(main.error, difference)
  return { value: main.value, error, absolute: main.absolute }
}

// The iterated integral of f(x, y) for x from a to b and y from c(x) to d(x).
export function integrate2(
  f: (x: number, y: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  tol: number = QUAD_TOL,
  budget?: QuadBudget
): QuadResult {
  outerRange(a, b)
  if (a === b) return { value: 0, error: 0, absolute: 0 }
  const inner = innerTolerance(tol, a, b)
  return crossChecked((golden, rel, bud) => {
    const outer = newLevel(0, a, b, bud, golden)
    return settleOuter(
      () =>
        adapt(
          (x) => {
            const [lo, hi] = range(c(x), d(x), 1, 0, x)
            if (lo === hi) return 0
            const r = adapt((y) => f(x, y), lo, hi, inner, rel, QUAD_INNER_MAX_PANELS, newLevel(1, lo, hi, bud, golden))
            outer.channel.error = r.error
            outer.channel.absolute = r.absolute
            return r.value
          },
          a,
          b,
          tol,
          rel,
          QUAD_MAX_PANELS,
          outer
        ),
      outer
    )
  }, budget)
}

// The iterated integral of f(x, y, z) for x from a to b, y from c(x) to d(x),
// and z from e(x, y) to g(x, y).
export function integrate3(
  f: (x: number, y: number, z: number) => number,
  a: number,
  b: number,
  c: (x: number) => number,
  d: (x: number) => number,
  e: (x: number, y: number) => number,
  g: (x: number, y: number) => number,
  tol: number = QUAD_TOL,
  budget?: QuadBudget
): QuadResult {
  outerRange(a, b)
  if (a === b) return { value: 0, error: 0, absolute: 0 }
  const middle = innerTolerance(tol, a, b)
  return crossChecked((golden, rel, bud) => {
    const outer = newLevel(0, a, b, bud, golden)
    return settleOuter(
      () =>
        adapt(
          (x) => {
            const [lo, hi] = range(c(x), d(x), 1, 0, x)
            if (lo === hi) return 0
            const inner = innerTolerance(middle, lo, hi)
            const mid = newLevel(1, lo, hi, bud, golden)
            const r = adapt(
              (y) => {
                const [zlo, zhi] = range(e(x, y), g(x, y), 2, 1, y)
                if (zlo === zhi) return 0
                const q = adapt((z) => f(x, y, z), zlo, zhi, inner, rel, QUAD_INNER_MAX_PANELS, newLevel(2, zlo, zhi, bud, golden))
                mid.channel.error = q.error
                mid.channel.absolute = q.absolute
                return q.value
              },
              lo,
              hi,
              middle,
              rel,
              QUAD_INNER_MAX_PANELS,
              mid
            )
            outer.channel.error = r.error
            outer.channel.absolute = r.absolute
            return r.value
          },
          a,
          b,
          tol,
          rel,
          QUAD_MAX_PANELS,
          outer
        ),
      outer
    )
  }, budget)
}

// The 7-point Gauss rule on [-1, 1]: nodes and weights.
const G7_NODES = [-XGK[1], -XGK[3], -XGK[5], 0, XGK[5], XGK[3], XGK[1]]
const G7_WEIGHTS = [WG[0], WG[1], WG[2], WG[3], WG[2], WG[1], WG[0]]

// The 7-point Gauss rule on [a, b]: exact for polynomials of degree 13.
export function gaussLegendre7(f: (x: number) => number, a: number, b: number): number {
  const centre = (a + b) / 2
  const half = (b - a) / 2
  let s = 0
  for (let i = 0; i < 7; i++) s += G7_WEIGHTS[i] * f(centre + half * G7_NODES[i])
  return s * half
}
