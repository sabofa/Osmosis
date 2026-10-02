// Brush-load mixing (spec §3.5): colour distortion as a fresh paint mix per
// brush load. Every load of the brush is mixed a little differently, so no two
// patches of "the same" colour are quite the same paint: a different hue at
// the same value, or a different hue and lightness at about the same value.
//
// - A load is a run of loadMin..loadMax consecutive strokes of one role, in
//   painting order. It breaks when the next stroke is more than loadBreakPx
//   away. Its offset is seeded by randomFor('paint/load/' + role + '/' + cell,
//   seed), where cell is the surface cell of the load's first stroke, so a
//   load keeps its mix as the camera orbits.
// - The offset around the curve colour: hue ±hueMin..hueMax degrees (OKLCH),
//   chroma ×chromaMin..chromaMax, lightness held within ±valueHold of the
//   target, and valueStepFraction of loads also take a value step of ±valueStep.
// - A grey (chroma under greyChroma) takes an a/b vector of greyVecMin..Max
//   toward one of four families instead: warm, cool, green-grey, violet-grey.
// - Anti-correlation: the next load flips the hue sign with probability
//   flipHue and the chroma direction with flipChroma; the grey family steps to
//   its opposite. Adjacent patches contrast gently instead of averaging out.
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
import { clamp, D2R, smooth } from './math'
import { compileCurve, type CurveFn } from './respond'

// Grey families, as an angle in OKLab a/b: warm, cool, green-grey, violet-grey.
const FAMILIES = [62, 255, 135, 315]

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

export class LoadMixer {
  // How many loads have been started.
  loads = 0
  private readonly params: PaintParams
  private readonly state = new Map<Role, RoleState>()
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

  // Mix one stroke. Strokes must arrive in painting order, one role's strokes
  // consecutively, for loads to be what they are.
  mix(input: MixInput): MixResult {
    const params = this.params
    const m = params.mix
    const s = m.strength * roleScale(params, input.role) * this.amount(input.u)
    const st = this.stateOf(input.role)
    const lab = input.lab
    if (s <= 0) {
      return { lab: [lab[0], lab[1], lab[2]], load: -1, index: 0, size: 0, kd: 0, hueOffset: 0, chromaOffset: 0, step: 0 }
    }
    if (!st.off || st.left <= 0 || (st.pos && Math.hypot(input.x - st.pos[0], input.y - st.pos[1]) > m.loadBreakPx)) {
      this.newLoad(st, input.role, input.cell)
    }
    const off = st.off as Offset
    const kd = 1 - (1 - m.drift) * (st.size > 1 ? st.idx / (st.size - 1) : 0)
    const index = st.idx
    st.idx++
    st.left--
    st.pos = [input.x, input.y]

    const hs = input.colormapped ? m.colormapScale : 1
    const hold = input.colormapped
    // value: held within ±valueHold; a value step replaces the small noise
    let dL: number
    if (hold) dL = clamp(off.gaussL * 0.003, -0.004, 0.004)
    else if (off.step !== 0) dL = off.step * m.valueStep * clamp(s, 0.4, 1.5)
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
    const jlc = g1 * 0.04 * s * hs

    const lch = labToLch(lab)
    const C0 = lch[1]
    const wl = 1 - smooth(m.greyChroma - 0.02, m.greyChroma + 0.02, C0) // low chroma: offset a/b directly
    const L = lch[0] + dL * kd
    const l1 = fitLch([L, C0 * Math.exp((lc + jlc) * kd), lch[2] + (dh + jdh) * kd])
    const v = vec * kd
    const a2 = lab[1] + v * Math.cos(off.phi)
    const b2 = lab[2] + v * Math.sin(off.phi)
    const out = fitLab([L, l1[1] * (1 - wl) + a2 * wl, l1[2] * (1 - wl) + b2 * wl])
    return { lab: out, load: st.load, index, size: st.size, kd, hueOffset: dh, chromaOffset: lc, step: hold ? 0 : off.step }
  }
}
