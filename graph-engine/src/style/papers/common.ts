import { tag, type Attributes, type Box } from '../markup'
import type { PaperInput } from './types'

// What the papers share: the area they cover, a sheet of colour over it, and
// a grain made of noise.

// Three view boxes beyond the figure on every side: seven across in all.
export function cover(view: Box): Box {
  return { x: view.x - 3 * view.width, y: view.y - 3 * view.height, width: 7 * view.width, height: 7 * view.height }
}

// A rectangle over the whole cover, painted with `fill` (a colour, or a
// pattern's url).
export function sheet(view: Box, fill: string, extra: Attributes = {}): string {
  const box = cover(view)
  return tag('rect', { x: box.x, y: box.y, width: box.width, height: box.height, fill, ...extra })
}

// A tile of noise, repeated: specks of darker fibre on transparent. Drawn
// once into a pattern tile (with stitched turbulence, so the tile repeats
// seamlessly) rather than filtered over the whole cover, which keeps a
// seven-view-wide sheet cheap to draw and to pan.
//
// `frequency` sets the grain's size (higher is finer, and a pair "fx fy"
// stretches it into fibres). Only the noise above `threshold` shows, with an
// opacity of `gain` per unit above it — so a high threshold gives sparse
// specks and a low gain a faint tooth. `seed` picks the noise itself.
export function grain(input: PaperInput, name: string, frequency: string, octaves: number, gain: number, threshold: number, seed: number): { defs: string[]; fill: string } {
  const tile = 240
  const filter = input.id(`${name}-noise`)
  const pattern = input.id(name)
  return {
    defs: [
      tag('filter', { id: filter, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' }, [
        tag('feTurbulence', { type: 'fractalNoise', baseFrequency: frequency, numOctaves: octaves, seed, stitchTiles: 'stitch', result: 'noise' }),
        tag('feColorMatrix', { in: 'noise', type: 'matrix', values: `0 0 0 0 0.24 0 0 0 0 0.2 0 0 0 0 0.14 ${gain} 0 0 0 ${-gain * threshold}` }),
      ]),
      tag('pattern', { id: pattern, patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: tile, height: tile }, [
        tag('rect', { x: 0, y: 0, width: tile, height: tile, filter: `url(#${filter})` }),
      ]),
    ],
    fill: `url(#${pattern})`,
  }
}
