import { resolve, blendMaps, toStylesheet, builtinById, DEFAULT_THEME_ID } from 'theme-core'
import type { Mode, ResolvedTheme, ThemeManifest } from 'theme-core'

export interface ApplyInput {
  manifest: ThemeManifest
  mode: Mode
  blend: number // 0 light … 1 dark
}

// resolve() is the expensive step; a manifest object resolves once.
const resolved = new WeakMap<ThemeManifest, ResolvedTheme>()

function resolveOnce(m: ThemeManifest): ResolvedTheme {
  let r = resolved.get(m)
  if (!r) {
    r = resolve(m)
    resolved.set(m, r)
  }
  return r
}

// Short FNV-1a hash: resolve()'s key covers tokens only, so css needs its own.
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

let warned = false

// The whole theme as one stylesheet. Pure: the provider decides when to write
// it; `key` changes exactly when the css would.
export function buildThemeSheet(i: ApplyInput): { css: string; mode: Mode; key: string } {
  let manifest = i.manifest
  let r: ResolvedTheme
  try {
    r = resolveOnce(manifest)
  } catch (err) {
    if (!warned) {
      warned = true
      console.warn('theme failed to resolve; using the default theme', err)
    }
    manifest = builtinById(DEFAULT_THEME_ID)!
    r = resolveOnce(manifest)
  }
  const tokens = i.blend > 0 && i.blend < 1 ? blendMaps(r.light, r.dark, i.blend) : i.mode === 'dark' ? r.dark : r.light
  return {
    css: toStylesheet(tokens, i.mode, manifest.css),
    mode: i.mode,
    key: `${r.key}:${fnv1a(manifest.css ?? '')}:${i.mode}:${i.blend.toFixed(3)}`,
  }
}
