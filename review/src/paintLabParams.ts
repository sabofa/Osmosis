// The lab's side of the painter's parameters: how a raw slider value becomes a
// parameter (clamped, snapped), how the schema is grouped into the panel, and
// how params become JSON and back (presets, Export, Import). Pure, so the
// graph-engine suite tests it (graph-engine/src/space/paint/lab/*.test.ts).
//
// The contract is graph-engine/src/space/paint/params.ts: PARAM_SCHEMA drives
// every slider and CURVE_SCHEMA every curve editor, resolvePaintParams reads
// every JSON, getParam/setParam address a value by its dotted path
// ("edges.wContrast.1" reaches a tuple entry; a curve is addressed whole, as
// "curves.value").

import type { CurvePoints, CurveSpec } from '../../graph-engine/src/space/paint/curves'
import {
  CURVE_SCHEMA,
  DEFAULT_PAINT_PARAMS,
  getParam,
  PARAM_SCHEMA,
  resolvePaintParams,
  setParam,
  type PaintParams,
  type PaintParamsOverride,
  type ParamSpec,
} from '../../graph-engine/src/space/paint/params'
import { ROLES } from '../../graph-engine/src/space/paint/types'

const SPEC_BY_PATH = new Map(PARAM_SCHEMA.map((spec) => [spec.path, spec]))

// How many decimals a step needs to be shown: 1 -> 0, 0.5 -> 1, 0.005 -> 3.
export function decimalsFor(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

// A 0..1 slider with a whole step is a switch (light.shadows).
export function isToggle(spec: ParamSpec): boolean {
  return spec.min === 0 && spec.max === 1 && spec.step === 1
}

// The nearest value the slider can hold: inside [min, max], a whole number of
// steps from min (what an <input type=range> itself does), with the float
// residue of the multiplication rounded off.
function snapTo(spec: ParamSpec, value: number): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, value))
  const most = Math.floor((spec.max - spec.min) / spec.step + 1e-9)
  const steps = Math.min(most, Math.round((clamped - spec.min) / spec.step))
  const digits = Math.max(decimalsFor(spec.step), decimalsFor(spec.min))
  return Number((spec.min + steps * spec.step).toFixed(digits))
}

// A raw value (a drag, a typed number or its text) applied to one parameter.
// Anything that is not a finite number, or a path the schema does not have,
// changes nothing and returns the same object.
export function applySlider(params: PaintParams, path: string, raw: number | string): PaintParams {
  const spec = SPEC_BY_PATH.get(path)
  if (!spec) return params
  const n = typeof raw === 'string' ? (raw.trim() === '' ? Number.NaN : Number(raw)) : raw
  if (!Number.isFinite(n)) return params
  const value = snapTo(spec, n)
  return getParam(params, path) === value ? params : setParam(params, path, value)
}

export interface ParamGroup {
  title: string
  specs: ParamSpec[]
  // The curve editors of the group (the Curves group has these and no sliders).
  curves: CurveSpec[]
}

// One group per schema group, in the order each first appears (the runs of one
// group, such as the two of Edges, join into one); a group only curves belong
// to comes after them.
export function groupSchema(schema: readonly ParamSpec[], curveSchema: readonly CurveSpec[] = []): ParamGroup[] {
  const groups = new Map<string, ParamGroup>()
  const group = (title: string) => {
    let g = groups.get(title)
    if (!g) groups.set(title, (g = { title, specs: [], curves: [] }))
    return g
  }
  for (const spec of schema) group(spec.group).specs.push(spec)
  for (const curve of curveSchema) group(curve.group).curves.push(curve)
  return [...groups.values()]
}

// The order the panel shows its groups in: what changes the light and the
// environment first, then the curves, the plan, and the finer controls, with
// the stroke groups last. (PARAM_SCHEMA's own order puts Stroke detection and
// the mix balances early, where they were added.) A group not named here comes
// after these, in schema order.
export const LAB_GROUP_ORDER: readonly string[] = [
  'General', 'Light', 'Environment', 'Curves', 'Value plan', 'Lighting curve', 'Brush-load mix', 'Edges', 'Stroke detection',
  ...ROLES.map((role) => `Stroke: ${role}`),
  'Particles', 'Impasto & canvas',
]

// Every slider path in the order PaintParams lays its fields out (tuples by
// index; curves and the weave are not sliders).
function layoutOrder(params: PaintParams): Map<string, number> {
  const order = new Map<string, number>()
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'number') order.set(path, order.size)
    else if (Array.isArray(value)) {
      if (!Array.isArray(value[0])) value.forEach((v, i) => walk(v, `${path}.${i}`))
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k)
    }
  }
  walk(params, '')
  return order
}
const LAYOUT = layoutOrder(DEFAULT_PAINT_PARAMS)

