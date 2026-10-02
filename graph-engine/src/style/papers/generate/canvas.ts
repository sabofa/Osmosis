// Cotton duck: a coarse plain weave of heavier, more irregular threads, primed
// with gesso. Ported from the mockup's painter.js getCanvasTile('duck'): the
// same weave field, with the priming filling less of the valley than linen's so
// the tooth stays strong, plus a faint mottle of the cloth's tone.

import { fbmFieldN, mixFields, normStd, scaleCells } from './noise'
import { BRIGHTNESS, composeOffsets } from './structure'
import type { Structure } from './structure'
import { prime, weaveField } from './weave'
import type { WeaveSpec } from './weave'
import { randomFor } from '../../random'

// 128 threads across a 1024-texel tile: a pitch of 8 texels.
const DUCK: WeaveSpec = {
  pitch: 8,
  width: [0.84, 1.06],
  fatP: 0.05,
  narrowP: 0.05,
  thick: 0.32,
  wander: 0.3,
  jit: 0.14,
  slubP: 0.4,
  slubAmp: [0.4, 1.1],
  slubSig: [25, 100],
  bright: [0.93, 1.06],
  occl: 0.88,
  streak: 0.09,
}

const FILL = 0.45 // how much of the valley the priming fills
const LEVEL = 0.6 // the height the priming fills up to
const BRIGHTNESS_AMOUNT = 0.45 // thread brightness's share of the mockup's albedo
const HEIGHT_SD = 0.2

export function buildCanvas(size: number, seed: string): Structure {
  const s = size / 1024
  const id = (stage: string) => randomFor(`paper/canvas/${seed}/${stage}`)
  const weave = weaveField(id('weave'), size, DUCK)
  const height = weave.H
  prime(height, LEVEL, FILL)
  normStd(height, HEIGHT_SD)

  const cloud = fbmFieldN(id('mottle-low'), size, { cx: scaleCells(3, size), octaves: 3, warp: { amp: 50 * s, cx: scaleCells(3, size) }, grid: 128 })
  const grain = fbmFieldN(id('mottle-high'), size, { cx: scaleCells(12, size), octaves: 3, grid: 384 })
  const mottle = mixFields([
    { field: cloud, amount: 0.016 },
    { field: grain, amount: 0.01 },
  ])
  const offsets = composeOffsets(size, weave.K, BRIGHTNESS_AMOUNT, [{ field: mottle, amount: 1, sensitivity: BRIGHTNESS }])
  return { size, offsets, deviation: height }
}
