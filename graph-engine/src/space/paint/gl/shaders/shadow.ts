// The shadow-map pass (R2): depth only, from the key light, orthographic,
// fitted to the scene's bounding sphere. The G-buffer pass samples it.

export const SHADOW_VERTEX = /* glsl */ `#version 300 es
// paint: shadow
layout(location = 0) in vec3 a_position; // relative to the scene origin
uniform mat4 u_lightViewProj;
void main() {
  gl_Position = u_lightViewProj * vec4(a_position, 1.0);
}
`

export const SHADOW_FRAGMENT = /* glsl */ `#version 300 es
// paint: shadow (depth only)
precision lowp float;
void main() {}
`
