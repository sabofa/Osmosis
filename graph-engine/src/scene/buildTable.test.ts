import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { buildTable } from './buildTable'

function table(spec: string) {
  const parsed = parseSpec(spec)
  return buildTable(parsed.statements, parsed.config)
}

describe('buildTable', () => {
  it('builds a table from header/row statements as typed', () => {
    const tables = table('header: A | B\nrow: 1 | 2\nrow: 3 | 4')
    expect(tables).toHaveLength(1)
    expect(tables[0].headers).toEqual(['A', 'B'])
    expect(tables[0].rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('expands a table generator statement into rows', () => {
    const tables = table('table: y = x^2 for x in [0, 3] step 1')
    expect(tables[0].headers).toEqual(['x', 'y'])
    expect(tables[0].rows).toEqual([
      ['0', '0'],
      ['1', '1'],
      ['2', '4'],
      ['3', '9'],
    ])
  })

  it('marks an undefined generator cell rather than throwing', () => {
    const tables = table('table: y = sqrt(x) for x in [-2, 0] step 1')
    expect(tables[0].rows.some((row) => row[1] === 'undefined')).toBe(true)
  })

  it('rejects a non-positive step', () => {
    expect(() => table('table: y = x for x in [0, 1] step 0')).toThrow(/positive/)
  })

  it('groups statements into separate named tables, in first-seen order', () => {
    const tables = table('scores.header: name | value\nscores.row: a | 1\ntimes.header: t\ntimes.row: 5\nscores.row: b | 2')
    expect(tables.map((t) => t.name)).toEqual(['scores', 'times'])
    expect(tables[0].rows).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
    expect(tables[1].rows).toEqual([['5']])
  })

  it('captures the raw source formula on a generator-built table, and null otherwise', () => {
    const generated = table('table: y = x^2 - 1 for x in [0, 2] step 1')
    expect(generated[0].formula).toBe('y = x^2 - 1')

    const typed = table('header: A | B\nrow: 1 | 2')
    expect(typed[0].formula).toBeNull()
  })

  it('drops a table entirely when its name is hidden', () => {
    const tables = table('@hide: scores\nscores.header: a\nscores.row: 1\ntimes.header: t\ntimes.row: 5')
    expect(tables.map((t) => t.name)).toEqual(['times'])
  })
})
