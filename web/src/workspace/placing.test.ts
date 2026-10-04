import { describe, it, expect } from 'vitest'
import { placeTargets, placeWithFallback, topTargets, workspaceTargets, type PlaceFn } from './placing'
import { WsError, type NodeKind, type NodeSummary, type PlacedRow } from './wsApi'

function node(id: string, kind: NodeKind): NodeSummary {
  return { id, kind, title: id, kind_tag: null, format: kind === 'file' ? 'markdown' : null, placement_count: 1, has_children: false, archived_at: null, top_level: false }
}
// A placement of `child` in `container` under `name`, the way a scope-only search lists it.
const row = (container: string, name: string, child: NodeSummary): PlacedRow => ({ placement_id: `${container}>${child.id}`, name, node: child, container_id: container })

describe('placeWithFallback: place, and if the name is taken, once more under the free name', () => {
  function fake(script: (Error | undefined)[]) {
    const calls: (string | undefined)[] = []
    const place: PlaceFn = async (_container, child, name) => {
      calls.push(name)
      const fail = script[calls.length - 1]
      if (fail) throw fail
      return { name: name ?? child }
    }
    return { place, calls }
  }
  const taken = (suggestion?: string) => new WsError(400, 'name_taken', 'taken', suggestion ? { suggestion } : undefined)

  it('goes in under the asked name, or under its title when none is given, and says it did not fall back', async () => {
    const a = fake([])
    expect(await placeWithFallback(a.place, 'c1', 'n1')).toEqual({ name: 'n1', fellBack: false })
    expect(a.calls).toEqual([undefined])
    const b = fake([])
    expect(await placeWithFallback(b.place, 'c1', 'n1', 'Week 1')).toEqual({ name: 'Week 1', fellBack: false })
    expect(b.calls).toEqual(['Week 1'])
  })

  it("a name clash is retried once with the server's suggestion, and the caller is told", async () => {
    const f = fake([taken('Week 1 (2)')])
    expect(await placeWithFallback(f.place, 'c1', 'n1', 'Week 1')).toEqual({ name: 'Week 1 (2)', fellBack: true })
    expect(f.calls).toEqual(['Week 1', 'Week 1 (2)'])
  })

  it('a clash with no suggestion, a second failure, and any other error are thrown, never retried again', async () => {
    const none = fake([taken()])
    await expect(placeWithFallback(none.place, 'c1', 'n1')).rejects.toThrow('taken')
    expect(none.calls).toHaveLength(1)
    const twice = fake([taken('x (2)'), taken('x (3)')])
    await expect(placeWithFallback(twice.place, 'c1', 'n1')).rejects.toThrow('taken')
    expect(twice.calls).toHaveLength(2)
    const other = fake([new WsError(400, 'cycle_rejected', 'no')])
    await expect(placeWithFallback(other.place, 'c1', 'n1')).rejects.toThrow('no')
    expect(other.calls).toHaveLength(1)
  })
})

describe('workspaceTargets: the workspace root and the folders reachable in it', () => {
  const root = { id: 't', kind: 'track' as const, title: 'quant' }
  const year = node('f1', 'folder')
  const calc = node('c1', 'course')
  const unit = node('f2', 'folder')
  const rows = [
    row('t', 'Year 1', year),
    row('t', 'Calc', calc),
    row('c1', 'Unit 1', unit),
    row('f2', 'notes', node('n1', 'file')),
    row('t', 'Archive', year), // the same folder under a second name: one target
  ]

  it('lists the root first, then each folder once by its path of names, however deep', () => {
    expect(workspaceTargets(root, rows)).toEqual([
      { id: 't', kind: 'track', label: 'quant' },
      { id: 'f1', kind: 'folder', label: 'quant / Archive' },
      { id: 'f2', kind: 'folder', label: 'quant / Calc / Unit 1' },
    ])
  })
  it('takes the shortest route to a folder, and the first by name among equals', () => {
    const t = workspaceTargets(root, [row('t', 'Year 1', year), row('t', 'Aaa', year)])
    expect(t.map((x) => x.label)).toEqual(['quant', 'quant / Aaa'])
  })
  it("a course is not offered (its own workspace is where to put things in it); files are never targets", () => {
    expect(workspaceTargets(root, rows).some((t) => t.kind === 'course' || t.kind === 'file')).toBe(false)
  })
  it('is only the root when nothing is under it', () => {
    expect(workspaceTargets(root, [])).toEqual([{ id: 't', kind: 'track', label: 'quant' }])
  })
  it('sorts names the way people read them: "Unit 2" before "Unit 10"', () => {
    const rs = [row('t', 'Unit 10', node('a', 'folder')), row('t', 'Unit 2', node('b', 'folder'))]
    expect(workspaceTargets(root, rs).map((x) => x.label)).toEqual(['quant', 'quant / Unit 2', 'quant / Unit 10'])
  })
  it('does not hang on a loop of rows that cannot happen in the graph', () => {
    const a = node('a', 'folder')
    const b = node('b', 'folder')
    expect(workspaceTargets(root, [row('a', 'b', b), row('b', 'a', a)]).map((x) => x.id)).toEqual(['t'])
  })
})

