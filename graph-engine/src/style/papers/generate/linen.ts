// Fine primed linen: a gesso layer fills the weave's valleys, so the texture is
// mostly a gentle relief of thread tops and slubs at low contrast. Ported from
// the mockup's papers.js buildLinen (the paper Ben approved in zoom-linen.png):
// the weave, the priming, a mottle and a warm/cool drift in the tone, and loose
// fibres. (The mockup's faint brush marks in the priming are left out: at 0.012
// of a unit field they are 0.2% of the height variance, a gradient a twentieth
// of the weave's, and the painter's own canvas tile has none.)

import { fibrePass } from './fibres'
import type { FibreSpec } from './fibres'
import { fbmFieldN, mixFields, normStd, scaleCells } from './noise'
import { srgb8ToOklab } from './oklab'
import type { Vec3 } from './oklab'
import { BRIGHTNESS, composeOffsets, DRIFT } from './structure'
import type { Structure } from './structure'
import { prime, weaveField } from './weave'
import type { WeaveSpec } from './weave'
import { randomFor } from '../../random'

// 192 threads across a 1024-texel tile: a pitch of 5.33 texels.
const LINEN: WeaveSpec = {
  pitch: 1024 / 192,
  width: [0.86, 1.04],
  fatP: 0.05,
  narrowP: 0.05,
  thick: 0.28,
  wander: 0.28,
  jit: 0.13,
  slubP: 0.5,
  slubAmp: [0.5, 1.3],
  slubSig: [25, 110],
  bright: [0.94, 1.05],
  occl: 0.9,
  streak: 0.08,
}

const FILL = 0.72
const LEVEL = 0.6
const BRIGHTNESS_AMOUNT = 0.4
const HEIGHT_SD = 0.15

// A fibre's colour as an OKLab offset from the mockup's linen tone.
const LINEN_TONE: Vec3 = [234, 228, 214]
function fibreDelta(rgb: Vec3): Vec3 {
  const base = srgb8ToOklab(LINEN_TONE[0], LINEN_TONE[1], LINEN_TONE[2])
  const c = srgb8ToOklab(rgb[0], rgb[1], rgb[2])
  return [c[0] - base[0], c[1] - base[1], c[2] - base[2]]
}

const FIBRES: FibreSpec = {
  count: 500,
  len: [30, 110],
  curl: 0.1,
  wid: [0.5, 0.9],
  alpha: [0.03, 0.06],
  colours: [
    { delta: fibreDelta([160, 145, 118]), weight: 1 },
    { delta: fibreDelta([250, 244, 228]), weight: 1 },
  ],
}

export function buildLinen(size: number, seed: string): Structure {
  const s = size / 1024
  const id = (stage: string) => randomFor(`paper/linen/${seed}/${stage}`)
  const weave = weaveField(id('weave'), size, LINEN)
  const height = weave.H
  prime(height, LEVEL, FILL)
  normStd(height, HEIGHT_SD)

  const cloud = fbmFieldN(id('mottle-low'), size, { cx: scaleCells(3, size), octaves: 3, warp: { amp: 50 * s, cx: scaleCells(3, size) }, grid: 128 })
  const grain = fbmFieldN(id('mottle-high'), size, { cx: scaleCells(12, size), octaves: 3, grid: 384 })
  const drift = fbmFieldN(id('drift'), size, { cx: scaleCells(3, size), octaves: 2, grid: 128 })
  const mottle = mixFields([
    { field: cloud, amount: 0.014 },
    { field: grain, amount: 0.009 },
  ])
  const offsets = composeOffsets(size, weave.K, BRIGHTNESS_AMOUNT, [
    { field: mottle, amount: 1, sensitivity: BRIGHTNESS },
    { field: drift, amount: 0.007, sensitivity: DRIFT },
  ])
  fibrePass(offsets, size, id('fibres'), FIBRES)
  return { size, offsets, deviation: height }
}
