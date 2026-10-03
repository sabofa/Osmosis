import { describe, it, expect } from 'vitest'
import { orphansUnder, makePathResolver } from './graphWalk'
import type { AppearsInRow, ChildRow, NodeKind, NodeSummary } from './wsApi'

function node(id: string, kind: NodeKind, placementCount: number, hasChildren = false): NodeSummary {
  return { id, kind, title: id, kind_tag: null, type: kind === 'file' ? 'markdown' : null, class: null, placement_count: placementCount, has_children: hasChildren, trashed_at: null }
}
const row = (n: NodeSummary, name = n.id): ChildRow => ({ placement_id: `${n.id}@`, name, node: n })

// children by container id; a fetcher that counts its calls
function childrenFrom(table: Record<string, ChildRow[]>) {
  const calls: string[] = []
  return { calls, childrenOf: async (id: string) => (calls.push(id), table[id] ?? []) }
}

describe('orphansUnder: what destroy-with-orphans would also trash', () => {
  it('counts the items placed nowhere else, at any depth', async () => {
    const { childrenOf } = childrenFrom({
      root: [row(node('f1', 'file', 1)), row(node('sub', 'folder', 1, true))],
      sub: [row(node('f2', 'file', 1))],
    })
    expect((await orphansUnder('root', childrenOf)).map((n) => n.id).sort()).toEqual(['f1', 'f2', 'sub'])
  })

  it('leaves out an item that is also placed outside the set', async () => {
    const { childrenOf } = childrenFrom({
      root: [row(node('shared', 'file', 2)), row(node('mine', 'file', 1))],
    })
    expect((await orphansUnder('root', childrenOf)).map((n) => n.id)).toEqual(['mine'])
  })

  it('takes an item whose every placement is inside the set, even placed twice in it', async () => {
    // "both" is in root and in sub, and nowhere else; sub is itself an orphan.
    const { childrenOf } = childrenFrom({
      root: [row(node('both', 'file', 2)), row(node('sub', 'folder', 1, true))],
      sub: [row(node('both', 'file', 2))],
    })
    expect((await orphansUnder('root', childrenOf)).map((n) => n.id).sort()).toEqual(['both', 'sub'])
  })

  it('does not look inside a folder that is not an orphan', async () => {
    const { childrenOf, calls } = childrenFrom({
      root: [row(node('keptFolder', 'folder', 2, true))],
      keptFolder: [row(node('inside', 'file', 1))],
    })
    expect(await orphansUnder('root', childrenOf)).toEqual([])
    expect(calls).toEqual(['root'])
  })

  it('finds nothing under an empty container', async () => {
    const { childrenOf } = childrenFrom({})
    expect(await orphansUnder('root', childrenOf)).toEqual([])
  })
})

const up = (container: string, name: string): AppearsInRow => ({ placement_id: `${container}/${name}`, container: { id: container, kind: 'folder', title: container }, name })

describe('makePathResolver: the names from a workspace root down to a container', () => {
  it('walks up through the placements, naming each step, and is [] at the root', async () => {
    const parents: Record<string, AppearsInRow[]> = {
      unit: [up('year', 'Unit 3')],
      year: [up('track', 'Year 1')],
    }
    const resolve = makePathResolver('track', async (id) => parents[id] ?? [])
    expect(await resolve('track')).toEqual([])
    expect(await resolve('year')).toEqual(['Year 1'])
    expect(await resolve('unit')).toEqual(['Year 1', 'Unit 3'])
  })

  it('finds the route to the root when a container sits under another workspace too', async () => {
    const parents: Record<string, AppearsInRow[]> = {
      shared: [up('elsewhere', 'Shared'), up('track', 'Shared here')],
      elsewhere: [up('otherTrack', 'E')],
    }
    const resolve = makePathResolver('track', async (id) => parents[id] ?? [])
    expect(await resolve('shared')).toEqual(['Shared here'])
  })

  it('answers null for a container that does not lead to the root, and asks the server once per container', async () => {
    const asked: string[] = []
    const parents: Record<string, AppearsInRow[]> = { a: [up('b', 'A')], b: [up('track', 'B')], lost: [] }
    const resolve = makePathResolver('track', async (id) => (asked.push(id), parents[id] ?? []))
    expect(await resolve('lost')).toBeNull()
    expect(await resolve('a')).toEqual(['B', 'A'])
    expect(await resolve('b')).toEqual(['B'])
    expect(asked.filter((id) => id === 'b')).toHaveLength(1)
  })
})
