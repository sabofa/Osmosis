// Stroke roles (spec §3.7, M8): chosen by role and by where a particle sits in
// the value plan, never at random. Each role has its own direction field,
// colour treatment and brush; each instance varies a little, seeded (±12%).
//
//   block      every visible particle (subsampled by the role's density): broad,
//              flat strokes round the light, laid along the planes. On the table
//              only where the shadow falls.
//   form       particles within detect.formBand of the terminator and not in the
//              deep core: curved strokes along the surface direction that crosses
//              the terminator most (the uv direction of the two the light crosses
//              more), loaded at the lighter end, stopping below the core (0.36).
//   scumble    where the transition between zones is wide (|∇v| per CSS px under
//              detect.scumbleGradient over at least scumbleMinPx), semi-dry,
//              alternating the lighter and the darker neighbour by parity.
//   glaze      the core and cast zones where the value is under detect.glazeBelow:
//              thin and transparent. On a mesh with opacity under 1 it is the ONLY
//              role: wide strokes in two crossing directions at alpha 0.26 with no
//              impasto, and dry strokes near the border.
//   reflected  the reflected-light zone, where the bounce in the value is at
//              least detect.reflectedMin.
//   dab        the top detect.dabTopFraction of the value maxima, at least
//              detect.dabMinPx apart: short, thick, loaded, painted last.
//
// A block or form stroke takes its behaviour (wet, ends, impasto, load) from the
// class of the nearest edge; a scumble stroke from the same, kept SOFT or FIRM.
//
// Ported from the approved mockup (figures.js buildJobs, makeSurfaceStroke).

import { randomFor } from '../../../style/random'
import type { MeshMark } from '../../scene/types'
import { PATH_POINTS, type Oklab, type Role } from '../types'
import { loadCellOf, sizedBristles, sizedLength, sizedVariance, sizedWidth, reshapeWidths } from './brush'
import { behaviourOf, strokeEdgeClass, type Behaviour } from './edges'
import { clamp, scratchU8, vcross, vlen, vnorm, type V3 } from './math'
import { stepValue, chamferDist } from './planes'
import { colourOfDraft, newRecipe, type DraftColour } from './recipe'
import { pathFromWalk, roleIndex, walkStroke, type DirMode, type PaintCtx, type StrokeDraft, type WalkSpec } from './strokes'
import { ambientShare, newZoneSample, planSample } from './value'
import { bigMax, drawFade, gIndex, toEye, unproject, zoomGrow } from './view'
import { Z_CAST } from './zones'

// The rotation of the direction field, radians (σ), per role: the hand is never exact.
const ROT: Partial<Record<Role, number>> = { block: 0.22, form: 0.34, scumble: 0.5, glaze: 0.22, reflected: 0.22, dab: 0.1 }
// Where a stroke of an unclassed role ends: 0 crisp .. 1 dissolved.
const BASE_END: Record<Role, number> = { block: 0.19, form: 0.31, scumble: 0.875, glaze: 0, reflected: 0.09, dab: 0, edge: 0.09, line: 0 }
// The mockup's STYLE.opacity per role: how opaque a loaded stroke is.
const PLAIN: Record<Role, boolean> = { block: false, form: false, scumble: false, glaze: true, reflected: true, dab: true, edge: false, line: true }
// A veil's glazes are bigger than a core glaze, and nearly clear.
const VEIL_SCALE = 2
// The renderer takes a glaze's alpha as its ABSOLUTE opacity (capped at 0.34) and
// multiplies every other role's alpha by that role's own base opacity.
const GLAZE_ALPHA = 0.34
const VEIL_ALPHA = 0.3
const VEIL_BORDER_ALPHA = 0.34
// The end of a veil's stroke is a dry brush lifting, not a cut: 0..1 of the dissolve a class gives an edge.
const VEIL_END_SOFT = 0.5
// A veil is a film, and it must read as one: tinted and brushy, with the surface behind it still showing.
// What a film shows is how much of each pixel its strokes cover, 1 - exp(-tau), tau the sum over the strokes
// over the pixel of -ln(1 - alpha x efficacy). The first calibration had two faults. A veil stroke was thin:
// the glaze role's load of 0.3 gave the brush a deposit of about 0.15, which the shader turns into 60% of the
// stroke's alpha (min(alpha, alpha (0.42 + 1.6 deposit))), so a veil was faint wherever its strokes were few.
// And the strokes were plentiful where it was seen face on (13 on a pixel, a film of 0.9 and more: the magenta
// plane that hid the hill). Now a veil stroke carries a load three times the role's (a deposit past 0.36 is all
// the alpha), and a veil's strokes are 0.1 of the glaze role's screen density: about 5 to 10k px² (of 80 x 160 px
// close up, 40 x 80 at the lab's framing), 3 on a pixel, a film of about 0.6 face on and 0.45 at a graze, mottled
// where the strokes' ends and the brush's gaps let the surface through (veil.test.ts holds the numbers).
const VEIL_LOAD = 3
const VEIL_DENSITY = 0.1
// The soft clamp of the direction field's degeneracy (n ∥ L).
const ISO_MIN = 0.12
// Scratch for the hot loop of a stroke (one stroke is built at a time).
const FIXED: V3 = [0, 0, 0]
const CLS_X = new Float64Array(9)
const CLS_Y = new Float64Array(9)

