// A paper tile at the density the view needs (paint-fix round 1): the weave of the approved mockup has two
// texels to a CSS px (its tile is 512 CSS px square), and the renderer lays one texel on one device px, so a
// view with `ratio` device px to the CSS px wants a tile of 512 x ratio texels, at any ratio. (The first wiring
// halved the 1024 tile below a ratio of 1.5 and used it whole above, which gave one texel to a device px at
// 1.25 or 1.5 and a weave a third too coarse.)
//
// Pure arithmetic: the session makes the tile at this size, the renderer lays it. A smaller tile is the area
// average of the whole one (what a supersampled picture shown smaller would be, which is what the mockup is),
// a bigger one is bilinear; both wrap, since a tile repeats.

// How many CSS px a tile spans (the mockup's: a 1024 tile at two texels to the CSS px).
export const PAPER_CSS_SPAN = 512
// The tile's size in texels is kept within these (a view at a ratio of 0.5 or 4 and beyond is still sensible).
export const PAPER_MIN_SIZE = 256
export const PAPER_MAX_SIZE = 2048

// The tile size, in texels, for a view with `ratio` device px to the CSS px.
export function paperTileSize(ratio: number): number {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return Math.min(PAPER_MAX_SIZE, Math.max(PAPER_MIN_SIZE, Math.round(PAPER_CSS_SPAN * r)))
}

// For each of `target` output texels along one axis of a `size` source: the first source texel it reads and
// the weights of the texels it spans (the overlap of the source interval [i k, (i + 1) k) with each texel, k =
// size / target, as a share of k).
function boxWeights(size: number, target: number): { start: Int32Array; count: Int32Array; weight: Float64Array; stride: number } {
  const k = size / target
  const stride = Math.ceil(k) + 1
  const start = new Int32Array(target)
  const count = new Int32Array(target)
  const weight = new Float64Array(target * stride)
  for (let i = 0; i < target; i++) {
    const a = i * k
    const b = (i + 1) * k
    const first = Math.floor(a + 1e-9)
    const last = Math.min(size - 1, Math.ceil(b - 1e-9) - 1)
    start[i] = first
    count[i] = last - first + 1
    for (let j = first; j <= last; j++) weight[i * stride + (j - first)] = (Math.min(b, j + 1) - Math.max(a, j)) / k
  }
  return { start, count, weight, stride }
}

// Resample one float channel set (`channels` interleaved values per texel, `size` x `size`) to `target` x `target`.
function resample(src: Float32Array, size: number, target: number, channels: number): Float32Array {
  if (size === target) return src
  if (target < size) {
    const w = boxWeights(size, target)
    // across, then down
    const wide = new Float32Array(target * size * channels)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < target; x++) {
        for (let c = 0; c < channels; c++) {
          let sum = 0
          for (let j = 0; j < w.count[x]; j++) sum += w.weight[x * w.stride + j] * src[(y * size + w.start[x] + j) * channels + c]
          wide[(y * target + x) * channels + c] = sum
        }
      }
    }
    const out = new Float32Array(target * target * channels)
    for (let y = 0; y < target; y++) {
      for (let x = 0; x < target; x++) {
        for (let c = 0; c < channels; c++) {
          let sum = 0
          for (let j = 0; j < w.count[y]; j++) sum += w.weight[y * w.stride + j] * wide[((w.start[y] + j) * target + x) * channels + c]
          out[(y * target + x) * channels + c] = sum
        }
      }
    }
    return out
  }
  // bigger: bilinear, wrapping
  const out = new Float32Array(target * target * channels)
  const k = size / target
  for (let y = 0; y < target; y++) {
    const fy = (y + 0.5) * k - 0.5
    const y0 = Math.floor(fy)
    const ty = fy - y0
    const ya = ((y0 % size) + size) % size
    const yb = (ya + 1) % size
    for (let x = 0; x < target; x++) {
      const fx = (x + 0.5) * k - 0.5
      const x0 = Math.floor(fx)
      const tx = fx - x0
      const xa = ((x0 % size) + size) % size
      const xb = (xa + 1) % size
      for (let c = 0; c < channels; c++) {
        const a = src[(ya * size + xa) * channels + c]
        const b = src[(ya * size + xb) * channels + c]
        const d = src[(yb * size + xa) * channels + c]
        const e = src[(yb * size + xb) * channels + c]
        out[(y * target + x) * channels + c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
      }
    }
  }
  return out
}

// A paper tile (sRGB RGBA8, and a float height) of `size` x `size` at `target` x `target`. The same arrays come
// back when the sizes agree. `withHeight` false leaves the height alone (an empty array comes back).
export function resampleTile(
  rgba: Uint8ClampedArray,
  height: Float32Array,
  size: number,
  target: number,
  withHeight = true,
): { rgba: Uint8ClampedArray; height: Float32Array; size: number } {
  if (target === size) return { rgba, height, size }
  const colour = new Float32Array(rgba.length)
  for (let i = 0; i < rgba.length; i++) colour[i] = rgba[i]
  const c = resample(colour, size, target, 4)
  const out = new Uint8ClampedArray(target * target * 4)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(c[i])
  return { rgba: out, height: withHeight ? resample(height, size, target, 1) : new Float32Array(0), size: target }
}
