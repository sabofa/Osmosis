// Reading a setting's value, and finding a setting by the name an author wrote.
//
// Three places take a value from outside the engine: a document's "@style-set:"
// directive (text), a host's base style (an object, from a stored theme or a URL)
// and a theme's style set (an object). All three read it here, so that a value is
// valid or refused the same way wherever it was written.
//
// A value is REFUSED when it is out of range, never clamped (geometry's ruling,
// 2026-10-04), with the range in the message. The older "@style-<setting>"
// directives refuse the same way, and for the figure styles' own settings (the
// style.* paths) this module calls the very same reader (`parseTokenValue`), so the
// two directive forms cannot disagree.
//
// This module may import `space/paint/params` and nothing else from space/ (the
// boundary test, style/boundary.test.ts, holds it); it imports nothing from it.

import { COLOR_NAMES } from '../colorNames'
import { parseColourSetting, TOKENS, type Token } from '../tokens'
import { REGISTRY, settingAt } from './registry'
import type { SettingSpec, SettingValue } from './types'

// ---------------------------------------------------------------------------
// The figure styles' tokens, by registry path
// ---------------------------------------------------------------------------

// The registry path of a token: style.<group>.<key>, and style.seed for the seed.
export function stylePathOf(token: Token): string {
  return token.group === 'seed' ? 'style.seed' : `style.${token.group}.${token.key}`
}

const TOKEN_BY_PATH: ReadonlyMap<string, Token> = new Map(TOKENS.map((token) => [stylePathOf(token), token]))

// The token behind a style.* path, or undefined for any other setting.
export function tokenAt(path: string): Token | undefined {
  return TOKEN_BY_PATH.get(path)
}

// A token's value from text, or a refusal naming what would have been valid.
// `name` is how the message calls the setting ("@style-looseness", "The base
// style's line looseness").
export function parseTokenValue(token: Token, text: string, name: string): string | number {
  const value = text.trim()
  switch (token.kind) {
    case 'choice':
      if (!token.choices.includes(value)) throw new Error(`${name} must be one of ${token.choices.join(', ')}, got "${value}"`)
      return value
    case 'colour': {
      const colour = parseColourSetting(value)
      if (colour === null) {
        throw new Error(
          `${name} must be a colour: a name (${Object.keys(COLOR_NAMES).join(', ')}), six hex digits without the "#" (which starts a comment in a spec) like fdf6e3, or "theme"; got "${value}"`
        )
      }
      return colour
    }
    case 'number': {
      const n = Number(value)
      const range = `from ${token.min} to ${token.max}`
      if (value === '' || !Number.isFinite(n)) throw new Error(`${name} must be a number ${range}, got "${value}"`)
      if (token.integer && !Number.isInteger(n)) throw new Error(`${name} must be a whole number ${range}, got "${value}"`)
      if (n < token.min || n > token.max) throw new Error(`${name} must be a number ${range}, got "${value}"`)
      return n
    }
  }
}

// ---------------------------------------------------------------------------
// Any setting's value
// ---------------------------------------------------------------------------

const show = (raw: unknown): string => {
  try {
    return JSON.stringify(raw) ?? String(raw)
  } catch {
    return String(raw)
  }
}

function readNumber(spec: SettingSpec, raw: unknown, name: string): number {
  const range = `from ${spec.min} to ${spec.max}`
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null
  if (text === null) throw new Error(`${name} must be a number ${range}, got ${show(raw)}`)
  const n = Number(text)
  if (text === '' || !Number.isFinite(n)) throw new Error(`${name} must be a number ${range}, got "${text}"`)
  // A setting that counts something whole (a seed, a switch, bristles) is refused when it is not, as a
  // figure style's whole-number setting is (parseTokenValue): never rounded.
  if (spec.integer === true && !Number.isInteger(n)) throw new Error(`${name} must be a whole number ${range}, got "${text}"`)
  if (n < (spec.min ?? Number.NEGATIVE_INFINITY) || n > (spec.max ?? Number.POSITIVE_INFINITY)) {
    throw new Error(`${name} must be a number ${range}, got "${text}"`)
  }
  return n
}

function readChoice(spec: SettingSpec, raw: unknown, name: string): string {
  const choices = spec.choices ?? []
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : null
  if (text === null || !choices.includes(text)) throw new Error(`${name} must be one of ${choices.join(', ')}, got ${text === null ? show(raw) : `"${text}"`}`)
  return text
}

