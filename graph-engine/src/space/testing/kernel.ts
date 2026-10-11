// Spec text through the parser and the space kernel, for tests of the
// builders. The spec must parse with no errors: a builder test never tests
// the parser by accident.

import { expect } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { createSpaceKernel } from '../kernel/index'
import type { SpaceKernel } from '../kernel/api'
import type { LabelAnchor, Mark, SpaceScene } from '../scene/types'

export function kernelOf(spec: string): SpaceKernel {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
}

export function sceneOf(spec: string): SpaceScene {
  return kernelOf(spec).scene()
}

export function marksOf<K extends Mark['kind']>(scene: SpaceScene, kind: K): Extract<Mark, { kind: K }>[] {
  return scene.marks.filter((m) => m.kind === kind) as Extract<Mark, { kind: K }>[]
}

export function markAt(scene: SpaceScene, object: string): Mark {
  const mark = scene.marks.find((m) => m.source.object === object)
  if (!mark) throw new Error(`no mark ${object}; the scene has ${scene.marks.map((m) => m.source.object).join(', ')}`)
  return mark
}

export function labelText(scene: SpaceScene): string[] {
  return scene.labels.map((l: LabelAnchor) => l.text)
}

export function vertexOf(p: Float64Array, i: number): [number, number, number] {
  return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
}

export function vertices(p: Float64Array): [number, number, number][] {
  return Array.from({ length: p.length / 3 }, (_, i) => vertexOf(p, i))
}
