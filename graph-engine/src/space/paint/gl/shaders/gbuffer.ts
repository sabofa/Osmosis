// The G-buffer pass (R1). Meshes draw to a multiple-render-target framebuffer
// at half the CSS resolution; the CPU reads it back (one readPixels per
// attachment) for the paint model.
//
// What a texel holds:
//   view depth     distance along the view direction from the eye
//   world normal   unit, turned to face the viewer (a surface is two-sided)
//   raw lit value  u = clamp(key Lambert x intensity x shadow + ambient
//                  + sky max(n.z, 0) + bounce max(-n.z, 0), 0, 1)   (spec §3.3)
//   shadow flag    1 in the key light's cast or self shadow
//   mark index     the mesh's index in scene.marks
//
// Two layouts, chosen by EXT_color_buffer_float:
//   float  one RGBA32F target: (octahedral normal x, y, depth, packed) with
//          packed = ((mark + 1) * 2 + shadow) * 1024 + round(u * 1023), an
//          integer below 2^24, so exact in a float32 (zero means empty).
//          One readPixels of 16 B per pixel: the half-float targets the plan
//          suggested read back slower (ANGLE converts them on the CPU), and
//          depth wants 32 bits anyway.
//   rgba8  RT0 RGBA8 (n.xyz * .5 + .5, shadow)
//          RT1 RGBA8 (depth as 24 bits in r g b, 255)
//          RT2 RGBA8 (u as 16 bits in r g, mark + 1 as 16 bits in b a)
// gbuffer.ts has the TypeScript twins of both encodes, which is what the
// readback decodes (and what its tests check).

import { COMMON_GLSL } from './common'

export const GBUFFER_VERTEX = /* glsl */ `#version 300 es
// paint: gbuffer
layout(location = 0) in vec3 a_position; // relative to the scene origin
layout(location = 1) in vec3 a_normal;   // scene space, zero where undefined
uniform mat4 u_viewProj;                 // origin folded in; scaled to the G-buffer grid
uniform mat4 u_lightViewProj;
out vec3 v_pos;
out vec3 v_normal;
out vec3 v_lightClip;
void main() {
  v_pos = a_position;
  v_normal = a_normal;
  v_lightClip = (u_lightViewProj * vec4(a_position, 1.0)).xyz;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}
`

export function gbufferFragment(float: boolean): string {
  return /* glsl */ `#version 300 es
// paint: gbuffer (${float ? 'float' : 'rgba8'})
precision highp float;
precision highp int;
precision highp sampler2D;
${float ? '#define GBUFFER_FLOAT' : ''}
in vec3 v_pos;
in vec3 v_normal;
in vec3 v_lightClip;
uniform vec3 u_relEye;      // eye - origin
uniform vec3 u_viewDir;
uniform bool u_perspective;
uniform vec3 u_lightDir;    // toward the light
uniform float u_intensity;
uniform float u_ambient;
uniform float u_sky;
uniform float u_bounce;
uniform bool u_shadows;
uniform sampler2D u_shadowMap;
uniform float u_shadowTexel; // 1 / shadow map size
uniform float u_mark;
uniform float u_depthBase;   // dot(origin - eye, viewDir)
uniform vec2 u_depthRange;   // rgba8 depth packing
${COMMON_GLSL}
#ifdef GBUFFER_FLOAT
layout(location = 0) out vec4 o_a;
#else
layout(location = 0) out vec4 o_n;
layout(location = 1) out vec4 o_d;
layout(location = 2) out vec4 o_v;
#endif

// A unit vector in two floats (an octahedral map).
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 e = n.xy;
  if (n.z < 0.0) e = (1.0 - abs(e.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return e;
}

// 3x3 PCF visibility: 1 lit .. 0 shadowed. Slope-scaled bias in shadow-map
// depth (one texel of depth is 1/size for a surface at 45 degrees).
float shadowVisibility(vec3 lightUvz, float cosTheta) {
  if (lightUvz.x < 0.0 || lightUvz.x > 1.0 || lightUvz.y < 0.0 || lightUvz.y > 1.0 || lightUvz.z > 1.0) return 1.0;
  float sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  float slope = min(sinTheta / max(cosTheta, 0.1), 6.0);
  float bias = u_shadowTexel * (1.2 + 1.6 * slope);
  float visible = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float d = texture(u_shadowMap, lightUvz.xy + vec2(float(i), float(j)) * u_shadowTexel).r;
      visible += (lightUvz.z - bias <= d) ? 1.0 : 0.0;
    }
  }
  return visible / 9.0;
}

void main() {
  // Derivatives before any branch (uniform control flow).
  vec3 faceNormal = cross(dFdx(v_pos), dFdy(v_pos));
  vec3 toEye = u_perspective ? normalize(u_relEye - v_pos) : -u_viewDir;
  vec3 n = v_normal;
  float len = length(n);
  n = len < 1e-4 ? normalize(faceNormal) : n / len;
  if (dot(n, toEye) < 0.0) n = -n;

  float nl = dot(n, u_lightDir);
  float visible = 1.0;
  if (u_shadows && nl > 0.0) visible = shadowVisibility(v_lightClip * 0.5 + 0.5, nl);
  float key = max(nl, 0.0) * u_intensity * visible;
  float value = clamp(key + u_ambient + u_sky * max(n.z, 0.0) + u_bounce * max(-n.z, 0.0), 0.0, 1.0);
  float shadow = (nl <= 0.0 || visible < 0.5) ? 1.0 : 0.0;
  float depth = dot(v_pos, u_viewDir) + u_depthBase;

#ifdef GBUFFER_FLOAT
  uint packed = ((uint(u_mark) + 1u) * 2u + uint(shadow)) * 1024u + uint(value * 1023.0 + 0.5);
  o_a = vec4(octEncode(n), depth, float(packed));
#else
  o_n = vec4(n * 0.5 + 0.5, shadow);
  uint d24 = uint(clamp((depth - u_depthRange.x) / (u_depthRange.y - u_depthRange.x), 0.0, 1.0) * 16777215.0 + 0.5);
  o_d = vec4(float((d24 >> 16) & 255u), float((d24 >> 8) & 255u), float(d24 & 255u), 255.0) * (1.0 / 255.0);
  uint v16 = uint(value * 65535.0 + 0.5);
  uint m16 = uint(u_mark) + 1u;
  o_v = vec4(float(v16 >> 8), float(v16 & 255u), float(m16 >> 8), float(m16 & 255u)) * (1.0 / 255.0);
#endif
}
`
}
