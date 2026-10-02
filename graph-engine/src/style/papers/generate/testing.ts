// Helpers for the paper generator's tests (not imported by the module itself).

// 32-bit FNV-1a over a typed array's bytes: a hash of a tile for "same
// settings, same tile" checks.
export function hashArray(a: Float32Array | Uint8ClampedArray): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// How a tile's wrap seam compares with its interior: the mean absolute
// difference between the last and first column (axis 'x') or row (axis 'y'),
// over the mean absolute difference between neighbouring columns or rows
// inside the tile. About 1 for a seamless tile; 2 or more when the two edges
// are unrelated. `channels` and `channel` pick one plane of an interleaved
// array.
export function seamRatio(a: ArrayLike<number>, size: number, axis: 'x' | 'y', channels = 1, channel = 0): number {
  const at = (x: number, y: number) => a[(y * size + x) * channels + channel]
  let seam = 0
  let inner = 0
  let innerCount = 0
  for (let k = 0; k < size; k++) {
    seam += axis === 'x' ? Math.abs(at(size - 1, k) - at(0, k)) : Math.abs(at(k, size - 1) - at(k, 0))
    for (let j = 0; j < size - 1; j++) {
      inner += axis === 'x' ? Math.abs(at(j + 1, k) - at(j, k)) : Math.abs(at(k, j + 1) - at(k, j))
      innerCount++
    }
  }
  return seam / size / (inner / innerCount)
}
