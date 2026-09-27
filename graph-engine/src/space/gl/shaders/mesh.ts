// The lit, two-sided mesh shader (plan G9, E3; spec SP4 "Surfaces"). GLSL ES 3.00.
//
// Blinn-Phong in view space (x right, y up, z toward the viewer):
// - a key light from the upper left front;
// - a fill light at about 30% of the key, from the opposite side (right, a
//   little below);
// - ambient 0.25, specular 0.15 with shininess 24.
// A zero normal (the scene contract's "undefined") falls back to the face
// normal, turned to the viewer. No gamma: colours are sRGB values drawn as-is
// (theme.ts).
//
// In order, per fragment (E3):
// 1. Discarded outside the axis box (look.ts).
// 2. The base colour: the flat colour, or with a colour scale the 256 x 1
//    colormap texture at the normalised scalar (normaliseScalar, generated
//    from the same formula as the CPU's normalise), or the no-data colour for
//    a non-finite scalar.
// 3. Lit, both sides: a back face flips its normal (gl_FrontFacing).
// 4. A back face is then mixed 30% toward a cool tint and darkened x0.85, so
//    a surface's orientation shows — half as much under OIT (V4), and its
//    accumulate weight is halved too, so a translucent closed surface (a
//    sphere) reads as its own colour, not the front/back average's grey.
// 5. Mesh lines, from the (u, v) attribute, at the integers of uv / step (the
//    upload shifts uv so the lines u0 + k du land there): 1 CSS px wide,
//    antialiased by fwidth, the colour mixed toward the theme's ink in light
//    and its background in dark (V6: "present, not loud" — a bright ink
//    line would read loud against a dark-theme surface), at a strength the
//    CPU side picks per theme. A family of lines fades out as its on-screen
//    spacing falls from 5 CSS px to 2.5, so a zoomed-out surface is not all
//    lines.
// 6. Depth cue (look.ts).
// 7. Output: the colour at the mesh's opacity; or, accumulating for
//    order-independent transparency (u_oit), the weighted pair shaders/oit.ts
//    composites.

import { NORMALISE_GLSL_FUNCTION } from '../../colormaps'
import { LOOK_FRAGMENT_GLSL, LOOK_VERTEX_GLSL } from '../look'
import { OIT_WEIGHT_GLSL } from './oit'

export const MESH_VERTEX = /* glsl */ `#version 300 es
// space: mesh
layout(location = 0) in vec3 a_position; // relative to the box centre, author units
layout(location = 1) in vec3 a_normal;   // world
layout(location = 2) in float a_scalar;  // the colormap's value, when the mesh has a scale
layout(location = 3) in vec2 a_uv;       // (u, v) shifted by a multiple of the mesh-line step
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec3 u_scale;                    // k: author units -> world
${LOOK_VERTEX_GLSL}
out vec3 v_normal;
out vec3 v_viewPos;
out vec3 v_rel;
out float v_scalar;
out vec2 v_uv;
out float v_depth;
void main() {
  vec3 world = a_position * u_scale;
  vec4 viewPos = u_view * vec4(world, 1.0);
  v_viewPos = viewPos.xyz;
  v_normal = mat3(u_view) * a_normal;
  v_rel = a_position;
  v_scalar = a_scalar;
  v_uv = a_uv;
  v_depth = viewDepth(world);
  gl_Position = u_proj * viewPos;
}
`

export const MESH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec3 v_normal;
in vec3 v_viewPos;
in vec3 v_rel;
in float v_scalar;
in vec2 v_uv;
in float v_depth;
uniform vec3 u_color;
uniform float u_opacity;
uniform bool u_perspective;
uniform bool u_colormap;
uniform sampler2D u_lut;
uniform vec2 u_domain;
uniform bool u_diverging;
uniform vec3 u_noData;
uniform vec3 u_backTint;
uniform bool u_meshLines;
uniform vec2 u_meshStep;
uniform vec3 u_meshLineColor;   // V6: the theme's ink in light, its background in dark
uniform float u_meshLineStrength;
uniform float u_pixelRatio;
uniform bool u_oit;
${LOOK_FRAGMENT_GLSL}
${NORMALISE_GLSL_FUNCTION}
${OIT_WEIGHT_GLSL}
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragWeight;

