// The frame as plain data (plan G5, G6): lines in AUTHOR coordinates, drawn by
// the GL layer through its line and arrow pipelines, and labels anchored at
// author points, drawn by the DOM overlay. Pure; recomputed from the camera
// every frame, because the walls flip and the labels are pushed in screen
// space.

import type { TickStep } from '../config'
import type { Vec3 } from '../scene/types'

// 'wall': a back wall's outline (gridStrong, 1.5 px).
// 'grid': a gridline on a back wall (grid, 1 px).
// 'tick': a tick edge or a tick mark (axis colour, 1.5 px).
// 'axis': a textbook axis, drawn as an arrow from a to b (axes frame only).
export type FrameLineRole = 'wall' | 'grid' | 'tick' | 'axis'

export interface FrameLine {
  a: Vec3
  b: Vec3
  role: FrameLineRole
}

export type FrameLabelRole = 'tick' | 'title'

export interface FrameLabel {
  // Stable across camera moves ("tick:x:<multiple>", "title:x"), so the
  // overlay's pool reuses the same span.
  key: string
  position: Vec3
  // CSS pixels from the projected position to the label's centre.
  screenOffset: readonly [number, number]
  text: string
  role: FrameLabelRole
}

export interface FrameModel {
  lines: FrameLine[]
  labels: FrameLabel[]
  // Identifies the line geometry: two models with the same key over the same
  // box and ticks have identical lines, so the GL layer need not re-upload.
  key: string
}

// One axis's ticks and title, resolved from SpaceConfig.
export interface FrameAxis {
  step: number
  // The authored step, when there is one (pi multiples label as pi).
  authored: TickStep | null
  title: string
}

export interface FrameAxes {
  x: FrameAxis
  y: FrameAxis
  z: FrameAxis
}

export const EMPTY_FRAME: FrameModel = { lines: [], labels: [], key: 'none' }

// Font sizes (G10), shared by the frame's label geometry and the overlay CSS.
export const TICK_FONT_PX = 12
export const TITLE_FONT_PX = 13
export const LABEL_FONT_PX = 13
