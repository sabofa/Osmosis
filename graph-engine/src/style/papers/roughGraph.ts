import { tag, num } from '../markup'
import { smoothNoise } from '../random'
import { grain, sheet } from './common'
import { MAJOR, MINOR } from './graph'
import type { PaperType } from './types'

// ROUGH-GRAPH — a grid ruled by hand on grainy paper: the lines waver a
// little, vary in weight, and do not quite agree on their spacing.
//
// Built as a pattern tile five grid squares wide (like graph), but each of
// its lines is a gently wavering path, seeded, and pinned to the same place
// at both edges of the tile so the tiles join without a seam; then the
// paper's grain over it. The waver grows with `texture`.

export const roughGraph: PaperType = {
  draw(input) {
    const { settings, view, tint, id, colour, random } = input
    const g = settings.grid
    const tile = 5 * g
    const waver = 0.25 + 1.1 * settings.texture
    // A line across the tile at `at`, wavering by up to `waver` units, its
    // ends pinned so the next tile carries on from it.
    const ruled = (at: number, vertical: boolean, stroke: string, width: number) => {
      const noise = smoothNoise(random, 5)
      const offset = random.range(-0.25, 0.25) * waver
      const points: string[] = []
      for (let i = 0; i <= 20; i++) {
        const t = i / 20
        const d = at + (offset + waver * noise(t)) * Math.sin(Math.PI * t)
        const s = t * tile
        points.push(vertical ? `${num(d)},${num(s)}` : `${num(s)},${num(d)}`)
      }
      return tag('polyline', { points: points.join(' '), fill: 'none', stroke, 'stroke-width': width * random.range(0.75, 1.25), 'stroke-linecap': 'round' })
    }
    const lines: string[] = []
    for (let k = 0; k < 5; k++) {
      const major = k === 0
      lines.push(ruled(k * g, true, colour(major ? MAJOR : MINOR), major ? 1 : 0.55))
      lines.push(ruled(k * g, false, colour(major ? MAJOR : MINOR), major ? 1 : 0.55))
    }
    const pattern = tag('pattern', { id: id('rough-graph'), patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: tile, height: tile }, lines)
    const fine = grain(input, 'rough-graph-grain', '0.5', 3, 0.8 * settings.texture, 0.45, 17)
    return {
      defs: [pattern, ...fine.defs],
      background: [sheet(view, tint), sheet(view, fine.fill), sheet(view, `url(#${id('rough-graph')})`)],
    }
  },
}
