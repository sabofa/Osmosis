// Brush-load mixing (spec §3.5): colour distortion as a fresh paint mix per
// brush load. Every load of the brush is mixed a little differently, so no two
// patches of "the same" colour are quite the same paint: a different hue at
// the same value, or a different hue and lightness at about the same value.
//
// - STROKES ON A SURFACE (block, form, scumble, glaze, reflected, dab) take a
//   SPATIAL mix: the offset is a pure function of (role, surface cell, seed), so
//   a stroke keeps its colour as the camera orbits (spec §3.8: same view, same
//   image; strokes ride the surface). The cell is the integer cell of the
//   stroke's start (ParticleSet.cell: a hash of floor(position / loadCell) whose
//   low four bits carry the cell's parities). The hue sign comes from the cell's
//   parity, so neighbouring cells take opposite signs (anti-correlation); the
//   chroma direction from a second parity; the value step and the grey family
//   from the cell's own seeded draws. The mix balance (hueBias, chromaBias,
//   valueBias) is a cell-hash threshold on the parity's choice, so a bias of b
//   makes the + direction come up (1 + b)/2 of the time. The drift is a seeded
//   fraction per stroke (its place in the cell). (mockup mix.js applySpatial)
// - LINES AND EDGES (they are re-traced as the camera moves, so they have no
//   surface to hold a colour) keep the SEQUENTIAL mixer, which follows:
//   a load is a run of loadMin..loadMax consecutive strokes of one role, in
//   painting order. It breaks when the next stroke is more than loadBreakPx
//   away. Its offset is seeded by randomFor('paint/load/' + role + '/' + cell,
//   seed), where cell is the surface cell of the load's first stroke.
// - The offset around the curve colour: hue ±hueMin..hueMax degrees (OKLCH),
//   chroma ×chromaMin..chromaMax, lightness held within ±valueHold of the
//   target, and valueStepFraction of loads also take a value step of ±valueStep.
// - A grey (chroma under greyChroma) takes an a/b vector of greyVecMin..Max
//   toward one of four families instead: warm, green-grey, cool, violet-grey (in that
//   order, so that two places on the list are opposite).
// - Anti-correlation: the next load flips the hue sign with probability
//   flipHue and the chroma direction with flipChroma; the grey family steps to
//   its opposite (warm to cool, green-grey to violet-grey; most of the time, and to its
//   neighbour otherwise). Adjacent patches contrast gently instead of averaging out.
// - The offsets stay inside what the sliders say, whatever the strength and the personal
//   jitter: the chroma factor within chromaMin..chromaMax (of a colormapped colour's
//   share), the value step within valueStep.
// - Drift: within a load the offset fades to `drift` of itself by the last stroke.
// - Strength: mix.strength × the role's own multiplier. A colormapped surface
//   scales the hue and chroma offsets by colormapScale (a third) and holds
//   lightness to ±0.004: the data colour stays true.
//
// Ported from the approved mockup (mix.js LoadMixer).

import { randomFor } from '../../../style/random'
import type { PaintParams } from '../params'
import type { Oklab, Role } from '../types'
import { fitLab, fitLch, labToLch } from './colour'
import { clamp, D2R, hash01, smooth } from './math'
import { compileCurve, type CurveFn } from './respond'

// Grey families, as an angle in OKLab a/b: warm, green-grey, cool, violet-grey. Two places on the list are opposite
// (warm 62 and cool 255, green-grey 135 and violet-grey 315), which is what "the next load steps to the opposite family"
// (`fam + 2`) needs. (The first order, warm, cool, green, violet, stepped warm to green-grey.)
export const GREY_FAMILIES: readonly number[] = [62, 135, 255, 315]
const FAMILIES = GREY_FAMILIES

