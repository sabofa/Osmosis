// Chains: the scene contract's runs of connected vertices (calc P2; spec "The
// scene contract"). Float64 world coordinates, with the curve's parameter at
// each vertex, so goal 2's pen can pin wobble to the mathematics and hover can
// report the parameter.
import type { Chain, MarkId, Vec2 } from './types'

export function markKey(id: MarkId): string {
  return `${id.statement}/${id.object}`
}

export function chainOf(points: readonly Vec2[], params: readonly number[], closed = false): Chain {
  if (points.length !== params.length) throw new Error(`chainOf: ${points.length} points but ${params.length} parameters`)
  const xy = new Float64Array(points.length * 2)
  points.forEach((p, i) => {
    xy[2 * i] = p.x
    xy[2 * i + 1] = p.y
  })
  return { xy, param: Float64Array.from(params), closed }
}

export function vertexCount(chain: Chain): number {
  return chain.param.length
}

export function chainPoints(chain: Chain): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < chain.param.length; i++) out.push({ x: chain.xy[2 * i], y: chain.xy[2 * i + 1] })
  return out
}
