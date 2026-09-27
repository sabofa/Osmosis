// Which labels show, and where (plan G10). Pure: the DOM overlay only
// applies what this returns.
//
// - Frame labels (ticks and titles) sit at their projected author position
//   plus the frame's screen offset, centred there.
// - Point labels (scene.labels) sit up-right of their anchor by 6 px, with
//   their bottom-left corner there.
// - A label whose anchor projects outside the viewport, or behind a
//   perspective eye, is hidden.
// - Keys are stable across camera moves, so the pool reuses its spans.

import { project, type CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { FrameModel } from '../frame/types'
import type { LabelAnchor } from '../scene/types'

export const POINT_LABEL_OFFSET: readonly [number, number] = [6, -6]

export type LabelRole = 'tick' | 'title' | 'label'

export interface LabelItem {
  key: string
  text: string
  // CSS px in the viewport: the label's centre for 'tick' and 'title', its
  // bottom-left corner for 'label'.
  x: number
  y: number
  role: LabelRole
  visible: boolean
}

function inView(camera: CameraMatrices, s: { x: number; y: number; depth: number }): boolean {
  const { width, height } = camera.viewport
  return s.x >= 0 && s.x <= width && s.y >= 0 && s.y <= height && s.depth >= -1 && s.depth <= 1
}

export function layoutLabels(frame: FrameModel, sceneLabels: readonly LabelAnchor[], camera: CameraMatrices, world: WorldMap): LabelItem[] {
  const items: LabelItem[] = []
  for (const l of frame.labels) {
    const s = project(camera, world.toWorld(l.position))
    items.push({ key: l.key, text: l.text, x: s.x + l.screenOffset[0], y: s.y + l.screenOffset[1], role: l.role, visible: inView(camera, s) })
  }
  sceneLabels.forEach((l, i) => {
    const s = project(camera, world.toWorld(l.position))
    items.push({
      key: `label:${i}:${l.source.object}`,
      text: l.text,
      x: s.x + POINT_LABEL_OFFSET[0],
      y: s.y + POINT_LABEL_OFFSET[1],
      role: 'label',
      visible: inView(camera, s),
    })
  })
  return items
}
