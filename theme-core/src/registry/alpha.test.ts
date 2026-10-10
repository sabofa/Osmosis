import { describe, expect, it } from 'vitest'
import { ALPHA_TOKENS } from './alpha.js'
import { TOKENS, tokenByName, ResolveError } from './index.js'
import { LAYER_TOKENS, dialDefault, formatAlpha } from '../layerTokens.js'
import { builtinById } from '../builtins/index.js'
import { normalise } from '../manifest.js'
import { resolve } from '../resolve.js'
import { compose, ownerOf } from '../layers.js'

const SIX = ['doc-sheet-alpha', 'doc-surface-alpha', 'doc-media-alpha', 'graph-paper-alpha', 'graph-grid-alpha', 'callout-alpha']
const mk = (dials: Record<string, number> = {}, any: Record<string, string> = {}) =>
  resolve(normalise({ id: 't', name: 'T', dials, overrides: { any } }))

/** Resolved values of representative pre-existing tokens, captured from main (the alpha work must not move them). */
const PRE_EXISTING: Record<string, Record<'light' | 'dark', Record<string, string>>> = {
  "osmosis": {
    "light": {
      "color-canvas": "#eef1e5",
      "color-surface": "#ffffff",
      "color-text": "#17170f",
      "color-text-muted": "#6b6b5f",
      "color-border": "#e4e2d4",
      "color-border-strong": "#c9c6b3",
      "color-accent": "#c65d22",
      "color-accent-wash": "#faf1e9",
      "color-good": "#4c7a4a",
      "color-bad": "#a34b3f",
      "color-heat-0": "#e4e2d4",
      "color-heat-1": "#e9c9a6",
      "color-heat-2": "#e3a468",
      "color-heat-3": "#d97a35",
      "color-heat-4": "#c65d22",
      "radius-md": "12px",
      "shadow-1": "0 1px 5px #17170f2e, 0 0.5px 2.5px #17170f17",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#ffffff",
      "graph-grid": "#e4e2d4",
      "graph-region-alpha": "0.18",
      "doc-page": "#ffffff",
      "panel-bg": "#ffffff",
      "button-primary-bg": "#c65d22"
    },
    "dark": {
      "color-canvas": "#17160f",
      "color-surface": "#201e15",
      "color-text": "#f2efe2",
      "color-text-muted": "#a19d8c",
      "color-border": "#34311e",
      "color-border-strong": "#4a4530",
      "color-accent": "#e2803f",
      "color-accent-wash": "#2c2113",
      "color-good": "#6fa06c",
      "color-bad": "#c76a5c",
      "color-heat-0": "#2a2819",
      "color-heat-1": "#4a3a20",
      "color-heat-2": "#7a4e24",
      "color-heat-3": "#a85f2a",
      "color-heat-4": "#e2803f",
      "radius-md": "12px",
      "shadow-1": "0 1px 5px #f2efe280, 0 0.5px 2.5px #f2efe240",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#201e15",
      "graph-grid": "#34311e",
      "graph-region-alpha": "0.18",
      "doc-page": "#201e15",
      "panel-bg": "#201e15",
      "button-primary-bg": "#e2803f"
    }
  },
  "forest": {
    "light": {
      "color-canvas": "#ecf0e6",
      "color-surface": "#fbfcf8",
      "color-text": "#141a13",
      "color-text-muted": "#5d6b5c",
      "color-border": "#d8e0d2",
      "color-border-strong": "#b8c6b0",
      "color-accent": "#2f7a4f",
      "color-accent-wash": "#e8f3ea",
      "color-good": "#2f7a4f",
      "color-bad": "#a6553c",
      "color-heat-0": "#d8e0d2",
      "color-heat-1": "#b3d3b8",
      "color-heat-2": "#86bc93",
      "color-heat-3": "#57a06d",
      "color-heat-4": "#2f7a4f",
      "radius-md": "12px",
      "shadow-1": "0 1px 5px #141a132e, 0 0.5px 2.5px #141a1317",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#fbfcf8",
      "graph-grid": "#d8e0d2",
      "graph-region-alpha": "0.18",
      "doc-page": "#fbfcf8",
      "panel-bg": "#fbfcf8",
      "button-primary-bg": "#2f7a4f"
    },
    "dark": {
      "color-canvas": "#0f1511",
      "color-surface": "#161f18",
      "color-text": "#e6efe6",
      "color-text-muted": "#92a394",
      "color-border": "#25332a",
      "color-border-strong": "#36473c",
      "color-accent": "#6fbf8a",
      "color-accent-wash": "#16261b",
      "color-good": "#2f7a4f",
      "color-bad": "#a6553c",
      "color-heat-0": "#d8e0d2",
      "color-heat-1": "#b3d3b8",
      "color-heat-2": "#86bc93",
      "color-heat-3": "#57a06d",
      "color-heat-4": "#2f7a4f",
      "radius-md": "12px",
      "shadow-1": "0 1px 5px #e6efe680, 0 0.5px 2.5px #e6efe640",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#161f18",
      "graph-grid": "#25332a",
      "graph-region-alpha": "0.18",
      "doc-page": "#161f18",
      "panel-bg": "#161f18",
      "button-primary-bg": "#6fbf8a"
    }
  },
  "ocean": {
    "light": {
      "color-canvas": "#e9f1f4",
      "color-surface": "#fafdfe",
      "color-text": "#10202a",
      "color-text-muted": "#69747c",
      "color-border": "#c7d0d5",
      "color-border-strong": "#aab5ba",
      "color-accent": "#1f7a8c",
      "color-accent-wash": "#d6e5e9",
      "color-good": "#3b7e50",
      "color-bad": "#9f535e",
      "color-heat-0": "#c7d0d5",
      "color-heat-1": "#a1bac3",
      "color-heat-2": "#7ba5b0",
      "color-heat-3": "#528f9e",
      "color-heat-4": "#1f7a8c",
      "radius-md": "14.5px",
      "shadow-1": "0 1px 5px #10202a26, 0 0.5px 2.5px #10202a13",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#fafdfe",
      "graph-grid": "#c7d0d5",
      "graph-region-alpha": "0.18",
      "doc-page": "#fafdfe",
      "panel-bg": "#fafdfe",
      "button-primary-bg": "#1f7a8c"
    },
    "dark": {
      "color-canvas": "#0a1419",
      "color-surface": "#10202a",
      "color-text": "#e2eef2",
      "color-text-muted": "#829098",
      "color-border": "#232d32",
      "color-border-strong": "#3a454a",
      "color-accent": "#4fb3c8",
      "color-accent-wash": "#14282f",
      "color-good": "#72b584",
      "color-bad": "#da8992",
      "color-heat-0": "#232d32",
      "color-heat-1": "#304c54",
      "color-heat-2": "#3b6c79",
      "color-heat-3": "#468f9f",
      "color-heat-4": "#4fb3c8",
      "radius-md": "14.5px",
      "shadow-1": "0 1px 5px #e2eef269, 0 0.5px 2.5px #e2eef234",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#10202a",
      "graph-grid": "#232d32",
      "graph-region-alpha": "0.18",
      "doc-page": "#10202a",
      "panel-bg": "#10202a",
      "button-primary-bg": "#4fb3c8"
    }
  },
  "ember": {
    "light": {
      "color-canvas": "#f2ebe0",
      "color-surface": "#fffaf3",
      "color-text": "#1c1410",
      "color-text-muted": "#75655a",
      "color-border": "#e6d9c8",
      "color-border-strong": "#cdb9a2",
      "color-accent": "#b3411f",
      "color-accent-wash": "#f8e9df",
      "color-good": "#6e7f3c",
      "color-bad": "#b3411f",
      "color-heat-0": "#e6d9c8",
      "color-heat-1": "#f0c29e",
      "color-heat-2": "#eea16a",
      "color-heat-3": "#e0753a",
      "color-heat-4": "#b3411f",
      "radius-md": "12px",
      "shadow-1": "0 1px 5px #1c14102e, 0 0.5px 2.5px #1c141017",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#fffaf3",
      "graph-grid": "#e6d9c8",
      "graph-region-alpha": "0.18",
      "doc-page": "#fffaf3",
      "panel-bg": "#fffaf3",
      "button-primary-bg": "#b3411f"
    },
    "dark": {
      "color-canvas": "#0d0b09",
      "color-surface": "#16110d",
      "color-text": "#f6ece0",
      "color-text-muted": "#a89583",
      "color-border": "#2b2119",
      "color-border-strong": "#443426",
      "color-accent": "#ff8a3d",
      "color-accent-wash": "#2e1a0f",
      "color-good": "#6e7f3c",
      "color-bad": "#b3411f",
      "color-heat-0": "#e6d9c8",
      "color-heat-1": "#f0c29e",
      "color-heat-2": "#eea16a",
      "color-heat-3": "#e0753a",
      "color-heat-4": "#b3411f",
      "radius-md": "12px",
      "shadow-1": "0 1px 5px #f6ece080, 0 0.5px 2.5px #f6ece040",
      "space-3": "12px",
      "text-md": "14px",
      "font-body": "'Inter', system-ui, sans-serif",
      "surface-alpha": "1",
      "graph-paper": "#16110d",
      "graph-grid": "#2b2119",
      "graph-region-alpha": "0.18",
      "doc-page": "#16110d",
      "panel-bg": "#16110d",
      "button-primary-bg": "#ff8a3d"
    }
  }
}

