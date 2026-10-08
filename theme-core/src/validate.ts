import { contrast, fitLightness, parseColour, toHex, type Oklch } from './colour.js'
import { FONT_STACKS, ID_RE, RESERVED_THEME_IDS, normalise, type Mode } from './manifest.js'
import { tokenByName, isValidTokenValue } from './registry/index.js'
import { mirrorSeed, resolve } from './resolve.js'

export interface Issue { path: string; message: string; suggestion?: string }
export interface Report { ok: boolean; errors: Issue[]; warnings: Issue[] }
export const MAX_CSS_BYTES = 64 * 1024

const TOP = new Set(['schema', 'id', 'name', 'description', 'author', 'seeds', 'dials', 'fonts', 'overrides', 'css', 'graph', 'ambience', 'sounds', 'assets'])
const SEED_KEYS = new Set(['canvas', 'surface', 'ink', 'accent', 'secondary', 'good', 'bad', 'warn', 'info'])
const UNIT_DIALS = ['contrast', 'warmth', 'saturation', 'roundness', 'density', 'elevation', 'borders', 'translucency', 'texture', 'motion']
const ROLES = new Set(['display', 'body', 'mono', 'math'])
const BOARDS = new Set(['blackboard', 'greenboard', 'whiteboard'])
const MODES: Mode[] = ['light', 'dark']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isColour = (v: unknown): boolean => {
  if (typeof v !== 'string') return false
  try { parseColour(v); return true } catch { return false }
}
function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++ } else n += 3
    } else n += 3
  }
  return n
}
const trunc = (s: string, n = 40): string => (s.length > n ? s.slice(0, n) + String.fromCharCode(0x2026) : s)
function show(v: unknown): string {
  const t = typeof v
  if (t === 'object' || t === 'function' || t === 'symbol') return v === null ? 'null' : t
  if (t === 'bigint') return trunc(`${String(v)}n`)
  const j = JSON.stringify(v)
  return trunc(j === undefined ? t : j)
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function structural(raw: unknown, errors: Issue[]): void {
  const err = (path: string, message: string): void => { errors.push({ path, message }) }
  if (!isObj(raw)) { err('', 'theme must be a plain object'); return }
  if (raw.schema !== 1) err('schema', 'schema must be 1')
  if (typeof raw.id !== 'string') err('id', 'id must be a string')
  else if (raw.id.startsWith('builtin:')) err('id', 'builtin ids are reserved')
  else if (!ID_RE.test(raw.id)) err('id', 'id must match ' + ID_RE.source)
  else if ((RESERVED_THEME_IDS as readonly string[]).includes(raw.id)) err('id', 'id is reserved')
  if (typeof raw.name !== 'string' || raw.name === '') err('name', 'name must be a non-empty string')
  for (const k of Object.keys(raw)) if (!TOP.has(k)) err(k, `unknown top-level field: ${trunc(k)}`)
  if (raw.description !== undefined && typeof raw.description !== 'string') err('description', 'description must be a string')
  if (raw.author !== undefined && raw.author !== 'human' && raw.author !== 'claude') err('author', "author must be 'human' or 'claude'")
  for (const f of ['seeds', 'dials', 'fonts', 'overrides', 'graph']) {
    if (raw[f] !== undefined && !isObj(raw[f])) err(f, `${f} must be an object`)
  }

  if (isObj(raw.seeds)) {
    for (const [mode, s] of Object.entries(raw.seeds)) {
      if (!MODES.includes(mode as Mode)) { err(`seeds.${mode}`, 'seeds modes are light and dark'); continue }
      if (!isObj(s)) { err(`seeds.${mode}`, 'must be an object'); continue }
      for (const [k, v] of Object.entries(s)) {
        const p = `seeds.${mode}.${k}`
        if (k === 'series') {
          if (!Array.isArray(v)) err(p, 'series must be an array of colours')
          else {
            if (v.length > 16) err(p, 'series has at most 16 entries')
            v.forEach((c, i) => { if (!isColour(c)) err(`${p}[${i}]`, `not a colour: ${show(c)}`) })
          }
        } else if (!SEED_KEYS.has(k)) err(p, `unknown seed: ${trunc(k)}`)
        else if (!isColour(v)) err(p, `not a colour: ${show(v)}`)
      }
    }
  }

  if (isObj(raw.dials)) {
    for (const [k, v] of Object.entries(raw.dials)) {
      const p = `dials.${k}`
      if (UNIT_DIALS.includes(k)) { if (!num(v) || v < 0 || v > 1) err(p, 'must be a number from 0 to 1') }
      else if (k === 'typeScale') { if (!num(v) || v < 1.125 || v > 1.333) err(p, 'must be a number from 1.125 to 1.333') }
      else if (k === 'baseSize') { if (!num(v) || v < 13 || v > 18) err(p, 'must be a number from 13 to 18') }
      else if (k === 'twilightBlend') { if (typeof v !== 'boolean') err(p, 'must be true or false') }
      else err(p, `unknown dial: ${trunc(k)}`)
    }
  }

  if (isObj(raw.fonts)) {
    for (const [role, f] of Object.entries(raw.fonts)) {
      const p = `fonts.${role}`
      if (!ROLES.has(role)) { err(p, `unknown font role: ${trunc(role)}`); continue }
      const ok = isObj(f) && (
        (typeof f.stack === 'string' && Object.prototype.hasOwnProperty.call(FONT_STACKS, f.stack)) ||
        (typeof f.asset === 'string' && f.asset !== ''))
      if (!ok) err(p, `font must be { stack: ${Object.keys(FONT_STACKS).join('|')} } or { asset: non-empty string }`)
    }
  }

  if (isObj(raw.overrides)) {
    for (const [mode, o] of Object.entries(raw.overrides)) {
      if (mode !== 'any' && mode !== 'light' && mode !== 'dark') { err(`overrides.${mode}`, 'overrides modes are any, light and dark'); continue }
      if (!isObj(o)) { err(`overrides.${mode}`, 'must be an object'); continue }
      for (const [tok, v] of Object.entries(o)) {
        const p = `overrides.${mode}.${tok}`
        const d = tokenByName.get(tok)
        if (!d) { err(p, `unknown token: ${trunc(tok)}`); continue }
        if (typeof v !== 'string' || !isValidTokenValue(d, v)) {
          err(p, d.allowed ? `invalid value for ${trunc(tok)}; allowed: ${d.allowed.join(', ')}` : `invalid ${d.type} value for ${tok}: ${show(v)}`)
        }
      }
    }
  }

  if (raw.css !== undefined) {
    if (typeof raw.css !== 'string') err('css', 'css must be a string')
    else if (utf8Length(raw.css) > MAX_CSS_BYTES) err('css', `css exceeds ${MAX_CSS_BYTES} bytes`)
  }

  if (isObj(raw.graph) && raw.graph.boards !== undefined) {
    const b = raw.graph.boards
    if (!isObj(b)) err('graph.boards', 'boards must be an object')
    else {
      for (const [k, v] of Object.entries(b)) {
        if (!BOARDS.has(k)) err(`graph.boards.${k}`, `unknown board: ${trunc(k)}`)
        else if (!isColour(v)) err(`graph.boards.${k}`, `not a colour: ${show(v)}`)
      }
    }
  }
}

function dist(a: Oklch, b: Oklch): number {
  const ax = a.c * Math.cos((a.h * Math.PI) / 180), ay = a.c * Math.sin((a.h * Math.PI) / 180)
  const bx = b.c * Math.cos((b.h * Math.PI) / 180), by = b.c * Math.sin((b.h * Math.PI) / 180)
  return Math.hypot(a.l - b.l, ax - bx, ay - by)
}

interface Check { fg: string; bg: string; min: number }

function fitHex(c: Oklch, checks: { bg: Oklch; min: number }[]): string | undefined {
  const opaque = { ...c, a: 1 }
  const passes = (hex: string): boolean => {
    const p = parseColour(hex)
    return checks.every((k) => contrast(p, k.bg) >= k.min)
  }
  const cands = checks.map((k) => fitLightness(opaque, k.bg, k.min + 0.02))
  let cand = cands.reduce((a, b) => (Math.abs(b.l - opaque.l) > Math.abs(a.l - opaque.l) ? b : a), cands[0]!)
  const bgl = checks.reduce((a, k) => a + k.bg.l, 0) / checks.length
  const dir = cand.l > opaque.l ? 1 : cand.l < opaque.l ? -1 : opaque.l >= bgl ? 1 : -1
  for (let i = 0; i < 200; i++) {
    if (cand.l <= 0 || cand.l >= 1) break
    const hex = toHex(cand)
    if (passes(hex)) return hex
    cand = { ...cand, l: cand.l + dir * 0.005 }
  }
  const end = dir > 0 ? '#ffffff' : '#000000'
  return passes(end) ? end : undefined
}

export function fitToHex(c: Oklch, against: Oklch, min: number): string | undefined {
  return fitHex(c, [{ bg: against, min }])
}

function contrastWarnings(raw: Record<string, unknown>, errors: Issue[], warnings: Issue[]): void {
  let r
  try { r = resolve(normalise(raw as never)) } catch (e) {
    errors.push({ path: 'resolve', message: trunc(e instanceof Error ? e.message : 'resolve failed', 100) })
    return
  }
  const seedsRaw = isObj(raw.seeds) ? raw.seeds : {}
  for (const mode of MODES) {
    const t = r[mode]
    const col = (n: string): Oklch | undefined => { try { return t[n] ? parseColour(t[n]!) : undefined } catch { return undefined } }
    const checks: Check[] = [
      { fg: 'color-text', bg: 'color-canvas', min: 4.5 },
      { fg: 'color-text', bg: 'color-surface', min: 4.5 },
      { fg: 'color-text-muted', bg: 'color-surface', min: 3 },
    ]
    for (let i = 1; i <= 16; i++) { if (t[`color-series-${i}`]) checks.push({ fg: `color-series-${i}`, bg: 'color-surface', min: 3 }) }
    checks.push({ fg: 'color-focus', bg: 'color-canvas', min: 3 }, { fg: 'color-text-on-accent', bg: 'color-accent', min: 4.5 })
    const suggestions = new Map<string, string | undefined>()
    const suggest = (fg: string): string | undefined => {
      if (suggestions.has(fg)) return suggestions.get(fg)
      const f = col(fg)
      const group = checks.filter((k) => k.fg === fg).map((k) => ({ bg: col(k.bg), min: k.min }))
        .filter((k): k is { bg: Oklch; min: number } => k.bg !== undefined)
      const hex = f && group.length ? fitHex(f, group) : undefined
      suggestions.set(fg, hex)
      return hex
    }
    for (const { fg, bg, min } of checks) {
      const f = col(fg), b = col(bg)
      if (!f || !b) continue
      const ratio = contrast(f, b)
      if (ratio >= min) continue
      const hex = suggest(fg)
      const issue: Issue = { path: `overrides.${mode}.${fg}`, message: `${mode}: ${fg} on ${bg} has contrast ${ratio.toFixed(2)}, below ${min}` }
      if (hex) {
        const p = parseColour(hex)
        const worst = Math.min(...checks.filter((k) => k.fg === fg).map((k) => { const bb = col(k.bg); return bb ? contrast(p, bb) : Infinity }))
        issue.suggestion = `set ${fg} to ${hex} (contrast ${worst.toFixed(1)})`
      }
      warnings.push(issue)
    }
    // closeness: only series colours the user supplied (this mode's, or the other mode's mirrored in)
    const other = mode === 'light' ? 'dark' : 'light'
    const mine = isObj(seedsRaw[mode]) ? (seedsRaw[mode] as Record<string, unknown>).series : undefined
    const theirs = isObj(seedsRaw[other]) ? (seedsRaw[other] as Record<string, unknown>).series : undefined
    let user: Oklch[] = []
    if (Array.isArray(mine)) user = mine.map((s) => parseColour(s as string))
    else if (Array.isArray(theirs)) user = theirs.map((s) => mirrorSeed('accent', parseColour(s as string), mode))
    for (let a = 0; a < user.length; a++) for (let b = a + 1; b < user.length; b++) {
      const d = dist(user[a]!, user[b]!)
      if (d < 0.05) warnings.push({ path: `color-series-${a + 1}/${b + 1}`, message: `${mode}: series colours ${a + 1} and ${b + 1} are too similar (distance ${d.toFixed(3)}, below 0.05)` })
    }
  }
}

export function validate(raw: unknown): Report {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  try {
    structural(raw, errors)
    if (errors.length === 0) contrastWarnings(raw as Record<string, unknown>, errors, warnings)
  } catch (e) {
    errors.push({ path: '', message: `validate failed: ${trunc(e instanceof Error ? e.message : 'unknown error', 100)}` })
  }
  return { ok: errors.length === 0, errors, warnings: errors.length ? [] : warnings }
}
