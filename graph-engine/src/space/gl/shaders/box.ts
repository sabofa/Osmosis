// The box shader (S5's box pipeline): instanced unit cubes, each scaled and
// offset to its box, lit like meshes. GLSL ES 3.00.
//
// Per vertex: a corner of the unit cube in [0, 1]^3 and its face's outward
// normal. Per instance: the box's min and max corners, relative to the box
// centre in author units. An axis-aligned face normal stays itself under the
// author-to-world scale, so the normal needs no correction. The lighting is
// the mesh shader's (key, fill, ambient, low specular), copied rather than
// shared so this pipeline stands on its own.

export const BOX_VERTEX = /* glsl */ `#version 300 es
// space: box
layout(location = 0) in vec3 a_corner;   // unit cube, [0, 1]^3
layout(location = 1) in vec3 a_normal;   // outward, axis-aligned
layout(location = 2) in vec3 a_min;      // per instance, relative to the box centre
layout(location = 3) in vec3 a_max;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec3 u_scale;                    // k: author units -> world
out vec3 v_normal;
out vec3 v_viewPos;
void main() {
  vec3 p = mix(a_min, a_max, a_corner);
  vec4 viewPos = u_view * vec4(p * u_scale, 1.0);
  v_viewPos = viewPos.xyz;
  v_normal = mat3(u_view) * a_normal;
  gl_Position = u_proj * viewPos;
}
`

export const BOX_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_viewPos;
uniform vec3 u_color;
uniform float u_opacity;
uniform bool u_perspective;
out vec4 fragColor;

const vec3 KEY = vec3(-0.5014, 0.6017, 0.6217);
const vec3 FILL = vec3(0.6046, -0.2519, 0.7557);
const float AMBIENT = 0.25;
const float DIFFUSE = 0.75;
const float FILL_SHARE = 0.3;
const float SPECULAR = 0.15;
const float SHININESS = 24.0;

void main() {
  vec3 toEye = u_perspective ? normalize(-v_viewPos) : vec3(0.0, 0.0, 1.0);
  vec3 n = normalize(v_normal);
  if (!gl_FrontFacing) n = -n;
  float key = max(dot(n, KEY), 0.0);
  float fill = max(dot(n, FILL), 0.0);
  vec3 halfway = normalize(KEY + toEye);
  float spec = key > 0.0 ? pow(max(dot(n, halfway), 0.0), SHININESS) : 0.0;
  vec3 lit = u_color * (AMBIENT + DIFFUSE * key + FILL_SHARE * DIFFUSE * fill) + SPECULAR * spec;
  fragColor = vec4(min(lit, vec3(1.0)), u_opacity);
}
`
