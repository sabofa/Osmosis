import { boundsOfPolygons, insideRegion, regionPolygons } from './region'
import type { FillType } from './types'

// STIPPLE — the region shaded with dots, the engraver's way.
//
// Built on a grid `spacing` apart, each dot jittered by up to a third of a
// spacing and sized a little unevenly, seeded; a dot is kept only when its
// CENTRE is inside the region (so none lands in a hole). The pen clips the
// dots to the exact outline as well, so none spills over the edge.

export const stipple: FillType = {
  draw({ outline, settings, random }) {
    const polygons = regionPolygons(outline)
    const box = boundsOfPolygons(polygons)
    const step = settings.spacing
    const dots: { at: { x: number; y: number }; r: number }[] = []
    for (let y = Math.floor(box.minY / step) * step; y <= box.maxY + step; y += step) {
      for (let x = Math.floor(box.minX / step) * step; x <= box.maxX + step; x += step) {
        const at = { x: x + random.range(-0.35, 0.35) * step, y: y + random.range(-0.35, 0.35) * step }
        const r = step * (0.1 + 0.08 * random.next())
        if (insideRegion(at, polygons)) dots.push({ at, r })
      }
    }
    return { marks: [{ kind: 'dots', dots }] }
  },
}