export interface MixInput {
  role: Role
  // The surface cell of the stroke's start (ParticleSet.cell).
  cell: number
  // The stroke's value (the plan value its colour was made at), for curves.mixAmount.
  u: number
  // Where the stroke sits on screen, CSS px, for the load break.
  x: number
  y: number
  // The curve colour the mix is an offset around, fitted OKLab.
  lab: readonly number[]
  colormapped: boolean
  // The stroke's own seed, for its small personal jitter.
  seed: number
  // 0 turns the personal jitter off (the load's offset alone); default 1.
  jitter?: number
  // The jitter's two standard-normal draws, when the stroke has them (strokes
  // draw theirs from their own stream); else they come from the seed.
  jit0?: number
  jit1?: number
}

export interface MixResult {
  lab: Oklab
  // Which load this stroke belongs to (0-based, in order of creation), its index in the load, and the load's size.
  load: number
  index: number
  size: number
  // The drift factor applied: 1 on the first stroke of a load, `drift` on the last.
  kd: number
  // The load's hue offset in degrees (signed) and chroma log-factor, before the stroke's drift.
  hueOffset: number
  chromaOffset: number
  // -1, 0 or +1: a value step down, none, or up.
  step: number
}

interface Offset {
  sign: number
  mag: number
  lc: number
  lcSign: number
  fam: number
  gaussL: number
  step: number
  phi: number
  vec: number
}

interface RoleState {
  left: number
  idx: number
  size: number
  off: Offset | null
  prev: { sign: number; mag: number; lcSign: number; fam: number; step: number }
  pos: [number, number] | null
  load: number
}

const roleScale = (params: PaintParams, role: Role): number => {
  const m = params.mix
  switch (role) {
    case 'block': return m.roleBlock
    case 'form': return m.roleForm
    case 'scumble': return m.roleScumble
    case 'glaze':
    case 'reflected': return m.roleGlaze
    case 'dab': return m.roleDab
    case 'edge': return m.roleEdge
    case 'line': return m.roleLine
  }
}

// The next sign of a chain whose long-run share of + is pi (see the header).
// prev is 0 for the first, f the flip probability at pi = 0.5.
export function nextSign(prev: number, pi: number, f: number, draw: number): number {
  if (prev === 0) return draw < pi ? 1 : -1
  const lambda = Math.min(2 * f, 1 / Math.max(pi, 1 - pi))
  if (prev > 0) return draw < lambda * (1 - pi) ? -1 : 1
  return draw < lambda * pi ? 1 : -1
}

// The roles whose strokes lie on a surface and take the spatial mix.
const SPATIAL: Record<Role, boolean> = {
  block: true, form: true, scumble: true, glaze: true, reflected: true, dab: true, edge: false, line: false,
}
export const isSpatialRole = (role: Role): boolean => SPATIAL[role]

// The choice `base` (+1 or -1) of a cell, moved by a balance in -1..1: a bias b > 0
// turns a - into a + with probability b (and b < 0 a + into a - with probability -b),
// by the cell's own hash draw `u`, so the long-run share of + is (1 + b)/2.
export function biased(base: number, bias: number, u: number): number {
  if (bias > 0 && base < 0) return u < bias ? 1 : -1
  if (bias < 0 && base > 0) return u < -bias ? -1 : 1
  return base
}

export class LoadMixer {
  // How many loads have been started (a spatial cell counts once per role).
  loads = 0
  private readonly params: PaintParams
  private readonly state = new Map<Role, RoleState>()
  private readonly cells = new Map<Role, Map<number, { off: Offset; id: number }>>()
  private readonly amount: CurveFn

  constructor(params: PaintParams) {
    this.params = params
    this.amount = compileCurve(params.curves.mixAmount)
  }

  private stateOf(role: Role): RoleState {
    let st = this.state.get(role)
    if (!st) {
      st = { left: 0, idx: 0, size: 0, off: null, prev: { sign: 0, mag: 0, lcSign: 0, fam: 0, step: 0 }, pos: null, load: -1 }
      this.state.set(role, st)
    }
    return st
  }

