// Order-independent transparency's composite (plan E4 step 6; McGuire and
// Bavoil 2013, weighted blended OIT), drawn as one full-screen triangle into
// the default framebuffer: the resolved opaque colour, with the average
// translucent colour laid over it by 1 - revealage.
//
// The accumulation itself is the mesh or box shader with u_oit set
// (shaders/mesh.ts, shaders/box.ts): it writes (premultiplied colour x w,
// alpha) to target 0 and alpha x w to target 1, with w = oitWeight(alpha, z)
// below and z the view depth. Both take the weight from here, so a box and a
// surface accumulate on one scale. targets.ts explains the single-blend-state
// layout.

import { glslFloat } from '../../colormaps'

export const COMPOSITE_VERTEX = /* glsl */ `#version 300 es
// space: composite
void main() {
  // A triangle covering the viewport: (-1, -1), (3, -1), (-1, 3).
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_opaque;   // resolved RGBA8
uniform sampler2D u_accum;    // RGBA16F: sum of C * w, and the revealage product in alpha
uniform sampler2D u_weight;   // R16F: sum of alpha * w
out vec4 fragColor;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec3 opaque = texelFetch(u_opaque, at, 0).rgb;
  vec4 accum = texelFetch(u_accum, at, 0);
  float weight = texelFetch(u_weight, at, 0).r;
  float coverage = 1.0 - accum.a;
  vec3 average = accum.rgb / clamp(weight, 1e-5, 5e4);
  fragColor = vec4(mix(opaque, average, coverage), 1.0);
}
`

// S6 fix round 1, I2: z is the fragment's view depth, positive in front of
// the eye — an absolute distance, not one relative to the box. depthSpan
// (S6 plan V4, S3 parked item M10) is the box's own view-space depth range
// (u_cueRange.y - u_cueRange.x, look.ts), but z / depthSpan alone still
// compares an absolute eye distance to a span local to the box: at this
// renderer's actual scale (box half-extents at most 1, so depthSpan is a
// handful of units, while z — the distance from the eye to the box, which
// the turntable camera keeps a few box radii back — is always at least
// 1.5 x depthSpan) that ratio never approaches 0, so every fragment clamped
// to the same floor weight and depth order was lost regardless of the
// divisor (the original bug: a fixed literal 200 in its place).
//
// The fix normalises z the same way depthCue() does (look.ts): relative to
// the box's own near edge, zRel = clamp((z - u_cueRange.x) / depthSpan, 0,
// 1), 0 at the nearest point of the box's bounding sphere and 1 at the
// farthest. oitWeight itself takes zRel directly (the caller subtracts
// u_cueRange.x first), so its curve — OIT_PEAK at zRel = 0, falling to
// OIT_FLOOR by zRel = 1 — is shared byte-for-byte with oitWeight, its exact
// TypeScript mirror (oit.test.ts asserts the GLSL source contains the same
// expression, so the two cannot drift).
export const OIT_FLOOR = 1e-2
export const OIT_PEAK = 3e3
export const OIT_FALLOFF = 3

// The exact mirror of oitWeight() below, for tests: GLSL cannot run here.
export function oitWeight(a: number, zRel: number): number {
  const z = Math.min(1, Math.max(0, zRel))
  return a * Math.max(OIT_FLOOR, OIT_PEAK * (1 - z) ** OIT_FALLOFF)
}

// glslFloat, not string interpolation, so an exponent like 3 renders as the
// float literal "3.0" GLSL's pow() requires, never the int literal "3".
export const OIT_WEIGHT_EXPRESSION = `max(${glslFloat(OIT_FLOOR)}, ${glslFloat(OIT_PEAK)} * pow(1.0 - zRel, ${glslFloat(OIT_FALLOFF)}))`

export const OIT_WEIGHT_GLSL = /* glsl */ `
float oitWeight(float a, float zRel) {
  return a * ${OIT_WEIGHT_EXPRESSION};
}
`
