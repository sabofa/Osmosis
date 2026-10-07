// A PNG writer, with nothing but the language: a paper tile is RGBA texels in memory, and an exported
// figure carries it as a data URL. The container needs a CRC-32 per chunk and a zlib stream (with its
// Adler-32) for the pixels; both are written here, so no dependency comes in with the export.
//
// The pixels are stored, not compressed, unless the caller brings a deflater: `encodePng` writes the
// scanlines as STORED deflate blocks by default (valid, if large: a 512 x 512 RGBA tile is about 1 MB, 1.4 MB
// as base64), and takes a zlib deflater to do better. A browser has one (CompressionStream('deflate'),
// which is zlib format, and asynchronous: host.ts splits the work with `pngScanlines` and `pngFromZlib`).

// The table of the CRC-32 of the PNG and zip families: the polynomial 0xEDB88320, bit-reflected.
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

// The CRC-32 of `bytes[start, end)`. `previous` continues a running checksum (the CRC of what came before).
export function crc32(bytes: Uint8Array, start = 0, end: number = bytes.length, previous = 0): number {
  let c = ~previous >>> 0
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

const ADLER_MOD = 65521
// The longest run of bytes whose two sums fit in a 32-bit unsigned integer before they must be reduced
// (zlib's own constant).
const ADLER_RUN = 5552

export function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + ADLER_RUN)
    for (; i < end; i++) {
      a += bytes[i]
      b += a
    }
    a %= ADLER_MOD
    b %= ADLER_MOD
  }
  return ((b << 16) | a) >>> 0
}

const MAX_STORED = 0xffff

// `raw` as a zlib stream of STORED deflate blocks: the two header bytes, blocks of at most 65535 bytes each
// with its length and the complement of it, and the Adler-32 of `raw`.
export function storedDeflate(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_STORED))
  const out = new Uint8Array(2 + raw.length + 5 * blocks + 4)
  out[0] = 0x78 // deflate, a 32 KiB window
  out[1] = 0x01 // no dictionary, the fastest level; (0x78 << 8 | 0x01) is a multiple of 31, as the format needs
  let at = 2
  for (let b = 0; b < blocks; b++) {
    const start = b * MAX_STORED
    const length = Math.min(MAX_STORED, raw.length - start)
    out[at++] = b === blocks - 1 ? 1 : 0 // BFINAL, and BTYPE 00: stored
    out[at++] = length & 0xff
    out[at++] = length >>> 8
    out[at++] = ~length & 0xff
    out[at++] = (~length >>> 8) & 0xff
    out.set(raw.subarray(start, start + length), at)
    at += length
  }
  const sum = adler32(raw)
  out[at++] = sum >>> 24
  out[at++] = (sum >>> 16) & 0xff
  out[at++] = (sum >>> 8) & 0xff
  out[at] = sum & 0xff
  return out
}

function checkSize(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) {
    throw new RangeError(`a PNG needs a whole width and height of at least 1, got ${width} x ${height}`)
  }
  if (rgba.length !== 4 * width * height) throw new RangeError(`a ${width} x ${height} RGBA image has ${4 * width * height} bytes, got ${rgba.length}`)
}

// The image's rows as PNG wants them before compression: each row's filter byte (0, none) then its RGBA texels.
export function pngScanlines(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  checkSize(width, height, rgba)
  const row = 4 * width
  const raw = new Uint8Array(height * (row + 1))
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1)
  }
  return raw
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

// A PNG file around an already-compressed zlib stream of the image's scanlines (`pngScanlines`): the
// signature, IHDR (8 bits per channel, RGBA, no interlace), one IDAT and IEND.
export function pngFromZlib(width: number, height: number, zlib: Uint8Array): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// An RGBA image (row by row, `4 * width * height` bytes) as a PNG file. `deflate` turns the scanlines into a
// zlib stream (zlib's own `deflateSync`, for one); left out, the stream is stored uncompressed.
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  deflate: (raw: Uint8Array) => Uint8Array = storedDeflate
): Uint8Array {
  return pngFromZlib(width, height, deflate(pngScanlines(width, height, rgba)))
}
