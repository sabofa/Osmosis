// The lit, two-sided mesh shader (plan G9, spec SP4 "Surfaces"). GLSL ES 3.00.
//
// Blinn-Phong in view space (x right, y up, z toward the viewer):
// - a key light from the upper left front;
// - a fill light at about 30% of the key, from the opposite side (right, a
//   little below);
// - ambient 0.25, specular 0.15 with shininess 24.
// Back faces flip their normal (gl_FrontFacing), so both sides light
// correctly; S3 adds the back-face tint and colormaps. A zero normal (the
// scene contract's "undefined") falls back to the face normal, turned to
// the viewer. No gamma: colours are sRGB values drawn as-is (theme.ts).

export const MESH_VERTEX = /* glsl */ `#version 300 es
// space: mesh
layout(location = 0) in vec3 a_position; // relative to the box centre, author units
layout(location = 1) in vec3 a_normal;   // world
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec3 u_scale;                    // k: author units -> world
out vec3 v_normal;
out vec3 v_viewPos;
void main() {
  vec4 viewPos = u_view * vec4(a_position * u_scale, 1.0);
  v_viewPos = viewPos.xyz;
  v_normal = mat3(u_view) * a_normal;
  gl_Position = u_proj * viewPos;
}
`

export const MESH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_viewPos;
uniform vec3 u_color;
uniform float u_opacity;
uniform bool u_perspective;
out vec4 fragColor;

const vec3 KEY = vec3(-0.5014, 0.6017, 0.6217);   // normalise(-0.5, 0.6, 0.62)
const vec3 FILL = vec3(0.6046, -0.2519, 0.7557);  // normalise(0.6, -0.25, 0.75)
const float AMBIENT = 0.25;
const float DIFFUSE = 0.75;
const float FILL_SHARE = 0.3;
const float SPECULAR = 0.15;
const float SHININESS = 24.0;

void main() {
  vec3 toEye = u_perspective ? normalize(-v_viewPos) : vec3(0.0, 0.0, 1.0);
  vec3 n;
  float len = length(v_normal);
  if (len < 1e-4) {
    n = normalize(cross(dFdx(v_viewPos), dFdy(v_viewPos)));
    if (dot(n, toEye) < 0.0) n = -n;
  } else {
    n = v_normal / len;
    if (!gl_FrontFacing) n = -n;
  }
  float key = max(dot(n, KEY), 0.0);
  float fill = max(dot(n, FILL), 0.0);
  vec3 halfway = normalize(KEY + toEye);
  float spec = key > 0.0 ? pow(max(dot(n, halfway), 0.0), SHININESS) : 0.0;
  vec3 lit = u_color * (AMBIENT + DIFFUSE * key + FILL_SHARE * DIFFUSE * fill) + SPECULAR * spec;
  fragColor = vec4(min(lit, vec3(1.0)), u_opacity);
}
`
