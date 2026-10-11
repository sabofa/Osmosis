// Test helpers for the calculus of a surface: a scene from a spec, and marks
// and labels by their source object.

import { expect } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import type { ArrowMark, LabelAnchor, LineMark, Mark, MeshMark, PointMark, SpaceScene, Vec3 } from '../../scene/types'
import { createSpaceKernel } from '../index'

export function kernelOf(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
}

export function sceneOf(spec: string): SpaceScene {
  return kernelOf(spec).scene()
}

export function markOf<K extends Mark['kind']>(scene: SpaceScene, object: string, kind: K): Extract<Mark, { kind: K }> {
  const mark = scene.marks.find((m) => m.source.object === object)
  if (!mark) throw new Error(`no mark ${object} among ${scene.marks.map((m) => m.source.object).join(', ')}`)
  expect(mark.kind).toBe(kind)
  return mark as Extract<Mark, { kind: K }>
}

export const lineOf = (scene: SpaceScene, object: string): LineMark => markOf(scene, object, 'lines')
export const pointsOf = (scene: SpaceScene, object: string): PointMark => markOf(scene, object, 'points')
export const arrowsOf = (scene: SpaceScene, object: string): ArrowMark => markOf(scene, object, 'arrows')
export const meshOf = (scene: SpaceScene, object: string): MeshMark => markOf(scene, object, 'mesh')

export function labelOf(scene: SpaceScene, object: string): LabelAnchor {
  const label = scene.labels.find((l) => l.source.object === object)
  if (!label) throw new Error(`no label ${object} among ${scene.labels.map((l) => l.source.object).join(', ')}`)
  return label
}

export function vertices(positions: Float64Array): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i + 2 < positions.length; i += 3) out.push([positions[i], positions[i + 1], positions[i + 2]])
  return out
}

// The direction of a two-vertex line, normalised.
export function unit(v: readonly number[]): number[] {
  const len = Math.hypot(...v)
  return v.map((c) => c / len)
}

export function expectClose(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((a, i) => expect(Math.abs(a - expected[i]), `component ${i}: ${a} vs ${expected[i]}`).toBeLessThanOrEqual(tolerance))
}

// Parallel (same or opposite direction) within a tolerance on the unit vectors.
export function expectParallel(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  const a = unit(actual)
  const b = unit(expected)
  const sign = a.reduce((s, c, i) => s + c * b[i], 0) < 0 ? -1 : 1
  expectClose(
    a.map((c) => sign * c),
    b,
    tolerance
  )
}
