import { describe, expect, it, vi } from 'vitest'
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
  it('changes with the texture, the seed or the base colour in the key', () => {
    const same = Array.from(tilePixels(KEY)!.rgba)
    for (const other of [paperKey('canvas', 3, 256, 0.5, '#e8dcc0'), paperKey('canvas', 4, 256, 1, '#e8dcc0'), paperKey('canvas', 3, 256, 1, '#203050')]) {
      expect(Array.from(tilePixels(other)!.rgba)).not.toEqual(same)
    }
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

describe('fillPaperTiles', () => {
  it('skips a tile that fails, fills the others, and forgets the failure', async () => {
    const { fillPaperTiles } = await import('./host')
    const bad = paperKey('canvas', 9, 64, 1, '#e8dcc0')
    const good = paperKey('linen', 9, 64, 1, '#e8dcc0')
    const images = [bad, good].map((key) => ({
      key,
      href: '' as string,
      getAttribute(name: string) {
        return name === 'data-paper-key' ? this.key : this.href
      },
      setAttribute(_: string, value: string) {
        this.href = value
      },
    }))
    const root = { querySelectorAll: () => images } as unknown as ParentNode
    let calls = 0
    vi.stubGlobal('ImageData', class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    })
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() {
        return { putImageData() {} }
      }
      convertToBlob() {
        calls++
        return calls === 1 ? Promise.reject(new Error('no canvas')) : Promise.resolve(new Blob(['x']))
      }
    })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ok')
    try {
      await fillPaperTiles(root)
      expect(images[0].href).toBe('')
      expect(images[1].href).toBe('blob:ok')
      await fillPaperTiles(root) // the bad key is tried afresh, not served from the cache
      expect(calls).toBe(3)
      expect(images[0].href).toBe('blob:ok')
    } finally {
      create.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
