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
//     peaks and skips its valleys. The threshold is a smoothstep widened by
//     half the deposit's own change over a pixel (fwidth of the deposit, not of
//     the tooth: the weave's grain is meant to be crisp), so a stroke's side and
//     end edges, where the deposit falls off faster than the smoothstep is wide,
//     are at least a pixel soft and do not stair-step;
//   - wet pickup mixes the layers beneath (and the canvas where nothing has
//     been painted yet) into the stroke's colour, most at its start;
//   - the paint height accumulates for impasto: h' = h (1 - a/2) + a * dep * kp;
//   - a re-projected frame's strokes (the camera is moving, the model is not running) lie where the last frame's
//     surface was, and some of that is now hidden or off the surface. With u_depthTest on, each fragment's view
//     depth (from the stroke's world path, per vertex) is compared with the scene's depth for the new view
//     (shaders/depth.ts) and a stroke behind a surface is faded out over a tolerance that grows with the surface's
//     slope across the stroke (depthVisible below). An edge stroke is also tested once per stroke, at its point
//     nearest the viewer, for having left its form (formVisible); gl/depthTest.ts is the numeric twin of both, and
//     gl/brush.ts of the bristle loop and the ribbon's cap;
//   - a baked frame's data lines whose style is 'dashed' are drawn a second time (u_hiddenPass), right after the line layer:
//     only where a surface is nearer than the stroke (the complement of the depth test above, so the two passes cover each
//     point once between them), dashed by the stroke's arc length in CSS px and at half strength, as the per-frame model
//     draws a hidden run (depthVisible and dashMask below; gl/depthTest.ts hiddenShare and dashMask are the numeric twins).
//
// Colours accumulate in sRGB-encoded space, as the mockup does, so the mixes
// look as approved. Output 0 is premultiplied colour with coverage as alpha,
// output 1 is the height in r with a/2 as alpha; both blend ONE, ONE_MINUS_SRC_ALPHA.

import { MAX_BRISTLES, PATH_POINTS, ROLES } from '../../types'
import { BRISTLE_REACH, CAP_PAD, DRY_TEXTURE_REF, DRY_TEXTURE_SCALE_MAX, MIN_HALF_WIDTH } from '../brush'
import { DASH_EDGE, DASH_OFF, DASH_ON, DEPTH_SLOPE_CAP, FORM_REACH, HIDDEN_ALPHA } from '../depthTest'
import { COMMON_GLSL } from './common'

// Ribbon tessellation: PATH_POINTS - 1 segments, each split RIBBON_SUBDIV
// times along the Catmull-Rom curve so a curved stroke has no visible kinks.
export const RIBBON_SUBDIV = 4
export const RIBBON_SEGMENTS = (PATH_POINTS - 1) * RIBBON_SUBDIV
export const VERTICES_PER_STROKE = 2 * (RIBBON_SEGMENTS + 1)
// Texels per stroke in the stroke data texture (RGBA32F): the path points
// (x, y, width, 0), then colour + alpha, the brush parameters, the stroke
// parameters, the role / edge class / whether there is a world path, and then the
// world path (x, y, z, 0 per point), which the depth test of a re-projected frame reads.
export const TEXELS_PER_STROKE = 2 * PATH_POINTS + 4

const ROLE_EDGE_INDEX = ROLES.indexOf('edge')

// What both stages need of the scene's depth: the target, the bias, and the slope (the change of depth over a pixel:
// the smaller of the two one-sided differences on each axis, so the far side of a silhouette is not mistaken for a
// slope, and capped).
const DEPTH_TEST_GLSL = /* glsl */ `
uniform bool u_depthTest;       // a re-projected frame: hide what the new view's surfaces cover
uniform sampler2D u_sceneDepth; // the scene's view depth for this view, RG32F, 1e30 where nothing is drawn
uniform float u_depthBias;      // view-depth units a stroke may lie behind its surface
uniform vec2 u_resolution;      // backing px
uniform float u_pixelRatio;     // backing px per CSS px

const int ROLE_EDGE = ${ROLE_EDGE_INDEX};

float sceneDepthAt(ivec2 pix) {
  return texelFetch(u_sceneDepth, clamp(pix, ivec2(0), ivec2(u_resolution) - 1), 0).r;
}

float sceneSlope(ivec2 pix) {
  float zc = sceneDepthAt(pix);
  float zl = sceneDepthAt(pix + ivec2(-1, 0));
  float zr = sceneDepthAt(pix + ivec2(1, 0));
  float zd = sceneDepthAt(pix + ivec2(0, -1));
  float zu = sceneDepthAt(pix + ivec2(0, 1));
  return min(max(min(abs(zc - zl), abs(zr - zc)), min(abs(zc - zd), abs(zu - zc))), ${DEPTH_SLOPE_CAP.toFixed(1)} * u_depthBias);
}
`

