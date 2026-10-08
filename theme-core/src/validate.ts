import { contrast, fitLightness, parseColour, toHex, type Oklch } from './colour.js'
import { FONT_STACKS, ID_RE, type Mode } from './manifest.js'
import { tokenByName, isValidTokenValue } from './registry/index.js'
import { resolve } from './resolve.js'

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
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function structural(raw: unknown, errors: Issue[]): void {
  const err = (path: string, message: string): void => { errors.push({ path, message }) }
  if (!isObj(raw)) { err('', 'theme must be a plain object'); return }
  if (raw.schema !== 1) err('schema', 'schema must be 1')
  if (typeof raw.id !== 'string') err('id', 'id must be a string')
  else if (raw.id.startsWith('builtin:')) err('id', 'builtin ids are reserved')
  else if (!ID_RE.test(raw.id)) err('id', 'id must match ' + ID_RE.source)
  if (typeof raw.name !== 'string' || raw.name === '') err('name', 'name must be a non-empty string')
  for (const k of Object.keys(raw)) if (!TOP.has(k)) err(k, `unknown top-level field: ${k}`)
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
            v.forEach((c, i) => { if (!isColour(c)) err(`${p}[${i}]`, `not a colour: ${String(c)}`) })
          }
        } else if (!SEED_KEYS.has(k)) err(p, `unknown seed: ${k}`)
        else if (!isColour(v)) err(p, `not a colour: ${String(v)}`)
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
      else err(p, `unknown dial: ${k}`)
    }
  }

  if (isObj(raw.fonts)) {
    for (const [role, f] of Object.entries(raw.fonts)) {
      const p = `fonts.${role}`
      if (!ROLES.has(role)) { err(p, `unknown font role: ${role}`); continue }
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
        if (!d) { err(p, `unknown token: ${tok}`); continue }
        if (typeof v !== 'string' || !isValidTokenValue(d, v)) {
          err(p, d.allowed ? `invalid value for ${tok}; allowed: ${d.allowed.join(', ')}` : `invalid ${d.type} value for ${tok}: ${String(v)}`)
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
        if (!BOARDS.has(k)) err(`graph.boards.${k}`, `unknown board: ${k}`)
        else if (!isColour(v)) err(`graph.boards.${k}`, `not a colour: ${String(v)}`)
      }
    }
  }
}

function dist(a: Oklch, b: Oklch): number {
  const ax = a.c * Math.cos((a.h * Math.PI) / 180), ay = a.c * Math.sin((a.h * Math.PI) / 180)
  const bx = b.c * Math.cos((b.h * Math.PI) / 180), by = b.c * Math.sin((b.h * Math.PI) / 180)
  return Math.hypot(a.l - b.l, ax - bx, ay - by)
}

function contrastWarnings(raw: Record<string, unknown>, errors: Issue[], warnings: Issue[]): void {
  let r
  try { r = resolve(raw as never) } catch (e) {
    errors.push({ path: 'resolve', message: e instanceof Error ? e.message : String(e) })
    return
  }
  for (const mode of MODES) {
    const t = r[mode]
    const col = (n: string): Oklch | undefined => { try { return t[n] ? parseColour(t[n]!) : undefined } catch { return undefined } }
    const check = (fg: string, bg: string, min: number): void => {
      const f = col(fg), b = col(bg)
      if (!f || !b) return
      const ratio = contrast(f, b)
      if (ratio >= min) return
      const fit = fitLightness(f, b, min)
      warnings.push({
        path: `overrides.${mode}.${fg}`,
        message: `${mode}: ${fg} on ${bg} has contrast ${ratio.toFixed(2)}, below ${min}`,
        suggestion: `set ${fg} to ${toHex(fit)} (contrast ${contrast(fit, b).toFixed(1)})`,
      })
    }
    check('color-text', 'color-canvas', 4.5)
    check('color-text', 'color-surface', 4.5)
    check('color-text-muted', 'color-surface', 3)
    for (let i = 1; i <= 16; i++) { if (t[`color-series-${i}`]) check(`color-series-${i}`, 'color-surface', 3) }
    check('color-focus', 'color-canvas', 3)
    check('color-text-on-accent', 'color-accent', 4.5)
    const series: [number, Oklch][] = []
    for (let i = 1; i <= 16; i++) { const c = col(`color-series-${i}`); if (c) series.push([i, c]) }
    for (let a = 0; a < series.length; a++) for (let b = a + 1; b < series.length; b++) {
      const d = dist(series[a]![1], series[b]![1])
      if (d < 0.08) warnings.push({ path: `color-series-${series[a]![0]}/${series[b]![0]}`, message: `${mode}: series colours ${series[a]![0]} and ${series[b]![0]} are too similar (distance ${d.toFixed(3)}, below 0.08)` })
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
    errors.push({ path: '', message: `validate failed: ${e instanceof Error ? e.message : String(e)}` })
  }
  return { ok: errors.length === 0, errors, warnings: errors.length ? [] : warnings }
}
