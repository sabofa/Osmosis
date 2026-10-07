import { describe, expect, it, vi } from 'vitest'
import { randomFor } from '../../../style/random'
import { chainSegments, familyField, marchTriangles, type Chain } from './edges'
import { bake, bakeFigure, PX, P, torusMesh, type Baked } from './edgesFixture'
import { sceneOf, tableMesh } from '../model/testing'
import { worldLight } from '../model/valueFinalFixture'
import { FAM_LIGHT } from '../model/value'

// A plan over a refined surface is heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 180_000 })

// The planes of two families that share triangle edges, with the length of the border they share (px at the reference scale), per mesh and side.
interface Pair {
  mark: number
  side: number
  a: number
  b: number
  px: number
}
function crossFamilyPairs(b: Baked, perPx: number): Pair[] {
  const out = new Map<string, Pair>()
  b.plan.surfaces.forEach((s, m) => {
    if (!s || b.plan.ground[m] === 1 || b.plan.veil[m] === 1) return
    for (let k = 0; k < 2; k++) {
      const pl = b.planes.planeOf[m][k]
      if (!pl) continue
      for (let t = 0; t < pl.length; t++) {
        for (let e = 0; e < 3; e++) {
          const u = s.adj[3 * t + e]
          if (u <= t || pl[t] === pl[u] || b.planes.planes[pl[t]].fam === b.planes.planes[pl[u]].fam) continue
          const v0 = s.indices[3 * t + e]
          const v1 = s.indices[3 * t + ((e + 1) % 3)]
          const len = Math.hypot(s.positions[3 * v0] - s.positions[3 * v1], s.positions[3 * v0 + 1] - s.positions[3 * v1 + 1], s.positions[3 * v0 + 2] - s.positions[3 * v1 + 2]) / perPx
          const key = `${m},${k},${Math.min(pl[t], pl[u])},${Math.max(pl[t], pl[u])}`
          const p = out.get(key) ?? { mark: m, side: k, a: Math.min(pl[t], pl[u]), b: Math.max(pl[t], pl[u]), px: 0 }
          p.px += len
          out.set(key, p)
        }
      }
    }
  })
  return [...out.values()]
}

describe('a family boundary is an edge: every cross-family plane pair that shares a border has a hardness', () => {
  // the sphere under the lab's light, a torus (a hole to shadow itself with) and the lab's saddle, whose cast shadow starts on the lit side of its terminator
  const figures = ['sphere', 'torus', 'saddle', 'tangent-plane']
  for (const id of figures) {
    it(`${id}: every pair of planes of two families that share a border of 16 px or more has adjHard > 0, and the field of the plan's own family weight agrees with the planes' families`, () => {
      const b = bakeFigure(id)
      const pairs = crossFamilyPairs(b, b.perPx).filter((p) => p.px >= 16)
      expect(pairs.length).toBeGreaterThan(id === 'tangent-plane' ? 2 : 3)
      for (const p of pairs) expect(b.edges.adjHard(p.a, p.b), `${id}: planes ${p.a} and ${p.b} of mark ${p.mark} side ${p.side} share ${p.px.toFixed(0)} px`).toBeGreaterThan(0)
      // the field's 0.5 iso is the plan's own family boundary wherever the shadow flag is settled (vis 0 or 1: the vertex is clearly lit or clearly shadowed)
      let settled = 0
      b.plan.surfaces.forEach((s, m) => {
        if (!s || b.plan.ground[m] === 1 || b.plan.veil[m] === 1) return
        ;[b.plan.front[m], b.plan.back[m]].forEach((sp) => {
          if (!sp) return
          const { lw } = familyField(s, sp, Math.max(1e-4, P.value.terminatorSoftness))
          for (let v = 0; v < lw.length; v++) {
            if ((sp.vis[v] !== 0 && sp.vis[v] !== 1) || Math.abs(lw[v] - 0.5) < 1e-6) continue
            settled++
            expect(lw[v] > 0.5, `${id} vertex ${v}: lw ${lw[v]}`).toBe(sp.fam[v] === FAM_LIGHT)
          }
        })
      })
      expect(settled).toBeGreaterThan(1000)
    })
  }

  it('is a torus too: the cross-family pairs of a closed torus with a table to cast on', () => {
    const torus = bake(sceneOf([torusMesh(1, 0.4, 40, 20), tableMesh({ z: -0.8, half: 3, index: 1 })]), worldLight(-35, 39))
    const pairs = crossFamilyPairs(torus, PX).filter((p) => p.px >= 16)
    expect(pairs.length).toBeGreaterThan(1)
    for (const p of pairs) expect(torus.edges.adjHard(p.a, p.b), `planes ${p.a} and ${p.b} share ${p.px.toFixed(0)} px`).toBeGreaterThan(0)
  })
})

