import { describe, expect, it } from 'vitest'
import {
  LAYER_TOKENS, assertNoCycles, clampTokenValue, dialDefault, effectiveFloor, formatAlpha, resolveLayerAlphas,
  type LayerTokenDef,
} from './layerTokens.js'
import * as barrel from './index.js'

describe('LAYER_TOKENS table', () => {
  it('has the seven tokens with sane numbers', () => {
    expect(LAYER_TOKENS.map((t) => t.token)).toEqual([
      'doc-sheet-alpha', 'doc-surface-alpha', 'doc-media-alpha',
      'graph-paper-alpha', 'graph-grid-alpha', 'graph-region-alpha', 'callout-alpha',
    ])
    const names = new Set(LAYER_TOKENS.map((t) => t.token))
    for (const t of LAYER_TOKENS) {
      expect(t.floor, t.token).toBeLessThanOrEqual(t.default)
      expect(t.default, t.token).toBeLessThanOrEqual(1)
      if (t.atLeast) expect(names.has(t.atLeast), t.token).toBe(true)
    }
    expect(LAYER_TOKENS.find((t) => t.token === 'graph-region-alpha')!.dialDriven).toBe(false)
  })
})

describe('effectiveFloor', () => {
  it('base, board, override, unknown paper, unknown token', () => {
    expect(effectiveFloor('graph-paper-alpha')).toBe(0.25)
    expect(effectiveFloor('graph-paper-alpha', { paper: 'blackboard' })).toBe(0.85)
    expect(effectiveFloor('graph-paper-alpha', { minOverride: 0.9 })).toBe(0.9)
    expect(effectiveFloor('graph-paper-alpha', { minOverride: 0.1 })).toBe(0.25)
    expect(effectiveFloor('graph-paper-alpha', { paper: 'parchment' })).toBe(0.25)
    expect(effectiveFloor('callout-alpha', { minOverride: 5 })).toBe(1)
    expect(() => effectiveFloor('nope')).toThrow()
  })
})

describe('clampTokenValue', () => {
  it('clamps and falls back', () => {
    expect(clampTokenValue('callout-alpha', 0.1)).toBe(0.7)
    expect(clampTokenValue('callout-alpha', 3)).toBe(1)
    expect(clampTokenValue('graph-paper-alpha', '0.4')).toBe(0.4)
    expect(clampTokenValue('callout-alpha', Number.NaN)).toBe(0.92)
    expect(clampTokenValue('callout-alpha', 'abc')).toBe(0.92)
    expect(clampTokenValue('graph-paper-alpha', 0.5, { paper: 'whiteboard' })).toBe(0.85)
  })
})

describe('formatAlpha', () => {
  it('formats', () => {
    expect(formatAlpha(1)).toBe('1')
    expect(formatAlpha(0.92)).toBe('0.92')
    expect(formatAlpha(0.5)).toBe('0.5')
    expect(formatAlpha(0.125)).toBe('0.125')
    expect(formatAlpha(0.3333)).toBe('0.333')
  })
})

describe('dialDefault', () => {
  it('lerps default to floor', () => {
    expect(dialDefault('doc-sheet-alpha', 0)).toBe(1)
    expect(dialDefault('doc-sheet-alpha', 1)).toBe(0.55)
    expect(dialDefault('doc-sheet-alpha', 0.5)).toBe(0.775)
    expect(dialDefault('graph-region-alpha', 1)).toBe(0.18)
    expect(dialDefault('callout-alpha', 7)).toBe(0.7)
    expect(dialDefault('callout-alpha', -3)).toBe(0.92)
  })
})

describe('resolveLayerAlphas', () => {
  it('defaults when empty', () => {
    const r = resolveLayerAlphas({})
    // media's own default is 0.95, but it is never less opaque than the sheet (default 1)
    for (const t of LAYER_TOKENS) expect(r[t.token], t.token).toBe(t.token === 'doc-media-alpha' ? 1 : t.default)
  })
  it('media stays at least as opaque as the sheet', () => {
    expect(resolveLayerAlphas({ 'doc-sheet-alpha': 0.6, 'doc-media-alpha': 0.65 })['doc-media-alpha']).toBe(0.7)
    expect(resolveLayerAlphas({ 'doc-sheet-alpha': 0.8, 'doc-media-alpha': 0.75 })['doc-media-alpha']).toBe(0.8)
    expect(resolveLayerAlphas({ 'doc-sheet-alpha': 1, 'doc-media-alpha': 0.7 })['doc-media-alpha']).toBe(1)
  })
  it('device override of the sheet raises media from 0.7 to 0.9', () => {
    const theme = { 'doc-sheet-alpha': 0.6, 'doc-media-alpha': 0.7 }
    expect(resolveLayerAlphas(theme)['doc-media-alpha']).toBe(0.7)
    expect(resolveLayerAlphas(theme, { 'doc-sheet-alpha': 0.9 })['doc-media-alpha']).toBe(0.9)
  })
  it('device wins over theme; paper raises; out of range clamped', () => {
    expect(resolveLayerAlphas({ 'callout-alpha': 0.8 }, { 'callout-alpha': 0.75 })['callout-alpha']).toBe(0.75)
    expect(resolveLayerAlphas({ 'graph-paper-alpha': 0.3 }, {}, { paper: 'blackboard' })['graph-paper-alpha']).toBe(0.85)
    const r = resolveLayerAlphas({ 'callout-alpha': 0.1, 'graph-grid-alpha': 4 })
    expect(r['callout-alpha']).toBe(0.7)
    expect(r['graph-grid-alpha']).toBe(1)
  })
})

describe('assertNoCycles', () => {
  const mk = (token: string, atLeast: string): LayerTokenDef =>
    ({ token, label: token, default: 1, floor: 0.5, atLeast, dialDriven: false })
  it('throws on a cycle and passes for LAYER_TOKENS', () => {
    expect(() => assertNoCycles([mk('a', 'b'), mk('b', 'a')])).toThrow('layer token cycle: a -> b -> a')
    expect(() => assertNoCycles(LAYER_TOKENS)).not.toThrow()
  })
})

describe('barrel', () => {
  it('exports the helpers', () => {
    expect(barrel.LAYER_TOKENS).toBe(LAYER_TOKENS)
    expect(barrel.resolveLayerAlphas).toBe(resolveLayerAlphas)
    expect(barrel.effectiveFloor).toBe(effectiveFloor)
  })
})
