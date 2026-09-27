// Shaped points (plan G9 "Points"): instanced screen-aligned quads of `size`
// CSS px, the shape drawn by a signed distance in the fragment shader and
// antialiased. It is depth-tested as a small sphere would be: at its
// centre moved toward the eye by its own radius, so a point lying on a
// surface is not half-buried in it where the surface tilts toward the viewer.
// Shapes: 0 dot, 1 ring, 2 cross (+), 3 diamond, 4 square. A point is
// clipped and depth-cued by its centre (look.ts).
//
// S6 plan V5, findable affordances: every point draws a 1 px background-
// coloured outline just past its shape, so it reads against any surface
// behind it. A "halo" point (u_halo: a draggable point, or the probe's/a
// pin's marker) draws a wider 2 px background band there instead, and a
// thin 1 px ink ring past that. These bands are opaque but carry no depth
// (drawn in the antialiased fringe pass, u_pass == 1): the core shape alone
// writes depth, exactly as before.

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
uniform bool u_halo;                    // V5: room for the wider halo bands
uniform float u_depthBias;
uniform vec3 u_eyeDir;                  // world, toward the eye (orthographic)
uniform vec3 u_eye;                     // world eye position (perspective)
uniform bool u_perspective;
uniform float u_worldPerPixel;          // world units per CSS px at the target
out vec2 v_local;                       // backing px from the centre
flat out vec3 v_rel;
flat out float v_depth;
${LOOK_VERTEX_GLSL}
void main() {
  v_rel = a_centre;
  v_depth = viewDepth(a_centre * u_scale);
  vec4 c = u_viewProj * vec4(a_centre * u_scale, 1.0);
  // Padding for the outline (always) and, past it, the halo band and ring
  // (u_halo): must reach at least as far as the fragment shader's bands.
  float pad = (u_halo ? 4.5 : 1.5) * u_pixelRatio + 1.0;
  float r = 0.5 * u_size * u_pixelRatio + pad;
  v_local = a_corner * r;
  if (c.w <= 0.0 || c.z < -c.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 ndc = c.xy / c.w;
  vec3 world = a_centre * u_scale;
  vec3 toEye = u_perspective ? normalize(u_eye - world) : u_eyeDir;
  vec4 lifted = u_viewProj * vec4(world + toEye * (0.5 * u_size * u_worldPerPixel), 1.0);
  float z = lifted.w > 0.0 ? lifted.z / lifted.w : c.z / c.w;
  gl_Position = vec4(ndc + a_corner * r / u_viewport * 2.0, z - u_depthBias, 1.0);
}
`

export const POINT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
flat in vec3 v_rel;
flat in float v_depth;
uniform vec3 u_color;
uniform vec3 u_ink;
uniform float u_pixelRatio;
uniform float u_size;
uniform int u_shape;
uniform bool u_halo;
uniform int u_pass;        // 0: opaque core, writes depth; 1: antialiased fringe, blended
${LOOK_FRAGMENT_GLSL}
out vec4 fragColor;

// V5's bands past the shape's edge, in device px: always a 1 px background
// outline; u_halo widens it to 2 px and adds a 1 px ink ring beyond that.
// Kept in sync with the vertex shader's padding by eye.
const float OUTLINE_PX = 1.0;
const float HALO_PX = 2.0;
const float RING_PX = 1.0;

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
  if (u_pass == 0) {
    if (!core) discard;
    fragColor = vec4(depthCue(u_color, v_depth), 1.0);
    return;
  }
  // Pass 1: the shape's own antialiased fringe, then — past it — the
  // outline, halo and ring bands (V5), each opaque but depth-less.
  if (core) discard;
  if (alpha > 0.0) {
    fragColor = vec4(depthCue(u_color, v_depth), alpha);
    return;
  }
  float beyond = d - 0.5; // device px past the fringe's outer edge (d = 0.5 there)
  float outlineEnd = OUTLINE_PX * u_pixelRatio;
  if (beyond < outlineEnd) {
    fragColor = vec4(depthCue(u_background, v_depth), 1.0);
    return;
  }
  if (u_halo) {
    float haloEnd = outlineEnd + HALO_PX * u_pixelRatio;
    if (beyond < haloEnd) {
      fragColor = vec4(depthCue(u_background, v_depth), 1.0);
      return;
    }
    if (beyond < haloEnd + RING_PX * u_pixelRatio) {
      fragColor = vec4(depthCue(u_ink, v_depth), 1.0);
      return;
    }
  }
  discard;
}
`
