import { describe, expect, it } from 'vitest'
import { MAX_BRISTLES, PATH_POINTS } from '../types'
import { COPY_FRAGMENT, EDGE_FRAGMENT, EDGE_VERTEX, IMAGE_FRAGMENT } from './shaders/blit'
import { COMMON_GLSL, FULLSCREEN_VERTEX } from './shaders/common'
import { COMPOSITE_FRAGMENT } from './shaders/composite'
import { GBUFFER_VERTEX, gbufferFragment } from './shaders/gbuffer'
import { SHADOW_FRAGMENT, SHADOW_VERTEX } from './shaders/shadow'
import { RIBBON_SEGMENTS, RIBBON_SUBDIV, STROKE_FRAGMENT, STROKE_VERTEX, TEXELS_PER_STROKE, VERTICES_PER_STROKE } from './shaders/stroke'
import { UNDERPAINT_FRAGMENT } from './shaders/underpaint'

const ALL = {
  fullscreen: FULLSCREEN_VERTEX,
  common: COMMON_GLSL,
  shadowV: SHADOW_VERTEX,
  shadowF: SHADOW_FRAGMENT,
  gbufferV: GBUFFER_VERTEX,
  gbufferFloat: gbufferFragment(true),
  gbufferRgba8: gbufferFragment(false),
  strokeV: STROKE_VERTEX,
  strokeF: STROKE_FRAGMENT,
  compositeF: COMPOSITE_FRAGMENT,
  underpaintF: UNDERPAINT_FRAGMENT,
  copy: COPY_FRAGMENT,
  image: IMAGE_FRAGMENT,
  edgeV: EDGE_VERTEX,
  edgeF: EDGE_FRAGMENT,
}