// A curve is points over x in 0..1 (space/paint/curves.ts): at least two, x rising,
// y within the curve's own range (the editor's). Written as JSON ("[[0,0],[1,1]]") or
// as "x,y" pairs separated by spaces ("0,0 0.5,0.7 1,1"), which suits a directive.
function readCurve(spec: SettingSpec, raw: unknown, name: string): number[][] {
  const yMin = spec.min ?? Number.NEGATIVE_INFINITY
  const yMax = spec.max ?? Number.POSITIVE_INFINITY
  const refuse = (why: string): never => {
    throw new Error(
      `${name} must be a curve: at least two "x,y" points with x rising from 0 to 1 and y from ${yMin} to ${yMax}, like "0,0 0.5,0.7 1,1" — ${why}`
    )
  }
  let points: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text.startsWith('[')) {
      try {
        points = JSON.parse(text)
      } catch {
        return refuse(`"${text}" is not valid JSON`)
      }
    } else {
      points = text === '' ? [] : text.split(/\s+/).map((pair) => {
        const parts = pair.split(',')
        if (parts.length !== 2 || parts.some((part) => part === '')) return refuse(`"${pair}" is not an x,y pair`)
        return parts.map(Number)
      })
    }
  }
  if (!Array.isArray(points) || points.length < 2) return refuse(`got ${show(raw)}`)
  const out: number[][] = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      return refuse(`${show(point)} is not an x,y pair of numbers`)
    }
    const [x, y] = point as [number, number]
    if (x < 0 || x > 1) return refuse(`x ${x} is outside 0 to 1`)
    if (y < yMin || y > yMax) return refuse(`y ${y} is outside ${yMin} to ${yMax}`)
    if (out.length > 0 && x <= out[out.length - 1][0]) return refuse(`x must rise, but ${x} follows ${out[out.length - 1][0]}`)
    out.push([x, y])
  }
  return out
}

// A setting's value from what was written, or a refusal naming what is valid.
// `raw` is the text of a directive, or a value from an object a host passed (a
// number, a string, a curve's points). The value comes back normalised: a colour name
// as "#rrggbb", a number as a number, a curve as fresh [x, y] pairs.
export function readSettingValue(spec: SettingSpec, raw: unknown, name: string): SettingValue {
  const token = TOKEN_BY_PATH.get(spec.path)
  if (token !== undefined) {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      const what = token.kind === 'number' ? `a number from ${token.min} to ${token.max}` : token.kind === 'choice' ? `one of ${token.choices.join(', ')}` : 'a colour'
      throw new Error(`${name} must be ${what}, got ${show(raw)}`)
    }
    return parseTokenValue(token, String(raw), name)
  }
  switch (spec.type) {
    case 'number':
      return readNumber(spec, raw, name)
    case 'choice':
      return readChoice(spec, raw, name)
    case 'colour': {
      const colour = typeof raw === 'string' ? parseColourSetting(raw) : null
      if (colour === null) throw new Error(`${name} must be a colour: six hex digits without the "#" like fdf6e3, or a colour name, or "theme"; got ${show(raw)}`)
      return colour
    }
    case 'curve':
      return readCurve(spec, raw, name)
  }
}

// ---------------------------------------------------------------------------
// Finding a setting by the name an author wrote
// ---------------------------------------------------------------------------

// The setting at a path, written in full ("style.line.looseness") or, for the figure
// styles, without "style." ("line.looseness", as the design's examples write it).
export function findSetting(path: string): SettingSpec | undefined {
  const text = path.trim()
  return settingAt(text) ?? settingAt(`style.${text}`)
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}

// How close a typed path is to a registry path: the edit distance to the whole path,
// or to what is left once leading segments are dropped (a bare "looseness" is close to
// style.line.looseness), a little more for each segment dropped.
function closeness(wanted: string, candidate: string): number {
  const segments = candidate.split('.')
  let best = Number.POSITIVE_INFINITY
  for (let dropped = 0; dropped < segments.length; dropped++) {
    best = Math.min(best, distance(wanted, segments.slice(dropped).join('.')) + dropped * 0.75)
  }
  return best
}

// The registry paths nearest to a path that is not one, nearest first. Deterministic:
// a tie goes to the path that comes first in the registry.
export function nearestPaths(path: string, count = 3): string[] {
  const wanted = path.trim().toLowerCase()
  return REGISTRY.map((spec, index) => ({ path: spec.path, index, score: closeness(wanted, spec.path.toLowerCase()) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, count)
    .map((entry) => entry.path)
}

// The refusal for a path that is not a setting, naming the nearest ones (or, for a group
// such as "paint.value", the settings in it). `subject` is how the message starts
// ("@style-set", "The base style's set").
export function noSuchSetting(subject: string, path: string): string {
  const text = path.trim()
  const inside = REGISTRY.filter((spec) => spec.path.startsWith(`${text}.`) || spec.path.startsWith(`style.${text}.`))
  if (text !== '' && inside.length > 0) {
    const names = inside.slice(0, 5).map((spec) => spec.path)
    return `${subject}: "${text}" is a group of settings, not one setting — it holds ${names.join(', ')}${inside.length > names.length ? ', ...' : ''}`
  }
  return `${subject} has no setting "${text}" — the nearest are ${nearestPaths(text).join(', ')}`
}
