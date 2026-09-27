// Order-independent transparency's composite (plan E4 step 6; McGuire and
// Bavoil 2013, weighted blended OIT), drawn as one full-screen triangle into
// the default framebuffer: the resolved opaque colour, with the average
// translucent colour laid over it by 1 - revealage.
//
// The accumulation itself is the mesh shader with u_oit set (shaders/mesh.ts):
// it writes (premultiplied colour x w, alpha) to target 0 and alpha x w to
// target 1, with w = alpha * clamp(0.03 / (1e-5 + (z / 200)^4), 1e-2, 3e3)
// and z the view depth. targets.ts explains the single-blend-state layout.

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
