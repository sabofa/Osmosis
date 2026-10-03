import { describe, expect, it } from 'vitest'
import { createFakeGl } from '../../gl/fakeGl'
import type { BakedSurface } from '../bake/types'
import {
  bakedOrigin,
  colourData,
  COLOUR_STRIDE,
  facesBack,
  hasCoverage,
  recolourBaked,
  sideColour,
  surfaceProblem,
  uploadBaked,
} from './bakedSurfaces'
import { Resources } from './resources'
import { BAKED_FRAGMENT, BAKED_VERTEX, FACES_BACK_GLSL } from './shaders/bakedUnderpaint'

const GL_ARRAY_BUFFER = 0x8892
const GL_ELEMENT_ARRAY_BUFFER = 0x8893

// A unit square in the x-z plane at y = y0, two triangles, four vertices, normal (0, -1, 0) or `closed` with an outward one.
function square(options: { mark?: number; y?: number; closed?: boolean; alphaFront?: number[]; alphaBack?: number[] | null } = {}): BakedSurface {
  const y = options.y ?? 0
  const closed = options.closed ?? false
  const alphaFront = options.alphaFront ?? [1, 1, 1, 1]
  const alphaBack = closed ? null : options.alphaBack === undefined ? [0.5, 0.5, 0.5, 0.5] : options.alphaBack
  return {
    mark: options.mark ?? 0,
    positions: Float32Array.from([0, y, 0, 1, y, 0, 1, y, 1, 0, y, 1]),
    normals: Float32Array.from([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    closed,
    underFront: Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0, 0]),
    underBack: closed ? null : Float32Array.from([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0, 1]),
    alphaFront: Float32Array.from(alphaFront),
    alphaBack: alphaBack ? Float32Array.from(alphaBack) : null,
    uFront: new Float32Array(4),
    uBack: closed ? null : new Float32Array(4),
    famFront: new Uint8Array(4),
    famBack: closed ? null : new Uint8Array(4),
    local: new Float32Array(12),
  }
}

describe('facesBack: the side the viewer sees, from the sign of n . toEye', () => {
  const n = [0, 0, 1]

  it('is the front where the normal points toward the eye, and the back where it points away', () => {
    expect(facesBack(n, [0, 0, 1], false)).toBe(false)
    expect(facesBack(n, [0, 0, -1], false)).toBe(true)
    expect(facesBack(n, [0.6, 0, 0.8], false)).toBe(false)
    expect(facesBack(n, [0.6, 0, -0.8], false)).toBe(true)
  })

  it('counts a normal square to the view as the front', () => {
    expect(facesBack(n, [1, 0, 0], false)).toBe(false)
  })

  it('never shows the back of a closed surface', () => {
    expect(facesBack(n, [0, 0, -1], true)).toBe(false)
    expect(facesBack(n, [0, 0, 1], true)).toBe(false)
  })

  it('changes with the eye on a perspective view: one sheet, an eye at its height, the near part is seen from the front and the far part from behind', () => {
    // a horizontal sheet seen from an eye above it: every point sees the front; from below, every point sees the back
    const above = [0, 0, 5]
    const below = [0, 0, -5]
    for (const x of [-3, 0, 3]) {
      const p = [x, 0, 0]
      const toAbove = [above[0] - p[0], above[1] - p[1], above[2] - p[2]]
      const toBelow = [below[0] - p[0], below[1] - p[1], below[2] - p[2]]
      expect(facesBack(n, toAbove, false)).toBe(false)
      expect(facesBack(n, toBelow, false)).toBe(true)
    }
    // a tilted normal (-0.8, 0, 0.6) seen from an eye low beside it: from the +x side it points away, from the -x side toward
    const tilted = [-0.8, 0, 0.6]
    expect(facesBack(tilted, [10, 0, 0.1], false)).toBe(true)
    expect(facesBack(tilted, [-10, 0, 0.1], false)).toBe(false)
  })

  it('is the shader’s expression, which the fragment shader carries', () => {
    expect(FACES_BACK_GLSL).toContain('bool facesBack(vec3 n, vec3 toEye, bool closed)')
    expect(FACES_BACK_GLSL).toContain('return !closed && dot(n, toEye) < 0.0;')
    expect(BAKED_FRAGMENT).toContain(FACES_BACK_GLSL)
    // the fragment takes toEye per fragment for a perspective view, from the direction otherwise
    expect(BAKED_FRAGMENT).toContain('vec3 toEye = u_perspective ? normalize(u_relEye - v_pos) : -u_viewDir;')
    expect(BAKED_FRAGMENT).toContain('vec4 c = facesBack(v_normal, toEye, u_closed) ? v_back : v_front;')
  })
})

