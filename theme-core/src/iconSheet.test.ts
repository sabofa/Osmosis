import { describe, expect, it } from 'vitest'
import { parseIconSheetRef } from './iconSheet.js'
import * as barrel from './index.js'

describe('parseIconSheetRef', () => {
  const def = { kind: 'default' }
  it('parses the grammar', () => {
    expect(parseIconSheetRef('default')).toEqual(def)
    expect(parseIconSheetRef('builtin:retro')).toEqual({ kind: 'builtin', slug: 'retro' })
    expect(parseIconSheetRef('asset:0123456789abcdef')).toEqual({ kind: 'asset', hash: '0123456789abcdef' })
  })
  it('falls back to default for junk', () => {
    for (const v of ['junk', '', 'builtin:UP', 'asset:xyz', 'builtin:', 'asset:0123', 5, null, undefined, {}]) {
      expect(parseIconSheetRef(v as never)).toEqual(def)
    }
  })
  it('never throws on random strings', () => {
    const alphabet = 'abcdef0123:-_ XYZ'
    for (let i = 0; i < 200; i++) {
      let s = ''
      for (let j = 0; j < i % 40; j++) s += alphabet[(i * 7 + j * 13) % alphabet.length]
      expect(() => parseIconSheetRef(s)).not.toThrow()
    }
  })
  it('is exported from the barrel', () => { expect(barrel.parseIconSheetRef).toBe(parseIconSheetRef) })
})
