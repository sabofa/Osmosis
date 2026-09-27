// What a frame's lines depend on, besides the camera's wall and edge
// choices: the box, the world scale (tick marks are a fixed world length)
// and the tick steps. Two frames with equal keys have identical lines, so
// the GL layer may skip re-uploading; anything that moves a line must be in
// here, or a new box would be drawn with the old one's walls.

import type { WorldMap } from '../camera/world'
import type { FrameAxes } from './types'

export function frameGeometryKey(style: string, world: WorldMap, axes: FrameAxes): string {
  const b = world.box
  return [
    style,
    b.x.min,
    b.x.max,
    b.y.min,
    b.y.max,
    b.z.min,
    b.z.max,
    ...world.scale,
    axes.x.step,
    axes.y.step,
    axes.z.step,
  ].join(',')
}