describe('sideColour: the colour and coverage of the side that is seen', () => {
  it('reads side +1 or side -1 of an open surface at the vertex', () => {
    const s = square()
    expect(sideColour(s, 1, false)).toEqual({ colour: [expect.closeTo(0.4), expect.closeTo(0.5), expect.closeTo(0.6)], alpha: 1 })
    const back = sideColour(s, 2, true)
    expect(back.colour.map((v) => +v.toFixed(3))).toEqual([0.3, 0.2, 0.1])
    expect(back.alpha).toBe(0.5)
  })

  it('has no back for a closed surface: the front, whatever side is asked for', () => {
    const s = square({ closed: true })
    expect(sideColour(s, 0, true)).toEqual(sideColour(s, 0, false))
  })
})

describe('what a surface needs to be drawn', () => {
  it('has coverage when any vertex of either side has some, and not otherwise (a veil, a lit bare table)', () => {
    expect(hasCoverage(square())).toBe(true)
    expect(hasCoverage(square({ alphaFront: [0, 0, 0, 0], alphaBack: [0, 0, 0.2, 0] }))).toBe(true)
    expect(hasCoverage(square({ alphaFront: [0, 0, 0.01, 0], alphaBack: [0, 0, 0, 0] }))).toBe(true)
    expect(hasCoverage(square({ alphaFront: [0, 0, 0, 0], alphaBack: [0, 0, 0, 0] }))).toBe(false)
    // a closed surface is seen from the front only: coverage on a back that does not exist is none
    expect(hasCoverage(square({ closed: true, alphaFront: [0, 0, 0, 0] }))).toBe(false)
  })

  it('names what is wrong with a surface whose arrays disagree, and nothing for a good one', () => {
    expect(surfaceProblem(square())).toBeNull()
    expect(surfaceProblem({ ...square(), normals: new Float32Array(9) })).toMatch(/normals/)
    expect(surfaceProblem({ ...square(), underFront: new Float32Array(9) })).toMatch(/front colours/)
    expect(surfaceProblem({ ...square(), alphaBack: new Float32Array(3) })).toMatch(/back coverage/)
    expect(surfaceProblem({ ...square(), indices: Uint32Array.from([0, 1, 9]) })).toMatch(/past its last vertex/)
    expect(surfaceProblem({ ...square(), indices: new Uint32Array(0) })).toMatch(/no triangle/)
  })

  it('interleaves the colour buffer: underFront, underBack, alphaFront, alphaBack per vertex (the front again for a surface with no back)', () => {
    const s = square({ alphaBack: [0.1, 0.2, 0.3, 0.4] })
    const data = colourData(s)
    expect(data.length).toBe(4 * COLOUR_STRIDE)
    expect(Array.from(data.subarray(0, 8)).map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3, 0.9, 0.8, 0.7, 1, 0.1])
    expect(Array.from(data.subarray(8, 16)).map((v) => +v.toFixed(3))).toEqual([0.4, 0.5, 0.6, 0.6, 0.5, 0.4, 1, 0.2])
    const closed = colourData(square({ closed: true }))
    expect(Array.from(closed.subarray(0, 8)).map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 1, 1])
  })

  it('takes a NaN colour or alpha for no underpainting there: colour 0 and coverage 0 on that side only (the image path’s NaN)', () => {
    const s = square({ alphaBack: [0.1, 0.2, 0.3, 0.4] })
    s.underFront[3 * 1 + 2] = Number.NaN
    s.alphaFront[2] = Number.NaN
    const data = colourData(s)
    expect(data.every((x) => Number.isFinite(x))).toBe(true)
    // vertex 1: the front is none, the back is kept
    expect(Array.from(data.subarray(8, 16)).map((v) => +v.toFixed(3))).toEqual([0, 0, 0, 0.6, 0.5, 0.4, 0, 0.2])
    // vertex 2: the front's alpha is NaN, so is the front
    expect(data[2 * COLOUR_STRIDE + 6]).toBe(0)
    expect(data[2 * COLOUR_STRIDE + 7]).toBeCloseTo(0.3, 6)
    // a surface whose only covered vertices have a NaN colour has no coverage
    const bad = square({ alphaFront: [0, 1, 0, 0], alphaBack: [0, 0, 0, 0] })
    bad.underFront[3] = Number.NaN
    expect(hasCoverage(bad)).toBe(false)
  })

  it('puts the origin at the middle of the surfaces’ bounding box, in 64 bits', () => {
    expect(bakedOrigin([])).toEqual([0, 0, 0])
    expect(bakedOrigin([square({ y: 4 }), square({ y: 8 })])).toEqual([0.5, 6, 0.5])
  })
})

