// The procedural oil brush (R3), ported from the approved mockup's
// painter.js (Painter.stroke).
//
// The mockup stamps, for every bristle, discs along a dense centreline into a
// deposit buffer, keeps the heaviest deposit per pixel, then gates it by the
// canvas tooth and blends it over the canvas. Here each stroke is one
// instanced ribbon and the fragment shader evaluates the same field directly:
//   - the ribbon follows the stroke's projected path (a Catmull-Rom curve
//     through its PATH_POINTS points);
//   - across the ribbon, `bristles` bristles sit side by side, each with its
//     own seeded load (smooth clumping plus noise), radius, start and end
//     (ragged at the stroke's edges), slow lateral wander and a faint colour
//     jitter. A bristle's deposit is  load(t) * (1 - d^2 / R^2)^2  and the
//     heaviest bristle wins, which gives the streaky ridges;
//   - along the stroke, a loaded start, a thinning body and an end bump, as in
//     the mockup. Each bristle's start and end are round caps at its own
//     start and end, the way the stamped discs are;
//   - the deposit plus 0.45 of the canvas height must clear a threshold that
//     rises with the dry-brush amount, so a dry tail catches the weave's
//     peaks and skips its valleys;
//   - wet pickup mixes the layers beneath (and the canvas where nothing has
//     been painted yet) into the stroke's colour, most at its start;
//   - the paint height accumulates for impasto: h' = h (1 - a/2) + a * dep * kp.
//
// Colours accumulate in sRGB-encoded space, as the mockup does, so the mixes
// look as approved. Output 0 is premultiplied colour with coverage as alpha,
// output 1 is the height in r with a/2 as alpha; both blend ONE, ONE_MINUS_SRC_ALPHA.

import { PATH_POINTS } from '../../types'
import { COMMON_GLSL } from './common'

// Ribbon tessellation: PATH_POINTS - 1 segments, each split RIBBON_SUBDIV
// times along the Catmull-Rom curve so a curved stroke has no visible kinks.
export const RIBBON_SUBDIV = 4
export const RIBBON_SEGMENTS = (PATH_POINTS - 1) * RIBBON_SUBDIV
export const VERTICES_PER_STROKE = 2 * (RIBBON_SEGMENTS + 1)
// Texels per stroke in the stroke data texture (RGBA32F): the path points
// (x, y, width, 0), then colour + alpha, the brush parameters, the stroke
// parameters and the role / edge class.
export const TEXELS_PER_STROKE = PATH_POINTS + 4

export const STROKE_VERTEX = /* glsl */ `#version 300 es
// paint: stroke
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_strokes;
uniform int u_base;      // first stroke of this layer in the sorted order
uniform int u_perRow;    // strokes per row of the data texture
uniform vec2 u_cssSize;  // the view's size in CSS px
out vec3 v_geo;          // lateral offset (hw units), arc position (px), half width (px)
flat out vec4 v_colour;  // sRGB colour, alpha
flat out vec4 v_p0;      // load, impasto, bristles, bristle variance
flat out vec4 v_p1;      // dry, wet, end softness, seed
flat out vec4 v_p2;      // role, edge class, length (px), cap (px)

const int PTS = ${PATH_POINTS};
const int SUB = ${RIBBON_SUBDIV};
const int SEGS = (PTS - 1) * SUB;
const int TEXELS = ${TEXELS_PER_STROKE};

vec4 fetchTexel(int id, int k) {
  return texelFetch(u_strokes, ivec2((id % u_perRow) * TEXELS + k, id / u_perRow), 0);
}

void main() {
  int id = u_base + gl_InstanceID;
  int j = gl_VertexID >> 1;
  float side = ((gl_VertexID & 1) == 0) ? -1.0 : 1.0;

  vec4 pt[PTS];
  float cum[PTS];
  float widthSum = 0.0;
  for (int k = 0; k < PTS; k++) {
    pt[k] = fetchTexel(id, k);
    widthSum += pt[k].z;
    cum[k] = k == 0 ? 0.0 : cum[k - 1] + length(pt[k].xy - pt[k - 1].xy);
  }
  float len = cum[PTS - 1];
  if (len < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 c0 = fetchTexel(id, PTS);
  vec4 c1 = fetchTexel(id, PTS + 1);
  vec4 c2 = fetchTexel(id, PTS + 2);
  vec4 c3 = fetchTexel(id, PTS + 3);
  float cap = clamp(1.6 * (widthSum / float(PTS)) / max(c1.z, 1.0), 1.0, 6.0);

  float u = float(j) / float(SEGS) * float(PTS - 1);
  int a = min(int(floor(u)), PTS - 2);
  float f = u - float(a);
  vec2 p0 = pt[max(a - 1, 0)].xy;
  vec2 p1 = pt[a].xy;
  vec2 p2 = pt[a + 1].xy;
  vec2 p3 = pt[min(a + 2, PTS - 1)].xy;
  vec2 b1 = p2 - p0;
  vec2 b2 = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3;
  vec2 b3 = 3.0 * p1 - p0 - 3.0 * p2 + p3;
  vec2 pos = 0.5 * (2.0 * p1 + b1 * f + b2 * f * f + b3 * f * f * f);
  vec2 tang = 0.5 * (b1 + 2.0 * b2 * f + 3.0 * b3 * f * f);
  if (dot(tang, tang) < 1e-8) tang = p2 - p1;
  if (dot(tang, tang) < 1e-8) tang = vec2(1.0, 0.0);
  vec2 tn = normalize(tang);
  float s = mix(cum[a], cum[a + 1], f);
  float w = mix(pt[a].z, pt[a + 1].z, f);
  if (j == 0) { pos -= tn * cap; s -= cap; }
  if (j == SEGS) { pos += tn * cap; s += cap; }

  float hw = max(w * 0.5, 0.6);
  float extent = hw * 1.3 + 1.2;
  vec2 css = pos + vec2(-tn.y, tn.x) * side * extent;
  v_geo = vec3(side * extent / hw, s, hw);
  v_colour = c0;
  v_p0 = c1;
  v_p1 = c2;
  v_p2 = vec4(c3.x, c3.y, len, cap);
  gl_Position = vec4(css.x / u_cssSize.x * 2.0 - 1.0, 1.0 - css.y / u_cssSize.y * 2.0, 0.0, 1.0);
}
`

