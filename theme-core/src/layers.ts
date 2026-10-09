import { DEFAULT_THEME_ID, builtinById } from './builtins/index.js'
import { normalise, type Dials, type ThemeManifest } from './manifest.js'
import { tokenByName } from './registry/index.js'

export type Owner = 'workspace' | 'ambience' | 'shared'

const SHARED_TOKENS: ReadonlySet<string> = new Set(['font-math', 'doc-font-body', 'doc-measure'])
const WORKSPACE_GROUPS: ReadonlySet<string> = new Set(['type', 'shape', 'space', 'elevation', 'motion', 'component'])
const AMBIENCE_GROUPS: ReadonlySet<string> = new Set(['colour', 'surface', 'graph', 'document'])

export function ownerOf(tokenName: string): Owner {
  const def = tokenByName.get(tokenName)
  if (!def) throw new Error(`unknown token: ${tokenName}`)
  if (SHARED_TOKENS.has(tokenName)) return 'shared'
  if (WORKSPACE_GROUPS.has(def.group)) return 'workspace'
  if (AMBIENCE_GROUPS.has(def.group)) return 'ambience'
  throw new Error(`token ${tokenName} has unmapped group: ${def.group}`)
}

export const OWNED_DIALS: { workspace: readonly (keyof Dials)[]; ambience: readonly (keyof Dials)[] } = {
  workspace: ['roundness', 'density', 'elevation', 'borders', 'motion', 'typeScale', 'baseSize'],
  ambience: ['contrast', 'saturation', 'warmth', 'translucency', 'texture', 'twilightBlend'],
}

export interface IgnoredField { layer: 'workspace' | 'ambience'; themeId: string; path: string; reason: string }
export interface LayerSet { workspace?: ThemeManifest | null; ambience?: ThemeManifest | null }

type Bucket = 'any' | 'light' | 'dark'
const BUCKETS: readonly Bucket[] = ['any', 'light', 'dark']
const MIDDLE_DOT = String.fromCharCode(183)

export function compose(layers: LayerSet): { manifest: ThemeManifest; ignored: IgnoredField[] } {
  const ws = layers.workspace ?? null
  const amb = layers.ambience ?? null
  if (!ws && !amb) return { manifest: builtinById(DEFAULT_THEME_ID)!, ignored: [] }
  if (!ws || !amb) return { manifest: (ws ?? amb)!, ignored: [] }

  const ignored: IgnoredField[] = []
  const skip = (m: ThemeManifest, layer: 'workspace' | 'ambience', path: string, reason: string) =>
    ignored.push({ layer, themeId: m.id, path, reason })
  const ownedBy = (other: 'workspace' | 'ambience') => `owned by the ${other} layer`

  if (Object.keys(ws.seeds).length > 0) skip(ws, 'workspace', 'seeds', ownedBy('ambience'))

  const dials: Partial<Dials> = {}
  const dialRec = dials as Record<string, unknown>
  const wsOwn = new Set<string>(OWNED_DIALS.workspace)
  const ambOwn = new Set<string>(OWNED_DIALS.ambience)
  for (const [k, v] of Object.entries(ws.dials)) {
    if (wsOwn.has(k)) dialRec[k] = v
    else skip(ws, 'workspace', `dials.${k}`, ownedBy('ambience'))
  }
  for (const [k, v] of Object.entries(amb.dials)) {
    if (ambOwn.has(k)) dialRec[k] = v
    else skip(amb, 'ambience', `dials.${k}`, ownedBy('workspace'))
  }

  const fonts: ThemeManifest['fonts'] = {}
  for (const role of ['display', 'body', 'mono'] as const) {
    if (ws.fonts[role] !== undefined) fonts[role] = ws.fonts[role]
    if (amb.fonts[role] !== undefined) skip(amb, 'ambience', `fonts.${role}`, ownedBy('workspace'))
  }
  const math = amb.fonts.math ?? ws.fonts.math
  if (math !== undefined) fonts.math = math

  const overrides: NonNullable<ThemeManifest['overrides']> = {}
  for (const b of BUCKETS) {
    const out: Record<string, string> = {}
    const wsShared = new Set<string>()
    const take = (m: ThemeManifest, layer: 'workspace' | 'ambience') => {
      const src = m.overrides?.[b]
      if (!src) return
      const other = layer === 'workspace' ? 'ambience' : 'workspace'
      for (const [tok, val] of Object.entries(src)) {
        const path = `overrides.${b}.${tok}`
        if (!tokenByName.has(tok)) { skip(m, layer, path, 'unknown token'); continue }
        const o = ownerOf(tok)
        if (o === 'shared' || o === layer) {
          if (o === 'shared' && layer === 'ambience' && wsShared.has(tok)) {
            skip(ws, 'workspace', path, 'overridden by the ambience layer')
          }
          out[tok] = val
          if (o === 'shared' && layer === 'workspace') wsShared.add(tok)
        }
        else skip(m, layer, path, ownedBy(other))
      }
    }
    take(ws, 'workspace')
    take(amb, 'ambience')
    if (Object.keys(out).length > 0) overrides[b] = out
  }

  const css = [ws.css, amb.css].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n')

  for (const field of ['ambience', 'sounds', 'assets'] as const) {
    if (ws[field] !== undefined) skip(ws, 'workspace', field, ownedBy('ambience'))
  }
  if (ws.graph !== undefined) skip(ws, 'workspace', 'graph', ownedBy('ambience'))
  if (amb.workspace !== undefined) skip(amb, 'ambience', 'workspace', ownedBy('workspace'))

  const manifest = normalise({
    id: `${ws.id}+${amb.id}`,
    name: `${ws.name} ${MIDDLE_DOT} ${amb.name}`,
    seeds: amb.seeds,
    dials,
    fonts,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    ...(css ? { css } : {}),
    ...(amb.graph !== undefined ? { graph: amb.graph } : {}),
    ...(amb.description !== undefined ? { description: amb.description } : {}),
    ...(amb.author !== undefined ? { author: amb.author } : {}),
    ...(amb.ambience !== undefined ? { ambience: amb.ambience } : {}),
    ...(amb.sounds !== undefined ? { sounds: amb.sounds } : {}),
    ...(amb.assets !== undefined ? { assets: amb.assets } : {}),
    ...(ws.workspace !== undefined ? { workspace: ws.workspace } : {}),
  })
  return { manifest, ignored }
}