  private newLoad(st: RoleState, role: Role, cell: number): void {
    const m = this.params.mix
    const r = randomFor(`paint/load/${role}/${cell}`, this.params.seed)
    const p = st.prev
    st.size = r.int(Math.min(m.loadMin, m.loadMax), Math.max(m.loadMin, m.loadMax))
    st.left = st.size
    st.idx = 0
    // hue: magnitude hueMin..hueMax, its sign anti-correlated with the last load
    const sign = nextSign(p.sign, (1 + m.hueBias) / 2, m.flipHue, r.next())
    const lo = Math.min(m.hueMin, m.hueMax)
    const span = Math.abs(m.hueMax - m.hueMin)
    let mag = r.range(lo, lo + span)
    if (p.mag > 0 && Math.abs(mag - p.mag) < 0.3 * span) mag += mag > lo + span / 2 ? -0.46 * span : 0.46 * span
    // chroma factor chromaMin..chromaMax (log space), alternating direction
    const lcSign = nextSign(p.lcSign, (1 + m.chromaBias) / 2, m.flipChroma, r.next())
    const up = Math.log(Math.max(1, m.chromaMax))
    const down = -Math.log(Math.min(1, Math.max(0.05, m.chromaMin)))
    const lc = lcSign > 0 ? r.range(Math.min(0.08, up), up) : -r.range(Math.min(0.08, down), down)
    // grey families: opposite families in turn (warm <-> cool, green <-> violet)
    const fam = (p.fam + 2 + (r.next() < 0.4 ? 1 : 0)) % 4
    const gaussL = r.gauss()
    // about a quarter of loads also take a value step, alternating in sign
    let step = 0
    if (r.next() < m.valueStepFraction) step = nextSign(p.step, (1 + m.valueBias) / 2, 1, r.next())
    const phi = (FAMILIES[fam] + r.range(-18, 18)) * D2R
    const vec = r.range(Math.min(m.greyVecMin, m.greyVecMax), Math.max(m.greyVecMin, m.greyVecMax))
    st.off = { sign, mag, lc, lcSign, fam, gaussL, step, phi, vec }
    st.prev = { sign, mag, lcSign, fam, step }
    this.loads++
    st.load = this.loads - 1
  }

  // The offset of a surface cell for a role: a pure function of (role, cell, seed).
  private cellOffset(role: Role, cell: number): { off: Offset; id: number } {
    let byCell = this.cells.get(role)
    if (!byCell) {
      byCell = new Map()
      this.cells.set(role, byCell)
    }
    const have = byCell.get(cell)
    if (have) return have
    const m = this.params.mix
    const r = randomFor(`paint/cell/${role}/${cell}`, this.params.seed)
    const bits = cell & 15
    // the hue sign: the cell's parity (neighbours opposite), then the balance by a cell draw
    const sign = biased(bits & 1 ? 1 : -1, m.hueBias, r.next())
    const lo = Math.min(m.hueMin, m.hueMax)
    const span = Math.abs(m.hueMax - m.hueMin)
    const mag = r.range(lo, lo + span)
    // the chroma direction: a second parity
    const lcSign = biased(bits & 2 ? 1 : -1, m.chromaBias, r.next())
    const up = Math.log(Math.max(1, m.chromaMax))
    const down = -Math.log(Math.min(1, Math.max(0.05, m.chromaMin)))
    const lc = lcSign > 0 ? r.range(Math.min(0.08, up), up) : -r.range(Math.min(0.08, down), down)
    const gaussL = r.gauss()
    // about a quarter of cells also take a value step, its direction from the cell's draw
    let step = 0
    if (r.next() < m.valueStepFraction) step = r.next() < (1 + m.valueBias) / 2 ? 1 : -1
    // the grey family: the cell's own (neighbours step to another)
    const fam = (cell >> 2) & 3
    const phi = (FAMILIES[fam] + r.range(-18, 18)) * D2R
    const vec = r.range(Math.min(m.greyVecMin, m.greyVecMax), Math.max(m.greyVecMin, m.greyVecMax))
    const made = { off: { sign, mag, lc, lcSign, fam, gaussL, step, phi, vec }, id: this.loads++ }
    byCell.set(cell, made)
    return made
  }

