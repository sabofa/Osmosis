// GLSL shared by the paint shaders (GLSL ES 3.00).
//
// Determinism (spec §3.8): nothing in these shaders reads a clock, a frame
// counter or a random source. Every "random" number is an integer hash of a
// seed the model chose (the stroke's seed), the bristle index and a salt, so
// the same strokes always draw the same bristles.

export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
// paint: fullscreen triangle
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const COMMON_GLSL = /* glsl */ `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

// smoothstep that also accepts edge0 > edge1 (the mockup's smooth(a, b, x)).
float sstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

uint hashU(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

// Four numbers in (0, 1), a byte each, from (seed, index, salt): one hash.
vec4 rnd4(uint seed, uint index, uint salt) {
  uint h = hashU(seed * 0x9e3779b1u + index * 0x85ebca6bu + salt * 0xc2b2ae35u + 0x165667b1u);
  return (vec4(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u), float(h >> 24)) + 0.5) * (1.0 / 256.0);
}

// An approximate unit Gaussian from three uniforms (Irwin-Hall).
float gauss3(float a, float b, float c) {
  return (a + b + c - 1.5) * 2.0;
}

// The paper tile is tiled in screen space at 1:1 device px (it never moves
// with the camera). Row 0 of the tile is the TOP of the image, so GL's
// bottom-up fragment y is flipped first.
ivec2 paperCoord(vec2 fragCoord, vec2 resolution, ivec2 tile) {
  int x = int(fragCoord.x);
  int y = int(resolution.y - fragCoord.y);
  return ivec2(x % tile.x, y % tile.y);
}

vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 srgbDecode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// OKLab lightness of a linear-light sRGB colour.
float oklabL(vec3 lin) {
  float l = 0.4122214708 * lin.r + 0.5363325363 * lin.g + 0.0514459929 * lin.b;
  float m = 0.2119034982 * lin.r + 0.6806995451 * lin.g + 0.1073969566 * lin.b;
  float s = 0.0883024619 * lin.r + 0.2817188376 * lin.g + 0.6299787005 * lin.b;
  return 0.2104542553 * pow(max(l, 0.0), 1.0 / 3.0) + 0.7936177850 * pow(max(m, 0.0), 1.0 / 3.0) - 0.0040720468 * pow(max(s, 0.0), 1.0 / 3.0);
}
`
