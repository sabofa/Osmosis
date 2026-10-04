import { describe, it, expect } from 'vitest'
import { makePathResolver } from './graphWalk'
import type { AppearsInRow, NodeKind } from './wsApi'

const up = (container: string, name: string, kind: NodeKind = 'folder'): AppearsInRow => ({ placement_id: `${container}/${name}`, container: { id: container, kind, title: container }, name })

describe('makePathResolver: the names from a workspace root down to a container', () => {
  it('walks up through the placements, naming each step, and is [] at the root', async () => {
    const parents: Record<string, AppearsInRow[]> = {
      unit: [up('year', 'Unit 3')],
      year: [up('track', 'Year 1', 'track')],
    }
    const resolve = makePathResolver('track', async (id) => parents[id] ?? [])
    expect(await resolve('track')).toEqual([])
    expect(await resolve('year')).toEqual(['Year 1'])
    expect(await resolve('unit')).toEqual(['Year 1', 'Unit 3'])
  })

  it('finds the route to the root when a container sits under another workspace too', async () => {
    const parents: Record<string, AppearsInRow[]> = {
      shared: [up('elsewhere', 'Shared'), up('track', 'Shared here', 'track')],
      elsewhere: [up('otherTrack', 'E', 'track')],
    }
    const resolve = makePathResolver('track', async (id) => parents[id] ?? [])
    expect(await resolve('shared')).toEqual(['Shared here'])
  })

  it('goes up through a track and a course to a trajectory root', async () => {
    const parents: Record<string, AppearsInRow[]> = {
      unit: [up('calc', 'Unit 1')],
      calc: [up('year1', 'Calc', 'course')],
      year1: [up('quant', 'Year 1', 'track')],
    }
    const resolve = makePathResolver('quant', async (id) => parents[id] ?? [])
    expect(await resolve('unit')).toEqual(['Year 1', 'Calc', 'Unit 1'])
  })

  it('answers null for a container that does not lead to the root, and asks the server once per container', async () => {
    const asked: string[] = []
    const parents: Record<string, AppearsInRow[]> = { a: [up('b', 'A')], b: [up('track', 'B', 'track')], lost: [] }
    const resolve = makePathResolver('track', async (id) => (asked.push(id), parents[id] ?? []))
    expect(await resolve('lost')).toBeNull()
    expect(await resolve('a')).toEqual(['B', 'A'])
    expect(await resolve('b')).toEqual(['B'])
    expect(asked.filter((id) => id === 'b')).toHaveLength(1)
  })
})
