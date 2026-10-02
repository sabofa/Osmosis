// What every mark shader shares (plan E3): clipping at the axis box and depth
// cueing.
//
// - Box clipping: a mark fragment whose author-space position lies outside
//   the resolved box by more than 1e-6 of the box span (per axis) is
//   discarded. The box reaches the shader in the same centre-relative author
//   coordinates as the positions (box - centre), so a surface at x ~ 4500
//   clips as precisely as one at the origin. The frame is never clipped.
// - Depth cue: mix(colour, background, cue * smoothstep(0, 1, depthT)), where
//   depthT is the fragment's view depth normalised across the box's bounding
//   sphere (nearest point 0, farthest 1). cue is 0.35, or 0 under
//   `@depthcue: off`. The frame is not cued: its back walls would lose the
//   contrast that makes them readable.
//
// View depth is measured along the camera's forward direction from the eye,
// as a plane: depth(p) = dot(forward, p) - dot(forward, eye), p in world.

import type { CameraMatrices } from '../camera/projection'
import { glslFloat } from '../colormaps'
import type { WorldMap } from '../camera/world'
import type { Vec3 } from '../scene/types'
import type { Rgb, SpaceColors } from '../theme'
import type { ProgramInfo } from './program'

export const DEPTH_CUE = 0.35
// The clip tolerance, as a fraction of the box span on each axis.
export const CLIP_TOLERANCE = 1e-6

export interface ClipBox {
  // Centre-relative author units.
  min: Vec3
  max: Vec3
}

export interface MarkLook {
  clip: ClipBox | null
  cue: number
  // View depths of the box's bounding sphere, nearest and farthest.
  cueRange: readonly [number, number]
  // (forward, -dot(forward, eye)): depth(p) = dot(xyz, p) + w.
  depthPlane: readonly [number, number, number, number]
  background: Rgb
}

// The resolved box relative to its centre.
export function clipBox(world: WorldMap): ClipBox {
  const { box, centre } = world
  return {
    min: [box.x.min - centre[0], box.y.min - centre[1], box.z.min - centre[2]],
    max: [box.x.max - centre[0], box.y.max - centre[1], box.z.max - centre[2]],
  }
}

export function markLook(camera: CameraMatrices, world: WorldMap, colors: SpaceColors, depthcue: boolean): MarkLook {
  const f = camera.basis.forward
  const e = camera.eye
  const w = -(f[0] * e[0] + f[1] * e[1] + f[2] * e[2])
  // World is centred on the box, so the sphere's centre is the origin, at depth w.
  const h = world.halfExtents
  const radius = Math.hypot(h[0], h[1], h[2])
  return {
    clip: clipBox(world),
    cue: depthcue ? DEPTH_CUE : 0,
    cueRange: [w - radius, w + radius],
    depthPlane: [f[0], f[1], f[2], w],
    background: colors.background,
  }
}

// The frame's look: never clipped, never cued.
export function frameLook(look: MarkLook): MarkLook {
  return { ...look, clip: null, cue: 0 }
}

// Vertex side: viewDepth(worldPosition).
export const LOOK_VERTEX_GLSL = /* glsl */ `
uniform vec4 u_depthPlane;
float viewDepth(vec3 world) {
  return dot(u_depthPlane.xyz, world) + u_depthPlane.w;
}
`

// Fragment side: outsideBox(centreRelative) and depthCue(colour, depth).
export const LOOK_FRAGMENT_GLSL = /* glsl */ `
uniform bool u_clip;
uniform vec3 u_clipMin;
uniform vec3 u_clipMax;
uniform float u_cue;
uniform vec2 u_cueRange;
uniform vec3 u_background;
bool outsideBox(vec3 rel) {
  if (!u_clip) return false;
  vec3 tol = (u_clipMax - u_clipMin) * ${glslFloat(CLIP_TOLERANCE)};
  return any(lessThan(rel, u_clipMin - tol)) || any(greaterThan(rel, u_clipMax + tol));
}
vec3 depthCue(vec3 color, float depth) {
  float t = clamp((depth - u_cueRange.x) / max(u_cueRange.y - u_cueRange.x, 1e-6), 0.0, 1.0);
  return mix(color, u_background, u_cue * smoothstep(0.0, 1.0, t));
}
`

export function applyLook(gl: WebGL2RenderingContext, program: ProgramInfo, look: MarkLook): void {
  const clip = look.clip
  gl.uniform1i(program.uniform('u_clip'), clip ? 1 : 0)
  if (clip) {
    gl.uniform3f(program.uniform('u_clipMin'), clip.min[0], clip.min[1], clip.min[2])
    gl.uniform3f(program.uniform('u_clipMax'), clip.max[0], clip.max[1], clip.max[2])
  }
  gl.uniform1f(program.uniform('u_cue'), look.cue)
  gl.uniform2f(program.uniform('u_cueRange'), look.cueRange[0], look.cueRange[1])
  gl.uniform4f(program.uniform('u_depthPlane'), look.depthPlane[0], look.depthPlane[1], look.depthPlane[2], look.depthPlane[3])
  gl.uniform3f(program.uniform('u_background'), look.background[0], look.background[1], look.background[2])
}
