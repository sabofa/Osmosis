import { describe, expect, it } from 'vitest'
import { chainOf } from '../scene/chains'
import type { SceneObject } from '../scene/types'
import { toRenderItems } from './renderItems'

const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
const id = (object: string) => ({ statement: 0, object })

describe('toRenderItems', () => {
  it('draws each chain of a curve as its own ribbon, closing closed chains', () => {
    const curve: SceneObject = {
      kind: 'curve', id: id('curve'), breaks: [], color: null,
      chains: [
        chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1]),
        chainOf([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }], [0, 1, 2], true),
      ],
    }
    const { geometry } = toRenderItems([curve], bounds)
    expect(geometry.map((g) => g.kind)).toEqual(['curve', 'curve'])
    if (geometry[1].kind !== 'curve') throw new Error('unreachable')
    expect(geometry[1].points).toHaveLength(4)
    expect(geometry[1].points[3]).toEqual({ x: 2, y: 0 })
  })
  it('skips a chain with fewer than two vertices', () => {
    const curve: SceneObject = { kind: 'curve', id: id('curve'), breaks: [], chains: [chainOf([{ x: 0, y: 0 }], [0])] }
    expect(toRenderItems([curve], bounds).geometry).toHaveLength(0)
  })
  it('clips an asymptote line to the view as a dashed segment', () => {
    const line: SceneObject = { kind: 'line', id: id('asymptote.0'), through: { x: 1, y: 0 }, direction: { x: 0, y: 1 }, extent: 'infinite', role: 'asymptote', color: 'gray' }
    const { geometry } = toRenderItems([line], bounds)
    expect(geometry).toHaveLength(1)
    const seg = geometry[0]
    if (seg.kind !== 'segment') throw new Error('expected a segment')
    expect(seg.dashed).toBe(true)
    expect(Math.min(seg.from.y, seg.to.y)).toBeCloseTo(-10)
    expect(Math.max(seg.from.y, seg.to.y)).toBeCloseTo(10)
  })
  it('keeps a plain construction line solid, and drops a line that misses the view', () => {
    const solid: SceneObject = { kind: 'line', through: { x: 0, y: 0 }, direction: { x: 1, y: 1 }, extent: 'infinite' }
    const missing: SceneObject = { kind: 'line', through: { x: 0, y: 50 }, direction: { x: 1, y: 0 }, extent: 'infinite' }
    const { geometry } = toRenderItems([solid, missing], bounds)
    expect(geometry).toHaveLength(1)
    expect(geometry[0].kind === 'segment' && !geometry[0].dashed).toBe(true)
  })
  it('fills a band as triangles covering its outline', () => {
    const band: SceneObject = {
      kind: 'band', id: id('band.0'),
      outline: [chainOf([{ x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 1 }], [0, 1, 1, 0], true)],
    }
    const { geometry } = toRenderItems([band], bounds)
    expect(geometry).toHaveLength(1)
    if (geometry[0].kind !== 'region') throw new Error('expected a region')
    expect(geometry[0].triangles.length % 3).toBe(0)
    let area = 0
    const t = geometry[0].triangles
    for (let i = 0; i < t.length; i += 3) area += Math.abs((t[i + 1].x - t[i].x) * (t[i + 2].y - t[i].y) - (t[i + 2].x - t[i].x) * (t[i + 1].y - t[i].y)) / 2
    expect(area).toBeCloseTo(2, 10)
  })
  it('passes marks and points to the misc group untouched', () => {
    const mark: SceneObject = { kind: 'mark', id: id('hole.0'), at: { x: 1, y: 2 }, role: 'hole', fill: 'open', exact: true }
    const { geometry, misc } = toRenderItems([mark], bounds)
    expect(geometry).toHaveLength(0)
    expect(misc).toEqual([mark])
  })
})
