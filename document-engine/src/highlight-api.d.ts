// The TypeScript version pinned here ships an incomplete lib.dom.d.ts for
// the CSS Custom Highlight API — HighlightRegistry (CSS.highlights) is
// declared with only `forEach`, missing the Map-like members the spec (and
// every implementing browser) actually provides. Augment it rather than
// casting at every call site.
export {}

declare global {
  interface HighlightRegistry {
    set(propertyName: string, highlight: Highlight): HighlightRegistry
    delete(propertyName: string): boolean
    has(propertyName: string): boolean
    clear(): void
    readonly size: number
  }
}
