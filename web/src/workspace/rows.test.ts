import { describe, it, expect } from 'vitest'
import { addableNodes, parentWorkspaces, sidebarSections, showsRow } from './rows'
import { mayHold } from './newMenu'
import type { AppearsInRow, ChildRow, NodeKind, NodeSummary } from './wsApi'

function node(id: string, kind: NodeKind = 'course'): NodeSummary {
  return {
    id,
    kind,
    title: id,
    kind_tag: null,
    format: kind === 'file' ? 'markdown' : null,
    placement_count: 1,
    has_children: false,
    archived_at: null,
    top_level: false,
  }
}
const child = (n: NodeSummary, name = n.id): ChildRow => ({ placement_id: `${n.id}@c`, name, appears_elsewhere: false, node: n })

describe('sidebarSections: how a workspace\'s own container is laid out', () => {
  it('a course is one list of files and folders', () => {
    expect(sidebarSections('course').map((s) => [s.key, s.title, s.kinds])).toEqual([['files', 'Files', ['folder', 'file']]])
  })
  it('a track is Planning (everything that is not a course) and Courses', () => {
    expect(sidebarSections('track').map((s) => [s.key, s.title, s.kinds])).toEqual([
      ['planning', 'Planning', ['folder', 'file']],
      ['members', 'Courses', ['course']],
    ])
  })
  it('a trajectory is Planning (files and folders) and Tracks and courses', () => {
    expect(sidebarSections('trajectory').map((s) => [s.key, s.title, s.kinds])).toEqual([
      ['planning', 'Planning', ['folder', 'file']],
      ['members', 'Tracks and courses', ['track', 'course']],
    ])
  })
  it('every kind a container may hold is shown in exactly one of its sections, by the matrix', () => {
    for (const kind of ['trajectory', 'track', 'course'] as const) {
      const shown = sidebarSections(kind).flatMap((s) => s.kinds)
      const may = (['trajectory', 'track', 'course', 'folder', 'file'] as const).filter((k) => mayHold(kind, k))
      expect([...shown].sort()).toEqual([...may].sort())
    }
  })
  it('only the sections of tracks and courses offer an existing one to add', () => {
    expect(sidebarSections('course').map((s) => s.existing)).toEqual([[]])
    expect(sidebarSections('track').map((s) => s.existing)).toEqual([[], ['course']])
    expect(sidebarSections('trajectory').map((s) => s.existing)).toEqual([[], ['track', 'course']])
  })
})

describe('showsRow: a section lists the children of its kinds and nothing else', () => {
  const [planning, members] = sidebarSections('trajectory')
  it('keeps files and folders in Planning and tracks and courses in the other', () => {
    const rows = [child(node('t', 'track')), child(node('c', 'course')), child(node('f', 'folder')), child(node('n', 'file'))]
    expect(rows.filter((r) => showsRow(planning, r)).map((r) => r.node.id)).toEqual(['f', 'n'])
    expect(rows.filter((r) => showsRow(members, r)).map((r) => r.node.id)).toEqual(['t', 'c'])
  })
})

describe('addableNodes: the existing tracks and courses a container does not have yet', () => {
  const [a, b, c] = [node('a'), node('b'), node('c')]
  const t1 = node('t1', 'track')
  it('drops the ones that are already direct children of the container', () => {
    expect(addableNodes([a, b, c], ['course'], [child(a), child(c)], 'k').map((n) => n.id)).toEqual(['b'])
  })
  it('offers only the kind asked for', () => {
    expect(addableNodes([a, t1], ['course'], [], 'k').map((n) => n.id)).toEqual(['a'])
    expect(addableNodes([a, t1], ['track'], [], 'k').map((n) => n.id)).toEqual(['t1'])
    expect(addableNodes([a, t1], ['track', 'course'], [], 'k').map((n) => n.id)).toEqual(['a', 't1'])
  })
  it('never offers the container itself, nor a folder or a file', () => {
    expect(addableNodes([node('k', 'track'), node('f', 'folder'), node('n', 'file')], ['track', 'course'], [], 'k')).toEqual([])
  })
  it('a course also placed somewhere else is still addable here: it may sit in several places', () => {
    expect(addableNodes([{ ...a, placement_count: 3 }], ['course'], [], 'k')).toHaveLength(1)
  })
})

const up = (id: string, kind: NodeKind, title: string): AppearsInRow => ({ placement_id: `${id}>x`, name: 'x', container: { id, kind, title } })

describe('parentWorkspaces: the "in:" of a course or track header', () => {
  it('lists the trajectories and tracks the node appears in, in the order given', () => {
    expect(parentWorkspaces([up('t', 'trajectory', 'quant'), up('k', 'track', 'Year 1')])).toEqual([
      { id: 't', kind: 'trajectory', title: 'quant' },
      { id: 'k', kind: 'track', title: 'Year 1' },
    ])
  })
  it('leaves out the folders and anything else that is not a workspace to open', () => {
    expect(parentWorkspaces([up('f', 'folder', 'Archive'), up('c', 'course', 'Calc'), up('k', 'track', 'Year 1')])).toEqual([
      { id: 'k', kind: 'track', title: 'Year 1' },
    ])
  })
  it('names a container once even if it holds the node under two names', () => {
    expect(parentWorkspaces([up('k', 'track', 'Year 1'), { ...up('k', 'track', 'Year 1'), placement_id: 'other' }])).toHaveLength(1)
  })
  it('is empty for a node that appears nowhere', () => {
    expect(parentWorkspaces([])).toEqual([])
  })
})
