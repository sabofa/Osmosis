// The baked underpainting pass (the baked painting, Task 5; spec 2026-10-02-painted-figures-design.md §14). The bake colours
// every vertex of each refined surface (bake/types.ts BakedSurface: the underpainting as seen from side +1 and side -1, and
// an alpha for each), once, in world space. Each frame, in place of the per-pixel image the model hands over, this pass draws
// those surfaces from the current view into an image of the same kind: the G-buffer's size, row 0 the top, sRGB colour and a
// coverage, which the composite then reads exactly as it reads the uploaded one (shaders/underpaint.ts: opacity, weave,
// streaks and the silhouette cut are untouched).
//
//   surfaces   one draw per surface, depth tested: against the scene's own depth (the opaque meshes, drawn for this view at
//              this size with the same matrix) so a part another surface hides does not show, and against the surfaces
//              already drawn so the nearer of two that are both on the surface wins;
//   two-sided  the side the viewer sees is chosen per fragment by the sign of n . toEye on the interpolated normal, with toEye
//              per fragment for a perspective view; a closed surface is only ever seen from side +1 (facesBack in
//              gl/bakedSurfaces.ts is the twin);
//   colour     the per-vertex colour and alpha are interpolated premultiplied (colour x alpha, alpha), so where a covered
//              vertex meets an uncovered one the colour stays the covered one's and only the coverage fades; the fragment
//              divides the coverage out again and sRGB-encodes it (the model's image is sRGB bytes);
//   dilate     a texel that is not covered next to one that is takes its colour (coverage 0), as the model's image does
//              (gl/underpaint.ts underpaintTexels): the composite filters the image bilinearly, and a bare black texel
//              there would darken the rim of every form.
//
// Determinism: nothing here reads a clock or a random source.

import { UNDERPAINT_BLEED } from '../underpaint'
import { COMMON_GLSL } from './common'

// The least coverage a fragment writes: below half a byte it would be stored as 0 anyway.
export const BAKED_COVERAGE_MIN = 0.5 / 255

// Which side of a surface the viewer sees: the back when the surface is open and its normal points away from the eye. The
// twin of facesBack (gl/bakedSurfaces.ts), which the tests run.
export const FACES_BACK_GLSL = /* glsl */ `
bool facesBack(vec3 n, vec3 toEye, bool closed) {
  return !closed && dot(n, toEye) < 0.0;
}
`

export const BAKED_VERTEX = /* glsl */ `#version 300 es
// paint: baked surfaces
precision highp float;
layout(location = 0) in vec3 a_position;   // relative to the origin of the baked surfaces
layout(location = 1) in vec3 a_normal;     // unit, the surface's own (side +1)
layout(location = 2) in vec3 a_underFront; // linear-light sRGB, side +1
layout(location = 3) in vec3 a_underBack;  // side -1
layout(location = 4) in vec2 a_alpha;      // coverage of side +1, side -1
uniform mat4 u_viewProj;                   // origin folded in, scaled to the G-buffer grid, row 0 the top
uniform vec3 u_viewDir;
uniform float u_depthBase;                 // dot(origin - eye, viewDir)
out vec3 v_pos;
out vec3 v_normal;
out float v_depth;
out vec4 v_front;                          // colour x alpha, alpha
out vec4 v_back;
void main() {
  v_pos = a_position;
  v_normal = a_normal;
  v_depth = dot(a_position, u_viewDir) + u_depthBase;
  v_front = vec4(a_underFront * a_alpha.x, a_alpha.x);
  v_back = vec4(a_underBack * a_alpha.y, a_alpha.y);
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}
`

export const BAKED_FRAGMENT = /* glsl */ `#version 300 es
// paint: baked surfaces
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 v_pos;
in vec3 v_normal;
in float v_depth;
in vec4 v_front;
in vec4 v_back;
uniform vec3 u_relEye;         // eye - origin
uniform vec3 u_viewDir;
uniform bool u_perspective;
uniform bool u_closed;         // this surface is closed: side +1 only
uniform bool u_sceneTest;      // test against the scene's depth (off when the context cannot draw it)
uniform sampler2D u_sceneDepth; // the opaque meshes' view depth for this view, G-buffer size, RG32F, 1e30 where there is none
uniform float u_depthBias;     // how far behind the scene's surface a fragment may lie and still be on it, view depth
${COMMON_GLSL}
${FACES_BACK_GLSL}
layout(location = 0) out vec4 o_colour;

void main() {
  // Behind the nearest opaque surface here: hidden. (A surface the bake refined is the scene's mesh cut finer, so the
  // depths agree to rounding, and the bias is the stroke pass's.)
  if (u_sceneTest && v_depth - texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r > u_depthBias) discard;
  vec3 toEye = u_perspective ? normalize(u_relEye - v_pos) : -u_viewDir;
  vec4 c = facesBack(v_normal, toEye, u_closed) ? v_back : v_front;
  if (c.a < ${BAKED_COVERAGE_MIN.toFixed(6)}) discard;
  o_colour = vec4(srgbEncode(c.rgb / c.a), min(c.a, 1.0));
}
`

// The raw image to the underpainting texture, with the rim dilated: a texel with no coverage takes the colour of the nearest
// covered one within UNDERPAINT_BLEED texels (the nearest by distance, the first in reading order on a tie), coverage 0.
export const BAKED_DILATE_FRAGMENT = /* glsl */ `#version 300 es
// paint: baked dilate
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_raw;       // the surfaces' image: sRGB colour, coverage; row 0 the top
layout(location = 0) out vec4 o_colour;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(u_raw, 0) - 1;
  vec4 c = texelFetch(u_raw, p, 0);
  if (c.a > 0.0) {
    o_colour = c;
    return;
  }
  float best = 1.0e9;
  vec3 taken = vec3(0.0);
  for (int dy = -${UNDERPAINT_BLEED}; dy <= ${UNDERPAINT_BLEED}; dy++) {
    for (int dx = -${UNDERPAINT_BLEED}; dx <= ${UNDERPAINT_BLEED}; dx++) {
      float d = float(dx * dx + dy * dy);
      if (d == 0.0 || d >= best) continue;
      vec4 n = texelFetch(u_raw, clamp(p + ivec2(dx, dy), ivec2(0), last), 0);
      if (n.a > 0.0) {
        best = d;
        taken = n.rgb;
      }
    }
  }
  o_colour = vec4(taken, 0.0);
}
`
