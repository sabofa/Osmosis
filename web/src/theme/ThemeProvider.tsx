import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BUILTINS, modeAt } from 'theme-core'
import type { Location, ModeSource, ThemeManifest } from 'theme-core'
import {
  getThemes,
  putThemeManifest,
  deleteThemeRecord,
  putActiveTheme,
  putThemeLocation,
} from '../lib/api'
import type { ThemePreset } from '../hooks/useThemePresets'
import { Ctx, type CustomTheme, type ThemeContextValue } from './context'
import { buildThemeSheet } from './applyTheme'
import { activeManifest, activeWorkspaceManifest, applyPreview, composeActive, presetToManifest, readCache, writeCache, toPresetView, type StorageLike } from './themeState'

const SOURCE_KEY = 'osmosis:theme'
const BLEND_KEY = 'osmosis:theme-blend'
const STYLE_ID = 'osmosis-theme'
const LEGACY_STYLE_ID = 'osmosis-preset-css'
const LEGACY_PROPS = ['--accent', '--accent-wash', '--bg', '--surface', '--ink', '--muted', '--line', '--line-strong']
const REFRESH_MS = 5 * 60_000
const SUN_TICK_MS = 60_000

const NO_STORAGE: StorageLike = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

// Even reaching for window.localStorage throws when site data is blocked.
function safeStorage(): StorageLike {
  try {
    return typeof localStorage === 'undefined' ? NO_STORAGE : localStorage
  } catch {
    return NO_STORAGE
  }
}

function readSource(): ModeSource {
  try {
    const s = safeStorage().getItem(SOURCE_KEY)
    return s === 'light' || s === 'dark' || s === 'system' || s === 'sun' ? s : 'system'
  } catch {
    return 'system'
  }
}

function readBlend(): boolean {
  try {
    return safeStorage().getItem(BLEND_KEY) === 'on'
  } catch {
    return false
  }
}

function systemDarkNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function safeStore(key: string, value: string) {
  try {
    safeStorage().setItem(key, value)
  } catch {
    // private mode / full: the choice just won't persist
  }
}

