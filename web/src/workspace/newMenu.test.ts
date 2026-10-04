import { describe, it, expect } from 'vitest'
import { mayHold, newOptions } from './newMenu'

const md = { format: 'markdown', label: 'Markdown', newBody: '' }
const graph = { format: 'graph', label: 'Graph' } // no newBody: not offered under "New"
const notes = { format: 'notes', label: 'Notes', newBody: '# Notes\n' }

const keys = (kind: Parameters<typeof newOptions>[0], types = [md, graph]) => newOptions(kind, types).map((o) => o.key)

describe('newOptions: what a container may be given, by the containment matrix', () => {
  it('a trajectory holds a file, a folder, a course and a track', () => {
    expect(keys('trajectory')).toEqual(['file:markdown', 'folder', 'course', 'track'])
  })
  it('a track holds a file, a folder and a course, no longer a track', () => {
    expect(keys('track')).toEqual(['file:markdown', 'folder', 'course'])
  })
  it('a course holds a file and a folder, no course and no track', () => {
    expect(keys('course')).toEqual(['file:markdown', 'folder'])
  })
  it('a folder holds a file and a folder, no longer a course', () => {
    expect(keys('folder')).toEqual(['file:markdown', 'folder'])
  })
  it('a file holds nothing', () => {
    expect(keys('file')).toEqual([])
  })
  it('nothing offers to make a trajectory: it is only ever made at the top, from the picker', () => {
    for (const kind of ['trajectory', 'track', 'course', 'folder', 'file'] as const) {
      expect(newOptions(kind, [md]).some((o) => (o.kind as string) === 'trajectory')).toBe(false)
    }
  })
})

describe('newOptions: one entry per registered file format that says how a new one starts', () => {
  it('leaves out a format with no newBody, keeps one whose newBody is the empty string', () => {
    expect(newOptions('course', [md, graph]).filter((o) => o.kind === 'file').map((o) => o.format)).toEqual(['markdown'])
  })
  it('with one such format the entry reads "New file"; with several each is named for its format', () => {
    const one = newOptions('course', [md]).find((o) => o.kind === 'file')!
    expect([one.label, one.short]).toEqual(['New file', 'File'])
    const many = newOptions('course', [md, notes]).filter((o) => o.kind === 'file')
    expect(many.map((o) => o.label)).toEqual(['New Markdown file', 'New Notes file'])
    expect(many.map((o) => o.format)).toEqual(['markdown', 'notes'])
  })
  it('offers no file entry at all when no format can be created, but still the containers', () => {
    expect(keys('trajectory', [graph])).toEqual(['folder', 'course', 'track'])
  })
})

describe('mayHold: the same matrix, asked of one pair', () => {
  const kinds = ['trajectory', 'track', 'course', 'folder', 'file'] as const
  const holds = (c: (typeof kinds)[number]) => kinds.filter((k) => mayHold(c, k))

  it('trajectory holds track, course, folder, file', () => {
    expect(holds('trajectory')).toEqual(['track', 'course', 'folder', 'file'])
  })
  it('track holds course, folder, file; course holds folder, file; folder holds folder, file; file holds nothing', () => {
    expect(holds('track')).toEqual(['course', 'folder', 'file'])
    expect(holds('course')).toEqual(['folder', 'file'])
    expect(holds('folder')).toEqual(['folder', 'file'])
    expect(holds('file')).toEqual([])
  })
  it('nothing holds a trajectory, a track no longer nests, a folder holds no course', () => {
    expect(kinds.filter((c) => mayHold(c, 'trajectory'))).toEqual([])
    expect(mayHold('track', 'track')).toBe(false)
    expect(mayHold('folder', 'course')).toBe(false)
  })
})
