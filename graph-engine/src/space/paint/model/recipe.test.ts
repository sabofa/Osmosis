import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { makeCurve } from './curve'
import { colourOfRecipe, newRecipe, type RecipeEnv } from './recipe'

const P = DEFAULT_PAINT_PARAMS
const curve = makeCurve(P)
const env: RecipeEnv = { curve, ground: [0.8, 0, 0], devL: 0, devC: 0, devH: 0 }

const recipe = (extra: Partial<ReturnType<typeof newRecipe>> = {}) => ({ ...newRecipe(), lx: 0.6, ly: 0.08, lz: 0.05, u: 0.55, nz: 0.4, ...extra })

describe('a colour recipe', () => {
  it('takes the hue and chroma step of its plane from the curve, for the plane\'s mean normal', () => {
    const n: [number, number, number] = [0.6, -0.48, 0.64]
    const step = curve.planeStep(...n)
    // the step is real here (a plane turned from the light and the sky does not step by nothing)
    expect(Math.abs(step[0]) + Math.abs(step[1])).toBeGreaterThan(1e-3)
    const withPlane = colourOfRecipe(recipe({ hasPlane: true, pnx: n[0], pny: n[1], pnz: n[2] }), env)
    const byHand = curve.lab({ local: [0.6, 0.08, 0.05], u: 0.55, nz: 0.4, planeHue: step[0], planeChroma: step[1], j: [0, 0, 0] })
    expect(withPlane).toEqual(byHand)
    // and a recipe with no plane takes no step
    const without = colourOfRecipe(recipe(), env)
    expect(without).toEqual(curve.lab({ local: [0.6, 0.08, 0.05], u: 0.55, nz: 0.4, planeHue: 0, planeChroma: 0, j: [0, 0, 0] }))
    expect(withPlane).not.toEqual(without)
  })

  it('turns with the plane: two planes with different mean normals give different colours', () => {
    const a = colourOfRecipe(recipe({ hasPlane: true, pnx: 0.6, pny: -0.48, pnz: 0.64 }), env)
    const b = colourOfRecipe(recipe({ hasPlane: true, pnx: -0.7, pny: 0.2, pnz: 0.68 }), env)
    expect(a).not.toEqual(b)
  })
})
