// SP8 style clauses. They are stripped only on a line space has claimed:
// splitStyle reads them off the end tentatively, and a hook that does not
// claim the line throws the result away, so the shared parser sees the line
// exactly as written. "color:" and "name:" are the shared loop's, stripped
// before the hooks run.
//
//   opacity: 0.5
//   colormap: height | none | <expr> [map <name>] [diverging]
//   mesh: on | off
//   res: 120
//   width: 3            (line width, px)
//   dashed              (a bare flag)

import { parseExprString } from '../../parser/parseExpr'
import type { ColormapName } from '../scene/types'
import type { ColormapClause, SpaceStyle } from './types'

// color and name are the shared clauses; one read here was written before a
// style clause, where the shared loop cannot strip it, and is refused.
export type StyleKey = 'opacity' | 'colormap' | 'mesh' | 'res' | 'width' | 'dashed' | 'color' | 'name'

export interface RawClause {
  key: StyleKey
  value: string
}

const COLORMAPS: readonly ColormapName[] = ['viridis', 'cividis', 'magma', 'plasma', 'gray', 'balance']

export function isColormapName(name: string): name is ColormapName {
  return (COLORMAPS as readonly string[]).includes(name)
}

export function unknownColormap(name: string): Error {
  return new Error(`Unknown colormap "${name}" — the maps are ${COLORMAPS.join(', ')}`)
}

// The keyed clauses (every one but the bare "dashed"), and where one starts
// in a line: the single list the space grammar reads clauses by.
export const STYLE_KEYS = ['opacity', 'colormap', 'mesh', 'res', 'width', 'color', 'name'] as const
export const STYLE_CLAUSE_START = new RegExp(String.raw`\s(?:${STYLE_KEYS.join('|')}):|\sdashed(?=\s|$)`)

// Reads the trailing style clauses off `line`, last first, and returns what is
// left. Nothing is validated here: a clause is recognised by its keyword, so a
// claimed line with a bad value is refused by name rather than misread.
export function splitStyle(line: string): { rest: string; clauses: RawClause[] } {
  let rest = line.trimEnd()
  const clauses: RawClause[] = []
  for (;;) {
    const dashed = /\s+dashed$/.exec(rest)
    if (dashed) {
      clauses.unshift({ key: 'dashed', value: '' })
      rest = rest.slice(0, dashed.index).trimEnd()
      continue
    }
    const keyword = new RegExp(String.raw`\s(${STYLE_KEYS.join('|')}):`, 'g')
    let last: RegExpExecArray | null = null
    for (let m = keyword.exec(rest); m; m = keyword.exec(rest)) last = m
    if (!last) break
    clauses.unshift({ key: last[1] as StyleKey, value: rest.slice(last.index + last[0].length).trim() })
    rest = rest.slice(0, last.index).trimEnd()
  }
  return { rest, clauses }
}

// What a clause is being applied to, for the refusal message.
export type StyleTarget = 'surface' | 'parametric surface' | 'implicit surface' | 'curve' | 'function definition' | 'vector definition'

const SURFACES: readonly StyleTarget[] = ['surface', 'parametric surface', 'implicit surface']

function article(target: StyleTarget): string {
  return target === 'implicit surface' ? 'an' : 'a'
}

function refuse(key: StyleKey, target: StyleTarget): Error {
  const label = key === 'dashed' ? 'dashed' : `${key}:`
  const appliesTo = key === 'width' || key === 'dashed' ? 'curves and lines' : key === 'res' ? 'drawn forms' : 'surfaces'
  return new Error(`${label} applies to ${appliesTo}, not to ${article(target)} ${target}`)
}

function applies(key: StyleKey, target: StyleTarget): boolean {
  if (target === 'function definition' || target === 'vector definition') return false
  if (key === 'res') return true
  if (key === 'width' || key === 'dashed') return target === 'curve'
  return SURFACES.includes(target)
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/

function number(key: string, value: string): number {
  if (!NUMBER.test(value)) throw new Error(`${key}: expects a number, got "${value}"`)
  return Number.parseFloat(value)
}

function parseColormap(value: string): ColormapClause {
  let rest = value.trim()
  let diverging = false
  let map: ColormapName | null = null
  const flag = /(^|\s)diverging$/.exec(rest)
  if (flag) {
    diverging = true
    rest = rest.slice(0, flag.index).trim()
  }
  const named = /(^|\s)map\s+(\S+)$/.exec(rest)
  if (named) {
    if (!isColormapName(named[2])) throw unknownColormap(named[2])
    map = named[2]
    rest = rest.slice(0, named.index).trim()
  }
  if (rest === '') throw new Error('colormap: expects "height", "none" or an expression, e.g. "colormap: height" or "colormap: x*y map balance"')
  if (rest === 'none') {
    if (map || diverging) throw new Error('colormap: none takes no map and is not diverging')
    return { by: { kind: 'none' }, map: null, diverging: false }
  }
  // balance is the one diverging map, and a diverging scale uses it.
  if (map === 'balance') diverging = true
  if (diverging && map !== null && map !== 'balance') {
    throw new Error(`A diverging colormap uses the balance map, not ${map}, which is sequential`)
  }
  if (rest === 'height') return { by: { kind: 'height' }, map, diverging }
  return { by: { kind: 'expr', expr: parseExprString(rest), text: rest }, map, diverging }
}

// Validates the clauses against what they are applied to and returns the
// style. Throws, naming the clause, when one does not apply or its value is
// out of range.
export function buildStyle(clauses: readonly RawClause[], target: StyleTarget): SpaceStyle {
  const style: SpaceStyle = { opacity: null, colormap: null, mesh: null, res: null, width: null, dashed: false }
  const seen = new Set<StyleKey>()
  for (const { key, value } of clauses) {
    if (key === 'color' || key === 'name') {
      throw new Error('write color: and name: after the other clauses, e.g. "z = x^2 opacity: 0.5 color: red"')
    }
    if (!applies(key, target)) throw refuse(key, target)
    if (seen.has(key)) throw new Error(`${key === 'dashed' ? 'dashed' : `${key}:`} is given twice`)
    seen.add(key)
    switch (key) {
      case 'opacity': {
        const v = number('opacity', value)
        if (v < 0 || v > 1) throw new Error(`opacity: must be from 0 to 1, got ${value}`)
        style.opacity = v
        break
      }
      case 'res': {
        // Cells per axis on a surface (400 is @resolution's cap, well inside
        // the 1,000,000-triangle budget); segments on a curve.
        const v = number('res', value)
        const max = target === 'curve' ? 10000 : 400
        if (!Number.isInteger(v) || v < 2 || v > max) {
          throw new Error(`res: must be a whole number from 2 to ${max} on ${article(target)} ${target}, got ${value}`)
        }
        style.res = v
        break
      }
      case 'width': {
        const v = number('width', value)
        if (!(v > 0)) throw new Error(`width: must be positive, got ${value}`)
        style.width = v
        break
      }
      case 'mesh': {
        if (value !== 'on' && value !== 'off') throw new Error(`mesh: must be "on" or "off", got "${value}"`)
        style.mesh = value === 'on'
        break
      }
      case 'colormap':
        style.colormap = parseColormap(value)
        break
      case 'dashed':
        style.dashed = true
        break
    }
  }
  return style
}