describe('upload and recolour', () => {
  function upload(surfaces: (BakedSurface | null)[]) {
    const fake = createFakeGl()
    const res = new Resources(fake.gl)
    const result = uploadBaked(fake.gl, res, surfaces)
    return { fake, res, ...result }
  }

  it('uploads each surface once: positions, normals, the interleaved colours and the triangles, at their sizes', () => {
    const { fake, gpu } = upload([square({ y: 2 })])
    expect(gpu.surfaces.length).toBe(1)
    const arrays = fake.uploads.filter((u) => u.target === GL_ARRAY_BUFFER)
    // 4 vertices: 12 position floats, 12 normal floats, 32 colour floats
    expect(arrays.map((u) => u.data?.length)).toEqual([12, 12, 4 * COLOUR_STRIDE])
    const elements = fake.uploads.filter((u) => u.target === GL_ELEMENT_ARRAY_BUFFER)
    expect(elements.length).toBe(1)
    expect(elements[0].data).toBeInstanceOf(Uint32Array)
    expect(elements[0].data?.length).toBe(6)
    // positions are relative to the origin (the middle of the box: (0.5, 2, 0.5)), in 32 bits
    expect(Array.from(arrays[0].data as Float32Array).slice(0, 6)).toEqual([-0.5, 0, -0.5, 0.5, 0, -0.5])
    expect(gpu.origin).toEqual([0.5, 2, 0.5])
    expect(gpu.surfaces[0]).toMatchObject({ index: 0, mark: 0, count: 6, vertices: 4, closed: false, covered: true })
  })

  it('feeds the attributes: positions at 0, normals at 1, and the one colour buffer at 2, 3 and 4', () => {
    const { fake, gpu } = upload([square()])
    const vao = gpu.surfaces[0].vao as never
    const buffers = [0, 1, 2, 3, 4].map((location) => fake.attribBuffer(vao, location))
    expect(buffers.every(Boolean)).toBe(true)
    expect(buffers[2]).toBe(buffers[3])
    expect(buffers[3]).toBe(buffers[4])
    expect(buffers[0]).not.toBe(buffers[1])
    expect(buffers[0]).not.toBe(buffers[2])
    // the colour attributes are strided over the interleaved vertex: 3 + 3 + 2 floats
    const strides = fake.calls.filter((c) => c.fn === 'vertexAttribPointer' && (c.args[0] as number) >= 2).map((c) => [c.args[0], c.args[1], c.args[4], c.args[5]])
    expect(strides).toEqual([
      [2, 3, 32, 0],
      [3, 3, 32, 12],
      [4, 2, 32, 24],
    ])
  })

  it('leaves out a surface with no coverage (a veil), and a null, and says why it left out one it cannot draw', () => {
    const veil = square({ mark: 1, alphaFront: [0, 0, 0, 0], alphaBack: [0, 0, 0, 0] })
    const broken = { ...square({ mark: 2 }), normals: new Float32Array(3) }
    const { gpu, skipped, fake } = upload([null, square({ mark: 0 }), veil, broken])
    expect(gpu.surfaces.map((s) => s.index)).toEqual([1])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatch(/mark 2/)
    // nothing was made for the left-out ones: three buffers and an element buffer, one vertex array
    expect(fake.created.buffer).toBe(4)
    expect(fake.created.vertexArray).toBe(1)
  })

  it('writes only the colour buffer of each surface on a recolour: no other buffer, no new buffer, no vertex array', () => {
    const { fake, gpu } = upload([square({ mark: 0 }), square({ mark: 1, y: 3 })])
    const before = { uploads: fake.uploads.length, created: { ...fake.created } }
    const recoloured = [square({ mark: 0 }), square({ mark: 1, y: 3 })]
    recoloured[0].underFront.fill(0.25)
    recoloured[1].alphaBack = Float32Array.from([0.9, 0.8, 0.7, 0.6])
    expect(recolourBaked(fake.gl, gpu, recoloured)).toBe(true)
    // nothing was uploaded in full
    expect(fake.uploads.length).toBe(before.uploads)
    expect(fake.created).toEqual(before.created)
    const subs = fake.calls.map((c, i) => ({ c, i })).filter((e) => e.c.fn === 'bufferSubData')
    expect(subs.length).toBe(2)
    for (const [k, { c, i }] of subs.entries()) {
      // into this surface's colour buffer, from its start, 8 floats a vertex
      const bound = fake.calls
        .slice(0, i)
        .reverse()
        .find((e) => e.fn === 'bindBuffer' && e.args[0] === GL_ARRAY_BUFFER)
      expect(bound?.args[1]).toBe(gpu.surfaces[k].colours)
      expect(c.args[0]).toBe(GL_ARRAY_BUFFER)
      expect(c.args[1]).toBe(0)
      expect((c.args[2] as Float32Array).length).toBe(4 * COLOUR_STRIDE)
    }
    const first = subs[0].c.args[2] as Float32Array
    expect(first[0]).toBe(0.25)
    const second = subs[1].c.args[2] as Float32Array
    expect(Array.from(second.subarray(6, 8)).map((v) => +v.toFixed(3))).toEqual([1, 0.9])
  })

  it('does not recolour surfaces that are not the ones uploaded: another vertex count, or one that has coverage now and had none', () => {
    const veil = square({ mark: 1, alphaFront: [0, 0, 0, 0], alphaBack: [0, 0, 0, 0] })
    const { fake, gpu } = upload([square({ mark: 0 }), veil])
    fake.calls.length = 0
    // another vertex count
    const bigger: BakedSurface = { ...square({ mark: 0 }), positions: new Float32Array(15), normals: new Float32Array(15), underFront: new Float32Array(15), underBack: new Float32Array(15), alphaFront: new Float32Array(5), alphaBack: new Float32Array(5) }
    expect(recolourBaked(fake.gl, gpu, [bigger, veil])).toBe(false)
    // the veil has coverage now: it has no buffers to take it
    expect(recolourBaked(fake.gl, gpu, [square({ mark: 0 }), square({ mark: 1 })])).toBe(false)
    // a surface missing
    expect(recolourBaked(fake.gl, gpu, [null, veil])).toBe(false)
    expect(fake.calls.filter((c) => c.fn === 'bufferSubData')).toHaveLength(0)
  })

  it('takes a surface out of the draw when its coverage goes, and puts it back when it returns', () => {
    const { fake, gpu } = upload([square()])
    expect(recolourBaked(fake.gl, gpu, [square({ alphaFront: [0, 0, 0, 0], alphaBack: [0, 0, 0, 0] })])).toBe(true)
    expect(gpu.surfaces[0].covered).toBe(false)
    expect(recolourBaked(fake.gl, gpu, [square()])).toBe(true)
    expect(gpu.surfaces[0].covered).toBe(true)
  })

  it('frees everything it made with the resources', () => {
    const { fake, res } = upload([square(), square({ y: 1, closed: true })])
    expect(Object.values(fake.created).some((n) => n > 0)).toBe(true)
    res.disposeAll()
    expect(fake.deleted.buffer).toBe(fake.created.buffer)
    expect(fake.deleted.vertexArray).toBe(fake.created.vertexArray)
  })
})

describe('the baked surface shaders', () => {
  it('carry the per-vertex colour premultiplied, so a covered vertex’s colour is not darkened by an uncovered neighbour’s', () => {
    expect(BAKED_VERTEX).toContain('v_front = vec4(a_underFront * a_alpha.x, a_alpha.x);')
    expect(BAKED_VERTEX).toContain('v_back = vec4(a_underBack * a_alpha.y, a_alpha.y);')
    expect(BAKED_FRAGMENT).toContain('srgbEncode(c.rgb / c.a)')
  })

  it('hide what the scene’s depth says is behind a nearer surface, by the same bias the strokes use', () => {
    expect(BAKED_FRAGMENT).toContain('if (u_sceneTest && v_depth - texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r > u_depthBias) discard;')
    // the view depth of a vertex is the depth pass's: along the view direction from the eye
    expect(BAKED_VERTEX).toContain('v_depth = dot(a_position, u_viewDir) + u_depthBase;')
  })
})
