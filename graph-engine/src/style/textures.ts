import type { Texture } from './lines/types'
import { tag, type Box } from './markup'

// Textures: the grain in graphite, the dust in chalk, the soft edge of ink.
//
// Each is an SVG filter laid over EVERYTHING drawn in one line type (the pen
// puts it on the stroke layers), so it is computed once per figure rather
// than once per stroke. A texture only changes how the ink covers the page —
// knocking specks out of it, softening its edge — and never where a line is:
// no displacement, ever. Geometry comes from lines/.
//
// The filter region is given in drawing units (userSpaceOnUse) and covers
// the whole figure: a filter sized by each element's own bounding box would
// be zero pixels tall on a horizontal line, and the line would vanish.

// The seed of the noise itself. Fixed: the noise is the paper's grain, which
// does not change from figure to figure.
const NOISE_SEED = 7

// A mask from noise: alpha = gain × noise − cut, clamped by the renderer. The
// larger the cut, the more of the line the grain knocks out.
function speckle(baseFrequency: number, octaves: number, gain: number, cut: number): string[] {
  return [
    tag('feTurbulence', { type: 'fractalNoise', baseFrequency, numOctaves: octaves, seed: NOISE_SEED, result: 'noise' }),
    tag('feColorMatrix', { in: 'noise', type: 'matrix', values: `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${gain} 0 0 0 ${-cut}`, result: 'speck' }),
  ]
}

export function textureFilter(texture: Texture, id: string, region: Box): string {
  const frame = { id, filterUnits: 'userSpaceOnUse', x: region.x, y: region.y, width: region.width, height: region.height, 'color-interpolation-filters': 'sRGB' }
  const s = Math.min(1, Math.max(0, texture.strength))
  switch (texture.name) {
    // Graphite: fine, dense specks knocked out of every pass; stronger grain
    // knocks out more.
    case 'grain':
      return tag('filter', frame, [
        ...speckle(0.9, 2, 7, 7 * (0.26 + 0.12 * s) - 1),
        tag('feComposite', { in: 'SourceGraphic', in2: 'speck', operator: 'in' }),
      ])
    // Chalk: coarser, patchier breaks, and a soft, dusty edge.
    case 'chalk':
      return tag('filter', frame, [
        tag('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 0.35 + 0.25 * s, result: 'soft' }),
        ...speckle(0.55, 3, 6, 6 * (0.3 + 0.2 * s) - 1),
        tag('feComposite', { in: 'soft', in2: 'speck', operator: 'in' }),
      ])
    // Ink: a faint halo where the ink wicks into the paper, under the line,
    // plus — rising gently with strength — a few pinholes knocked out of the
    // line itself: a nib running dry rather than a break in the stroke. The
    // cut starts high (little survives past it at low strength, so only the
    // odd fleck shows) and eases as strength grows.
    case 'bleed': {
      const cut = 6 * (0.66 + 0.5 * s) - 1
      return tag('filter', frame, [
        tag('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 0.25 + 0.5 * s, result: 'halo' }),
        tag('feComponentTransfer', { in: 'halo', result: 'faint' }, [tag('feFuncA', { type: 'linear', slope: 0.55 })]),
        tag('feMerge', { result: 'merged' }, [tag('feMergeNode', { in: 'faint' }), tag('feMergeNode', { in: 'SourceGraphic' })]),
        ...speckle(0.7, 2, 6, cut),
        tag('feComposite', { in: 'merged', in2: 'speck', operator: 'in' }),
      ])
    }
    // Watercolour: broad, slow noise varying how strongly the tint covers,
    // so a wash is blotchy rather than flat.
    case 'wash':
      return tag('filter', frame, [
        tag('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.012, numOctaves: 3, seed: NOISE_SEED, result: 'noise' }),
        tag('feColorMatrix', { in: 'noise', type: 'matrix', values: `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${0.6 + 1.4 * s} 0 0 0 ${0.7 - 1.1 * s}`, result: 'blotch' }),
        tag('feComposite', { in: 'SourceGraphic', in2: 'blotch', operator: 'in' }),
      ])
    // Flat's fainter cousin: the same idea as wash, higher-frequency noise
    // and a much smaller swing, so a flat tint looks laid by hand without
    // reading as watercolour.
    case 'mottle':
      return tag('filter', frame, [
        tag('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.04, numOctaves: 2, seed: NOISE_SEED, result: 'noise' }),
        tag('feColorMatrix', { in: 'noise', type: 'matrix', values: `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${0.6 * s} 0 0 0 ${1 - 0.3 * s}`, result: 'blotch' }),
        tag('feComposite', { in: 'SourceGraphic', in2: 'blotch', operator: 'in' }),
      ])
    // A plain blur: a wash's pooled rim, soft on the inside.
    case 'soften':
      return tag('filter', frame, [tag('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 1 + 2 * s })])
  }
}
