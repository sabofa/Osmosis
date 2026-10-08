import { DEFAULT_DIALS, type Mode, type ThemeManifest } from './manifest.js'
import type { ResolvedTheme, TokenMap } from './resolve.js'

export type BoardName = 'blackboard' | 'greenboard' | 'whiteboard'
export interface GraphColours {
  surface: string; paper: string; ink: string; muted: string; line: string; lineStrong: string
  accent: string; accentWash: string; good: string; bad: string; series: string[]
}
export interface GraphThemeSource {
  mode: Mode
  colours: GraphColours
  /** The OTHER mode's colours (name kept from graph styles); holds whichever mode is not `mode`. */
  lightColours?: GraphColours
  boards?: Partial<Record<BoardName, string>>
  media?: Record<string, unknown>
  styles?: unknown
  lettering?: { family?: string }
}

export interface DocumentTokens {
  mode: Mode
  colors: {
    page: string; text: string; textMuted: string; link: string; rule: string; selection: string
    highlight: [string, string, string, string]
    codeBg: string; codeText: string
    syntax: Record<'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'operator' | 'punctuation', string>
    tableHeader: string; tableStripe: string; accent: string
  }
  fonts: { body: string; display: string; mono: string; math: string; cjk: string }
  scale: { base: string; ratio: number; leading: string; measure: string }
  key: string
}

const tok = (m: TokenMap, name: string): string => {
  const v = m[name]
  if (v === undefined) throw new Error(`theme token missing: ${name}`)
  return v
}

const graphColours = (m: TokenMap): GraphColours => ({
  surface: tok(m, 'color-surface'), paper: tok(m, 'graph-paper'), ink: tok(m, 'graph-ink'),
  muted: tok(m, 'color-text-muted'), line: tok(m, 'graph-grid'), lineStrong: tok(m, 'graph-grid-strong'),
  accent: tok(m, 'color-accent'), accentWash: tok(m, 'color-accent-wash'), good: tok(m, 'color-good'), bad: tok(m, 'color-bad'),
  series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tok(m, `color-series-${i}`)),
})

export function toGraphThemeSource(r: ResolvedTheme, manifest: ThemeManifest, mode: Mode): GraphThemeSource {
  const other: Mode = mode === 'light' ? 'dark' : 'light'
  const g = manifest.graph
  return {
    mode,
    colours: graphColours(r[mode]),
    lightColours: graphColours(r[other]),
    boards: g?.boards,
    media: g?.media,
    styles: g?.styles,
    lettering: { family: tok(r[mode], 'font-display') },
  }
}

export function toDocumentTokens(r: ResolvedTheme, manifest: ThemeManifest, mode: Mode): DocumentTokens {
  const m = r[mode]
  const syn = (k: string): string => tok(m, `color-syntax-${k}`)
  const hl = (i: number): string => tok(m, `color-highlight-${i}`)
  return {
    mode,
    colors: {
      page: tok(m, 'doc-page'), text: tok(m, 'doc-text'), textMuted: tok(m, 'color-text-muted'),
      link: tok(m, 'color-link'), rule: tok(m, 'doc-rule'), selection: tok(m, 'color-selection'),
      highlight: [hl(1), hl(2), hl(3), hl(4)],
      codeBg: tok(m, 'doc-code-bg'), codeText: tok(m, 'doc-code-text'),
      syntax: {
        keyword: syn('keyword'), string: syn('string'), number: syn('number'), comment: syn('comment'),
        function: syn('function'), type: syn('type'), operator: syn('operator'), punctuation: syn('punctuation'),
      },
      tableHeader: tok(m, 'doc-table-header'), tableStripe: tok(m, 'doc-table-stripe'), accent: tok(m, 'color-accent'),
    },
    fonts: {
      body: tok(m, 'font-body'), display: tok(m, 'font-display'), mono: tok(m, 'font-mono'), math: tok(m, 'font-math'),
      cjk: "'Noto Sans JP', 'Noto Serif JP', system-ui, sans-serif",
    },
    scale: {
      base: tok(m, 'text-md'), ratio: manifest.dials.typeScale ?? DEFAULT_DIALS.typeScale,
      leading: tok(m, 'leading-normal'), measure: tok(m, 'doc-measure'),
    },
    key: r.key,
  }
}
