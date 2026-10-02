// The composite (R4): the canvas, the paint over it by coverage, and the
// impasto relief, to the default framebuffer. Ported from the mockup's
// Painter.finish().
//
//   canvas      tiled in screen space at 1:1 device px, so it never moves with
//               the camera; the paint accumulates as premultiplied colour and
//               coverage, so   colour = paint + canvas (1 - coverage).
//   relief      the height field is  paint height x impasto strength  plus the
//               weave, which shows only where paint is thin
//               (0.22 x weave x exp(-2.4 x paint) x canvas texture). Its
//               gradient (the field blurred by [1 2 1]/4 in both axes, then a
//               central difference) is lit at (impasto.lightAzimuth,
//               impasto.lightElevation): a gentle multiply
//               1 + 0.5 tanh(1.4 f) plus a faint sheen where paint is thick.
//   grey        the final image as OKLab lightness (the value check).
//   no canvas   paint over a flat tone, without the weave (paint-only).
// Colours are sRGB-encoded throughout, as in the mockup.

import { COMMON_GLSL, FULLSCREEN_VERTEX } from './common'

export { FULLSCREEN_VERTEX }

// The mockup's finish() constants. It lights a 2x supersampled height field
// (gain 0.5, and a sheen normal of -2.4 h'), i.e. 0.25 and -1.2 per CSS-px
// gradient; the shader multiplies by the pixel ratio to light the same relief
// from a gradient taken per device px, so the relief looks the same at any
// pixel ratio.
export const RELIEF_GAIN = 0.25
export const SHEEN_NORMAL = 1.2
export const WEAVE_RELIEF = 0.22
export const SHEEN = 0.03
export const SHEEN_POWER = 30

export const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
// paint: composite
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_paint0;  // premultiplied sRGB colour, coverage
uniform sampler2D u_paint1;  // paint height (r)
uniform sampler2D u_paper;   // sRGB RGBA8
uniform sampler2D u_paperH;  // normalised weave height, R32F
uniform ivec2 u_paperSize;
uniform vec2 u_resolution;
uniform vec3 u_flatTone;     // sRGB tone for the no-canvas view
uniform bool u_noCanvas;
uniform bool u_relief;
uniform bool u_grey;
uniform float u_impasto;
uniform float u_texture;
uniform float u_heightScale;
uniform float u_pixelRatio;  // device px per CSS px
uniform vec3 u_light;        // unit, toward the relief light (image y down)
uniform vec3 u_halfVec;
${COMMON_GLSL}
out vec4 fragColor;

float heightAt(ivec2 g) {
  g = clamp(g, ivec2(0), ivec2(u_resolution) - 1);
  float pt = texelFetch(u_paint1, g, 0).r / u_heightScale;
  float weave = 0.0;
  if (!u_noCanvas) {
    float hg = texelFetch(u_paperH, paperCoord(vec2(g) + 0.5, u_resolution, u_paperSize), 0).r;
    weave = ${WEAVE_RELIEF.toFixed(2)} * hg * exp(-2.4 * pt) * u_texture;
  }
  return pt * u_impasto + weave;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int rows = int(u_resolution.y);
  vec4 paint = texelFetch(u_paint0, px, 0);
  vec3 paper = u_noCanvas ? u_flatTone : texelFetch(u_paper, paperCoord(gl_FragCoord.xy, u_resolution, u_paperSize), 0).rgb;
  vec3 col = paint.rgb + paper * (1.0 - paint.a);

  if (u_relief) {
    // Image rows run top-down; GL rows run bottom-up.
    int ry = rows - 1 - px.y;
    float hx = 0.0;
    float hy = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        if (abs(i) == 2 && abs(j) == 2) continue;
        float h = heightAt(ivec2(px.x + i, rows - 1 - (ry + j)));
        // d/dx of the blurred field: x kernel [-1 -2 0 2 1]/8, y kernel [1 2 1]/4.
        float kx = float(i == -2 ? -1 : (i == -1 ? -2 : (i == 1 ? 2 : (i == 2 ? 1 : 0)))) * 0.125;
        float ky = float(j == -2 ? -1 : (j == -1 ? -2 : (j == 1 ? 2 : (j == 2 ? 1 : 0)))) * 0.125;
        float wy = abs(j) == 2 ? 0.0 : (j == 0 ? 0.5 : 0.25);
        float wx = abs(i) == 2 ? 0.0 : (i == 0 ? 0.5 : 0.25);
        hx += kx * wy * h;
        hy += ky * wx * h;
      }
    }
    float f0 = -${RELIEF_GAIN.toFixed(2)} * u_pixelRatio * (hx * u_light.x + hy * u_light.y) / u_light.z;
    float f = 1.0 + 0.5 * tanh(f0 * 1.4);
    float pt = texelFetch(u_paint1, px, 0).r / u_heightScale;
    vec3 n = normalize(vec3(-${SHEEN_NORMAL.toFixed(1)} * u_pixelRatio * hx, -${SHEEN_NORMAL.toFixed(1)} * u_pixelRatio * hy, 1.0));
    float nd = dot(n, u_halfVec);
    float sheen = nd > 0.0 ? pow(nd, ${SHEEN_POWER.toFixed(1)}) * ${SHEEN.toFixed(2)} * min(1.0, pt * 2.0) : 0.0;
    col = col * f + sheen;
  }

  // A triangular dither, hashed from the pixel (never from time).
  uint hh = hashU(uint(px.x) * 1973u + uint(px.y) * 9277u);
  float dither = (float(hh & 0xffffu) + float(hh >> 16) - 65535.0) * (1.0 / 65535.0) * (0.7 / 255.0);
  col += dither;

  if (u_grey) {
    float L = oklabL(srgbDecode(col));
    col = srgbEncode(vec3(L * L * L));
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`