export const STROKE_VERTEX = /* glsl */ `#version 300 es
// paint: stroke
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_strokes;
uniform int u_base;      // first stroke of this layer in the sorted order
uniform int u_perRow;    // strokes per row of the data texture
uniform vec2 u_cssSize;  // the view's size in CSS px
uniform vec3 u_viewDir;  // the view's direction, and dot(eye, viewDir): the view depth of a world point
uniform float u_eyeDot;
out vec3 v_geo;          // lateral offset (hw units), arc position (px), half width (px)
out float v_zs;          // the view depth of the stroke's surface point here (for the depth test)
flat out float v_form;   // 1 while an edge decal is on its form, 0 when it has left it (formVisible); 1 for every other stroke
flat out float v_world;  // 1 when the stroke has a world path to test with
flat out vec4 v_colour;  // sRGB colour, alpha
flat out vec4 v_p0;      // load, impasto, bristles, bristle variance
flat out vec4 v_p1;      // dry, wet, end softness, seed
flat out vec4 v_p2;      // role, edge class, length (px), mean cap (px)
${COMMON_GLSL}
${DEPTH_TEST_GLSL}
const int PTS = ${PATH_POINTS};
const int SUB = ${RIBBON_SUBDIV};
const int SEGS = (PTS - 1) * SUB;
const int TEXELS = ${TEXELS_PER_STROKE};
const int WORLD = PTS + 4;  // the first world-path texel

vec4 fetchTexel(int id, int k) {
  return texelFetch(u_strokes, ivec2((id % u_perRow) * TEXELS + k, id / u_perRow), 0);
}

// How far the ribbon runs past an end of the path: a bristle's round end reaches ${BRISTLE_REACH.toFixed(2)} of its radius
// past the path (the radius is at most that many spacings of 2 / bristles half widths), and a pixel more keeps the
// ribbon's own edge, which fwidth cannot soften, clear of the deposit. The width is the stroke's there.
float ribbonCap(float width, int nB) {
  return ${BRISTLE_REACH.toFixed(2)} * max(width * 0.5, ${MIN_HALF_WIDTH.toFixed(1)}) * (2.0 / float(nB)) + ${CAP_PAD.toFixed(1)};
}

// Has an edge decal left its form? pos is a point of its path (CSS px, y down) and vzs the decal's view depth
// there. It is on its form when some surface within ${FORM_REACH} CSS px lies at its depth (the pixel under an outline is the
// background's; the decal's own surface is a pixel or two away). The closest depth match is the form, and the decal
// stays while it is within the bias plus the slope there across that reach (gl/depthTest.ts formVisible is the twin).
float formVisible(vec2 pos, float vzs) {
  vec2 c = vec2(pos.x / u_cssSize.x, 1.0 - pos.y / u_cssSize.y) * u_resolution;
  ivec2 last = ivec2(u_resolution) - 1;
  float off = 1.0e30;
  ivec2 at = ivec2(0);
  for (int dy = -${FORM_REACH}; dy <= ${FORM_REACH}; dy++) {
    for (int dx = -${FORM_REACH}; dx <= ${FORM_REACH}; dx++) {
      ivec2 p = clamp(ivec2(floor(c + vec2(float(dx), float(dy)) * u_pixelRatio)), ivec2(0), last);
      float d = abs(texelFetch(u_sceneDepth, p, 0).r - vzs);
      if (d < off) {
        off = d;
        at = p;
      }
    }
  }
  float tol = u_depthBias + sceneSlope(at) * ${FORM_REACH}.0 * u_pixelRatio;
  return 1.0 - sstep(tol, 2.0 * tol, off);
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
  int nB = int(clamp(c1.z + 0.5, 2.0, ${MAX_BRISTLES.toFixed(1)}));
  int role = int(c3.x + 0.5);

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
  vec3 wa = fetchTexel(id, WORLD + a).xyz;
  vec3 wb = fetchTexel(id, WORLD + a + 1).xyz;
  v_zs = dot(mix(wa, wb, f), u_viewDir) - u_eyeDot;
  v_world = c3.z;
  v_form = 1.0;
  if (u_depthTest && c3.z > 0.5 && role == ROLE_EDGE) {
    // an edge decal is on its form while the point of it nearest the viewer is: the decal is one mark, which may
    // cross an occlusion boundary (a pull from the figure into the table behind it) and then has parts on no surface
    int kn = 0;
    float zn = 1.0e30;
    for (int k = 0; k < PTS; k++) {
      float zk = dot(fetchTexel(id, WORLD + k).xyz, u_viewDir) - u_eyeDot;
      if (zk < zn) {
        zn = zk;
        kn = k;
      }
    }
    v_form = formVisible(pt[kn].xy, zn);
  }
  float s = mix(cum[a], cum[a + 1], f);
  float w = mix(pt[a].z, pt[a + 1].z, f);
  // the ends: the cap each end needs for ITS width
  if (j == 0) {
    float cap0 = ribbonCap(w, nB);
    pos -= tn * cap0;
    s -= cap0;
  }
  if (j == SEGS) {
    float cap1 = ribbonCap(w, nB);
    pos += tn * cap1;
    s += cap1;
  }

  float hw = max(w * 0.5, 0.6);
  float extent = hw * 1.3 + 1.2;
  vec2 css = pos + vec2(-tn.y, tn.x) * side * extent;
  v_geo = vec3(side * extent / hw, s, hw);
  v_colour = c0;
  v_p0 = c1;
  v_p1 = c2;
  v_p2 = vec4(c3.x, c3.y, len, ribbonCap(widthSum / float(PTS), nB));
  gl_Position = vec4(css.x / u_cssSize.x * 2.0 - 1.0, 1.0 - css.y / u_cssSize.y * 2.0, 0.0, 1.0);
}
`