// ---- what a particle is, value-wise ----

interface Where {
  // The plan value (before the deviation), the model's value, the bounce weight.
  u: number
  v: number
  b: number
  lightW: number
  shadowW: number
  reflW: number
  // The plane (-1 for a veil) and the G-buffer pixel (-1 for a veil).
  plane: number
  gi: number
  zone: number
}
const WHERE: Where = { u: 0, v: 0, b: 0, lightW: 0, shadowW: 0, reflW: 0, plane: -1, gi: -1, zone: 0 }
const ZS = newZoneSample()

function whereOf(an: PaintCtx, k: number): Where {
  const w = WHERE
  const i = an.vis.idx[k]
  if (an.set.opacity[i] >= 1) {
    const gi = an.vis.gi[k]
    w.u = an.plan.u[gi]
    w.v = an.plan.value[gi]
    w.b = an.plan.bounce[gi]
    w.lightW = an.plan.lightW[gi]
    w.shadowW = an.plan.shadowW[gi]
    w.reflW = an.plan.reflW[gi]
    w.plane = an.planes.plane[gi]
    w.gi = gi
    w.zone = an.plan.zone[gi]
    return w
  }
  // a veil is not in the G-buffer: light it from its own normal, unshadowed
  const params = an.fc.params
  const nx = an.vis.normal[3 * k], ny = an.vis.normal[3 * k + 1], nz = an.vis.normal[3 * k + 2]
  const L = an.fc.view.lightDir
  const nl = nx * L[0] + ny * L[1] + nz * L[2]
  planSample(params, an.plan.curves, nl, false, nx, ny, nz, 0, ZS)
  w.u = ZS.u
  w.v = ZS.u
  w.b = ZS.lift
  w.lightW = ZS.w[0] + 0.6 * ZS.w[1]
  w.shadowW = ZS.w[2] + ZS.w[4]
  w.reflW = ZS.w[3]
  w.plane = -1
  w.gi = -1
  w.zone = ZS.zone
  return w
}

// ---- veils ----

export interface Veil {
  inside(x: number, y: number, z: number): boolean
  // A flat sheet's plane (n · x = d, n a unit normal); null for anything else.
  plane: { n: V3; d: number } | null
  // 0 at the centre .. 1 at the border (a flat sheet), 0 for anything else.
  border(x: number, y: number, z: number): number
}
const veils = new WeakMap<MeshMark, Veil>()

