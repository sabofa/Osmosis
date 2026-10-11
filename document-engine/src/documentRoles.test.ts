import { describe, expect, it } from 'vitest'
import { documentRoles, roleKindOfNode } from './documentRoles'
import { parseBlocks } from './markdown'

const roles = (md: string) => documentRoles(parseBlocks(md))

describe('documentRoles', () => {
  it('empty doc', () => expect(roles('')).toEqual([]))
  it('title, lede, sections', () => {
    const r = roles('# T\n\nlead\n\nbody\n\n## A\n\nx\n\n## B\n\n### c')
    expect(r.map((x) => x.role)).toEqual(['title', 'lede', undefined, 'section', undefined, 'section', undefined])
    expect(r.filter((x) => x.sectionIndex).map((x) => x.sectionIndex)).toEqual([1, 2])
    expect(r[0].level).toBe(1)
    expect(r[6].level).toBe(3)
  })
  it('no title -> no lede', () => {
    expect(roles('plain\n\n## A').map((x) => x.role)).toEqual([undefined, 'section'])
  })
  it('lede only when the next block is a paragraph', () => {
    expect(roles('# T\n\n- item\n\npara').map((x) => x.role)).toEqual(['title', undefined, undefined])
    expect(roles('# T\n\n> quote\n\npara').map((x) => x.role)).toEqual(['title', undefined, undefined])
    expect(roles('# T\n\n## S\n\npara').map((x) => x.role)).toEqual(['title', 'section', undefined])
  })
  it('only the first H1 is the title; its lede is relative to it', () => {
    expect(roles('# A\n\n# B\n\np').map((x) => x.role)).toEqual(['title', undefined, undefined])
  })
  it('title need not be the first block', () => {
    expect(roles('intro\n\n# A\n\nlead').map((x) => x.role)).toEqual([undefined, 'title', 'lede'])
  })
  it('headings inside quotes do not count', () => {
    const r = roles('> # Q\n> ## R\n\n# T\n\n## S')
    expect(r.map((x) => x.role)).toEqual([undefined, 'title', 'section'])
    expect(r[2].sectionIndex).toBe(1)
  })
  it('works on lezer kinds including setext', () => {
    const kinds = ['SetextHeading1', 'Paragraph', 'SetextHeading2', 'ATXHeading2', 'BulletList'].map((n) => ({ type: roleKindOfNode(n) }))
    const r = documentRoles(kinds)
    expect(r.map((x) => x.role)).toEqual(['title', 'lede', 'section', 'section', undefined])
    expect(r[3].sectionIndex).toBe(2)
  })
  it('roleKindOfNode maps unknowns to other', () => {
    expect(roleKindOfNode('FencedCode')).toBe('other')
    expect(roleKindOfNode('ATXHeading4')).toBe('h4')
  })
})
