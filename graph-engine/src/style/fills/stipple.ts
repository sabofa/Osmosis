import { smoothNoise } from '../random'
import { boundsOfPolygons, hatchLength, insideRegion, MARK_BUDGET, regionPolygons } from './region'
import type { FillType } from './types'

// STIPPLE — the region shaded with dots, the engraver's way.
//
// Built on a grid `spacing` apart, each dot jittered by up to a third of a
// spacing and sized a little unevenly, seeded; a dot is kept only when its
// CENTRE is inside the region (so none lands in a hole). The pen clips the
// dots to the exact outline as well, so none spills over the edge.
//
// Roughness widens the jitter and the size spread, and clumps the dots: a
// slow 2D density built from two independent noises over the box's
// normalised x and y thins the dots in some patches and, now and then,
// doubles one with a satellite beside it. Centres stay inside the region
// exactly as before — roughness never lets a dot escape a hole.

export const stipple: FillType = {
  draw({ outline, settings, random }) {
    const polygons = regionPolygons(outline)
    const box = boundsOfPolygons(polygons)
    const r = settings.roughness
    // About one dot per spacing squared of area (the area is the hatch
    // length at that spacing times the spacing); past the budget the grid
    // opens out until the count fits.
    const expected = hatchLength(polygons, 0, settings.spacing) / settings.spacing
    const step = expected > MARK_BUDGET.dots ? settings.spacing * Math.sqrt(expected / MARK_BUDGET.dots) : settings.spacing
    const jitter = 0.35 + 0.25 * r
    const width = Math.max(1e-6, box.maxX - box.minX)
    const height = Math.max(1e-6, box.maxY - box.minY)
    const nx = r > 0 ? smoothNoise(random, 5) : null
    const ny = r > 0 ? smoothNoise(random, 5) : null
    const dots: { at: { x: number; y: number }; r: number }[] = []
    for (let y = Math.floor(box.minY / step) * step; y <= box.maxY + step; y += step) {
      for (let x = Math.floor(box.minX / step) * step; x <= box.maxX + step; x += step) {
        const at = { x: x + random.range(-jitter, jitter) * step, y: y + random.range(-jitter, jitter) * step }
        const size = r > 0 ? 1 + r * random.range(-0.4, 0.8) : 1
        const dotR = step * (0.1 + 0.08 * random.next()) * size
        if (!insideRegion(at, polygons)) continue
        if (nx && ny) {
          const density = (nx((x - box.minX) / width) + ny((y - box.minY) / height)) / 2
          if (random.next() < r * 0.6 * (0.5 - 0.5 * density)) continue
        }
        dots.push({ at, r: dotR })
        // A satellite dot beside this one, now and then: two grains that
        // fell together.
        if (r > 0 && random.next() < 0.05 * r) {
          const satAngle = random.range(0, 2 * Math.PI)
          const satDist = dotR * random.range(1, 2)
          const satAt = { x: at.x + Math.cos(satAngle) * satDist, y: at.y + Math.sin(satAngle) * satDist }
          if (insideRegion(satAt, polygons)) dots.push({ at: satAt, r: dotR * 0.7 })
        }
      }
    }
    return { marks: [{ kind: 'dots', dots }] }
  },
}