describe('every shader', () => {
  it('is GLSL ES 3.00 and names its pass', () => {
    for (const [name, src] of Object.entries(ALL)) {
      if (name === 'common') continue
      expect(src.startsWith('#version 300 es'), name).toBe(true)
      expect(src, name).toMatch(/\/\/ paint: /)
    }
  })

  it('reads no clock, frame counter or random source: the same strokes always draw the same bristles', () => {
    for (const [name, src] of Object.entries(ALL)) {
      expect(src, name).not.toMatch(/u_time|u_frame|u_clock|iTime|Date|Math\.random|\brand\s*\(/i)
    }
    // The only randomness is an integer hash of the stroke's seed.
    expect(STROKE_FRAGMENT).toContain('rnd4(seed')
    expect(COMMON_GLSL).toContain('uint hashU(uint x)')
  })
})

describe('the stroke shaders (R3)', () => {
  it('tessellate PATH_POINTS - 1 segments, each split RIBBON_SUBDIV times', () => {
    expect(PATH_POINTS).toBe(8)
    expect(RIBBON_SEGMENTS).toBe((PATH_POINTS - 1) * RIBBON_SUBDIV)
    expect(VERTICES_PER_STROKE).toBe(2 * (RIBBON_SEGMENTS + 1))
    expect(TEXELS_PER_STROKE).toBe(PATH_POINTS + 4)
    expect(STROKE_VERTEX).toContain(`const int PTS = ${PATH_POINTS};`)
    expect(STROKE_VERTEX).toContain(`const int SUB = ${RIBBON_SUBDIV};`)
  })

  it('read as many bristles as a stroke can have (MAX_BRISTLES, which the model clamps to)', () => {
    expect(MAX_BRISTLES).toBe(48)
    expect(STROKE_FRAGMENT).toContain('int nB = int(clamp(v_p0.z + 0.5, 2.0, 48.0));')
  })

  it('draw a Catmull-Rom ribbon through the path points with a round cap at each end', () => {
    expect(STROKE_VERTEX).toContain('2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3')
    expect(STROKE_VERTEX).toContain('pos -= tn * cap')
    expect(STROKE_VERTEX).toContain('pos += tn * cap')
  })

  it('gate a dry tail by the canvas height texture, so paint skips the weave valleys', () => {
    expect(STROKE_FRAGMENT).toContain('texelFetch(u_paperH')
    expect(STROKE_FRAGMENT).toContain('dep + 0.45 * hg')
    expect(STROKE_FRAGMENT).toContain('sstep(g0, g1,')
  })

  it('load the start, thin the body and dissolve the end (endSoft pulls the end in to 0.6)', () => {
    expect(STROKE_FRAGMENT).toContain('exp(-(tl / 0.06) * (tl / 0.06))')
    expect(STROKE_FRAGMENT).toContain('sstep(0.2, 1.0, tl)')
    expect(STROKE_FRAGMENT).toContain('mix(rb.x, 0.6, endSoft)')
  })

  it('give each bristle its own seeded load, with clumping, and the heaviest bristle wins', () => {
    expect(STROKE_FRAGMENT).toContain('float bl = load * (1.0 - vari * (1.0 - f0))')
    expect(STROKE_FRAGMENT).toContain('if (dep > bestDep)')
    expect(STROKE_FRAGMENT).toContain('float dep = load0 * w * w;')
  })

  it('pick up wet paint from the layers beneath, most at the start, and from the canvas where nothing is painted', () => {
    expect(STROKE_FRAGMENT).toContain('texelFetch(u_prev')
    expect(STROKE_FRAGMENT).toContain('prev.rgb + paper * (1.0 - prev.a)')
    expect(STROKE_FRAGMENT).toContain('mix(v_colour.rgb * bestJit, under, wetv)')
    expect(STROKE_FRAGMENT).toContain('1.0 - sstep(0.0, 0.3, t)')
  })

  it('accumulate premultiplied colour with coverage, and paint height with a half-coverage alpha', () => {
    expect(STROKE_FRAGMENT).toContain('o_colour = vec4(col * al, al);')
    expect(STROKE_FRAGMENT).toContain('o_height = vec4(al * dep * kp * u_heightScale, 0.0, 0.0, 0.5 * al);')
  })

  it('keep a data line exact: the crisp brush has no jitter, no ragged ends and no wander', () => {
    expect(STROKE_FRAGMENT).toContain('bool crisp = rb.z > 0.5;')
    expect(STROKE_FRAGMENT).toContain('(crisp ? 0.0 : (r1.x - 0.5) * 0.5 * spacingN)')
    expect(STROKE_FRAGMENT).toContain('float wob = crisp ? 0.0')
    expect(STROKE_FRAGMENT).toContain('float ts = crisp ? 0.0')
  })

  it('treat a glaze alpha as the absolute opacity, capped at the glaze base', () => {
    expect(STROKE_FRAGMENT).toContain('role == ROLE_GLAZE ? min(v_colour.a, ra.x) : v_colour.a * ra.x')
  })

  it('have a flat role view that skips the brush', () => {
    expect(STROKE_FRAGMENT).toContain('if (u_debugRoles)')
    expect(STROKE_FRAGMENT).toContain('u_roleColour[role]')
  })
})

describe('the G-buffer shader (R1)', () => {
  const f = ALL.gbufferFloat
  const b = ALL.gbufferRgba8

  it('computes the raw lit value: key Lambert x intensity x shadow + ambient + sky max(n.z, 0) + bounce max(-n.z, 0), clamped', () => {
    for (const src of [f, b]) {
      expect(src).toContain('float key = max(nl, 0.0) * u_intensity * visible;')
      expect(src).toContain('clamp(key + u_ambient + u_sky * max(n.z, 0.0) + u_bounce * max(-n.z, 0.0), 0.0, 1.0)')
    }
  })

  it('flags the shadow where the light does not reach: cast, or facing away', () => {
    expect(f).toContain('(nl <= 0.0 || visible < 0.5) ? 1.0 : 0.0')
  })

  it('samples the shadow map with a 3 x 3 PCF and a slope-scaled bias', () => {
    expect(f).toContain('for (int j = -1; j <= 1; j++)')
    expect(f).toContain('for (int i = -1; i <= 1; i++)')
    expect(f).toContain('float bias = u_shadowTexel * (1.2 + 1.6 * slope);')
    expect(f).toContain('return visible / 9.0;')
  })

  it('turns the normal to face the viewer and falls back to the face normal where undefined', () => {
    expect(f).toContain('if (dot(n, toEye) < 0.0) n = -n;')
    expect(f).toContain('len < 1e-4 ? normalize(faceNormal)')
  })

  it('writes the view depth along the view direction', () => {
    expect(f).toContain('float depth = dot(v_pos, u_viewDir) + u_depthBase;')
  })

  it('has a float layout of one RGBA32F target and an rgba8 layout of three', () => {
    expect(f).toContain('#define GBUFFER_FLOAT')
    // The float branch writes one target; the rgba8 branch three.
    expect(f).toContain('layout(location = 0) out vec4 o_a;')
    expect(f).not.toContain('o_b')
    expect(b).not.toMatch(/^#define GBUFFER_FLOAT/m)
    for (const out of ['o_n', 'o_d', 'o_v']) expect(b).toContain(`out vec4 ${out};`)
    expect(f).toContain('((uint(u_mark) + 1u) * 2u + uint(shadow)) * 1024u + uint(value * 1023.0 + 0.5)')
    expect(b).toContain('uint m16 = uint(u_mark) + 1u;')
  })
})

describe('the shadow shader (R2)', () => {
  it('is depth only, from the light matrix', () => {
    expect(SHADOW_VERTEX).toContain('u_lightViewProj * vec4(a_position, 1.0)')
    expect(SHADOW_FRAGMENT).not.toMatch(/out\s+vec4/)
  })
})

describe('the composite shader (R4)', () => {
  const c = COMPOSITE_FRAGMENT

  it('lays the paint over the canvas by coverage: paint + canvas (1 - coverage)', () => {
    expect(c).toContain('paint.rgb + paper * (1.0 - paint.a)')
  })

  it('lights the gradient of paint height x impasto plus the weave where paint is thin', () => {
    expect(c).toContain('return pt * u_impasto + weave;')
    expect(c).toContain('exp(-2.4 * pt) * u_texture')
    expect(c).toContain('tanh(f0 * 1.4)')
    expect(c).toContain('u_pixelRatio')
  })

  it('has a grey view (OKLab lightness) and a flat-tone view without the canvas', () => {
    expect(c).toContain('if (u_grey)')
    expect(c).toContain('oklabL(srgbDecode(col))')
    expect(c).toContain('u_noCanvas ? u_flatTone')
  })
})