// One active-theme pointer with optimistic updates: each choice bumps a
// request counter, a failure rolls back to the last server-confirmed value,
// and a stale response (superseded by a newer choice) is ignored.
function useActiveSlot(initial: string | null, layer: 'ambience' | 'workspace', setError: (e: string | null) => void) {
  const [value, setValue] = useState<string | null>(initial)
  const confirmed = useRef<string | null>(initial)
  const req = useRef(0)
  const set = useCallback(
    (id: string | null) => {
      const mine = ++req.current
      setValue(id)
      putActiveTheme(id, layer)
        .then(() => {
          if (mine !== req.current) return
          confirmed.current = id
          setError(null)
        })
        .catch((err) => {
          if (mine !== req.current) return // superseded by a newer choice
          setValue(confirmed.current)
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [layer, setError]
  )
  // Server truth arrives: adopt it unless a newer choice was made since `snapshot`.
  const adopt = useCallback((id: string | null, snapshot: number) => {
    if (snapshot !== req.current) return
    confirmed.current = id
    setValue(id)
  }, [])
  return { value, setValue, req, set, adopt }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => readCache(safeStorage()))
  const [custom, setCustom] = useState<CustomTheme[]>(cache?.themes ?? [])
  const [location, setLocationState] = useState<Location | null>(cache?.location ?? null)
  const [source, setSourceState] = useState<ModeSource>(readSource)
  const [twilightBlend, setTwilightBlendState] = useState<boolean>(readBlend)
  const [preview, setPreview] = useState<ThemeManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ambienceSlot = useActiveSlot(cache?.active_theme_id ?? null, 'ambience', setError)
  const workspaceSlot = useActiveSlot(cache?.active_workspace_theme_id ?? null, 'workspace', setError)
  const activeId = ambienceSlot.value
  const activeWorkspaceId = workspaceSlot.value
  const [systemDark, setSystemDark] = useState<boolean>(systemDarkNow)
  const [tick, setTick] = useState(0)

  // ---- mode: re-evaluated on every input that can change it ----
  const resolvedMode = useMemo(
    () => modeAt(source, new Date(), location, systemDark, twilightBlend),
    // tick is the clock: bumped by the sun timer and by visibility changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, location, systemDark, twilightBlend, tick]
  )
  const { mode, blend, effectiveSource } = resolvedMode

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (source !== 'sun') return
    const t = setInterval(() => setTick((n) => n + 1), SUN_TICK_MS)
    return () => clearInterval(t)
  }, [source])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // ---- apply: data-theme + the one stylesheet ----
  const ambienceManifest = useMemo(() => activeManifest(custom, activeId), [custom, activeId])
  const workspaceManifest = useMemo(
    () => activeWorkspaceManifest(custom, BUILTINS, activeWorkspaceId),
    [custom, activeWorkspaceId]
  )
  const manifest = useMemo(() => {
    const slots = applyPreview(preview, workspaceManifest, ambienceManifest)
    return composeActive(slots.workspace, slots.ambience)
  }, [preview, workspaceManifest, ambienceManifest])
  const appliedKey = useRef('')

  useLayoutEffect(() => {
    // One-time cleanup of the old mechanism (inline tokens + preset css tag).
    document.getElementById(LEGACY_STYLE_ID)?.remove()
    const root = document.documentElement
    for (const p of LEGACY_PROPS) root.style.removeProperty(p)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    const sheet = buildThemeSheet({ manifest, mode, blend })
    let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (tag && sheet.key === appliedKey.current) return
    if (!tag) {
      tag = document.createElement('style')
      tag.id = STYLE_ID
      document.head.appendChild(tag)
    }
    tag.textContent = sheet.css
    appliedKey.current = sheet.key
  }, [manifest, mode, blend])

  // ---- server sync ----
  const { setValue: setAmbienceValue } = ambienceSlot
  const { setValue: setWorkspaceValue } = workspaceSlot
  const { req: ambReqRef, adopt: adoptAmbience } = ambienceSlot
  const { req: wsReqRef, adopt: adoptWorkspace } = workspaceSlot
  const refresh = useCallback(async () => {
    const ambReq = ambReqRef.current
    const wsReq = wsReqRef.current
    try {
      const p = await getThemes()
      setCustom(p.themes.map((t) => ({ id: t.id, name: t.name, manifest: t.manifest, updated_at: t.updated_at })))
      setLocationState(p.location ?? null)
      adoptAmbience(p.active_theme_id, ambReq)
      adoptWorkspace(p.active_workspace_theme_id ?? null, wsReq)
      setError(null)
    } catch {
      // Node unreachable: keep what we have.
    }
  }, [ambReqRef, wsReqRef, adoptAmbience, adoptWorkspace])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), REFRESH_MS)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  useEffect(() => {
    writeCache(safeStorage(), { themes: custom, active_theme_id: activeId, active_workspace_theme_id: activeWorkspaceId, location })
  }, [custom, activeId, activeWorkspaceId, location])

  // ---- actions ----
  const setSource = useCallback((s: ModeSource) => {
    safeStore(SOURCE_KEY, s)
    setSourceState(s)
  }, [])

  const setTwilightBlend = useCallback((b: boolean) => {
    safeStore(BLEND_KEY, b ? 'on' : 'off')
    setTwilightBlendState(b)
  }, [])

  const setActiveId = ambienceSlot.set
  const setActiveWorkspaceId = workspaceSlot.set

  const saveManifest = useCallback(async (m: ThemeManifest): Promise<boolean> => {
    try {
      const { theme } = await putThemeManifest(m)
      const row: CustomTheme = { id: theme.id, name: theme.name, manifest: theme.manifest, updated_at: theme.updated_at }
      setCustom((prev) => [...prev.filter((t) => t.id !== row.id), row])
      setPreview(null)
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const saveTheme = useCallback((p: ThemePreset): Promise<boolean> => saveManifest(presetToManifest(p)), [saveManifest])

  const deleteTheme = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteThemeRecord(id)
      setCustom((prev) => prev.filter((t) => t.id !== id))
      setAmbienceValue((cur) => (cur === id ? null : cur))
      setWorkspaceValue((cur) => (cur === id ? null : cur))
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [setAmbienceValue, setWorkspaceValue])

  const setLocation = useCallback(async (loc: Location | null): Promise<boolean> => {
    try {
      const r = await putThemeLocation(loc)
      setLocationState(r.location ?? null)
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const previewManifest = useCallback((m: ThemeManifest | null) => setPreview(m), [])

  const presets = useMemo<ThemePreset[]>(
    () => [
      ...BUILTINS.map((m) => toPresetView(m.id, m.name, m, true)),
      ...custom.map((c) => toPresetView(c.id, c.name, c.manifest)),
    ],
    [custom]
  )

  const stateRef = useRef({ source, effectiveSource, mode, blend, twilightBlend })
  useEffect(() => {
    stateRef.current = { source, effectiveSource, mode, blend, twilightBlend }
  })
  const state = useCallback(() => stateRef.current, [])

  const value: ThemeContextValue = {
    source,
    setSource,
    twilightBlend,
    setTwilightBlend,
    mode,
    blend,
    effectiveSource,
    location,
    setLocation,
    custom,
    activeId,
    setActiveId,
    activeWorkspaceId,
    setActiveWorkspaceId,
    previewManifest,
    saveTheme,
    saveManifest,
    deleteTheme,
    presets,
    error,
    refresh,
    state,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
