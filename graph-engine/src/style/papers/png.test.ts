import { deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { adler32, crc32, encodePng, pngFromZlib, pngScanlines, storedDeflate } from './png'

// The PNG writer: the checksums against published values, and a tiny decoder that reads back what it wrote.

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))

describe('crc32', () => {
  it('is the standard CRC-32: the check value of "123456789", and of nothing', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(ascii('IEND'))).toBe(0xae426082) // the CRC every PNG ends with
  })

  it('takes a range, and continues a running checksum', () => {
    const bytes = ascii('xx123456789yy')
    expect(crc32(bytes, 2, 11)).toBe(0xcbf43926)
    expect(crc32(ascii('6789'), 0, 4, crc32(ascii('12345')))).toBe(0xcbf43926)
  })
})

describe('adler32', () => {
  it('is the standard Adler-32: "Wikipedia" is 0x11E60398, and nothing is 1', () => {
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398)
    expect(adler32(new Uint8Array(0))).toBe(1)
  })

  it('reduces long runs correctly: 100000 bytes of 255, against the definition', () => {
    const bytes = new Uint8Array(100000).fill(255)
    let a = 1
    let b = 0
    for (const byte of bytes) {
      a = (a + byte) % 65521
      b = (b + a) % 65521
    }
    expect(adler32(bytes)).toBe(((b << 16) | a) >>> 0)
  })
})

// A decoder for exactly what the encoder writes: the chunks (each CRC checked), the zlib header, the stored
// blocks (their length and its complement) and the Adler-32 trailer; the filter byte of every row is 0.
function decode(png: Uint8Array): { width: number; height: number; colourType: number; rgba: Uint8Array } {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let at = 8
  let header: Uint8Array | null = null
  const idat: Uint8Array[] = []
  let ended = false
  while (at < png.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + length)
    expect(view.getUint32(at + 8 + length), `the CRC of ${type}`).toBe(crc32(png, at + 4, at + 8 + length))
    if (type === 'IHDR') header = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') ended = true
    at += 12 + length
  }
  expect(ended).toBe(true)
  expect(at).toBe(png.length)
  const hv = new DataView(header!.buffer, header!.byteOffset, header!.byteLength)
  const width = hv.getUint32(0)
  const height = hv.getUint32(4)
  expect([header![8], header![10], header![11], header![12]]).toEqual([8, 0, 0, 0]) // 8 bits, deflate, filter 0, no interlace

  const zlib = new Uint8Array(idat.reduce((n, part) => n + part.length, 0))
  let z = 0
  for (const part of idat) {
    zlib.set(part, z)
    z += part.length
  }
  expect(((zlib[0] << 8) | zlib[1]) % 31).toBe(0)
  expect(zlib[0] & 0x0f).toBe(8)
  const raw: number[] = []
  let p = 2
  for (;;) {
    const final = zlib[p] & 1
    expect(zlib[p] >> 1, 'a stored block').toBe(0)
    const len = zlib[p + 1] | (zlib[p + 2] << 8)
    const nlen = zlib[p + 3] | (zlib[p + 4] << 8)
    expect(nlen).toBe(~len & 0xffff)
    for (let i = 0; i < len; i++) raw.push(zlib[p + 5 + i])
    p += 5 + len
    if (final) break
  }
  const sum = ((zlib[p] << 24) | (zlib[p + 1] << 16) | (zlib[p + 2] << 8) | zlib[p + 3]) >>> 0
  expect(p + 4).toBe(zlib.length)
  expect(sum).toBe(adler32(Uint8Array.from(raw)))

  const row = 4 * width
  expect(raw.length).toBe(height * (row + 1))
  const rgba = new Uint8Array(height * row)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (row + 1)], `row ${y}'s filter`).toBe(0)
    rgba.set(raw.slice(y * (row + 1) + 1, (y + 1) * (row + 1)), y * row)
  }
  return { width, height, colourType: header![9], rgba }
}