  // Mix one stroke. A surface stroke takes its cell's offset; a line or an edge
  // stroke takes its load's, and those must arrive in painting order, one role's
  // strokes consecutively, for loads to be what they are.
  mix(input: MixInput): MixResult {
    const params = this.params
    const m = params.mix
    const s = m.strength * roleScale(params, input.role) * this.amount(input.u)
    const lab = input.lab
    if (s <= 0) {
      return { lab: [lab[0], lab[1], lab[2]], load: -1, index: 0, size: 0, kd: 0, hueOffset: 0, chromaOffset: 0, step: 0 }
    }
    if (SPATIAL[input.role]) {
      const c = this.cellOffset(input.role, input.cell)
      // the drift: a seeded place in the cell, from the stroke's own seed
      const kd = 1 - (1 - m.drift) * hash01(input.seed, input.cell, 0x2f6e2b1)
      return this.apply(input, s, c.off, kd, c.id, 0, 1)
    }
    const st = this.stateOf(input.role)
    if (!st.off || st.left <= 0 || (st.pos && Math.hypot(input.x - st.pos[0], input.y - st.pos[1]) > m.loadBreakPx)) {
      this.newLoad(st, input.role, input.cell)
    }
    const off = st.off as Offset
    const kd = 1 - (1 - m.drift) * (st.size > 1 ? st.idx / (st.size - 1) : 0)
    const index = st.idx
    st.idx++
    st.left--
    st.pos = [input.x, input.y]
    return this.apply(input, s, off, kd, st.load, index, st.size)
  }

  // The stroke's colour: the curve colour moved by an offset, scaled by the drift.
  private apply(input: MixInput, s: number, off: Offset, kd: number, load: number, index: number, size: number): MixResult {
    const params = this.params
    const m = params.mix
    const lab = input.lab
    const hs = input.colormapped ? m.colormapScale : 1
    const hold = input.colormapped
    // value: held within ±valueHold; a value step replaces the small noise
    let dL: number
    if (hold) dL = clamp(off.gaussL * 0.003, -0.004, 0.004)
    else if (off.step !== 0) dL = off.step * m.valueStep * clamp(s, 0.4, 1)
    else dL = clamp(off.gaussL * 0.004, -m.valueHold, m.valueHold)
    const dh = off.sign * off.mag * s * hs
    const lc = clamp(off.lc * s, -0.5, 0.45) * hs
    const vec = off.vec * s * hs
    // the stroke's own small personal jitter
    let g0 = 0
    let g1 = 0
    if (input.jitter !== 0) {
      if (input.jit0 !== undefined && input.jit1 !== undefined) {
        g0 = input.jit0
        g1 = input.jit1
      } else {
        const jr = randomFor(`paint/mixjit/${input.seed}`, params.seed)
        g0 = jr.gauss()
        g1 = jr.gauss()
      }
    }
    const jdh = g0 * 2 * s * hs
    // the chroma factor, with the personal jitter, stays inside the sliders' range (a colormapped colour's share of it):
    // the jitter was added after the clamp and pushed chroma past chromaMax and under chromaMin
    const lcLo = Math.log(Math.max(0.05, Math.min(1, m.chromaMin))) * hs
    const lcHi = Math.log(Math.max(1, m.chromaMax)) * hs
    const lcAll = clamp(lc + g1 * 0.04 * s * hs, lcLo, lcHi)

    const lch = labToLch(lab)
    const C0 = lch[1]
    const wl = 1 - smooth(m.greyChroma - 0.02, m.greyChroma + 0.02, C0) // low chroma: offset a/b directly
    const L = lch[0] + dL * kd
    const l1 = fitLch([L, C0 * Math.exp(lcAll * kd), lch[2] + (dh + jdh) * kd])
    const v = vec * kd
    const a2 = lab[1] + v * Math.cos(off.phi)
    const b2 = lab[2] + v * Math.sin(off.phi)
    const out = fitLab([L, l1[1] * (1 - wl) + a2 * wl, l1[2] * (1 - wl) + b2 * wl])
    return { lab: out, load, index, size, kd, hueOffset: dh, chromaOffset: lc, step: hold ? 0 : off.step }
  }
}
