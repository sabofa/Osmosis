// A GRAIN paper: no weave, only the stuff paper is made of. Layers of tileable noise at three sizes
// (the tooth, a finer one on top of it, and the slow cloudiness of the sheet, its "formation"), fibres
// lying on the sheet, and flecks of something darker. Each type is its own recipe of these (the
// files beside this one): fine writing paper is a quiet tooth, rough paper a coarse one with long
// fibres, kraft is fibres and flecks, and the ruled papers (notebook, graph, dotted) are a quiet tooth
// to draw their lines over.
//
// Everything is an OKLab OFFSET around the base tone and a height (the tooth that colourise.ts lights
// from a grazing angle), seeded by (type, seed, stage) and periodic, so it tiles.

import { fibrePass } from '../fibres'
import type { FibreSpec } from '../fibres'
import { fbmFieldN, scaleCells, upsamplePeriodic } from '../noise'
import type { Structure } from '../structure'
import type { GeneratedPaperType } from '../types'
import type { Vec3 } from '../oklab'
import { addLayer, centreOffsets, speckPass, stageOf, WARM } from './support'
import type { SpeckSpec } from './support'

// A noise layer: lattice cells across a 1024-texel tile (a smaller tile has fewer, so the SIZE of a
// feature in texels stays put), octaves, and its amount as the standard deviation of dL.
export interface NoiseLayer {
  cells: number
  octaves: number
  amount: number
}

export interface GrainSpec {
  tooth: NoiseLayer
  fine?: NoiseLayer
  cloud: NoiseLayer
  // How a lightness change drifts in colour (default: lighter is a touch yellower).
  sensitivity?: Vec3
  fibres?: FibreSpec
  flecks?: SpeckSpec
  // The standard deviation of the height (the tooth the light finds).
  heightSd: number
}

export function buildGrain(type: GeneratedPaperType, size: number, seed: string, spec: GrainSpec): Structure {
  const sens = spec.sensitivity ?? WARM
  const off = new Float32Array(3 * size * size)

  const tooth = fbmFieldN(stageOf(type, seed, 'tooth'), size, { cx: scaleCells(spec.tooth.cells, size), octaves: spec.tooth.octaves })
  addLayer(off, size, tooth, spec.tooth.amount, sens)
  const toothFull = upsamplePeriodic(tooth.data, tooth.w, tooth.h, size, size)
  const deviation = new Float32Array(size * size)
  let norm = 1
  if (spec.fine) {
    const fine = fbmFieldN(stageOf(type, seed, 'fine'), size, { cx: scaleCells(spec.fine.cells, size), octaves: spec.fine.octaves })
    addLayer(off, size, fine, spec.fine.amount, sens)
    const fineFull = upsamplePeriodic(fine.data, fine.w, fine.h, size, size)
    // The height is the tooth with the finer grain riding on it.
    norm = 1 / Math.sqrt(1.25)
    for (let i = 0; i < deviation.length; i++) deviation[i] = (toothFull[i] + 0.5 * fineFull[i]) * norm * spec.heightSd
  } else {
    for (let i = 0; i < deviation.length; i++) deviation[i] = toothFull[i] * spec.heightSd
  }

  const cloud = fbmFieldN(stageOf(type, seed, 'cloud'), size, {
    cx: scaleCells(spec.cloud.cells, size),
    octaves: spec.cloud.octaves,
    warp: { amp: 40 * (size / 1024), cx: scaleCells(3, size) },
    grid: 128,
  })
  addLayer(off, size, cloud, spec.cloud.amount, sens)

  if (spec.flecks) speckPass(off, size, stageOf(type, seed, 'flecks'), spec.flecks)
  if (spec.fibres) fibrePass(off, size, stageOf(type, seed, 'fibres'), spec.fibres)
  centreOffsets(off)
  return { size, offsets: off, deviation }
}