export function veilOf(mesh: MeshMark): Veil {
  const have = veils.get(mesh)
  if (have) return have
  const p = mesh.positions
  const n = p.length / 3
  let mx = 0, my = 0, mz = 0
  for (let i = 0; i < mesh.normals.length; i += 3) {
    mx += mesh.normals[i]
    my += mesh.normals[i + 1]
    mz += mesh.normals[i + 2]
  }
  const nm = vnorm([mx, my, mz])
  let flat = vlen([mx, my, mz]) > 0
  for (let i = 0; i < mesh.normals.length && flat; i += 3) {
    if (mesh.normals[i] * nm[0] + mesh.normals[i + 1] * nm[1] + mesh.normals[i + 2] * nm[2] < 0.999) flat = false
  }
  let v: Veil
  if (flat) {
    const e1 = vnorm(vcross(nm, Math.abs(nm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
    const e2 = vcross(nm, e1)
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (let i = 0; i < n; i++) {
      const a = p[3 * i] * e1[0] + p[3 * i + 1] * e1[1] + p[3 * i + 2] * e1[2]
      const b = p[3 * i] * e2[0] + p[3 * i + 1] * e2[1] + p[3 * i + 2] * e2[2]
      if (a < a0) a0 = a
      if (a > a1) a1 = a
      if (b < b0) b0 = b
      if (b > b1) b1 = b
    }
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2
    const ha = Math.max(1e-9, (a1 - a0) / 2), hb = Math.max(1e-9, (b1 - b0) / 2)
    const at = (x: number, y: number, z: number): [number, number] => [
      (x * e1[0] + y * e1[1] + z * e1[2] - ca) / ha,
      (x * e2[0] + y * e2[1] + z * e2[2] - cb) / hb,
    ]
    v = {
      plane: { n: nm, d: nm[0] * p[0] + nm[1] * p[1] + nm[2] * p[2] },
      inside: (x, y, z) => {
        const [a, b] = at(x, y, z)
        return Math.abs(a) <= 1.02 && Math.abs(b) <= 1.02
      },
      border: (x, y, z) => {
        const [a, b] = at(x, y, z)
        return Math.max(Math.abs(a), Math.abs(b))
      },
    }
  } else {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, p[3 * i]); x1 = Math.max(x1, p[3 * i])
      y0 = Math.min(y0, p[3 * i + 1]); y1 = Math.max(y1, p[3 * i + 1])
      z0 = Math.min(z0, p[3 * i + 2]); z1 = Math.max(z1, p[3 * i + 2])
    }
    const m = 0.02 * Math.max(x1 - x0, y1 - y0, z1 - z0)
    v = {
      plane: null,
      inside: (x, y, z) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m && z >= z0 - m && z <= z1 + m,
      border: () => 0,
    }
  }
  veils.set(mesh, v)
  return v
}

// ---- colour ----

interface ColourOpts {
  du?: number
  lScale?: number
  dC?: number
  bounceBoost?: number
}

// The curve colour of the stroke at particle k (fitted OKLab) and the value it
// was made at, with the recipe it was made from (so a colour parameter can make
// it again without this stroke's geometry being redone).
function strokeColour(an: PaintCtx, k: number, rng: ReturnType<typeof randomFor>, w: Where, opts: ColourOpts): { lab: Oklab; u: number; colour: DraftColour } {
  const { set, vis, fc, curve } = an
  const params = fc.params
  const i = vis.idx[k]
  const ground = fc.ground[set.mark[i]] === 1
  const px = set.position[3 * i], py = set.position[3 * i + 1], pz = set.position[3 * i + 2]
  // the plane's own short gradient: its mean plus planeGradient of the particle's own value
  const dev = curve.devU(px, py, pz)
  const stepped = w.plane >= 0 ? stepValue(an.planes, w.plane, w.u + dev, params.edges.planeGradient) : w.u + dev
  const u = clamp(stepped + (opts.du ?? 0), 0.02, 0.99)
  const nz = vis.normal[3 * k + 2]
  const plane = w.plane >= 0 && !ground ? an.planes.planes[w.plane] : null
  const r = newRecipe()
  r.ground = ground
  r.lx = set.colour[3 * i]
  r.ly = set.colour[3 * i + 1]
  r.lz = set.colour[3 * i + 2]
  r.u = u
  r.nz = nz
  r.bounce = opts.bounceBoost !== undefined ? Math.max(w.b, opts.bounceBoost) : w.b
  r.ambientShare = ambientShare(params, nz, w.v)
  if (plane) {
    r.hasPlane = true
    r.pnx = plane.nx
    r.pny = plane.ny
    r.pnz = plane.nz
  }
  r.colormapped = set.colormapped[i] === 1
  r.lScale = opts.lScale ?? Number.NaN
  // the stroke's own jitter on top of the curve's smooth field at the particle
  r.g0 = rng.gauss()
  r.g1 = rng.gauss()
  r.g2 = rng.gauss()
  r.c0 = 0.5
  r.c1 = 5 / 12
  r.c2 = 6 / 11
  r.dC = opts.dC ?? 0
  r.field = true
  r.px = px
  r.py = py
  r.pz = pz
  const colour: DraftColour = { a: r, b: null, t: 0 }
  return { lab: colourOfDraft(colour, an.env), u, colour }
}

// ---- the stroke ----

// A stroke that stops at the terminator (stopBelow) stops where the plan value falls under the middle of the soft edge
// between the core and the darkest half-tone: the plan value at N·L = 0.
const TERMINATOR = -2
interface RoleCfg {
  dir: 'block' | 'form'
  classed: 'full' | 'soft' | 'none'
  start: 'hand' | 'light'
  stopBelow: number
}
const CFG: Record<'block' | 'form' | 'scumble' | 'glaze' | 'reflected', RoleCfg> = {
  block: { dir: 'block', classed: 'full', start: 'hand', stopBelow: -1 },
  form: { dir: 'form', classed: 'full', start: 'light', stopBelow: TERMINATOR },
  scumble: { dir: 'block', classed: 'soft', start: 'hand', stopBelow: -1 },
  glaze: { dir: 'block', classed: 'none', start: 'hand', stopBelow: -1 },
  reflected: { dir: 'form', classed: 'none', start: 'hand', stopBelow: -1 },
}

type ParticleRole = keyof typeof CFG

function buildParticleStroke(an: PaintCtx, k: number, role: ParticleRole, fade: number, veilPass: 0 | 1 | 2 = 0): boolean {
  const { set, vis, fc } = an
  const params = fc.params
  const i = vis.idx[k]
  const cfg = CFG[role]
  const rp = params.roles[role]
  const w = whereOf(an, k)
  const veil = set.opacity[i] < 1
  const ground = fc.ground[set.mark[i]] === 1
  const rng = randomFor(`paint/stroke/${role}${veilPass ? '/v' + veilPass : ''}/${set.seed[i]}`, params.seed)
  const plain = PLAIN[role]
  // the light side: thicker, longer, opaque strokes; the shadows: thinner, shorter, softer ones
  const ls = plain ? 1 : 1 + 0.16 * w.lightW - 0.14 * w.shadowW
  const vLen = rng.range(0.88, 1.12)
  const vWid = rng.range(0.88, 1.12)
  const vLoad = rng.range(0.88, 1.12)
  const vImp = rng.range(0.88, 1.12)
  const vBri = rng.range(0.88, 1.12)
  let lengthPx = rp.length * vLen * ls * (ground && role === 'block' ? 1.25 : 1)
  let widthPx = rp.width * vWid * ls * (ground && role === 'block' ? 2.3 : 1)
  if (veil) {
    lengthPx *= VEIL_SCALE
    widthPx *= VEIL_SCALE
    if (veilPass === 2) {
      // the dry scumbles near the border: small, broken
      lengthPx = rp.length * 0.5 * vLen
      widthPx = rp.width * 0.4 * vWid
    }
  }
  // sized for the view: where the zoom leaves the particles short of the screen target the stroke grows to
  // still overlap, and the brush follows the zoom (brush.ts); both are 1 at the framing the roles were tuned at
  const big = Math.min(zoomGrow(fc, vis.pxArea[k], role) * fc.sizeScale, bigMax(params))
  lengthPx = sizedLength(lengthPx, big)
  widthPx = sizedWidth(widthPx, big)
  const bend = clamp(rng.gauss(), -2, 2) * rp.curvature * 1.2
  const rot = clamp(rng.gauss() * (ROT[role] ?? 0.22), -0.55, 0.55)

  // the start: the particle, on the surface
  const px = set.position[3 * i], py = set.position[3 * i + 1], pz = set.position[3 * i + 2]
  const nx = vis.normal[3 * k], ny = vis.normal[3 * k + 1], nz = vis.normal[3 * k + 2]
  const L = fc.view.lightDir
  const tx = set.tangent[3 * i], ty = set.tangent[3 * i + 1], tz = set.tangent[3 * i + 2]
  // the direction field
  let mode: DirMode = 'transport'
  let fixed: V3 | undefined
  const nlx = L[0] * nx + L[1] * ny + L[2] * nz
  // round the light: n × L
  const ix = ny * L[2] - nz * L[1]
  const iy = nz * L[0] - nx * L[2]
  const iz = nx * L[1] - ny * L[0]
  let dx = tx, dy = ty, dz = tz
  if (veil) {
    // two crossing passes over the sheet: along one parameter line, then across it
    if (veilPass === 1 || (veilPass === 0 && (set.seed[i] & 1) === 1)) {
      dx = ny * tz - nz * ty
      dy = nz * tx - nx * tz
      dz = nx * ty - ny * tx
    }
  } else if (cfg.dir === 'block') {
    if (ground) {
      const sd = Math.sqrt(L[0] * L[0] + L[1] * L[1])
      if (sd > 0.05) {
        FIXED[0] = -L[0] / sd
        FIXED[1] = -L[1] / sd
        FIXED[2] = 0
        fixed = FIXED
        dx = FIXED[0]
        dy = FIXED[1]
        dz = 0
        mode = 'fixed'
      }
    } else if (Math.sqrt(ix * ix + iy * iy + iz * iz) > ISO_MIN) {
      dx = ix
      dy = iy
      dz = iz
      mode = 'iso'
    }
  } else {
    // the parameter line the light crosses more: t or n × t
    const bx = ny * tz - nz * ty
    const by = nz * tx - nx * tz
    const bz = nx * ty - ny * tx
    const gx = L[0] - nx * nlx
    const gy = L[1] - ny * nlx
    const gz = L[2] - nz * nlx
    if (Math.abs(tx * gx + ty * gy + tz * gz) < Math.abs(bx * gx + by * gy + bz * gz) && Math.sqrt(gx * gx + gy * gy + gz * gz) >= 0.1) {
      dx = bx
      dy = by
      dz = bz
    }
    // a start rotation, so form strokes do not all run straight along the line
    const kk = dx * nx + dy * ny + dz * nz
    const px2 = dx - nx * kk, py2 = dy - ny * kk, pz2 = dz - nz * kk
    const dl = Math.sqrt(px2 * px2 + py2 * py2 + pz2 * pz2)
    if (dl > 1e-9) {
      const ux = px2 / dl, uy = py2 / dl, uz = pz2 / dl
      const kx = ny * uz - nz * uy, ky = nz * ux - nx * uz, kz = nx * uy - ny * ux
      const cr = Math.cos(rot), sr = Math.sin(rot)
      dx = ux * cr + kx * sr
      dy = uy * cr + ky * sr
      dz = uz * cr + kz * sr
    }
  }

  const spec: WalkSpec = {
    mark: set.mark[i],
    translucent: veil,
    px, py, pz,
    sx: vis.sx[k], sy: vis.sy[k], depth: vis.depth[k],
    nx, ny, nz,
    dx, dy, dz,
    mode,
    fixed,
    rot: mode === 'iso' ? rot : 0,
    lengthPx,
    bend,
    stopBelow: cfg.stopBelow === TERMINATOR ? 0.5 * (params.value.corePlateau + params.value.halfLo) : cfg.stopBelow,
    planeId: !veil && cfg.classed !== 'none' && role !== 'scumble' ? w.plane : -1,
    castOnly: ground,
    inside: veil ? veilOf(fc.scene.marks[set.mark[i]] as MeshMark).inside : undefined,
  }
  const walk = walkStroke(an, spec)
  if (walk.n < 3) return false

  // which end is the loaded start
  const x0 = walk.x[0], y0 = walk.y[0], x1 = walk.x[walk.n - 1], y1 = walk.y[walk.n - 1]
  let reverse: boolean
  if (cfg.start === 'light') {
    const g0 = gIndex(fc, x0, y0)
    const g1 = gIndex(fc, x1, y1)
    const u0 = g0 >= 0 ? an.plan.u[g0] : w.u
    const u1 = g1 >= 0 ? an.plan.u[g1] : w.u
    reverse = u1 > u0
  } else reverse = x1 < x0

  // the edge environment decides how this brush behaves: distinct (hard / firm), blended (soft), dissolving (lost)
  let cls = -1
  let beh: Behaviour | null = null
  if (!veil && cfg.classed !== 'none') {
    const xs = CLS_X
    const ys = CLS_Y
    for (let q = 0; q < 9; q++) {
      const f = (q * (walk.n - 1)) / 8
      const a = Math.floor(f)
      const b = Math.min(walk.n - 1, a + 1)
      xs[q] = walk.x[a] + (walk.x[b] - walk.x[a]) * (f - a)
      ys[q] = walk.y[a] + (walk.y[b] - walk.y[a]) * (f - a)
    }
    cls = strokeEdgeClass(fc, an.edges, xs, ys, 9, w.lightW, w.shadowW).cls
    if (cfg.classed === 'soft') cls = clamp(cls, 1, 2)
    beh = behaviourOf(cls)
  }

  const path = new Float32Array(2 * PATH_POINTS)
  const width = new Float32Array(PATH_POINTS)
  const world = new Float32Array(3 * PATH_POINTS)
  const meanW = pathFromWalk(walk, widthPx, reverse, path, width, world)
  if (meanW < 0.6) return false
  reshapeWidths(width, big)

  // the colour: the local colour through the curve at the stroke's value
  let du = 0
  const opts: ColourOpts = {}
  if (role === 'glaze') du = -0.07
  if (role === 'scumble') du = (set.seed[i] & 1 ? 1 : -1) * 0.1
  if (role === 'reflected') opts.bounceBoost = 0.5
  opts.du = du
  const col = strokeColour(an, k, rng, w, opts)

  const kpLight = plain ? 1 : 1 + 0.25 * w.lightW - 0.35 * w.shadowW
  const loadLight = plain ? 1 : 1 + 0.08 * w.lightW - 0.1 * w.shadowW
  const impasto = Math.max(0, rp.impasto * vImp * (beh ? beh.impastoMul : 1) * kpLight * (veil ? 0 : 1))
  // alpha: the silhouette fade and the density fade, and a class's opacity; a glaze's is its own absolute opacity
  const alpha =
    vis.fade[k] * fade * (role === 'glaze' ? (veil ? (veilPass === 2 ? VEIL_BORDER_ALPHA : VEIL_ALPHA) : GLAZE_ALPHA) : beh ? beh.alphaMul : 1)
  const draft: StrokeDraft = {
    role: roleIndex(role),
    path,
    width,
    world,
    normal: [nx, ny, nz],
    depth: vis.depth[k],
    lab: col.lab,
    colour: col.colour,
    u: col.u,
    cell: loadCellOf(set, i, params.mix.loadCell, fc.loadLevel),
    mx: vis.sx[k],
    my: vis.sy[k],
    colormapped: set.colormapped[i] === 1,
    alpha,
    load: rp.load * vLoad * (beh ? beh.loadMul : 1) * loadLight * (0.9 + 0.2 * rng.next()) * (veil && veilPass !== 2 ? VEIL_LOAD : 1),
    impasto,
    bristles: sizedBristles(rp.bristles * vBri, big),
    bristleVar: sizedVariance(clamp(rp.bristleVar * (beh ? beh.bristleVarMul : 1), 0, 1), big),
    dry: veilPass === 2 ? 0.6 : beh ? Math.max(rp.dry * 0.5, beh.dryMin) : rp.dry,
    wet: beh ? Math.max(rp.wet * beh.wetMul, beh.wetMin) : rp.wet,
    endSoft: clamp((beh ? beh.endSoft : veil && veilPass !== 2 ? VEIL_END_SOFT : BASE_END[role]) + (walk.endA === 3 || walk.endB === 3 ? 0.2 : 0), 0, 1),
    edge: cls >= 0 ? cls : 255,
    seed: set.seed[i],
    jit0: rng.gauss(),
    jit1: rng.gauss(),
    order: an.nextOrder++,
  }
  an.drafts.push(draft)
  return true
}

// ---- the roles over the visible particles ----

export function particleStrokes(an: PaintCtx): void {
  const { set, vis, fc } = an
  const params = fc.params
  const d = params.detect
  // a stroke whose density fade is under this is left out (it has all but faded away)
  const MIN = 0.02
  for (let k = 0; k < vis.count; k++) {
    const i = vis.idx[k]
    const veil = set.opacity[i] < 1
    const ground = fc.ground[set.mark[i]] === 1
    if (veil) {
      // a mesh with opacity under 1 is glazed and nothing else
      const f = drawFade(fc, vis, set, k, 'glaze', VEIL_DENSITY)
      if (f > MIN) {
        buildParticleStroke(an, k, 'glaze', f, 0)
        // the dry strokes near the border of a sheet
        const mesh = fc.scene.marks[set.mark[i]] as MeshMark
        const b = veilOf(mesh).border(set.position[3 * i], set.position[3 * i + 1], set.position[3 * i + 2])
        const fb = b > 0.86 ? drawFade(fc, vis, set, k, 'scumble') : 0
        if (fb > MIN) buildParticleStroke(an, k, 'glaze', fb, 2)
      }
      continue
    }
    const gi = vis.gi[k]
    const plan = an.plan
    let f = drawFade(fc, vis, set, k, 'block')
    if (f > MIN && (!ground || plan.zone[gi] === Z_CAST)) buildParticleStroke(an, k, 'block', f)
    if (ground) {
      f = drawFade(fc, vis, set, k, 'glaze')
      if (f > MIN && plan.shadowW[gi] > 0.55 && plan.u[gi] < d.glazeBelow) buildParticleStroke(an, k, 'glaze', f)
      continue
    }
    f = drawFade(fc, vis, set, k, 'form')
    if (f > MIN && plan.shadowW[gi] < 0.85 && Math.abs(plan.nl[gi]) <= d.formBand) buildParticleStroke(an, k, 'form', f)
    f = drawFade(fc, vis, set, k, 'scumble')
    if (f > MIN && an.scumbleOk[gi] === 1) buildParticleStroke(an, k, 'scumble', f)
    f = drawFade(fc, vis, set, k, 'glaze')
    if (f > MIN && plan.shadowW[gi] > 0.55 && plan.u[gi] < d.glazeBelow) buildParticleStroke(an, k, 'glaze', f)
    f = drawFade(fc, vis, set, k, 'reflected')
    if (f > MIN && plan.reflW[gi] > 0.35) {
      const nz = vis.normal[3 * k + 2]
      if (params.light.bounce * Math.max(-nz, 0) >= d.reflectedMin) buildParticleStroke(an, k, 'reflected', f)
    }
  }
}

// Where a transition between zones is wide enough to scumble: a gentle gradient
// (|∇v| per CSS px under detect.scumbleGradient) inside a zone boundary, at
// least scumbleMinPx across. Written to the context's scumbleOk.
export function scumbleMask(an: PaintCtx): void {
  const g = an.fc.g
  const n = g.width * g.height
  const d = an.fc.params.detect
  const bad = scratchU8('scumble.bad', n)
  for (let i = 0; i < n; i++) {
    const ok = g.mark[i] >= 0 && an.fc.ground[g.mark[i]] !== 1 && an.plan.trans[i] > 0.16 && an.plan.grad[i] < d.scumbleGradient
    bad[i] = ok ? 0 : 1
  }
  const dist = chamferDist(bad, g.width, g.height)
  // a pixel qualifies when it sits at least half the minimum width inside the gentle band
  const need = Math.max(0.5, d.scumbleMinPx / (2 * g.scale))
  for (let i = 0; i < n; i++) an.scumbleOk[i] = bad[i] === 0 && dist[i] >= need ? 1 : 0
}

// ---- highlight dabs ----

const DAB_MIN_VALUE = 0.8

export function dabStrokes(an: PaintCtx): void {
  const { fc, plan, set, vis } = an
  const g = fc.g
  const params = fc.params
  const d = params.detect
  const W = g.width
  const H = g.height
  const r = Math.max(2, Math.round(d.dabMinPx / (2 * g.scale)))
  // the value maxima: strict local maxima of the value (a hair of N·L breaks the ties of a clipped highlight)
  const score = (i: number) => plan.value[i] + 0.01 * plan.key[i]
  const cands: number[] = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const m = g.mark[i]
      if (m < 0 || fc.ground[m] === 1 || plan.value[i] < DAB_MIN_VALUE) continue
      const s = score(i)
      let top = true
      for (let dy = -r; dy <= r && top; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue
          const xx = x + dx
          if (xx < 0 || xx >= W) continue
          const j = yy * W + xx
          if (g.mark[j] === m && score(j) >= s) {
            top = false
            break
          }
        }
      }
      if (top) cands.push(i)
    }
  }
  if (cands.length === 0) return
  cands.sort((a, b) => score(b) - score(a) || a - b)
  const keep = Math.max(1, Math.ceil(d.dabTopFraction * cands.length))
  const chosen: number[] = []
  const minPx = d.dabMinPx
  for (const i of cands.slice(0, keep)) {
    const sx = ((i % W) + 0.5) * g.scale
    const sy = (Math.floor(i / W) + 0.5) * g.scale
    let ok = true
    for (const j of chosen) {
      const tx = ((j % W) + 0.5) * g.scale
      const ty = (Math.floor(j / W) + 0.5) * g.scale
      if (Math.hypot(sx - tx, sy - ty) < minPx) {
        ok = false
        break
      }
    }
    if (ok) chosen.push(i)
  }
  const rp = params.roles.dab
  const pt = [0, 0, 0]
  const ve = [0, 0, 0]
  for (const i of chosen) {
    const mark = g.mark[i]
    const sx = ((i % W) + 0.5) * g.scale
    const sy = (Math.floor(i / W) + 0.5) * g.scale
    const depth = g.depth[i]
    unproject(fc, sx, sy, depth, pt)
    let nx = g.normal[3 * i], ny = g.normal[3 * i + 1], nz = g.normal[3 * i + 2]
    toEye(fc, pt[0], pt[1], pt[2], ve)
    if (nx * ve[0] + ny * ve[1] + nz * ve[2] < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    // the nearest visible particle of this mesh gives the local colour
    let best = -1
    let bd = Infinity
    for (let k = 0; k < vis.count; k++) {
      if (set.mark[vis.idx[k]] !== mark) continue
      const dd = Math.hypot(vis.sx[k] - sx, vis.sy[k] - sy)
      if (dd < bd) {
        bd = dd
        best = k
      }
    }
    if (best < 0) continue
    const pi = vis.idx[best]
    const seed = (Math.imul(i, 0x9e3779b1) ^ set.seed[pi]) >>> 0
    const rng = randomFor(`paint/stroke/dab/${seed}`, params.seed)
    const vLen = rng.range(0.88, 1.12)
    const vWid = rng.range(0.88, 1.12)
    const vLoad = rng.range(0.88, 1.12)
    const vImp = rng.range(0.88, 1.12)
    const vBri = rng.range(0.88, 1.12)
    const L = fc.view.lightDir
    let dir: V3 = vcross([nx, ny, nz], L)
    let mode: DirMode = 'iso'
    if (vlen(dir) <= ISO_MIN) {
      // at the very peak the normal is the light: take the screen's horizontal
      const m = fc.view.view
      dir = [m[0], m[4], m[8]]
      mode = 'transport'
    }
    const spec: WalkSpec = {
      mark,
      translucent: false,
      px: pt[0], py: pt[1], pz: pt[2],
      sx, sy, depth,
      nx, ny, nz,
      dx: dir[0], dy: dir[1], dz: dir[2],
      mode,
      rot: clamp(rng.gauss() * (ROT.dab ?? 0.1), -0.3, 0.3),
      lengthPx: sizedLength(rp.length * vLen, fc.sizeScale),
      bend: clamp(rng.gauss(), -2, 2) * rp.curvature * 1.2,
      stopBelow: -1,
      planeId: -1,
      castOnly: false,
    }
    const walk = walkStroke(an, spec)
    if (walk.n < 3) continue
    const path = new Float32Array(2 * PATH_POINTS)
    const width = new Float32Array(PATH_POINTS)
    const world = new Float32Array(3 * PATH_POINTS)
    const reverse = walk.x[walk.n - 1] < walk.x[0]
    // a highlight dab is a brush too: it follows the zoom (the particle shortfall is not its business: it is one per highlight)
    if (pathFromWalk(walk, sizedWidth(rp.width * vWid, fc.sizeScale), reverse, path, width, world) < 0.6) continue
    reshapeWidths(width, fc.sizeScale)
    // the colour: a lighter, bolder value of the local colour
    const k = best
    const sameWhere = whereOfPixel(an, i)
    const col = strokeColour(an, k, rng, sameWhere, { du: 0.05, lScale: 1.35, dC: 0.9 })
    an.drafts.push({
      role: roleIndex('dab'),
      path,
      width,
      world,
      normal: [nx, ny, nz],
      depth,
      lab: col.lab,
      colour: col.colour,
      u: col.u,
      cell: loadCellOf(set, pi, params.mix.loadCell, fc.loadLevel),
      mx: sx,
      my: sy,
      colormapped: set.colormapped[pi] === 1,
      alpha: 1,
      load: rp.load * vLoad * (0.9 + 0.2 * rng.next()),
      impasto: rp.impasto * vImp,
      bristles: sizedBristles(rp.bristles * vBri, fc.sizeScale),
      bristleVar: sizedVariance(rp.bristleVar, fc.sizeScale),
      dry: rp.dry,
      wet: rp.wet,
      endSoft: BASE_END.dab,
      edge: 255,
      seed,
      jit0: rng.gauss(),
      jit1: rng.gauss(),
      order: an.nextOrder++,
    })
  }
}

// The value facts at G-buffer pixel i, for a stroke whose colour borrows particle k's local colour.
function whereOfPixel(an: PaintCtx, i: number): Where {
  const plan = an.plan
  return {
    u: plan.u[i],
    v: plan.value[i],
    b: plan.bounce[i],
    lightW: plan.lightW[i],
    shadowW: plan.shadowW[i],
    reflW: plan.reflW[i],
    plane: an.planes.plane[i],
    gi: i,
    zone: plan.zone[i],
  }
}