// The chain builder as it was (an unshift per node on the back half): the new one must give the same chains, node for node.
function referenceChains(nNodes: number, sa: ArrayLike<number>, sb: ArrayLike<number>): Chain[] {
  const nSeg = sa.length
  const start = new Int32Array(nNodes + 1)
  for (let j = 0; j < nSeg; j++) {
    start[sa[j] + 1]++
    start[sb[j] + 1]++
  }
  for (let i = 0; i < nNodes; i++) start[i + 1] += start[i]
  const fill = start.slice(0, nNodes)
  const inc = new Int32Array(2 * nSeg)
  for (let j = 0; j < nSeg; j++) {
    inc[fill[sa[j]]++] = j
    inc[fill[sb[j]]++] = j
  }
  const used = new Uint8Array(nSeg)
  const ptr = start.slice(0, nNodes)
  const nextUnused = (node: number): number => {
    while (ptr[node] < start[node + 1]) {
      const j = inc[ptr[node]]
      if (!used[j]) return j
      ptr[node]++
    }
    return -1
  }
  const chains: Chain[] = []
  for (let j0 = 0; j0 < nSeg; j0++) {
    if (used[j0]) continue
    used[j0] = 1
    const nodes = [sa[j0], sb[j0]]
    const segs = [j0]
    for (;;) {
      const end = nodes[nodes.length - 1]
      const j = nextUnused(end)
      if (j < 0) break
      used[j] = 1
      nodes.push(sa[j] === end ? sb[j] : sa[j])
      segs.push(j)
    }
    for (;;) {
      const end = nodes[0]
      const j = nextUnused(end)
      if (j < 0) break
      used[j] = 1
      nodes.unshift(sa[j] === end ? sb[j] : sa[j])
      segs.unshift(j)
    }
    const closed = nodes.length > 2 && nodes[0] === nodes[nodes.length - 1]
    if (closed) nodes.pop()
    chains.push({ nodes, segs, closed })
  }
  return chains
}

describe('chainSegments builds the back half without an unshift and gives the same chains', () => {
  it('on random soups of segments (loops, pinches, a segment from a node to itself, open chains), node for node and segment for segment', () => {
    const r = randomFor('paint/bake/chain-soup', 1)
    const rng = () => r.next()
    let open = 0
    let closed = 0
    for (let round = 0; round < 300; round++) {
      const nNodes = 3 + Math.floor(rng() * 40)
      const nSeg = Math.floor(rng() * 70)
      const sa: number[] = []
      const sb: number[] = []
      for (let j = 0; j < nSeg; j++) {
        sa.push(Math.floor(rng() * nNodes))
        sb.push(Math.floor(rng() * nNodes))
      }
      const got = chainSegments(nNodes, sa, sb)
      const want = referenceChains(nNodes, sa, sb)
      expect(got, `round ${round}`).toEqual(want)
      for (const c of got) {
        if (c.closed) closed++
        else open++
      }
    }
    expect(open).toBeGreaterThan(200)
    expect(closed).toBeGreaterThan(20)
  })

  it('on the iso lines of the showcase scenes: every side of every figure, node for node, closed and open chains both there', () => {
    let chains = 0
    let closed = 0
    let open = 0
    for (const id of ['sphere', 'torus', 'saddle', 'tangent-plane']) {
      const b = bakeFigure(id)
      b.plan.surfaces.forEach((s, m) => {
        if (!s || b.plan.ground[m] === 1 || b.plan.veil[m] === 1) return
        ;[b.plan.front[m], b.plan.back[m]].forEach((sp) => {
          if (!sp) return
          const f = familyField(s, sp, Math.max(1e-4, P.value.terminatorSoftness))
          const iso = marchTriangles(s, f.lw, 0.5, f.turn, f.vote)
          const want = referenceChains(iso.nNodes, iso.sa, iso.sb)
          expect(iso.chains, `${id} mark ${m}`).toEqual(want)
          for (const c of iso.chains) {
            chains++
            if (c.closed) closed++
            else open++
          }
        })
      })
    }
    expect(chains).toBeGreaterThan(5)
    expect(closed).toBeGreaterThan(0)
    expect(open).toBeGreaterThan(0)
  })
})
