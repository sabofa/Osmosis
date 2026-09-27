// Test helpers for the S5 builders: build a spec through the real kernel and
// read marks and readouts back. Imported by tests only.

import { parseSpec } from '../../../parser/parseSpec'
import { APPROX, MINUS } from '../../pick/format'
import type { LabelAnchor, LineMark, Mark, MeshMark, SpaceScene } from '../../scene/types'
import type { SpaceKernel } from '../api'
import { createSpaceKernel } from '../index'

export function kernelOf(spec: string): SpaceKernel {
  const parsed = parseSpec(spec)
  if (parsed.errors.length > 0) throw new Error(`parse errors: ${JSON.stringify(parsed.errors)}`)
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
}

export function sceneOf(spec: string): SpaceScene {
  return kernelOf(spec).scene()
}

export function markNamed<K extends Mark['kind']>(scene: SpaceScene, object: string, kind: K): Extract<Mark, { kind: K }> {
  const mark = scene.marks.find((m) => m.source.object === object)
  if (!mark) throw new Error(`no mark ${object}; have ${scene.marks.map((m) => m.source.object).join(', ')}`)
  if (mark.kind !== kind) throw new Error(`${object} is a ${mark.kind}, not ${kind}`)
  return mark as Extract<Mark, { kind: K }>
}

export function readout(scene: SpaceScene, line: number): LabelAnchor {
  const label = scene.labels.find((l) => l.source.object === `s${line}.readout`)
  if (!label) throw new Error(`no readout on line ${line}; labels: ${scene.labels.map((l) => l.source.object).join(', ')}`)
  return label
}

function parseNumber(text: string): number {
  return Number(text.replace(MINUS, '-'))
}

// The number after "<name> ≈ " in a readout, e.g. approx("area ≈ 0.1667", "area").
export function approx(text: string, name: string): number {
  const at = text.indexOf(`${name} ${APPROX} `)
  if (at < 0) throw new Error(`"${name} ${APPROX}" not in "${text}"`)
  const match = /^[−-]?[0-9.]+/.exec(text.slice(at + name.length + 3))
  if (!match) throw new Error(`no number after "${name} ${APPROX}" in "${text}"`)
  return parseNumber(match[0])
}

// The tuple after "<name> ≈ " in a readout: "centroid ≈ (0.6667, 0.3333)".
export function approxTuple(text: string, name: string): number[] {
  const at = text.indexOf(`${name} ${APPROX} (`)
  if (at < 0) throw new Error(`"${name} ${APPROX} (" not in "${text}"`)
  const inner = text.slice(at + name.length + 4, text.indexOf(')', at))
  return inner.split(',').map((s) => parseNumber(s.trim()))
}

export function vertices(mark: MeshMark | LineMark): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i + 2 < mark.positions.length; i += 3) out.push([mark.positions[i], mark.positions[i + 1], mark.positions[i + 2]])
  return out
}

// The sum of a mesh's triangle areas.
export function meshArea(mesh: MeshMark): number {
  const p = mesh.positions
  let sum = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
    const e1 = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]]
    const e2 = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]]
    sum += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2
  }
  return sum
}

// Each polyline of a LineMark, as its vertices.
export function polylines(mark: LineMark): [number, number, number][][] {
  const all = vertices(mark)
  const starts = Array.from(mark.starts)
  return starts.map((s, i) => all.slice(s, i + 1 < starts.length ? starts[i + 1] : all.length))
}
