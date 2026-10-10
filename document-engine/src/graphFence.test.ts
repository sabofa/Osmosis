import { describe, it, expect } from 'vitest'
import { parseBlocks } from './markdown'
import {
  isGraphFence,
  graphFenceModel,
  graphBlocks,
  graphErrorSummary,
  parseGraphInfo,
  graphFenceStyle,
  graphOptionsSignature,
} from './graphFence'

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

describe('parseGraphInfo', () => {
  it('defaults when there are no options', () => {
    expect(parseGraphInfo('graph')).toEqual({ lock: false })
    expect(parseGraphInfo('')).toEqual({ lock: false })
    expect(parseGraphInfo(undefined)).toEqual({ lock: false })
    expect(parseGraphInfo(null)).toEqual({ lock: false })
  })
  it('parses size, height, view and lock in any order', () => {
    const p = parseGraphInfo('graph lock height=300 view=x:-5..5,y:-3..3 size=m')
    expect(p).toEqual({
      size: 'm',
      height: 300,
      view: { x: [-5, 5], y: [-3, 3] },
      bounds: '-5,5,-3,3',
      lock: true,
    })
  })
  it('accepts every size and rejects unknown ones', () => {
    for (const s of ['s', 'm', 'l', 'full'] as const) expect(parseGraphInfo(`graph size=${s}`).size).toBe(s)
    expect(parseGraphInfo('graph size=xl').size).toBeUndefined()
    expect(parseGraphInfo('graph size=').size).toBeUndefined()
    expect(parseGraphInfo('graph size=S').size).toBe('s')
  })
  it('clamps height and ignores invalid values', () => {
    expect(parseGraphInfo('graph height=10').height).toBe(80)
    expect(parseGraphInfo('graph height=99999').height).toBe(2000)
    expect(parseGraphInfo('graph height=80').height).toBe(80)
    expect(parseGraphInfo('graph height=abc').height).toBeUndefined()
    expect(parseGraphInfo('graph height=-5').height).toBeUndefined()
    expect(parseGraphInfo('graph height=12.5').height).toBeUndefined()
    expect(parseGraphInfo('graph height=').height).toBeUndefined()
  })
  it('parses fractional views and either axis order', () => {
    expect(parseGraphInfo('graph view=y:0.5..1.5,x:-.5..2').view).toEqual({ x: [-0.5, 2], y: [0.5, 1.5] })
  })
  it('ignores malformed views', () => {
    for (const v of [
      'x:-5..5',
      'y:-3..3',
      'x:5..-5,y:-3..3',
      'x:1..1,y:-3..3',
      'x:-5..5,y:-3..',
      'x:a..b,y:1..2',
      'x:-5..5,x:-1..1',
      'x:-5..5,y:-3..3,z:1..2',
      'x:1e999..2,y:1..2',
      '',
      'x:-5....5,y:1..2',
    ]) {
      const p = parseGraphInfo(`graph view=${v}`)
      expect(p.view).toBeUndefined()
      expect(p.bounds).toBeUndefined()
    }
  })
  it('handles lock forms', () => {
    expect(parseGraphInfo('graph lock').lock).toBe(true)
    expect(parseGraphInfo('graph lock=true').lock).toBe(true)
    expect(parseGraphInfo('graph lock=false').lock).toBe(false)
    expect(parseGraphInfo('graph lock lock=false').lock).toBe(false)
    expect(parseGraphInfo('graph lock=yes').lock).toBe(false)
  })
  it('ignores unknown tokens and never throws', () => {
    expect(parseGraphInfo('graph foo bar=baz = == =x size=l ===')).toEqual({ size: 'l', lock: false })
    expect(parseGraphInfo('   graph\t size=s \n lock ')).toEqual({ size: 's', lock: true })
  })
})

describe('graphFenceStyle', () => {
  it('maps size to width and defaults to full width', () => {
    expect(graphFenceStyle(parseGraphInfo('graph'))).toEqual({ widthPct: 100 })
    expect(graphFenceStyle(parseGraphInfo('graph size=s')).widthPct).toBe(40)
    expect(graphFenceStyle(parseGraphInfo('graph size=m')).widthPct).toBe(60)
    expect(graphFenceStyle(parseGraphInfo('graph size=l')).widthPct).toBe(80)
    expect(graphFenceStyle(parseGraphInfo('graph size=full')).widthPct).toBe(100)
  })
  it('explicit height wins and is passed through', () => {
    expect(graphFenceStyle(parseGraphInfo('graph size=s height=250'))).toEqual({ widthPct: 40, height: 250 })
  })
})

describe('graphOptionsSignature', () => {
  it('changes only with bounds and lock', () => {
    const sigs = ['graph', 'graph lock', 'graph view=x:0..1,y:0..1', 'graph view=x:0..2,y:0..1'].map((i) =>
      graphOptionsSignature(parseGraphInfo(i)),
    )
    expect(new Set(sigs).size).toBe(sigs.length)
  })
  it('size and height do not remount', () => {
    const base = graphOptionsSignature(parseGraphInfo('graph'))
    expect(graphOptionsSignature(parseGraphInfo('graph size=s'))).toBe(base)
    expect(graphOptionsSignature(parseGraphInfo('graph height=300 size=l'))).toBe(base)
  })
})

describe('lenient option syntax', () => {
  it('accepts px heights', () => {
    expect(parseGraphInfo('graph height=300px').height).toBe(300)
    expect(parseGraphInfo('graph height=300PX').height).toBe(300)
    expect(parseGraphInfo('graph height=3em').height).toBeUndefined()
  })
  it('option keys and values are case-insensitive', () => {
    expect(parseGraphInfo('graph SIZE=L Lock')).toEqual({ size: 'l', lock: true })
    expect(parseGraphInfo('graph LOCK=False').lock).toBe(false)
  })
  it('allows spaces after commas in view', () => {
    expect(parseGraphInfo('graph view=x:0..1, y:0..1 lock')).toEqual({
      view: { x: [0, 1], y: [0, 1] },
      bounds: '0,1,0,1',
      lock: true,
    })
    expect(parseGraphInfo('graph view=x:0..1,').view).toBeUndefined()
  })
  it('view axes are case-insensitive', () => {
    expect(parseGraphInfo('graph view=X:0..1,Y:2..3').view).toEqual({ x: [0, 1], y: [2, 3] })
    expect(parseGraphInfo('graph view=X:0..1, y:2..3').bounds).toBe('0,1,2,3')
  })
  it('a trailing comma does not swallow a following option', () => {
    const p = parseGraphInfo('graph view=x:0..1, lock')
    expect(p.lock).toBe(true)
    expect(p.view).toBeUndefined()
    const q = parseGraphInfo('graph view=x:0..1, y:0..1 lock')
    expect(q.lock).toBe(true)
    expect(q.view).toEqual({ x: [0, 1], y: [0, 1] })
  })
})

describe('graphFenceModel options', () => {
  it('carries parsed options from the fence info', () => {
    const text = '```graph size=l lock\ny = x\n```'
    const model = graphFenceModel(parseBlocks(text)[0], text)!
    expect(model.options).toEqual({ size: 'l', lock: true })
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
