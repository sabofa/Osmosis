// A CHALKBOARD: slate, and what is left on it. The slate is a fine, dense grain with a slower mottle in
// its tone and the faint horizontal drag marks of a cloth wiped across it; the chalk that was wiped off
// leaves an ERASED HAZE, broad pale smears that sweep across the board (a lightness of +0.02 to +0.05
// where they lie, in the direction the cloth went, patchy and streaked), a scatter of tiny bright chalk
// bits and a few longer pale smudges. The dust that gathers in the tray along the lower edge is not in the
// tile (it belongs to the bottom of the figure): see papers/generated.ts.
//
// The blackboard and the greenboard are the same slate and the same hand, on different base tones (the
// theme's board colour: generated.ts), each from its own seed stream. Nothing here knows the colour, or
// the mode of the app: a board is the same in light and in dark.

import { fbmFieldN, scaleCells, upsamplePeriodic } from '../noise'
import type { Structure } from '../structure'
import type { GeneratedPaperType } from '../types'
import { addLayer, centreOffsets, NEUTRAL, smoothstep, speckPass, stageOf } from './support'

// The haze at its strongest, as a lightness offset. (Texture scales it, like everything else.)
const HAZE_TOP = 0.05

export function buildBoard(type: GeneratedPaperType, size: number, seed: string): Structure {
  const s = size / 1024
  const off = new Float32Array(3 * size * size)

  // The slate.
  const grain = fbmFieldN(stageOf(type, seed, 'grain'), size, { cx: scaleCells(260, size), octaves: 2 })
  addLayer(off, size, grain, 0.009, NEUTRAL)
  const mottle = fbmFieldN(stageOf(type, seed, 'mottle'), size, { cx: scaleCells(24, size), octaves: 3, grid: 256 })
  addLayer(off, size, mottle, 0.005, NEUTRAL)
  // The drag marks of a cloth: very thin across the stroke (many lattice rows), very long along it (a cell or two).
  const drag = fbmFieldN(stageOf(type, seed, 'drag'), size, { cx: scaleCells(2, size), cy: scaleCells(90, size), octaves: 2, grid: [Math.min(size, 64), size] })
  addLayer(off, size, drag, 0.0035, NEUTRAL)

  // The erased haze: a field stretched along x (few cells across, more down), warped into sweeps, kept
  // where it is above a threshold so it lies in patches, and streaked by a finer drag field.
  const wipe = fbmFieldN(stageOf(type, seed, 'haze'), size, {
    cx: scaleCells(2, size),
    cy: scaleCells(6, size),
    octaves: 3,
    warp: { amp: 90 * s, cx: scaleCells(2, size) },
    grid: 128,
  })
  const wipeFull = upsamplePeriodic(wipe.data, wipe.w, wipe.h, size, size)
  const streaks = fbmFieldN(stageOf(type, seed, 'haze-streaks'), size, { cx: scaleCells(3, size), cy: scaleCells(60, size), octaves: 2, grid: [Math.min(size, 64), size] })
  const streakFull = upsamplePeriodic(streaks.data, streaks.w, streaks.h, size, size)
  for (let i = 0; i < wipeFull.length; i++) {
    const patch = smoothstep(0.15, 1.5, wipeFull[i])
    const streak = 0.7 + 0.3 * Math.max(-1, Math.min(1, streakFull[i]))
    off[3 * i] += HAZE_TOP * patch * streak
  }

  // Chalk bits: tiny bright specks, and a few longer, fainter smudges.
  speckPass(off, size, stageOf(type, seed, 'bits'), { count: 170, radius: [0.5, 1.2], stretch: [0.4, 1], alpha: [0.4, 0.9], delta: [[0.05, 0, 0], [0.12, 0, 0]] })
  speckPass(off, size, stageOf(type, seed, 'smudges'), { count: 28, radius: [3, 9], stretch: [0.2, 0.5], alpha: [0.12, 0.3], delta: [[0.03, 0, 0], [0.06, 0, 0]] })

  // The relief the light finds: the slate's fine tooth.
  const deviation = new Float32Array(size * size)
  const grainFull = upsamplePeriodic(grain.data, grain.w, grain.h, size, size)
  const mottleFull = upsamplePeriodic(mottle.data, mottle.w, mottle.h, size, size)
  for (let i = 0; i < deviation.length; i++) deviation[i] = 0.1 * grainFull[i] + 0.04 * mottleFull[i]

  centreOffsets(off)
  return { size, offsets: off, deviation }
}
