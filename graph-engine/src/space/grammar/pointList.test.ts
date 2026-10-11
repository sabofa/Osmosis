import { describe, expect, it } from 'vitest'
import { parseSpaceKeyword } from './keyword'

// The one point-list rule after merging S4a and S4b (agreed with the solid-figure
// side): a solid figure's hyphenated point list is never claimed by space, while
// an expression that merely contains a minus sign still is.
describe('point lists belong to solid figures', () => {
  for (const line of ['line: A-B', 'line: A-B dashed', 'line: A - B plain', 'plane: A-B-C', 'path: A-B-C-D', 'line: a-b', 'plane: p-q-r', 'path: a-b-c']) {
    it(`does not claim "${line}"`, () => {
      expect(parseSpaceKeyword(line)).toBeNull()
    })
  }

  it('still claims an expression target with a minus sign under a non-geometric keyword', () => {
    const claimed = parseSpaceKeyword('critical: f-g')
    expect(claimed).not.toBeNull()
    expect(claimed?.kind).toBe('space')
  })
})
