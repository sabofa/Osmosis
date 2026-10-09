import { useMemo } from 'react'
import { resolve, toDocumentTokens } from 'theme-core'
import type { DocumentTokens, Mode, ThemeManifest } from 'theme-core'
import { useThemeContext } from './context'

export function documentTokensFor(manifest: ThemeManifest, mode: Mode): DocumentTokens {
  return toDocumentTokens(resolve(manifest), manifest, mode)
}

/** Document-engine tokens for the active (workspace + ambience + live preview) theme. */
export function useDocumentTokens(): DocumentTokens {
  const { manifest, mode } = useThemeContext()
  return useMemo(() => documentTokensFor(manifest, mode), [manifest, mode])
}
