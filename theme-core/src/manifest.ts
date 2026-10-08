export const THEME_SCHEMA = 1
export type Mode = 'light' | 'dark'
export interface ColourSeeds {
  canvas?: string; surface?: string; ink?: string; accent?: string; secondary?: string
  good?: string; bad?: string; warn?: string; info?: string; series?: string[]
}
export interface Seeds { light?: ColourSeeds; dark?: ColourSeeds }
export interface Dials {
  contrast: number; warmth: number; saturation: number; roundness: number; density: number
  elevation: number; borders: number; translucency: number; texture: number; motion: number // 0..1
  typeScale: number // ratio 1.125..1.333
  baseSize: number // px 13..18
  twilightBlend: boolean
}
export const DEFAULT_DIALS: Dials = {
  contrast: 0.5, warmth: 0.5, saturation: 0.5, roundness: 0.5, density: 0.5,
  elevation: 0.5, borders: 0.5, translucency: 0, texture: 0, motion: 0.5,
  typeScale: 1.2, baseSize: 14, twilightBlend: false,
}
export type FontRole = 'display' | 'body' | 'mono' | 'math'
export type StackName = 'space-grotesk' | 'inter' | 'system-sans' | 'system-serif' | 'system-mono' | 'stix-two' | 'latin-modern-math'
export type FontRef = { stack: StackName } | { asset: string } // {asset} is RESERVED (stored, never interpreted)
export const FONT_STACKS: Record<StackName, string> = {
  'space-grotesk': "'Space Grotesk', system-ui, sans-serif",
  'inter': "'Inter', system-ui, sans-serif",
  'system-sans': "system-ui, -apple-system, 'Segoe UI', sans-serif",
  'system-serif': "ui-serif, Georgia, 'Times New Roman', serif",
  'system-mono': "ui-monospace, 'Cascadia Mono', Consolas, monospace",
  'stix-two': "'STIX Two Text', 'STIX Two Math', Georgia, serif",
  'latin-modern-math': "'Latin Modern Math', 'STIX Two Math', serif",
}
export type FontSeeds = Partial<Record<FontRole, FontRef>>
export const DEFAULT_FONTS: Record<FontRole, FontRef> = {
  display: { stack: 'space-grotesk' }, body: { stack: 'inter' }, mono: { stack: 'system-mono' }, math: { stack: 'stix-two' },
}
export interface ThemeManifest {
  schema: 1
  id: string; name: string; description?: string; author?: 'human' | 'claude'
  seeds: Seeds; dials: Partial<Dials>; fonts: FontSeeds
  overrides?: { any?: Record<string, string>; light?: Record<string, string>; dark?: Record<string, string> }
  css?: string
  graph?: { styles?: unknown; boards?: Partial<Record<'blackboard' | 'greenboard' | 'whiteboard', string>>; media?: Record<string, unknown>; papers?: unknown }
  ambience?: unknown; sounds?: unknown; assets?: unknown // RESERVED slots: stored/returned unchanged, never interpreted
}
export const DEFAULT_SEEDS: Record<Mode, { canvas: string; surface: string; ink: string; accent: string }> = {
  light: { canvas: '#eef1e5', surface: '#ffffff', ink: '#17170f', accent: '#c65d22' },
  dark: { canvas: '#17160f', surface: '#201e15', ink: '#f2efe2', accent: '#e2803f' },
}
export function normalise(m: Partial<ThemeManifest> & { id: string; name: string }): ThemeManifest {
  return { ...m, schema: 1, seeds: m.seeds ?? {}, dials: m.dials ?? {}, fonts: m.fonts ?? {} } as ThemeManifest
}
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
