// Space's parsed directives and the document-level bindings (spec: Track 3,
// "Revised 2026-09-26", SP5-SP7). Parsed by space/grammar, carried on
// GraphConfig as `space` and `bindings`, consumed by the kernel, the frame,
// the camera and the renderer. Pure: the server bundles the parser, which
// reaches this file.

import type { ColormapName, Range } from './scene/types'

export type Projection = 'orthographic' | 'perspective'

export type FrameStyle = 'box' | 'axes' | 'none'

// `null` means "apply the SP5 default rule" (equal when the spec has no
// z = f surface and the data spans agree within a factor of 4, else auto).
export type Aspect = { kind: 'equal' } | { kind: 'auto' } | { kind: 'ratio'; x: number; y: number; z: number }

// A fixed tick step. `pi` is set when the author wrote the step as a rational
// multiple of pi (pi/2, 2pi, pi/6), so ticks label as multiples of pi — exact
// by construction, never inferred from the float (SP5).
export interface TickStep {
  value: number
  pi: { num: number; den: number } | null
}

// The camera an author asks for, in degrees. Azimuth is the camera's
// horizontal direction measured from +x toward +y; elevation is above the
// xy-plane.
export interface CameraSpec {
  azimuth: number
  elevation: number
  zoom: number
}

// The saved view (the document model's page `view`, step 7): the authored
// camera fields plus where it orbits about.
export interface SpaceView extends CameraSpec {
  target: readonly [number, number, number]
}

export interface SpaceConfig {
  bounds: { x: Range | null; y: Range | null; z: Range | null }
  aspect: Aspect | null
  projection: Projection
  camera: CameraSpec
  frame: FrameStyle
  ticks: { x: TickStep | null; y: TickStep | null; z: TickStep | null }
  titles: { x: string; y: string; z: string }
  colormap: ColormapName
  // The spec-wide sampling resolution, or null for the per-form defaults.
  resolution: number | null
  depthcue: boolean
}

// One `@param` line (the document model's bindings). `value` is the authored
// starting value; the live value belongs to the viewer.
export interface Binding {
  name: string
  value: number
  min: number
  max: number
  // null: continuous (the slider picks a step from the range).
  step: number | null
  integer: boolean
  // 1-based source line, for errors.
  line: number
  // The names called, as f(...), in its value, range and step; set only when
  // there are any. Those expressions compile with no scope, so a call of a name
  // the document also makes a @param would reach the built-in: the kernel
  // refuses it (kernel/scope.ts).
  calls?: readonly string[]
}

export const DEFAULT_CAMERA: CameraSpec = { azimuth: 40, elevation: 25, zoom: 1 }

export function defaultSpaceConfig(): SpaceConfig {
  return {
    bounds: { x: null, y: null, z: null },
    aspect: null,
    projection: 'orthographic',
    camera: { ...DEFAULT_CAMERA },
    frame: 'box',
    ticks: { x: null, y: null, z: null },
    titles: { x: 'x', y: 'y', z: 'z' },
    colormap: 'viridis',
    resolution: null,
    depthcue: true,
  }
}