export const STROKE_FRAGMENT = /* glsl */ `#version 300 es
// paint: stroke
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 v_geo;
flat in vec4 v_colour;
flat in vec4 v_p0;
flat in vec4 v_p1;
flat in vec4 v_p2;
uniform sampler2D u_prev;    // the layers beneath: premultiplied sRGB colour, coverage
uniform sampler2D u_paper;   // the canvas, sRGB RGBA8
uniform sampler2D u_paperH;  // the canvas height, normalised (std 0.2), R32F
uniform ivec2 u_paperSize;
uniform vec2 u_resolution;   // backing px
uniform float u_heightScale; // 1, or 0.5 when the height target is 8 bit
uniform vec4 u_roleA[8];     // opacity, thin, start boost, wet pickup at the start
uniform vec4 u_roleB[8];     // end position, end spread, crisp (1) or ragged (0), 0
uniform bool u_debugRoles;
uniform vec3 u_roleColour[8];
${COMMON_GLSL}
layout(location = 0) out vec4 o_colour;
layout(location = 1) out vec4 o_height;

const int ROLE_GLAZE = 3;
const float START_RAMP = 0.026;

void main() {
  float load = v_p0.x;
  float kp = v_p0.y;
  int nB = int(clamp(v_p0.z + 0.5, 2.0, 32.0));
  float vari = v_p0.w;
  float dry = v_p1.x;
  float wet = v_p1.y;
  float endSoft = v_p1.z;
  uint seed = uint(v_p1.w);
  int role = int(v_p2.x + 0.5);
  float len = v_p2.z;
  float cap = v_p2.w;
  vec4 ra = u_roleA[role];
  vec4 rb = u_roleB[role];

  float o = v_geo.x;
  float s = v_geo.y;
  float hw = v_geo.z;
  float sc = clamp(s, 0.0, len);
  float t = sc / len;

  if (u_debugRoles) {
    float m = (1.0 - sstep(0.88, 1.0, abs(o))) * (1.0 - sstep(0.0, 1.0, abs(s - sc) / max(cap, 1.0)));
    if (m <= 0.01) discard;
    float a = 0.9 * m;
    o_colour = vec4(u_roleColour[role] * a, a);
    o_height = vec4(0.0);
    return;
  }

  bool crisp = rb.z > 0.5;
  float tEndMean = clamp(mix(rb.x, 0.6, endSoft) + (rnd4(seed, 0u, 900u).x - 0.5) * rb.y, 0.35, 1.08);
  // Bristles clump: a smooth, seeded wander of the load across the brush.
  vec2 clumpPhase = rnd4(seed, 0u, 901u).xy * TAU;
  float spacingN = 2.0 / float(nB);
  float inset = 1.0 - 0.6 * spacingN;
  float fb = (o / inset * 0.5 + 0.5) * float(nB) - 0.5;
  int bc = int(floor(fb));

  float bestDep = 0.0;
  vec3 bestJit = vec3(1.0);
  for (int di = -1; di <= 2; di++) {
    int b = bc + di;
    if (b < 0 || b >= nB) continue;
    uint bu = uint(b);
    vec4 r1 = rnd4(seed, bu, 1u);
    // A crisp (data) brush has its bristles evenly spaced and equal, so the
    // stroke sits exactly on its path; a loaded brush jitters them.
    float ob = (((float(b) + 0.5) * spacingN - 1.0) + (crisp ? 0.0 : (r1.x - 0.5) * 0.5 * spacingN)) * inset;
    float radius = spacingN * (crisp ? 1.5 : 1.2 + 0.65 * r1.y);
    // Too far across the brush to reach this fragment (the wander is under half a px).
    if (abs(o - ob) >= radius + 0.5 / max(1.0, hw)) continue;
    vec4 r2 = rnd4(seed, bu, 2u);
    vec4 r3 = rnd4(seed, bu, 3u);
    vec4 r4 = rnd4(seed, bu, 4u);
    float e = abs(ob);
    float edgeRag = crisp ? 0.0 : sstep(0.78, 1.0, e);
    float m = 0.5 + 0.5 * (0.6 * sin(float(b) * 0.9 + clumpPhase.x) + 0.4 * sin(float(b) * 2.3 + clumpPhase.y));
    float f0 = crisp ? 1.0 : 0.58 + 0.28 * m + 0.22 * r1.z;
    float bl = load * (1.0 - vari * (1.0 - f0)) * (1.0 + (crisp ? 0.0 : 0.3 * sstep(0.72, 1.0, e))) * (1.0 - 0.4 * edgeRag * r1.w);
    float ts = crisp ? 0.0 : max(0.0, gauss3(r2.x, r2.y, r2.z) * 0.012 + 0.08 * e * e + 0.04 * edgeRag * r2.w);
    float tEnd = crisp ? 1.08 : clamp(tEndMean + (r3.x - 0.5) * 0.4 - 0.4 * e * e - 0.1 * edgeRag * r3.y, 0.3, 1.08);
    float phase = r3.z * TAU;
    float freq = 0.03 + 0.04 * r3.w;
    float wob = crisp ? 0.0 : 0.45 * sin(sc * freq + phase) / max(1.0, hw);

    // Round caps at this bristle's own start and end.
    float sStart = ts * len;
    float sEnd = min(tEnd, 1.0) * len;
    float along = s < sStart ? (sStart - s) : (s > sEnd ? (s - sEnd) : 0.0);
    float dLat = o - (ob + wob);
    float dn = along / hw;
    float d2 = (dLat * dLat + dn * dn) / (radius * radius);
    float w = max(1.0 - d2, 0.0);
    if (w <= 0.0) continue;

    float tl = clamp(t, ts + START_RAMP + 0.002, max(min(tEnd, 1.0), ts + START_RAMP + 0.003));
    float endQ = (tl - (tEnd - 0.045)) / 0.022;
    float load0 = bl
      * (1.0 + ra.z * exp(-(tl / 0.06) * (tl / 0.06)))
      * (1.0 - ra.y * sstep(0.2, 1.0, tl))
      * sstep(ts, ts + START_RAMP, tl)
      * (1.0 + 0.45 * exp(-endQ * endQ))
      * sstep(tEnd, tEnd - 0.04, tl);
    float dep = load0 * w * w;
    if (dep > bestDep) {
      bestDep = dep;
      float jl = (r4.x - 0.5) * 0.009;
      float ja = (r4.y - 0.5) * 0.006;
      float jb = (r4.z - 0.5) * 0.006;
      bestJit = vec3(1.0) + vec3(jl * 5.0 + ja * 3.0, jl * 5.0 - ja * 2.0 + jb, jl * 5.0 - jb * 3.0);
    }
  }
  if (bestDep <= 0.0) discard;
  float dep = bestDep;

  // The canvas tooth decides what a dry brush catches.
  vec2 fc = gl_FragCoord.xy;
  ivec2 pix = ivec2(fc);
  ivec2 pc = paperCoord(fc, u_resolution, u_paperSize);
  float hg = texelFetch(u_paperH, pc, 0).r;
  float tail = sstep(1.0 - clamp(dry, 0.1, 1.0), 1.0, t);
  float dryEff = dry * (0.5 + 0.5 * tail);
  float g0 = 0.08 + 0.12 * dryEff;
  float g1 = 0.26 + 0.22 * dryEff;
  float gate = dryEff > 0.0 ? sstep(g0, g1, dep + 0.45 * hg) : sstep(0.03, 0.12, dep);
  if (gate <= 0.001) discard;

  float opac = role == ROLE_GLAZE ? min(v_colour.a, ra.x) : v_colour.a * ra.x;
  float al = gate * min(opac, opac * (0.42 + 1.6 * dep));
  if (al <= 0.001) discard;

  // Wet-into-wet: pick up what is beneath, the canvas where nothing is yet.
  vec4 prev = texelFetch(u_prev, pix, 0);
  vec3 paper = texelFetch(u_paper, pc, 0).rgb;
  vec3 under = prev.rgb + paper * (1.0 - prev.a);
  float wetStart = max(ra.w, 0.45 * endSoft);
  float wetv = clamp(wet + wetStart * (1.0 - sstep(0.0, 0.3, t)), 0.0, 1.0);
  vec3 col = mix(v_colour.rgb * bestJit, under, wetv);

  o_colour = vec4(col * al, al);
  o_height = vec4(al * dep * kp * u_heightScale, 0.0, 0.0, 0.5 * al);
}
`
