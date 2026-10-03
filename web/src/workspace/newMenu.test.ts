import { describe, it, expect } from 'vitest'
import { newOptions } from './newMenu'

const md = { type: 'markdown', label: 'Markdown', newBody: '' }
const graph = { type: 'graph', label: 'Graph' } // no newBody: not offered under "New"
const notes = { type: 'notes', label: 'Notes', newBody: '# Notes\n' }

const keys = (kind: Parameters<typeof newOptions>[0], types = [md, graph]) => newOptions(kind, types).map((o) => o.key)

describe('newOptions: what a container may be given, by the containment matrix', () => {
  it('a track holds a file, a folder, a course and a track', () => {
    expect(keys('track')).toEqual(['file:markdown', 'folder', 'course', 'track'])
  })
  it('a course holds a file and a folder, no course and no track', () => {
    expect(keys('course')).toEqual(['file:markdown', 'folder'])
  })
  it('a folder holds a file, a folder and a course, no track', () => {
    expect(keys('folder')).toEqual(['file:markdown', 'folder', 'course'])
  })
  it('a file holds nothing', () => {
    expect(keys('file')).toEqual([])
  })
})

describe('newOptions: one entry per registered file type that says how a new one starts', () => {
  it('leaves out a type with no newBody, keeps one whose newBody is the empty string', () => {
    expect(newOptions('course', [md, graph]).filter((o) => o.kind === 'file').map((o) => o.fileType)).toEqual(['markdown'])
  })
  it('with one such type the entry reads "New file"; with several each is named for its type', () => {
    const one = newOptions('course', [md]).find((o) => o.kind === 'file')!
    expect([one.label, one.short]).toEqual(['New file', 'File'])
    const many = newOptions('course', [md, notes]).filter((o) => o.kind === 'file')
    expect(many.map((o) => o.label)).toEqual(['New Markdown file', 'New Notes file'])
    expect(many.map((o) => o.fileType)).toEqual(['markdown', 'notes'])
  })
  it('offers no file entry at all when no type can be created, but still the containers', () => {
    expect(keys('track', [graph])).toEqual(['folder', 'course', 'track'])
  })
})
