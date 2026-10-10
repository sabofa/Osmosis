import { superscript } from './labels'
import { FRAME } from './tuning'

export interface LogTick {
  value: number
  label: string
  kind: 'major' | 'minor'
}

// m × 10ⁿ parsed from a literal, so there is no float drift from Math.pow.
const val = (m: number, n: number): number => Number(`${m}e${n}`)

function majorLabel(n: number): string {
  if (n === 0) return '1'
  if (n === 1) return '10'
  return `10${superscript(n)}`
}

function plainLabel(m: number, n: number, v: number): string {
  return v >= 1e-6 && v < 1e21 ? String(v) : `${m}×10${superscript(n)}`
}

/** Decade (major) and 2-9 (minor) ticks for a log axis over [lo, hi]. */
export function logTicks(lo: number, hi: number, pxPerDecade: number): LogTick[] {
  if (!(lo > 0) || !(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return []
  const within = (v: number) => v >= lo * (1 - 1e-12) && v <= hi * (1 + 1e-12)
  const decades = Math.log10(hi / lo)
  const first = Math.floor(Math.log10(lo))
  const last = Math.ceil(Math.log10(hi))
  const sparse = decades > FRAME.maxDecades
  const stride = sparse ? Math.ceil(decades / FRAME.maxDecades) : 1
  const withMinors = !sparse && pxPerDecade >= FRAME.minorMinPxPerDecade
  const labelMinors = hi / lo <= 10

  const out: LogTick[] = []
  for (let n = first; n <= last; n++) {
    const major = val(1, n)
    if (within(major) && (stride === 1 || n % stride === 0)) {
      out.push({ value: major, label: majorLabel(n), kind: 'major' })
    }
    if (!withMinors) continue
    for (let m = 2; m <= 9; m++) {
      const v = val(m, n)
      if (within(v)) out.push({ value: v, label: labelMinors ? plainLabel(m, n, v) : '', kind: 'minor' })
    }
  }
  return out
}
