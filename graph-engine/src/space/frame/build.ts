// One entry point for the three frame styles (spec SP7 `@frame`). Pure.

import type { FrameStyle } from '../config'
import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import { axesFrame } from './axes'
import { boxFrame } from './box'
import { EMPTY_FRAME, type FrameAxes, type FrameModel } from './types'

export function buildFrame(style: FrameStyle, world: WorldMap, camera: CameraMatrices, axes: FrameAxes): FrameModel {
  if (style === 'box') return boxFrame(world, camera, axes)
  if (style === 'axes') return axesFrame(world, camera, axes)
  return { ...EMPTY_FRAME, lines: [], labels: [] }
}