const vec3 KEY = vec3(-0.5014, 0.6017, 0.6217);   // normalise(-0.5, 0.6, 0.62)
const vec3 FILL = vec3(0.6046, -0.2519, 0.7557);  // normalise(0.6, -0.25, 0.75)
const float AMBIENT = 0.25;
const float DIFFUSE = 0.75;
const float FILL_SHARE = 0.3;
const float SPECULAR = 0.15;
const float SHININESS = 24.0;
const float BACK_TINT = 0.3;
const float BACK_DARKEN = 0.85;
// V4: half the tint and darkening under OIT, and half the accumulate weight.
const float BACK_TINT_OIT = 0.15;
const float BACK_DARKEN_OIT = 0.925;
const float BACK_WEIGHT_OIT = 0.5;
const float MESH_FADE_FROM = 2.5;  // CSS px between lines: gone
const float MESH_FADE_TO = 5.0;    // CSS px between lines: full

void main() {
  // Derivatives first, in uniform control flow, before any discard.
  vec2 coord = v_uv / u_meshStep;
  vec2 perPixel = max(fwidth(coord), vec2(1e-8));
  vec3 dx = dFdx(v_viewPos);
  vec3 dy = dFdy(v_viewPos);
  if (outsideBox(v_rel)) discard;

  vec3 base = u_color;
  if (u_colormap) {
    if (isnan(v_scalar) || isinf(v_scalar)) {
      base = u_noData;
    } else {
      float t = normaliseScalar(v_scalar, u_domain.x, u_domain.y, u_diverging);
      base = texture(u_lut, vec2((t * 255.0 + 0.5) / 256.0, 0.5)).rgb;
    }
  }

  vec3 toEye = u_perspective ? normalize(-v_viewPos) : vec3(0.0, 0.0, 1.0);
  vec3 n;
  float len = length(v_normal);
  if (len < 1e-4) {
    n = normalize(cross(dx, dy));
    if (dot(n, toEye) < 0.0) n = -n;
  } else {
    n = v_normal / len;
    if (!gl_FrontFacing) n = -n;
  }
  float key = max(dot(n, KEY), 0.0);
  float fill = max(dot(n, FILL), 0.0);
  vec3 halfway = normalize(KEY + toEye);
  float spec = key > 0.0 ? pow(max(dot(n, halfway), 0.0), SHININESS) : 0.0;
  vec3 color = min(base * (AMBIENT + DIFFUSE * key + FILL_SHARE * DIFFUSE * fill) + SPECULAR * spec, vec3(1.0));

  if (!gl_FrontFacing) {
    color = u_oit ? mix(color, u_backTint, BACK_TINT_OIT) * BACK_DARKEN_OIT : mix(color, u_backTint, BACK_TINT) * BACK_DARKEN;
  }

  if (u_meshLines) {
    // Backing px from the nearest line of each family, and the spacing of
    // each family in CSS px.
    vec2 dist = abs(fract(coord + 0.5) - 0.5) / perPixel;
    vec2 on = clamp(0.5 * u_pixelRatio + 0.5 - dist, 0.0, 1.0);
    vec2 fade = smoothstep(MESH_FADE_FROM, MESH_FADE_TO, 1.0 / (perPixel * u_pixelRatio));
    float ink = max(on.x * fade.x, on.y * fade.y);
    color = mix(color, u_meshLineColor, u_meshLineStrength * ink);
  }

  color = depthCue(color, v_depth);
  if (u_oit) {
    // McGuire and Bavoil's weight (shaders/oit.ts), z the view depth,
    // normalised by the box's own view-space depth span (V4, S3 M10).
    float a = u_opacity;
    float depthSpan = max(u_cueRange.y - u_cueRange.x, 1e-3);
    float w = oitWeight(a, max(-v_viewPos.z, 0.0), depthSpan);
    if (!gl_FrontFacing) w *= BACK_WEIGHT_OIT;
    fragColor = vec4(color * a * w, a);
    fragWeight = vec4(a * w, 0.0, 0.0, 0.0);
  } else {
    fragColor = vec4(color, u_opacity);
    fragWeight = vec4(0.0);
  }
}
`