export const STROKE_FRAGMENT = /* glsl */ `#version 300 es
// paint: stroke
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 v_geo;
in float v_zs;
flat in float v_form;
flat in float v_world;
flat in vec4 v_colour;
flat in vec4 v_p0;
flat in vec4 v_p1;
flat in vec4 v_p2;
uniform sampler2D u_prev;    // the layers beneath: premultiplied sRGB colour, coverage
uniform sampler2D u_paper;   // the canvas, sRGB RGBA8
uniform sampler2D u_paperH;  // the canvas height, normalised (std 0.2), R32F
uniform float u_texture;     // the canvas texture slider: the tooth the dry gate reads is the height times it over the default (0.5), up to twice
uniform ivec2 u_paperSize;
uniform float u_heightScale; // 1, or 0.5 when the height target is 8 bit
uniform vec4 u_roleA[8];     // opacity, thin, start boost, wet pickup at the start
uniform vec4 u_roleB[8];     // end position, end spread, crisp (1) or ragged (0), 0
uniform bool u_debugRoles;
uniform vec3 u_roleColour[8];
uniform bool u_hiddenPass;   // the hidden pass: only where a surface is nearer, dashed and faint (see above)
${COMMON_GLSL}
${DEPTH_TEST_GLSL}
layout(location = 0) out vec4 o_colour;
layout(location = 1) out vec4 o_height;

const int ROLE_GLAZE = 3;
const float START_RAMP = 0.026;

// The dash mask at arc length s (CSS px) along the stroke: 1 in a dash, 0 in a gap, ${DASH_EDGE} px wide at each end of a dash;
// a dash starts at the stroke's start and the pattern repeats (gl/depthTest.ts dashMask is the twin).
const float DASH_ON = ${DASH_ON.toFixed(1)};
const float DASH_OFF = ${DASH_OFF.toFixed(1)};
const float DASH_EDGE = ${DASH_EDGE.toFixed(1)};
float dashMask(float s) {
  float period = DASH_ON + DASH_OFF;
  float p = s - floor(s / period) * period;
  float d = p > DASH_ON + 0.5 * DASH_OFF ? p - period : p;
  return clamp((d + 0.5 * DASH_EDGE) / DASH_EDGE, 0.0, 1.0) * clamp((DASH_ON - d + 0.5 * DASH_EDGE) / DASH_EDGE, 0.0, 1.0);
}

// How much of the stroke is seen at this pixel under the scene's depth: 1 in front of or on the surface, 0 well
// behind it. The tolerance is the bias plus the surface's slope (sceneSlope, per backing px) across the stroke's half
// width in backing px (hw is CSS px), because the stroke's depth is its centreline's and its edges lie on a tilted
// surface at other depths. Every role is only hidden by
// a surface in front of it (a veil or a curve may hover over a surface). An edge stroke is a decal, the screen path of
// a contour lifted onto the surface it followed, each point at its own depth; whether it has LEFT its form is decided
// once per stroke, at its point nearest the viewer (v_form), and not here: half the fragments of a ribbon on a
// silhouette are on the background side of the outline, and that is not the decal leaving.
float depthVisible(ivec2 pix, float hw, int role) {
  // The hidden pass has nothing to draw where there is no depth to test against (or the stroke has no world path).
  if (u_hiddenPass && (!u_depthTest || v_world < 0.5)) return 0.0;
  if (!u_depthTest || v_world < 0.5) return 1.0;
  float zc = sceneDepthAt(pix);
  float tol = u_depthBias + sceneSlope(pix) * max(hw * u_pixelRatio, 1.5);
  float seen = 1.0 - sstep(tol, 2.0 * tol, v_zs - zc);
  // The hidden pass draws what the normal pass does not: where a surface is nearer (1 - seen), dashed by the stroke's
  // arc length (v_geo.y, CSS px), and faint (gl/depthTest.ts hiddenShare is the twin).
  if (u_hiddenPass) return (1.0 - seen) * dashMask(v_geo.y) * ${HIDDEN_ALPHA.toFixed(2)};
  return role == ROLE_EDGE ? seen * v_form : seen;
}

void main() {
  float load = v_p0.x;
  float kp = v_p0.y;
  int nB = int(clamp(v_p0.z + 0.5, 2.0, ${MAX_BRISTLES.toFixed(1)}));
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
    float a = 0.9 * m * depthVisible(ivec2(gl_FragCoord.xy), hw, role);
    if (a <= 0.01) discard;
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
  // How fast the deposit changes over a pixel, taken before any pixel of the quad is discarded: the
  // gate below is widened by half of it, so an edge is never sharper than one pixel.
  float aa = 0.5 * fwidth(bestDep);
  if (bestDep <= 0.0) discard;
  float dep = bestDep;

  // The canvas tooth decides what a dry brush catches.
  vec2 fc = gl_FragCoord.xy;
  ivec2 pix = ivec2(fc);
  ivec2 pc = paperCoord(fc, u_resolution, u_paperSize);
  float hg = texelFetch(u_paperH, pc, 0).r * clamp(u_texture / ${DRY_TEXTURE_REF.toFixed(1)}, 0.0, ${DRY_TEXTURE_SCALE_MAX.toFixed(1)});
  float tail = sstep(1.0 - clamp(dry, 0.1, 1.0), 1.0, t);
  float dryEff = dry * (0.5 + 0.5 * tail);
  float g0 = 0.08 + 0.12 * dryEff;
  float g1 = 0.26 + 0.22 * dryEff;
  float gate = dryEff > 0.0 ? sstep(g0 - aa, g1 + aa, dep + 0.45 * hg) : sstep(0.03 - aa, 0.12 + aa, dep);
  if (gate <= 0.001) discard;

  float opac = role == ROLE_GLAZE ? min(v_colour.a, ra.x) : v_colour.a * ra.x;
  float al = gate * min(opac, opac * (0.42 + 1.6 * dep)) * depthVisible(pix, hw, role);
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
