// Arrowheads (plan G9 "Arrows"). The shaft is a line drawn by the line
// pipeline; this draws the head at the tip, per instance, shaped by
// arrowHead() from gl/arrowHead.ts (the same rule as arrowHeadKind):
// - a ring of headSize px when the vector is within 12 degrees of the view
//   direction (the textbook "vector out of the page"; the shaft, untrimmed,
//   is the dot inside it);
// - otherwise a screen-space isosceles triangle along the projected
//   direction, at most 45% of the projected length;
// - or a 4 px dot when that triangle would be under 4 px.

import { ARROW_HEAD_GLSL } from '../arrowHead'

export const ARROW_VERTEX = /* glsl */ `#version 300 es
// space: arrowhead
layout(location = 0) in vec2 a_corner;  // -1..1 on both axes
layout(location = 1) in vec3 a_tail;    // relative to the box centre, author units
layout(location = 2) in vec3 a_tip;
uniform mat4 u_viewProj;
uniform vec3 u_scale;
uniform vec2 u_viewport;
uniform float u_pixelRatio;
uniform float u_headSize;               // CSS px
uniform float u_depthBias;
uniform vec3 u_eyeDir;                  // world, toward the eye (orthographic)
uniform vec3 u_eye;                     // world eye position (perspective)
uniform bool u_perspective;
out vec2 v_local;                       // backing px in the head's frame: x along, y across, tip at 0
flat out int v_kind;                    // 0 triangle, 1 ring, 2 dot
out float v_size;                       // backing px: triangle length, ring or dot diameter
${ARROW_HEAD_GLSL}
void main() {
  vec4 a = u_viewProj * vec4(a_tail * u_scale, 1.0);
  vec4 b = u_viewProj * vec4(a_tip * u_scale, 1.0);
  float h = u_headSize * u_pixelRatio;
  float r = h + 1.0;
  v_local = a_corner * r;
  v_kind = 2;
  v_size = 0.0;
  if (b.w <= 0.0 || b.z < -b.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 sb = (b.xy / b.w * 0.5 + 0.5) * u_viewport;
  vec2 dir = vec2(0.0);
  if (a.w > 0.0) {
    vec2 sa = (a.xy / a.w * 0.5 + 0.5) * u_viewport;
    dir = sb - sa;
  }
  float len = length(dir);
  vec3 tipWorld = a_tip * u_scale;
  vec3 toEye = u_perspective ? normalize(u_eye - tipWorld) : u_eyeDir;
  float size;
  v_kind = arrowHead((a_tip - a_tail) * u_scale, toEye, len / u_pixelRatio, u_headSize, size);
  v_size = size * u_pixelRatio;
  vec2 t = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  vec2 pos = sb + t * v_local.x + n * v_local.y;
  gl_Position = vec4(pos / u_viewport * 2.0 - 1.0, b.z / b.w - u_depthBias, 1.0);
}
`

export const ARROW_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
flat in int v_kind;
in float v_size;
uniform vec3 u_color;
uniform float u_opacity;
uniform float u_pixelRatio;
uniform float u_headSize;
uniform float u_shaftWidth;
uniform int u_pass;        // 0: opaque core, writes depth; 1: antialiased fringe, blended
out vec4 fragColor;
void main() {
  float h = u_headSize * u_pixelRatio;
  vec2 p = v_local;
  float d;
  if (v_kind == 1) {
    float R = 0.5 * h;
    float t = max(1.5 * u_pixelRatio, u_shaftWidth * u_pixelRatio);
    d = abs(length(p) - (R - 0.5 * t)) - 0.5 * t;
  } else if (v_kind == 2) {
    d = length(p) - 0.5 * v_size;
  } else {
    // Apex at the tip (0, 0), base at x = -L, half-base 0.4 L.
    float L = v_size;
    float B = 0.4 * L;
    float side = (p.x * B + abs(p.y) * L) / sqrt(B * B + L * L);
    float base = -p.x - L;
    d = max(side, base);
  }
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  bool core = alpha >= 0.999;
  if (u_pass == 0 ? !core : (core || alpha <= 0.0)) discard;
  fragColor = vec4(u_color, (u_pass == 0 ? 1.0 : alpha) * u_opacity);
}
`
