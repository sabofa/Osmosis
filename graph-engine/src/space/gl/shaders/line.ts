// Pixel-width lines (plan G9 "Lines", spec SP4): one instanced quad per
// segment, expanded in screen space in the vertex shader to `width` CSS px
// times devicePixelRatio. WebGL's 1-pixel LINES are never used.
//
// - The quad extends half a width (plus a pixel of antialiasing) past each
//   end, and the fragment shader keeps only the capsule, so caps are round
//   and consecutive segments join round.
// - Depth is the segment's own, minus a small bias (1e-5 in NDC z), so a
//   line lying on a surface wins.
// - Two passes: the opaque core of every line writes depth, then the
//   antialiased fringe blends without writing it. A fringe that wrote depth
//   would hide the next segment's core wherever the line recedes from the
//   viewer, leaving it dotted.
// - Dashes run on a cumulative screen length per vertex (u_dashMode 1), or
//   restart per segment for very large marks (u_dashMode 2).
// - An arrow shaft (u_headSize > 0) is trimmed short of its tip in screen
//   space so it ends inside a triangular head (arrowHead() from
//   gl/arrowHead.ts, the same rule the head uses); a ring or dot head leaves
//   it whole.
// - Clipping at the axis box and the depth cue (look.ts) read the author
//   position and view depth interpolated along the segment; the frame draws
//   with both off.

import { ARROW_HEAD_GLSL } from '../arrowHead'
import { LOOK_FRAGMENT_GLSL, LOOK_VERTEX_GLSL } from '../look'

export const LINE_VERTEX = /* glsl */ `#version 300 es
// space: line
layout(location = 0) in vec2 a_corner;  // (end: 0 at p0, 1 at p1; side: -1 or +1)
layout(location = 1) in vec3 a_p0;      // relative to the box centre, author units
layout(location = 2) in vec3 a_p1;
layout(location = 3) in vec2 a_len;     // cumulative CSS px at p0 and p1 (dash mode 1)
uniform mat4 u_viewProj;
uniform vec3 u_scale;
uniform vec2 u_viewport;                // backing-store px
uniform float u_pixelRatio;
uniform float u_width;                  // CSS px
uniform float u_depthBias;              // NDC z
uniform float u_headSize;               // CSS px; > 0 for arrow shafts
uniform int u_dashMode;                 // 0 solid, 1 cumulative, 2 per segment
uniform vec3 u_eyeDir;                  // world, toward the eye (orthographic)
uniform vec3 u_eye;                     // world eye position (perspective)
uniform bool u_perspective;
out vec2 v_local;                       // backing px: x from p0 along the segment, y across
out float v_length;                     // backing px
out float v_halfWidth;                  // backing px
out float v_along;                      // CSS px along the line, for dashes
out vec3 v_rel;                         // author position, relative to the box centre
out float v_depth;                      // view depth
${ARROW_HEAD_GLSL}
${LOOK_VERTEX_GLSL}
void main() {
  vec4 c0 = u_viewProj * vec4(a_p0 * u_scale, 1.0);
  vec4 c1 = u_viewProj * vec4(a_p1 * u_scale, 1.0);
  v_local = vec2(0.0);
  v_length = 0.0;
  v_halfWidth = 0.0;
  v_along = 0.0;
  v_rel = a_p0;
  v_depth = viewDepth(a_p0 * u_scale);
  // Keep only the part in front of the near plane (z >= -w).
  float d0 = c0.z + c0.w;
  float d1 = c1.z + c1.w;
  if (d0 < 0.0 && d1 < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (d0 < 0.0) c0 = mix(c0, c1, d0 / (d0 - d1));
  if (d1 < 0.0) c1 = mix(c1, c0, d1 / (d1 - d0));

  vec2 s0 = (c0.xy / c0.w * 0.5 + 0.5) * u_viewport;
  vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * u_viewport;
  float z0 = c0.z / c0.w;
  float z1 = c1.z / c1.w;
  vec2 dir = s1 - s0;
  float full = length(dir);
  vec2 t = full > 1e-4 ? dir / full : vec2(1.0, 0.0);
  float len = full;
  if (u_headSize > 0.0) {
    vec3 tipWorld = a_p1 * u_scale;
    vec3 toEye = u_perspective ? normalize(u_eye - tipWorld) : u_eyeDir;
    float headLen;
    if (arrowHead((a_p1 - a_p0) * u_scale, toEye, full / u_pixelRatio, u_headSize, headLen) == 0) {
      float trim = 0.6 * headLen * u_pixelRatio;
      s1 -= t * trim;
      len = full - trim;
      z1 = mix(z0, z1, len / full);
    }
  }
  vec2 n = vec2(-t.y, t.x);
  float hw = 0.5 * u_width * u_pixelRatio;
  float r = hw + 1.0;
  float end = a_corner.x;
  vec2 pos = mix(s0, s1, end) + t * (end * 2.0 - 1.0) * r + n * a_corner.y * r;
  float z = mix(z0, z1, end) - u_depthBias;
  gl_Position = vec4(pos / u_viewport * 2.0 - 1.0, z, 1.0);

  v_local = vec2(end * len + (end * 2.0 - 1.0) * r, a_corner.y * r);
  v_length = len;
  v_halfWidth = hw;
  // Where this corner lies along p0 -> p1 (beyond either end for a cap).
  float along = full > 1e-4 ? v_local.x / full : 0.0;
  v_rel = mix(a_p0, a_p1, along);
  v_depth = mix(viewDepth(a_p0 * u_scale), viewDepth(a_p1 * u_scale), along);
  float fraction = v_local.x / max(len, 1e-4);
  if (u_dashMode == 1) {
    v_along = a_len.x + fraction * (a_len.y - a_len.x);
  } else {
    v_along = v_local.x / u_pixelRatio;
  }
}
`

export const LINE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
in float v_length;
in float v_halfWidth;
in float v_along;
in vec3 v_rel;
in float v_depth;
uniform vec3 u_color;
uniform float u_opacity;
uniform int u_dashMode;
uniform vec4 u_dash;       // on, off, on, off (CSS px)
uniform float u_dashTotal;
uniform int u_pass;        // 0: opaque core, writes depth; 1: antialiased fringe, blended
${LOOK_FRAGMENT_GLSL}
out vec4 fragColor;

void main() {
  if (outsideBox(v_rel)) discard;
  float x = clamp(v_local.x, 0.0, v_length);
  float dist = length(vec2(v_local.x - x, v_local.y));
  float alpha = clamp(v_halfWidth + 0.5 - dist, 0.0, 1.0);
  if (u_dashMode != 0 && u_dashTotal > 0.0) {
    float m = mod(v_along, u_dashTotal);
    bool on = m < u_dash.x || (m >= u_dash.x + u_dash.y && m < u_dash.x + u_dash.y + u_dash.z);
    if (!on) discard;
  }
  bool core = alpha >= 0.999;
  if (u_pass == 0 ? !core : (core || alpha <= 0.0)) discard;
  fragColor = vec4(depthCue(u_color, v_depth), (u_pass == 0 ? 1.0 : alpha) * u_opacity);
}
`
