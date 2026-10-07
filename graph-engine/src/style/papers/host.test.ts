import { describe, expect, it } from 'vitest'
import { inlinePaperTiles, setHrefs, tilePixels } from './host'
import { paperKey } from './generated'

const KEY = paperKey('canvas', 3, 256, 1, '#e8dcc0')
const KEY2 = paperKey('linen', 3, 256, 1, '#e8dcc0')
const svgOf = (...keys: string[]) =>
  `<svg>${keys.map((k) => `<pattern data-paper-key="${k}"><image data-paper-key="${k}" href="" width="256" height="256"/></pattern>`).join('')}</svg>`

describe('tilePixels', () => {
  it('is deterministic and the right size', () => {
    const a = tilePixels(KEY)!
    const b = tilePixels(KEY)!
    expect(a.size).toBe(256)
    expect(a.rgba.length).toBe(256 * 256 * 4)
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba))
  })
  it('returns null on a bad key', () => {
    expect(tilePixels('nonsense')).toBeNull()
  })
  it('differs between keys', () => {
    expect(Array.from(tilePixels(KEY)!.rgba)).not.toEqual(Array.from(tilePixels(KEY2)!.rgba))
  })
})

describe('setHrefs', () => {
  it('fills only empty hrefs of a matching key, leaving the rest identical, every repeat included', () => {
    const svg = `<svg><image data-paper-key="${KEY}" href=""/><image data-paper-key="${KEY2}" href=""/><image data-paper-key="${KEY}" href="keep"/><image data-paper-key="${KEY}" href=""/><rect href=""/></svg>`
    const out = setHrefs(svg, new Map([[KEY, 'blob:x']]))
    expect(out).toBe(
      `<svg><image data-paper-key="${KEY}" href="blob:x"/><image data-paper-key="${KEY2}" href=""/><image data-paper-key="${KEY}" href="keep"/><image data-paper-key="${KEY}" href="blob:x"/><rect href=""/></svg>`
    )
  })
})

function decode(svg: string): Uint8Array {
  const m = /href="data:image\/png;base64,([^"]+)"/.exec(svg)
  expect(m).not.toBeNull()
  return new Uint8Array(Buffer.from(m![1], 'base64'))
}
function checkPng(bytes: Uint8Array) {
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(16)).toBe(256)
}

describe('inlinePaperTiles', () => {
  it('inlines a PNG using CompressionStream', async () => {
    expect(typeof CompressionStream).toBe('function')
    checkPng(decode(await inlinePaperTiles(svgOf(KEY))))
  })
  it('falls back to stored deflate without CompressionStream', async () => {
    const saved = globalThis.CompressionStream
    // @ts-expect-error removing for the test
    delete globalThis.CompressionStream
    try {
      checkPng(decode(await inlinePaperTiles(svgOf(KEY))))
    } finally {
      globalThis.CompressionStream = saved
    }
  })
  it('generates each tile once for repeated keys', async () => {
    const out = await inlinePaperTiles(svgOf(KEY) + svgOf(KEY))
    expect(out.match(/data:image\/png;base64,/g)!.length).toBe(2)
  })
})
