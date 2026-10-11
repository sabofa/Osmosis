import type { ReactNode } from 'react'
import type { DocumentTokens } from 'theme-core'
import type { Chrome, Interaction } from '../types'

// The document-engine THEME ADAPTER: a theme's unrestricted JS hooks, passed as
// host.adapter. Spec: Learn spec/osmosis/document-engine/ADAPTER-ADDENDUM-2026-10-10.md.
// These types live here until engine-host adopts them (additive there).
// Every hook is optional; a missing hook is a no-op; a throwing hook is caught,
// logged once per hook, and the engine uses its default (see useAdapter.ts).

export type DocumentAlphasLike = DocumentTokens['alphas']

export interface AdapterContext {
  root: HTMLElement
  mode: 'light' | 'dark'
  interaction: Interaction
  chrome: Chrome
  kind: 'prose' | 'pdf' | 'image'
  tokens: DocumentTokens
  alphas: DocumentAlphasLike
  host: unknown
}

/** Read-only snapshot of a block (no offsets exposed). Block hooks are not built yet. */
export interface AdapterBlock {
  type: 'heading' | 'paragraph' | 'list' | 'listItem' | 'quote' | 'callout' | 'fence' | 'graph' | 'table' | 'math' | 'rule' | 'image' | 'pdfPage'
  level?: number
  index: number
  text?: string
  info?: string
}

export interface BlockDecoration {
  className?: string
  style?: Record<string, string>
  attrs?: Record<string, string>
  before?: ReactNode
  after?: ReactNode
  wrap?: (children: ReactNode) => ReactNode
}

export type AdapterEvent =
  | { type: 'selection'; hasSelection: boolean }
  | { type: 'zoom'; scale: number }
  | { type: 'mode'; interaction: Interaction }
  | { type: 'expand'; graph: number | null }
  | { type: 'scroll'; y: number; h: number }
  | { type: 'edit'; kind: 'type' | 'save' }

/** Every named piece of viewer chrome (ribbon, floating pill, menus). */
export type ChromePartKind =
  | 'ribbon' | 'ribbon-tab' | 'ribbon-panel' | 'ribbon-group' | 'ribbon-item' | 'ribbon-gallery' | 'popover'
  | 'viewer-controls' | 'zoom' | 'zoom-menu' | 'settings' | 'settings-menu' | 'notice'

export interface ChromePart {
  id: string
  kind: ChromePartKind
  label?: string
  state?: { active?: boolean; disabled?: boolean; open?: boolean }
}

/** What an adapter may add to a chrome part's root element. */
export interface PartDecoration {
  className?: string
  style?: Record<string, string>
  attrs?: Record<string, string>
  before?: ReactNode
  after?: ReactNode
}

export interface AdapterChromeHooks {
  /** Extra stylesheet text for the chrome, injected in one scoped <style data-adapter-css>. */
  css?(ctx: AdapterContext): string
  /** Class / style / attrs / first+last children for a part's root. Pure and cheap: runs on render. */
  decoratePart?(part: ChromePart, ctx: AdapterContext): PartDecoration | null
  /** Replace a part entirely; `defaultNode` is the engine's own node so it can be wrapped. */
  renderPart?(part: ChromePart, defaultNode: ReactNode, ctx: AdapterContext): ReactNode | null
  /**
   * After a part's element is mounted (and again when the adapter or the part's
   * state changes; not on every render). Free DOM access, including the empty
   * `[data-adapter-slot="before|after"]` spans of ribbon / ribbon-group /
   * ribbon-item parts, which React never touches. Return a cleanup.
   */
  mountPart?(el: HTMLElement, part: ChromePart, ctx: AdapterContext): void | (() => void)
}

export interface DocumentAdapter {
  id: string
  init?(ctx: AdapterContext): void | (() => void)
  tokens?(tokens: DocumentTokens, ctx: AdapterContext): DocumentTokens
  cssVars?(vars: Record<string, string>, ctx: AdapterContext): Record<string, string>
  css?(ctx: AdapterContext): string
  // TODO(adapter A3, block offset guarantees): decorateBlock / renderBlock are typed but not wired.
  decorateBlock?(block: AdapterBlock, ctx: AdapterContext): BlockDecoration | null
  renderBlock?(block: AdapterBlock, defaultRender: () => ReactNode, ctx: AdapterContext): ReactNode | null
  highlightCss?(color: string, defaultCss: string, ctx: AdapterContext): string
  onEvent?(e: AdapterEvent, ctx: AdapterContext): void
  // TODO(adapter A5, with D2): CodeMirror 6 Extensions; typed unknown[] to stay dependency-free.
  editorExtensions?(ctx: AdapterContext): unknown[]
  chrome?: AdapterChromeHooks
  dispose?(): void
}