// The groups as the panel shows them: in LAB_GROUP_ORDER, and the rows of each
// in the order PaintParams lays the fields out, which is how a group reads
// (strength first, the mix balances beside the other mix amounts).
export function labGroups(schema: readonly ParamSpec[], curveSchema: readonly CurveSpec[] = []): ParamGroup[] {
  const groups = groupSchema(schema, curveSchema)
  for (const g of groups) g.specs.sort((a, b) => (LAYOUT.get(a.path) ?? 1e9) - (LAYOUT.get(b.path) ?? 1e9))
  const rank = (title: string) => {
    const i = LAB_GROUP_ORDER.indexOf(title)
    return i < 0 ? LAB_GROUP_ORDER.length : i
  }
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.title) - rank(b.g.title) || a.i - b.i)
    .map(({ g }) => g)
}

const CURVE_KEYS = new Set(CURVE_SCHEMA.map((c) => c.path.split('.')[1]))

// A curve by its path ("curves.hAdjust"), whole.
export function getCurve(params: PaintParams, path: string): CurvePoints {
  return (params.curves as unknown as Record<string, CurvePoints>)[path.split('.')[1]]
}

// New params with one curve replaced. A path that is not a curve changes nothing.
export function setCurve(params: PaintParams, path: string, points: CurvePoints): PaintParams {
  const key = path.split('.')[1]
  return CURVE_KEYS.has(key) ? { ...params, curves: { ...params.curves, [key]: points } } : params
}

const sameCurve = (a: CurvePoints, b: CurvePoints) => JSON.stringify(a) === JSON.stringify(b)

// The curves that differ from `base` (the spec defaults unless told).
export function changedCurves(params: PaintParams, base: PaintParams = DEFAULT_PAINT_PARAMS): string[] {
  return CURVE_SCHEMA.filter((spec) => !sameCurve(getCurve(params, spec.path), getCurve(base, spec.path))).map((spec) => spec.path)
}

const SAME = 1e-9

// The sliders whose value differs from `base` (the spec defaults unless told).
export function changedPaths(params: PaintParams, base: PaintParams = DEFAULT_PAINT_PARAMS): string[] {
  return PARAM_SCHEMA.filter((spec) => Math.abs(getParam(params, spec.path) - getParam(base, spec.path)) > SAME).map((spec) => spec.path)
}

export function sameParams(a: PaintParams, b: PaintParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const WEAVES: readonly string[] = ['duck', 'linen']

// Every slider value brought inside its range (not snapped: a typed 0.333 stays
// 0.333), every curve point inside its editor (y clamped to the editor's range,
// a point outside x 0..1 dropped, a curve left with fewer than two points back
// to its default), and a weave the painter does not have repaired to the
// default. This is what an Import, a stored preset and the saved defaults go
// through, so a hand-edited file cannot put the painter in a state its editors
// cannot reach.
export function sanitiseParams(params: PaintParams): PaintParams {
  const next = structuredClone(params)
  for (const spec of PARAM_SCHEMA) {
    const value = getParam(next, spec.path)
    const clamped = Math.min(spec.max, Math.max(spec.min, value))
    if (clamped === value) continue
    const keys = spec.path.split('.')
    let at = next as unknown as Record<string, unknown>
    for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>
    at[keys[keys.length - 1]] = clamped
  }
  let result = next
  for (const spec of CURVE_SCHEMA) {
    const kept = getCurve(result, spec.path)
      .filter(([x]) => x >= 0 && x <= 1)
      .map(([x, y]): [number, number] => [x, Math.min(spec.yMax, Math.max(spec.yMin, y))])
    result = setCurve(result, spec.path, kept.length >= 2 ? kept : structuredClone(getCurve(DEFAULT_PAINT_PARAMS, spec.path)))
  }
  if (!WEAVES.includes(result.canvas.weave)) result.canvas.weave = DEFAULT_PAINT_PARAMS.canvas.weave
  return result
}

export function serialiseParams(params: PaintParams): string {
  return JSON.stringify(params, null, 2)
}

export type ParseResult = { ok: true; params: PaintParams } | { ok: false; error: string }

// Params from JSON text: an object (full or partial) laid over the defaults.
export function parseParams(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `That is not valid JSON (${error instanceof Error ? error.message : String(error)}).` }
  }
  return paramsFromData(data)
}

export function paramsFromData(data: unknown): ParseResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Expected a JSON object of painter parameters, like the one Export gives.' }
  }
  return { ok: true, params: sanitiseParams(resolvePaintParams(data as PaintParamsOverride)) }
}
