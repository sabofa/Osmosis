import { describe, expect, it } from 'vitest'
import { TOKENS, createResolver, isValidTokenValue, type ModeSeeds } from './index.js'
import { parseColour } from '../colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, type Dials, type Mode } from '../manifest.js'

const allDials = (v: number): Dials => Object.fromEntries(Object.keys(DEFAULT_DIALS).map((k) => {
  const d = (DEFAULT_DIALS as unknown as Record<string, unknown>)[k]
  return [k, typeof d === 'number' ? v : d]
})) as unknown as Dials

const dialSets: [string, Dials][] = [
  ['dials 0', allDials(0)],
  ['dials 1', allDials(1)],
  ['typeScale 1.125', { ...DEFAULT_DIALS, typeScale: 1.125 }],
  ['typeScale 1.333', { ...DEFAULT_DIALS, typeScale: 1.333 }],
  ['baseSize 13', { ...DEFAULT_DIALS, baseSize: 13 }],
  ['baseSize 18', { ...DEFAULT_DIALS, baseSize: 18 }],
]
const seedSets: [string, (m: Mode) => ModeSeeds][] = [
  ['defaults', (m) => ({ canvas: parseColour(DEFAULT_SEEDS[m].canvas), ink: parseColour(DEFAULT_SEEDS[m].ink), accent: parseColour(DEFAULT_SEEDS[m].accent) })],
  ['black', () => ({ canvas: parseColour('#000000'), ink: parseColour('#000000'), accent: parseColour('#000000') })],
  ['white', () => ({ canvas: parseColour('#ffffff'), ink: parseColour('#ffffff'), accent: parseColour('#ffffff') })],
  ['grey', () => ({ canvas: parseColour('#808080'), ink: parseColour('#808080'), accent: parseColour('#808080') })],
  ['green accent', (m) => ({ canvas: parseColour(DEFAULT_SEEDS[m].canvas), ink: parseColour(DEFAULT_SEEDS[m].ink), accent: parseColour('#00ff00') })],
]

describe('extreme inputs', () => {
  for (const [dn, dials] of dialSets) for (const mode of ['light', 'dark'] as Mode[]) for (const [sn, mk] of seedSets) {
    it(`${dn} ${mode} ${sn}`, () => {
      const r = createResolver({ mode, defs: TOKENS, seeds: mk(mode), dials, fonts: DEFAULT_FONTS })
      for (const d of TOKENS) {
        const v = r.get(d.name)
        expect(isValidTokenValue(d, v), `${d.name}=${v}`).toBe(true)
      }
    })
  }
})
