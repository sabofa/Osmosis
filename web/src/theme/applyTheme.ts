import { resolve, blendMaps, toStylesheet } from 'theme-core'
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

// The whole theme as one stylesheet. Pure: the provider decides when to write
// it; `key` changes exactly when the css would.
export function buildThemeSheet(i: ApplyInput): { css: string; mode: Mode; key: string } {
  const r = resolveOnce(i.manifest)
  const tokens = i.blend > 0 && i.blend < 1 ? blendMaps(r.light, r.dark, i.blend) : i.mode === 'dark' ? r.dark : r.light
  return {
    css: toStylesheet(tokens, i.mode, i.manifest.css),
    mode: i.mode,
    key: `${r.key}:${i.mode}:${i.blend.toFixed(3)}`,
  }
}
