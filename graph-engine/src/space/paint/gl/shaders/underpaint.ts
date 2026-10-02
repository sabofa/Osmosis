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
//
// While the camera moves (fix round 1, B7) the image is of the last full frame's view and has to move with the
// surface, not stay on the glass. The WARP variant does that backwards, per pixel of the NEW view: the scene's
// depth there (shaders/depth.ts) gives the surface point; the point is projected into the OLD view to find where
// the image holds its colour (gl/warp.ts is the same arithmetic in plain numbers, and is tested); the old G-buffer's
// depth there says whether the point was visible in the old view at all, and a point that was not takes the form's
// mean colour (a newly turned surface is never bare canvas). The silhouette is the new depth's: a pixel with no
// surface is not laid. The mask (weave, streaks) is the same, in the new view's pixels.

import { COMMON_GLSL } from './common'

// How much of the opacity the weave and the streaks can take, at texture 1 and streak 1 (see above).
export const UNDERPAINT_WEAVE_GATE = 0.08
export const UNDERPAINT_STREAK_GAIN = 0.3
// The canvas texture counts up to this much (the slider goes to 2).
export const UNDERPAINT_TEXTURE_MAX = 1.5

export function underpaintFragment(warp: boolean): string {
  return /* glsl */ `#version 300 es
// paint: underpaint${warp ? ' (warp)' : ''}
precision highp float;
precision highp int;
precision highp sampler2D;
${warp ? '#define WARP' : ''}
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
#ifdef WARP
uniform sampler2D u_sceneDepth; // the new view's depth (r, 1e30 where no surface is drawn) and bare table (g), RG32F
uniform sampler2D u_oldDepth;   // the last full frame's G-buffer depth, R32F, G-buffer size, row 0 the top
uniform mat4 u_invVP;           // the new view: the inverse of its viewProj, its eye and view direction
uniform vec3 u_eye;
uniform vec3 u_viewDir;
uniform mat4 u_oldVP;           // the old view: its viewProj, eye, view direction and size in CSS px
uniform vec3 u_oldEye;
uniform vec3 u_oldViewDir;
uniform vec2 u_oldCss;
uniform vec2 u_gridCss;         // the CSS px the image spans: the G-buffer's size times its scale
uniform vec3 u_fallback;        // the mean sRGB colour of the form: for a point the old view did not see
uniform float u_depthBias;
#endif
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

#ifdef WARP
// The colour and coverage of the image where the surface seen at this pixel was. A point the old view saw has the
// image's colour there, or none where the image has none (a lit table is bare canvas). A point of a form it did not
// see (a surface just turned into view, or the far side of a hole) takes the form's mean colour: never bare canvas.
// A point of the table it did not see has none. A coverage of 0 where there is no surface at all.
vec4 warped() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  vec2 surface = texelFetch(u_sceneDepth, pix, 0).rg;
  float d = surface.x;
  if (d > 1.0e29) return vec4(0.0);
  vec2 ndc = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
  vec4 n4 = u_invVP * vec4(ndc, -1.0, 1.0);
  vec4 f4 = u_invVP * vec4(ndc, 1.0, 1.0);
  vec3 pn = n4.xyz / n4.w;
  vec3 pf = f4.xyz / f4.w;
  float dn = dot(pn - u_eye, u_viewDir);
  float df = dot(pf - u_eye, u_viewDir);
  vec3 p = mix(pn, pf, abs(df - dn) < 1.0e-9 ? 0.0 : (d - dn) / (df - dn));
  vec4 o4 = u_oldVP * vec4(p, 1.0);
  if (o4.w > 1.0e-6) {
    vec2 on = o4.xy / o4.w;
    vec2 css = vec2((on.x * 0.5 + 0.5) * u_oldCss.x, (0.5 - on.y * 0.5) * u_oldCss.y);
    vec2 uv = css / u_gridCss;
    if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
      ivec2 size = textureSize(u_oldDepth, 0);
      ivec2 gp = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
      float zc = texelFetch(u_oldDepth, gp, 0).r;
      float zl = texelFetch(u_oldDepth, clamp(gp + ivec2(-1, 0), ivec2(0), size - 1), 0).r;
      float zr = texelFetch(u_oldDepth, clamp(gp + ivec2(1, 0), ivec2(0), size - 1), 0).r;
      float zd = texelFetch(u_oldDepth, clamp(gp + ivec2(0, -1), ivec2(0), size - 1), 0).r;
      float zu = texelFetch(u_oldDepth, clamp(gp + ivec2(0, 1), ivec2(0), size - 1), 0).r;
      // a G-buffer texel is two CSS px: the depth changes over it by the smaller one-sided slope, and a surface point
      // within that and the bias of the stored depth was the one the old view saw there
      float slope = min(max(min(abs(zc - zl), abs(zr - zc)), min(abs(zc - zd), abs(zu - zc))), 8.0 * u_depthBias);
      float seen = abs(dot(p - u_oldEye, u_oldViewDir) - zc);
      vec4 c = texture(u_under, uv);
      if (seen <= 2.0 * u_depthBias + 2.0 * slope) return c.a > 0.5 ? vec4(c.rgb, 1.0) : vec4(0.0);
    }
  }
  return surface.y > 0.5 ? vec4(0.0) : vec4(u_fallback, 1.0);
}
#endif

void main() {
#ifdef WARP
  vec4 c = warped();
  float inside = c.a;
#else
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y) * u_uvScale;
  vec4 c = texture(u_under, uv);
  // the silhouette: the filtered coverage, cut where it is half
  float inside = sstep(0.35, 0.65, c.a);
#endif
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
}

export const UNDERPAINT_FRAGMENT = underpaintFragment(false)
export const UNDERPAINT_WARP_FRAGMENT = underpaintFragment(true)
