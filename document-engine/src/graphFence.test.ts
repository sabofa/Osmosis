import { describe, it, expect } from 'vitest'
import { parseBlocks } from './markdown'
import { isGraphFence, graphFenceModel, graphBlocks, graphErrorSummary } from './graphFence'

describe('isGraphFence', () => {
  it('matches when the first word of the info string is graph', () => {
    expect(isGraphFence('graph')).toBe(true)
    expect(isGraphFence('graph title="x"')).toBe(true)
    expect(isGraphFence('  graph  ')).toBe(true)
  })
  it('rejects other languages, empty and look-alikes', () => {
    expect(isGraphFence('python')).toBe(false)
    expect(isGraphFence('')).toBe(false)
    expect(isGraphFence(undefined)).toBe(false)
    expect(isGraphFence('graphviz')).toBe(false)
    expect(isGraphFence('x graph')).toBe(false)
  })
})

describe('graphFenceModel', () => {
  it('extracts the body and its start offset, with emoji before the fence', () => {
    const text = '😀 hi\n\n```graph\ny = x^2\nx in [0, 1]\n```\nafter'
    const block = parseBlocks(text).find((b) => b.type === 'fence')!
    const model = graphFenceModel(block, text)!
    expect(model.spec).toBe('y = x^2\nx in [0, 1]')
    expect(model.startOffset).toBe(block.start)
    expect(text.slice(model.startOffset, model.startOffset + 3)).toBe('y =')
  })
  it('returns null for non-graph fences', () => {
    const text = '```python\nprint(1)\n```'
    expect(graphFenceModel(parseBlocks(text)[0], text)).toBeNull()
  })
  it('returns null for non-fence blocks', () => {
    const text = 'plain'
    expect(graphFenceModel(parseBlocks(text)[0], text)).toBeNull()
  })
})

describe('graphBlocks', () => {
  it('finds no graph blocks in a document without a graph fence', () => {
    const text = '# T\n\nbody\n\n```python\nx\n```\n'
    expect(graphBlocks(text)).toEqual([])
  })
  it('finds each graph fence', () => {
    const text = '```graph\na\n```\n\n```graph k=1\nb\n```'
    expect(graphBlocks(text).map((g) => g.spec)).toEqual(['a', 'b'])
  })
})

describe('graphErrorSummary', () => {
  it('returns null for no messages', () => {
    expect(graphErrorSummary([])).toBeNull()
    expect(graphErrorSummary(['', '  '])).toBeNull()
  })
  it('joins distinct messages', () => {
    expect(graphErrorSummary(['a', 'b', 'a'])).toBe('Graph error: a; b')
  })
})