describe('workspaceTargets: in a trajectory, its tracks are places too (they hold courses)', () => {
  const root = { id: 'tr', kind: 'trajectory' as const, title: 'quant' }
  const rows = [
    row('tr', 'Research', node('f0', 'folder')),
    row('tr', 'Year 1', node('k1', 'track')),
    row('tr', 'Applied', node('k2', 'track')),
    row('k1', 'Calc', node('c1', 'course')),
    row('c1', 'Unit 1', node('f1', 'folder')),
    row('tr', 'Syllabus', node('n1', 'file')),
  ]
  it('lists the root, then its folders and tracks, and the folders inside tracks and courses, by label', () => {
    expect(workspaceTargets(root, rows)).toEqual([
      { id: 'tr', kind: 'trajectory', label: 'quant' },
      { id: 'k2', kind: 'track', label: 'quant / Applied' },
      { id: 'f0', kind: 'folder', label: 'quant / Research' },
      { id: 'k1', kind: 'track', label: 'quant / Year 1' },
      { id: 'f1', kind: 'folder', label: 'quant / Year 1 / Calc / Unit 1' },
    ])
  })
  it('still offers no course and no file', () => {
    expect(workspaceTargets(root, rows).some((t) => t.kind === 'course' || t.kind === 'file')).toBe(false)
  })
})

describe('placeTargets: only what the containment matrix lets hold it', () => {
  const trajectory = { id: 'tr', kind: 'trajectory' as const, label: 'quant' }
  const track = { id: 't', kind: 'track' as const, label: 'quant / Year 1' }
  const course = { id: 'c', kind: 'course' as const, label: 'micro' }
  const folder = { id: 'f', kind: 'folder' as const, label: 'quant / Year 1 / Notes' }
  const all = [trajectory, track, course, folder]
  const ids = (n: { id: string; kind: NodeKind }, opts = {}) => placeTargets(n, all, opts).map((t) => t.id)

  it('a file goes in a trajectory, a track, a course or a folder', () => {
    expect(ids({ id: 'n', kind: 'file' })).toEqual(['tr', 't', 'c', 'f'])
  })
  it('a folder goes in a trajectory, a track, a course or a folder', () => {
    expect(ids({ id: 'x', kind: 'folder' })).toEqual(['tr', 't', 'c', 'f'])
  })
  it('a course goes in a trajectory or a track, never in a course or a folder', () => {
    expect(ids({ id: 'x', kind: 'course' })).toEqual(['tr', 't'])
  })
  it('a track goes only in a trajectory, no longer in a track', () => {
    expect(ids({ id: 'x', kind: 'track' })).toEqual(['tr'])
  })
  it('a trajectory goes nowhere', () => {
    expect(ids({ id: 'x', kind: 'trajectory' })).toEqual([])
  })
  it('never offers the node itself, nor a container it is already in', () => {
    expect(ids({ id: 'f', kind: 'folder' })).toEqual(['tr', 't', 'c'])
    expect(ids({ id: 'n', kind: 'file' }, { alreadyIn: ['c', 'f'] })).toEqual(['tr', 't'])
  })
  it('never offers a container inside the node itself, which would close a loop', () => {
    const rows = [row('t', 'a', node('a', 'folder')), row('a', 'b', node('b', 'folder')), row('b', 'c', node('c', 'folder'))]
    const folderAt = (id: string, label: string) => ({ id, kind: 'folder' as const, label })
    const targets = [track, folderAt('a', 'quant / a'), folderAt('b', 'quant / a / b'), folderAt('c', 'quant / a / b / c'), folderAt('z', 'quant / z')]
    expect(placeTargets({ id: 'a', kind: 'folder' }, targets, { rows }).map((t) => t.id)).toEqual(['t', 'z'])
    expect(placeTargets({ id: 'b', kind: 'folder' }, targets, { rows }).map((t) => t.id)).toEqual(['t', 'a', 'z'])
  })
  it('keeps the order it was given', () => {
    expect(placeTargets({ id: 'n', kind: 'file' }, [folder, track], {}).map((t) => t.id)).toEqual(['f', 't'])
  })
})

describe('topTargets: trajectories, tracks and courses by their titles', () => {
  it('keeps the order and the kind', () => {
    expect(topTargets([node('tr', 'trajectory'), node('t', 'track'), node('c', 'course')])).toEqual([
      { id: 'tr', kind: 'trajectory', label: 'tr' },
      { id: 't', kind: 'track', label: 't' },
      { id: 'c', kind: 'course', label: 'c' },
    ])
  })
})
