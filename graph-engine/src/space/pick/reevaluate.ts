// Re-evaluating a hit against a new scene (plan E10): a pin stores where it
// is on its mark (Hit.at), not pixels, so after a setValue it follows the
// true function — a pin on z = a x^2 at x = 1 reads z = 2 once a is 2. The
// mark is found by its source object, which is stable across rebuilds. Pure.
//
// A hit whose mark is gone, or whose re-evaluated point is not finite, is
// null: the pin is dropped.

import type { Mark, SpaceScene, Vec3 } from '../scene/types'
import { arrowReadout, curveReadout, graphReadout, implicitReadout, parametricReadout, pointReadout } from './readout'
import type { Hit } from './types'

const IMPLICIT_STEPS = 8

function finite(p: Vec3): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])
}

function vertex(a: Float64Array, i: number): Vec3 | null {
  return 3 * i + 2 < a.length ? [a[3 * i], a[3 * i + 1], a[3 * i + 2]] : null
}

function markOf(scene: SpaceScene, hit: Hit): Mark | undefined {
  return scene.marks.find((m) => m.source.object === hit.source.object)
}

export function reevaluate(hit: Hit, scene: SpaceScene): Hit | null {
  const mark = markOf(scene, hit)
  if (!mark) return null
  const at = hit.at
  const done = (position: Vec3, values: Hit['values'], next: Hit['at']): Hit | null =>
    finite(position) ? { source: mark.source, kind: hit.kind, position, values, at: next } : null
  switch (at.kind) {
    case 'graph': {
      if (mark.kind !== 'mesh' || mark.pick?.kind !== 'graph') return null
      const p: Vec3 = [at.x, at.y, mark.pick.f(at.x, at.y)]
      return done(p, graphReadout(p, mark.pick.fx(at.x, at.y), mark.pick.fy(at.x, at.y)), at)
    }
    case 'parametric': {
      if (mark.kind !== 'mesh' || mark.pick?.kind !== 'parametric') return null
      const p = mark.pick.r(at.u, at.v)
      return done(p, parametricReadout(p, mark.pick.param, at.u, at.v), at)
    }
    case 'implicit': {
      if (mark.kind !== 'mesh' || mark.pick?.kind !== 'implicit') return null
      // Back onto the new level set along the gradient: p <- p - F grad / |grad|^2.
      const { F, grad } = mark.pick
      let p = at.point
      for (let k = 0; k < IMPLICIT_STEPS; k++) {
        const g = grad(...p)
        const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2]
        const f = F(...p)
        if (f === 0 || !(g2 > 0)) break
        p = [p[0] - (f * g[0]) / g2, p[1] - (f * g[1]) / g2, p[2] - (f * g[2]) / g2]
      }
      return done(p, implicitReadout(p, grad(...p)), { kind: 'implicit', point: p })
    }
    case 'curve': {
      if (mark.kind !== 'lines') return null
      if (at.t !== null && mark.pick) {
        const p = mark.pick.r(at.t)
        return done(p, curveReadout(p, mark.pick.param, at.t, mark.pick.dr(at.t)), { kind: 'curve', t: at.t, point: p })
      }
      return done(at.point, curveReadout(at.point, null, null, null), at)
    }
    case 'point': {
      if (mark.kind !== 'points') return null
      const p = vertex(mark.positions, at.index)
      if (!p) return null
      const label = at.index === 0 ? (scene.labels.find((l) => l.source.object === `${mark.source.object}.label`)?.text ?? null) : null
      return done(p, pointReadout(p, label), at)
    }
    case 'arrow': {
      if (mark.kind !== 'arrows') return null
      const tail = vertex(mark.tails, at.index)
      const vector = vertex(mark.vectors, at.index)
      if (!tail || !vector) return null
      const tip: Vec3 = [tail[0] + vector[0], tail[1] + vector[1], tail[2] + vector[2]]
      return done(tip, arrowReadout(tail, vector), at)
    }
  }
}
