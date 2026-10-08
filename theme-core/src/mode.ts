import { isHex, mix, parseColour, toHex } from './colour.js'
import type { Mode } from './manifest.js'
import { altitudeAt } from './sun.js'
import type { Location } from './sun.js'

export type ModeSource = 'light' | 'dark' | 'system' | 'sun'
export type TokenMapLike = Record<string, string>

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

export function modeAt(
  source: ModeSource,
  now: Date,
  loc: Location | null,
  systemDark: boolean,
  twilightBlend: boolean,
): { mode: Mode; blend: number; effectiveSource: ModeSource } {
  const fixed = (dark: boolean, effectiveSource: ModeSource) => ({
    mode: (dark ? 'dark' : 'light') as Mode,
    blend: dark ? 1 : 0,
    effectiveSource,
  })
  if (source === 'light') return fixed(false, source)
  if (source === 'dark') return fixed(true, source)
  if (source === 'system') return fixed(systemDark, source)
  if (!loc) return fixed(systemDark, 'system')
  const alt = altitudeAt(now, loc)
  let blend: number
  if (twilightBlend) {
    const u = 1 - clamp01((alt + 6) / 8)
    blend = u * u * (3 - 2 * u)
  } else {
    blend = alt < -0.833 ? 1 : 0
  }
  return { mode: blend >= 0.5 ? 'dark' : 'light', blend, effectiveSource: source }
}

const isColour = (s: string): boolean => {
  if (!isHex(s) && !/^oklch\(/i.test(s.trim())) return false
  try {
    parseColour(s)
    return true
  } catch {
    return false
  }
}

export function blendMaps(light: TokenMapLike, dark: TokenMapLike, t: number): TokenMapLike {
  const k = Number.isFinite(t) ? clamp01(t) : 0
  if (k === 0) return { ...light }
  if (k === 1) return { ...dark }
  const out: TokenMapLike = {}
  for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
    const l = light[name]
    const d = dark[name]
    if (l !== undefined && d !== undefined && isColour(l) && isColour(d)) {
      out[name] = toHex(mix(parseColour(l), parseColour(d), k))
    } else {
      out[name] = (k < 0.5 ? (l ?? d) : (d ?? l)) as string
    }
  }
  return out
}
