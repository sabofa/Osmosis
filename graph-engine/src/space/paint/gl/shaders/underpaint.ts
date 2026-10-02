// The underpainting pass (paint-zoom): the first layer, laid before the block-in. The model hands over an
// image of the curve colour of every pixel of a form (PaintFrame.underpaint, at G-buffer resolution); this
// pass stretches it over the view, smoothly (the texture is filtered bilinear, and its coverage is cut at
// the silhouette), and lays it as a thin, scumbled imprimatura: opaque enough that a gap between strokes
// inside a form shows its colour and never the bare canvas, but not a flat fill.
//
//   coverage = opacity x mask x silhouette
//   mask     = 1 - weave gate - streaks
//   weave    thin paint skips the valleys of the canvas tooth, so the weave shows faintly through it
//            (UNDERPAINT_WEAVE_GATE x canvas texture x how low the tooth is here)
//   streaks  a seeded, directional streak noise (a long, thin value noise stretched along one brush
//            direction, from the seed), UNDERPAINT_STREAK_GAIN x streak
//
// The mask never takes more than WEAVE_GATE x texture + STREAK_GAIN x streak off the opacity
// (underpaintFloor in gl/underpaint.ts is that bound, which the coverage tests use). Colours are
// sRGB-encoded, as in the stroke pass; the output is premultiplied colour and coverage, and no height.
//
// Determinism: the noise is an integer hash of the seed and the cell, in CSS px, so it is the same
// at every pixel ratio and on every frame.

import { COMMON_GLSL } from './common'

// How much of the opacity the weave and the streaks can take, at texture 1 and streak 1 (see above).
export const UNDERPAINT_WEAVE_GATE = 0.08
export const UNDERPAINT_STREAK_GAIN = 0.3
// The canvas texture counts up to this much (the slider goes to 2).
export const UNDERPAINT_TEXTURE_MAX = 1.5

export const UNDERPAINT_FRAGMENT = /* glsl */ `#version 300 es
// paint: underpaint
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_under;   // the underpainting: sRGB colour, coverage; row 0 is the top; bilinear
uniform sampler2D u_paperH;  // the canvas height, normalised (std 0.2), R32F
uniform ivec2 u_paperSize;
uniform vec2 u_resolution;   // backing px
uniform vec2 u_uvScale;      // the canvas's extent over the image's
uniform float u_pixelRatio;  // device px per CSS px
uniform float u_opacity;
uniform float u_streak;
uniform float u_texture;
uniform vec2 u_dir;          // the brush direction of the streaks (unit)
uniform uint u_seed;
${COMMON_GLSL}
layout(location = 0) out vec4 o_colour;
layout(location = 1) out vec4 o_height;

float cellHash(ivec2 c) {
  return float(hashU(uint(c.x) * 0x9e3779b1u ^ uint(c.y) * 0x85ebca6bu ^ u_seed) & 0xffffu) * (1.0 / 65535.0);
}

float valueNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i);
  float b = cellHash(i + ivec2(1, 0));
  float c = cellHash(i + ivec2(0, 1));
  float d = cellHash(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y) * u_uvScale;
  vec4 c = texture(u_under, uv);
  // the silhouette: the filtered coverage, cut where it is half
  float inside = sstep(0.35, 0.65, c.a);
  if (inside <= 0.001) discard;

  // the weave: paint this thin catches the tooth's peaks first
  float hg = texelFetch(u_paperH, paperCoord(gl_FragCoord.xy, u_resolution, u_paperSize), 0).r;
  float low = 1.0 - sstep(-0.3, 0.2, hg);
  float weave = ${UNDERPAINT_WEAVE_GATE.toFixed(2)} * clamp(u_texture, 0.0, ${UNDERPAINT_TEXTURE_MAX.toFixed(1)}) * low;

  // the streaks: along the brush direction long and thin, across it short
  vec2 css = gl_FragCoord.xy / u_pixelRatio;
  vec2 q = vec2(dot(css, u_dir), dot(css, vec2(-u_dir.y, u_dir.x)));
  float n = 0.65 * valueNoise(vec2(q.x / 70.0, q.y / 2.6)) + 0.35 * valueNoise(vec2(q.x / 26.0 + 11.7, q.y / 1.3 + 5.3));
  float streak = ${UNDERPAINT_STREAK_GAIN.toFixed(2)} * clamp(u_streak, 0.0, 1.0) * sstep(0.4, 0.85, n);

  float a = clamp(u_opacity, 0.0, 1.0) * clamp(1.0 - weave - streak, 0.0, 1.0) * inside;
  if (a <= 0.001) discard;
  o_colour = vec4(c.rgb * a, a);
  o_height = vec4(0.0);
}
`
