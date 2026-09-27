// Readout rows for a hit (plan E7), every number through format.ts. Pure.
//
// - Graph z = f: x, y, z (= f), then the partials.
// - Parametric: the point, then its two parameters under their own names.
// - Implicit: the point, then |grad F|.
// - Curve: the point, its parameter under its own name, and the speed
//   |r'(t)|.
// - Point: its label, then its coordinates.
// - Arrow: its tail, its components and its magnitude.
//
// The title is the statement's `name:` when it has one, else its source line
// trimmed to 40 characters, else "line N".

import type { MarkSource, Vec3 } from '../scene/types'
import { formatNumber, formatPoint } from './format'
import type { ReadoutRow } from './types'

export const TITLE_MAX = 40

function point(p: Vec3): ReadoutRow[] {
  return [
    { label: 'x', value: formatNumber(p[0]) },
    { label: 'y', value: formatNumber(p[1]) },
    { label: 'z', value: formatNumber(p[2]) },
  ]
}

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function graphReadout(p: Vec3, fx: number, fy: number): ReadoutRow[] {
  return [...point(p), { label: '∂f/∂x', value: formatNumber(fx) }, { label: '∂f/∂y', value: formatNumber(fy) }]
}

export function parametricReadout(p: Vec3, names: readonly [string, string], u: number, v: number): ReadoutRow[] {
  return [...point(p), { label: names[0], value: formatNumber(u) }, { label: names[1], value: formatNumber(v) }]
}

export function implicitReadout(p: Vec3, grad: Vec3): ReadoutRow[] {
  return [...point(p), { label: '|∇F|', value: formatNumber(norm(grad)) }]
}

// `t` is null for a polyline with no parameter (a segment, a traced curve).
export function curveReadout(p: Vec3, name: string | null, t: number | null, velocity: Vec3 | null): ReadoutRow[] {
  const rows = point(p)
  if (name !== null && t !== null) rows.push({ label: name, value: formatNumber(t) })
  if (velocity) rows.push({ label: "|r′|", value: formatNumber(norm(velocity)) })
  return rows
}

export function pointReadout(p: Vec3, label: string | null): ReadoutRow[] {
  return [...(label ? [{ label: 'point', value: label }] : []), ...point(p)]
}

export function arrowReadout(tail: Vec3, vector: Vec3): ReadoutRow[] {
  return [
    { label: 'tail', value: formatPoint(tail) },
    { label: 'vector', value: `⟨${Array.from(vector, (c) => formatNumber(c)).join(', ')}⟩` },
    { label: '|v|', value: formatNumber(norm(vector)) },
  ]
}

// The readout's heading. `text` is the statement's source line, when known.
export function readoutTitle(source: MarkSource, text: string | null): string {
  if (source.statement) return source.statement
  const line = text?.trim() ?? ''
  if (line.length > 0) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
  return `line ${source.line}`
}
