import { describe, it, expect } from 'vitest'
import { SUGGESTED_KIND_TAGS, chipTags, isKindTag, parseTagInput, tagChoices, tagKey, tagLabel } from './kindTags'

describe('SUGGESTED_KIND_TAGS: what the Tag menu offers before "Other…"', () => {
  it('is the five the spec suggests, in the order the menu shows them', () => {
    expect([...SUGGESTED_KIND_TAGS]).toEqual(['source', 'resource', 'homework', 'test', 'flowchart'])
  })
  it('every suggestion is itself a valid tag', () => {
    expect(SUGGESTED_KIND_TAGS.every(isKindTag)).toBe(true)
  })
})

describe('isKindTag: ^[a-z][a-z0-9_-]{0,31}$', () => {
  it('accepts a lowercase word, digits, "_" and "-" after the first letter', () => {
    for (const ok of ['a', 'quiz', 'past-paper', 'week_3', 'x9', 'a'.repeat(32)]) expect(isKindTag(ok), ok).toBe(true)
  })
  it('refuses an empty tag, one not starting with a lowercase letter, and any other character', () => {
    for (const bad of ['', 'Quiz', '3d', '-x', '_x', 'two words', 'a.b', 'é', 'a/b', ' quiz']) expect(isKindTag(bad), JSON.stringify(bad)).toBe(false)
  })
  it('refuses 33 characters', () => {
    expect(isKindTag('a'.repeat(33))).toBe(false)
  })
})

describe('parseTagInput: what was typed into "Other…"', () => {
  it('takes a valid tag as typed, ignoring spaces around it', () => {
    expect(parseTagInput('quiz')).toEqual({ kind: 'tag', tag: 'quiz' })
    expect(parseTagInput('  past-paper \n')).toEqual({ kind: 'tag', tag: 'past-paper' })
  })
  it('does not fold the case: the server refuses "Quiz", so a different tag is never made quietly', () => {
    const r = parseTagInput('Quiz')
    expect(r.kind).toBe('refused')
  })
  it('says what a tag may be when it is not one', () => {
    for (const bad of ['', '   ', '2nd', 'a b', 'a'.repeat(33)]) {
      const r = parseTagInput(bad)
      expect(r.kind, JSON.stringify(bad)).toBe('refused')
      if (r.kind === 'refused') expect(r.message).toMatch(/lowercase letters, digits/)
    }
  })
})

describe('tagChoices: the entries of the Tag menu for one file', () => {
  it('is the suggestions then None when the file has no tag', () => {
    expect(tagChoices(null)).toEqual(['source', 'resource', 'homework', 'test', 'flowchart', null])
  })
  it('is the same when the tag is one of the suggestions', () => {
    expect(tagChoices('homework')).toEqual(['source', 'resource', 'homework', 'test', 'flowchart', null])
  })
  it('lists a tag of its own between the suggestions and None, so the menu shows what it has', () => {
    expect(tagChoices('past-paper')).toEqual(['source', 'resource', 'homework', 'test', 'flowchart', 'past-paper', null])
  })
})

describe('tagLabel and tagKey: the no-tag entry is not a tag called "none"', () => {
  it('the entry for no tag reads "(none)", and a tag is shown as it is', () => {
    expect(tagLabel(null)).toBe('(none)')
    expect(tagLabel('homework')).toBe('homework')
    expect(tagLabel('none')).toBe('none')
  })
  it('a custom tag called none has its own key and its own label, apart from the no-tag entry', () => {
    const entries = tagChoices('none')
    expect(entries).toContain('none')
    expect(entries).toContain(null)
    expect(new Set(entries.map(tagKey)).size).toBe(entries.length)
    expect(new Set(entries.map(tagLabel)).size).toBe(entries.length)
  })
  it('no tag can be written like the no-tag entry (its label and key are not valid tags), so the two never meet', () => {
    expect(isKindTag(tagLabel(null))).toBe(false)
    expect(isKindTag(tagKey(null))).toBe(false)
  })
})

describe('chipTags: the partition chips of a workspace', () => {
  it('is the suggestions when nothing else is tagged, whether or not they are in use', () => {
    expect(chipTags([])).toEqual(['source', 'resource', 'homework', 'test', 'flowchart'])
    expect(chipTags([null, 'homework', null])).toEqual(['source', 'resource', 'homework', 'test', 'flowchart'])
  })
  it('adds every other tag in use after the suggestions, once each, alphabetically', () => {
    expect(chipTags(['quiz', 'past-paper', null, 'quiz', 'source', 'lecture'])).toEqual([
      'source',
      'resource',
      'homework',
      'test',
      'flowchart',
      'lecture',
      'past-paper',
      'quiz',
    ])
  })
})
