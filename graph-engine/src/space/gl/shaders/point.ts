// Shaped points (plan G9 "Points"): instanced screen-aligned quads of `size`
// CSS px, the shape drawn by a signed distance in the fragment shader and
// antialiased, depth-tested at the point's own depth (less the line bias).
// Shapes: 0 dot, 1 ring, 2 cross (+), 3 diamond, 4 square. A point is
// clipped and depth-cued by its centre (look.ts).

import { LOOK_FRAGMENT_GLSL, LOOK_VERTEX_GLSL } from '../look'

export const POINT_VERTEX = /* glsl */ `#version 300 es
// space: point
layout(location = 0) in vec2 a_corner;  // -1..1 on both axes
layout(location = 1) in vec3 a_centre;  // relative to the box centre, author units
uniform mat4 u_viewProj;
uniform vec3 u_scale;
uniform vec2 u_viewport;
uniform float u_pixelRatio;
uniform float u_size;                   // CSS px diameter
uniform float u_depthBias;
out vec2 v_local;                       // backing px from the centre
flat out vec3 v_rel;
flat out float v_depth;
${LOOK_VERTEX_GLSL}
void main() {
  v_rel = a_centre;
  v_depth = viewDepth(a_centre * u_scale);
  vec4 c = u_viewProj * vec4(a_centre * u_scale, 1.0);
  float r = 0.5 * u_size * u_pixelRatio + 1.0;
  v_local = a_corner * r;
  if (c.w <= 0.0 || c.z < -c.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 ndc = c.xy / c.w;
  gl_Position = vec4(ndc + a_corner * r / u_viewport * 2.0, c.z / c.w - u_depthBias, 1.0);
}
`

export const POINT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
flat in vec3 v_rel;
flat in float v_depth;
uniform vec3 u_color;
uniform float u_pixelRatio;
uniform float u_size;
uniform int u_shape;
uniform int u_pass;        // 0: opaque core, writes depth; 1: antialiased fringe, blended
${LOOK_FRAGMENT_GLSL}
out vec4 fragColor;

float box(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

void main() {
  if (outsideBox(v_rel)) discard;
  float R = 0.5 * u_size * u_pixelRatio;
  vec2 p = v_local;
  float d;
  if (u_shape == 1) {
    float t = max(1.5 * u_pixelRatio, 0.3 * R);
    d = abs(length(p) - (R - 0.5 * t)) - 0.5 * t;
  } else if (u_shape == 2) {
    float w = max(0.75 * u_pixelRatio, 0.18 * R);
    d = min(box(p, vec2(R, w)), box(p, vec2(w, R)));
  } else if (u_shape == 3) {
    d = (abs(p.x) + abs(p.y) - R) * 0.70710678;
  } else if (u_shape == 4) {
    d = box(p, vec2(0.82 * R));
  } else {
    d = length(p) - R;
  }
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  bool core = alpha >= 0.999;
  if (u_pass == 0 ? !core : (core || alpha <= 0.0)) discard;
  fragColor = vec4(depthCue(u_color, v_depth), u_pass == 0 ? 1.0 : alpha);
}
`
