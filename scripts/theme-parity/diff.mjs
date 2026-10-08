// Dependency-free PNG pixel diff (8-bit RGB/RGBA, non-interlaced, as Edge writes).
// Usage: node diff.mjs <dir> [a-prefix b-prefix]   (default compares main-* vs branch-*)
//   or:  node diff.mjs a.png b.png
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'

function decode(file) {
  const buf = readFileSync(file)
  let pos = 8, w = 0, h = 0, ct = 0, idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG') }
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[dst + x] = v & 255
    }
  }
  return { w, h, bpp, px: out }
}

function compare(fa, fb) {
  const a = decode(fa), b = decode(fb)
  if (a.w !== b.w || a.h !== b.h) return { size: 'DIFFERENT SIZE' }
  let diff = 0, maxd = 0, minX = a.w, minY = a.h, maxX = -1, maxY = -1
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    let d = 0
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.px[(y * a.w + x) * a.bpp + k] - b.px[(y * b.w + x) * b.bpp + k]))
    if (d) { diff++; maxd = Math.max(maxd, d); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  }
  const sha = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8)
  return { total: a.w * a.h, diff, maxChannelDelta: maxd, bbox: diff ? [minX, minY, maxX, maxY] : null, bytesEqual: sha(fa) === sha(fb) }
}

// --themes <dir>: asserts branch-<theme>-home-<mode>.png differ from branch-home-<mode>.png (osmosis) in >5% of
// pixels and that the page margin (sample point bottom-right corner (w-3,h-3), clear of ember top-left gradient) is near the expected canvas.
const EXPECT = {
  forest: { light: '#ecf0e6', dark: '#0f1511' }, ocean: { light: '#e9f1f4', dark: '#0a1419' }, ember: { light: '#f2ebe0', dark: '#0d0b09' },
}
function themesCheck(dir) {
  let bad = 0
  for (const [theme, modes] of Object.entries(EXPECT)) for (const mode of ['light', 'dark']) {
    const A = decode(join(dir, `branch-home-${mode}.png`)), B = decode(join(dir, `branch-${theme}-home-${mode}.png`))
    let diff = 0
    for (let i = 0; i < A.w * A.h; i++) if (A.px[i * A.bpp] !== B.px[i * B.bpp] || A.px[i * A.bpp + 1] !== B.px[i * B.bpp + 1] || A.px[i * A.bpp + 2] !== B.px[i * B.bpp + 2]) diff++
    const frac = diff / (A.w * A.h)
    const o = ((B.h - 3) * B.w + (B.w - 3)) * B.bpp, got = [B.px[o], B.px[o + 1], B.px[o + 2]]
    const want = [1, 3, 5].map((k) => parseInt(modes[mode].slice(k, k + 2), 16))
    const delta = Math.max(...got.map((g, k) => Math.abs(g - want[k])))
    const ok = frac > 0.05 && delta <= 10
    if (!ok) bad++
    console.log(`${theme}-${mode}: ${(frac * 100).toFixed(1)}% px differ from osmosis, corner rgb(${got}) vs ${modes[mode]} maxDelta ${delta} ${ok ? 'OK' : 'FAIL'}`)
  }
  process.exit(bad ? 1 : 0)
}

const [x, y, z] = process.argv.slice(2)
if (x === '--themes') themesCheck(y)
else if (x?.endsWith('.png')) console.log(JSON.stringify(compare(x, y)))
else {
  const dir = x, pa = y ?? 'main', pb = z ?? 'branch'
  let bad = 0
  for (const f of readdirSync(dir).filter((n) => n.startsWith(pa + '-') && n.endsWith('.png')).sort()) {
    const other = pb + f.slice(pa.length)
    const r = compare(join(dir, f), join(dir, other))
    if (r.diff !== 0) bad++
    console.log(`${f.slice(pa.length + 1, -4)}: ${r.size ?? `${r.diff}/${r.total} px differ, max delta ${r.maxChannelDelta}, bytesEqual=${r.bytesEqual}${r.bbox ? ' bbox=' + r.bbox : ''}`}`)
  }
  process.exit(bad ? 1 : 0)
}