describe('alpha tokens', () => {
  it('are registered once, as number tokens with the floors from LAYER_TOKENS', () => {
    expect(ALPHA_TOKENS.map((t) => t.name)).toEqual(SIX)
    for (const n of [...SIX, 'graph-region-alpha']) {
      const t = tokenByName.get(n)!
      const l = LAYER_TOKENS.find((x) => x.token === n)!
      expect(t.type).toBe('number')
      expect(t.modeDependent).toBe(false)
      expect(t.min).toBe(l.floor)
      expect(t.max).toBe(1)
    }
    expect(new Set(TOKENS.map((t) => t.name)).size).toBe(TOKENS.length)
  })
  it('resolve to table defaults at dial 0, floors at dial 1 (region stays), midpoint at 0.5', () => {
    for (const mode of ['light', 'dark'] as const) {
      const d0 = mk()[mode]
      expect(SIX.map((n) => d0[n])).toEqual(['1', '0.9', '0.95', '1', '1', '0.92'])
      expect(d0['graph-region-alpha']).toBe('0.18')
      const d1 = mk({ translucency: 1 })[mode]
      expect(SIX.map((n) => d1[n])).toEqual(['0.55', '0.6', '0.7', '0.25', '0.15', '0.7'])
      expect(d1['graph-region-alpha']).toBe('0.18')
      expect(mk({ translucency: 0.5 })[mode]['doc-sheet-alpha']).toBe('0.775')
    }
  })
  it('clamps overrides into range without throwing; non-numbers still throw', () => {
    const r = mk({}, { 'callout-alpha': '0.1', 'graph-grid-alpha': '4', 'doc-surface-alpha': '0.8', 'graph-region-alpha': '0.01' }).light
    expect(r['callout-alpha']).toBe('0.7')
    expect(r['graph-grid-alpha']).toBe('1')
    expect(r['doc-surface-alpha']).toBe('0.8')
    expect(r['graph-region-alpha']).toBe('0.05')
    expect(() => mk({}, { 'callout-alpha': 'abc' })).toThrow(ResolveError)
  })
  it('ownership and compose', () => {
    expect(ownerOf('doc-sheet-alpha')).toBe('shared')
    for (const n of ['doc-surface-alpha', 'graph-paper-alpha', 'graph-grid-alpha', 'graph-region-alpha', 'callout-alpha', 'doc-media-alpha']) {
      expect(ownerOf(n), n).toBe('ambience')
    }
    const ws = normalise({ id: 'w', name: 'W', layer: 'workspace', overrides: { any: { 'doc-sheet-alpha': '0.8', 'doc-surface-alpha': '0.8' } } })
    const amb = normalise({ id: 'a', name: 'A', layer: 'ambience', dials: { translucency: 1 } })
    const r = compose({ workspace: ws, ambience: amb })
    expect(r.manifest.overrides?.any?.['doc-sheet-alpha']).toBe('0.8')
    expect(resolve(r.manifest).light['doc-sheet-alpha']).toBe('0.8')
    expect(r.ignored.some((i) => i.path === 'overrides.any.doc-surface-alpha')).toBe(true)
  })
  it('does not change any pre-existing token of the ambience built-ins', () => {
    for (const n of ['osmosis', 'forest', 'ocean', 'ember']) {
      const r = resolve(builtinById(`builtin:${n}`)!)
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(r[mode]).length).toBe(TOKENS.length)
        for (const a of SIX) expect(r[mode][a]).toBeDefined()
        const got = Object.fromEntries(Object.keys(PRE_EXISTING[n][mode]).map((t) => [t, r[mode][t]]))
        expect(got, `${n}/${mode}`).toEqual(PRE_EXISTING[n][mode])
      }
    }
  })
  it('LAYER_TOKENS drives the registry', () => {
    for (const n of SIX) {
      const l = LAYER_TOKENS.find((x) => x.token === n)!
      expect(l.dialDriven, n).toBe(true)
      for (const mode of ['light', 'dark'] as const) {
        expect(mk({ translucency: 0 })[mode][n], n).toBe(formatAlpha(dialDefault(n, 0)))
        expect(mk({ translucency: 1 })[mode][n], n).toBe(formatAlpha(dialDefault(n, 1)))
        expect(mk({ translucency: 0 })[mode][n], n).toBe(formatAlpha(l.default))
        expect(mk({ translucency: 1 })[mode][n], n).toBe(formatAlpha(l.floor))
      }
    }
  })
})
