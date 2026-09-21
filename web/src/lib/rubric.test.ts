import { describe, it, expect } from 'vitest'
import { rubricLines } from './rubric'

describe('rubricLines', () => {
  it('returns nothing for a missing rubric', () => {
    expect(rubricLines(null)).toEqual([])
    expect(rubricLines('  ')).toEqual([])
  })

  it('splits prose into one line per criterion, dropping bullets', () => {
    expect(rubricLines('- states the law\n2) shows the working\n\nnames the unit')).toEqual([
      { text: 'states the law', points: null },
      { text: 'shows the working', points: null },
      { text: 'names the unit', points: null },
    ])
  })

  it('reads a list of strings and a list of objects with points', () => {
    expect(rubricLines(['a', 'b'])).toEqual([
      { text: 'a', points: null },
      { text: 'b', points: null },
    ])
    expect(rubricLines([{ criterion: 'sets up the ratio', points: 2 }, { text: 'solves', weight: 1 }])).toEqual([
      { text: 'sets up the ratio', points: 2 },
      { text: 'solves', points: 1 },
    ])
  })

  it('unwraps {criteria} and a JSON string', () => {
    expect(rubricLines({ criteria: ['x'] })).toEqual([{ text: 'x', points: null }])
    expect(rubricLines('["y"]')).toEqual([{ text: 'y', points: null }])
  })
})