// A small image of values that differ by row and column, and by channel.
function image(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(4 * width * height)
  for (let i = 0; i < width * height; i++) {
    rgba[4 * i] = (i * 7) & 255
    rgba[4 * i + 1] = (i * 13 + 5) & 255
    rgba[4 * i + 2] = (i * 31 + 99) & 255
    rgba[4 * i + 3] = i % 5 === 0 ? 0 : 255
  }
  return rgba
}

describe('encodePng', () => {
  it('writes a PNG that decodes back to the same texels (stored blocks)', () => {
    for (const [w, h] of [[1, 1], [3, 2], [16, 16], [37, 11]] as const) {
      const rgba = image(w, h)
      const decoded = decode(encodePng(w, h, rgba))
      expect([decoded.width, decoded.height, decoded.colourType]).toEqual([w, h, 6])
      expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba))
    }
  })

  it('splits a long image into stored blocks of at most 65535 bytes, each with its own length', () => {
    // 200 x 200 RGBA: 160 200 bytes of scanlines, three blocks.
    const rgba = image(200, 200)
    const png = encodePng(200, 200, rgba)
    const decoded = decode(png)
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba))
    const zlib = storedDeflate(pngScanlines(200, 200, rgba))
    expect(zlib.length).toBe(2 + 160200 + 5 * 3 + 4)
  })

  it('reads back through a real inflater (node:zlib), so the stream is valid, not only self-consistent', () => {
    const rgba = image(64, 40)
    const png = encodePng(64, 40, rgba)
    // Pull the IDAT out and inflate it with zlib.
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    let at = 8
    let zlib = new Uint8Array(0)
    while (at < png.length) {
      const length = view.getUint32(at)
      if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === 'IDAT') zlib = png.slice(at + 8, at + 8 + length)
      at += 12 + length
    }
    const raw = new Uint8Array(inflateSync(zlib))
    expect(Array.from(raw)).toEqual(Array.from(pngScanlines(64, 40, rgba)))
  })

  it('takes a zlib deflater and writes what it returns, still a PNG that decodes', () => {
    const rgba = image(64, 40)
    const compressed = encodePng(64, 40, rgba, (raw) => new Uint8Array(deflateSync(raw)))
    const stored = encodePng(64, 40, rgba)
    expect(compressed.length).toBeLessThan(stored.length)
    // The same pixels either way: inflate the compressed one's IDAT.
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength)
    let at = 8
    let zlib = new Uint8Array(0)
    while (at < compressed.length) {
      const length = view.getUint32(at)
      const type = String.fromCharCode(...compressed.subarray(at + 4, at + 8))
      expect(view.getUint32(at + 8 + length), type).toBe(crc32(compressed, at + 4, at + 8 + length))
      if (type === 'IDAT') zlib = compressed.slice(at + 8, at + 8 + length)
      at += 12 + length
    }
    expect(Array.from(new Uint8Array(inflateSync(zlib)))).toEqual(Array.from(pngScanlines(64, 40, rgba)))
  })

  it('wraps an already compressed stream (pngFromZlib), which is how the browser path does it', () => {
    const rgba = image(8, 8)
    const zlib = new Uint8Array(deflateSync(pngScanlines(8, 8, rgba)))
    expect(Array.from(pngFromZlib(8, 8, zlib))).toEqual(Array.from(encodePng(8, 8, rgba, () => zlib)))
  })

  it('refuses a size that is not whole, or pixels that are not the size', () => {
    expect(() => encodePng(0, 4, new Uint8ClampedArray(0))).toThrow(RangeError)
    expect(() => encodePng(2.5, 2, new Uint8ClampedArray(20))).toThrow(RangeError)
    expect(() => encodePng(2, 2, new Uint8ClampedArray(15))).toThrow(RangeError)
  })

  it('is deterministic', () => {
    const rgba = image(16, 16)
    expect(Array.from(encodePng(16, 16, rgba))).toEqual(Array.from(encodePng(16, 16, rgba)))
  })
})
