// The chrome-part pattern. A component that is a named part of the viewer's
// chrome calls usePart() and spreads `props` on its root element:
//
//   const p = usePart({ id: 'zoom', kind: 'zoom' }, { ref: rootRef, className: 'document-viewer-zoom' })
//   return p.wrap(<div {...p.props}>{p.lead}...children...{p.trail}</div>)
//
// - `data-part="<kind>:<id>"` is ALWAYS on the root (styling/automation hook, no adapter needed).
// - With an adapter: decoratePart's class/style/attrs are merged in, `before` /
//   `after` become the first / last children (`lead` / `trail`), mountPart runs in
//   a layout effect (re-run only when the adapter or the part's state changes),
//   and renderPart may replace the whole node (`wrap`).
// - Parts of SLOT_PART_KINDS also get empty `[data-adapter-slot]` spans, but only
//   when the adapter defines mountPart. React never gives them children.
import { createElement, Fragment, useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import type { ChromePart } from './types'
import { partAttr, SLOT_PART_KINDS, useAdapterHooks } from './useAdapter'

export interface PartBase {
  /** The component's own ref to its root (object or callback; kept in sync). */
  ref?: { current: any } | ((el: any) => void)
  className?: string
  style?: CSSProperties
}

export interface PartHandle {
  props: Record<string, unknown>
  /** First children: the before-slot, then the adapter's `before` node. */
  lead: ReactNode
  /** Last children: the adapter's `after` node, then the after-slot. */
  trail: ReactNode
  /** Run renderPart over the default node. */
  wrap(node: ReactNode): ReactNode
}

function joinClass(a?: string, b?: string): string | undefined {
  const s = [a, b].filter(Boolean).join(' ')
  return s || undefined
}

export function usePart(part: ChromePart, base: PartBase = {}): PartHandle {
  const hooks = useAdapterHooks()
  const ownRef = useRef(base.ref)
  ownRef.current = base.ref
  const elRef = useRef<HTMLElement | null>(null)
  const setRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el
    const own = ownRef.current
    if (typeof own === 'function') own(el)
    else if (own) own.current = el
  }, [])
  const st = part.state
  const deco = useMemo(
    () => hooks.decorate(part),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hooks, part.kind, part.id, part.label, st?.active, st?.disabled, st?.open],
  )
  // mountPart: after the element exists; again only on adapter / state change.
  const partRef = useRef(part)
  partRef.current = part
  useLayoutEffect(() => {
    const el = elRef.current
    if (!hooks.hasMount || !el) return
    return hooks.mount(el, partRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hooks, part.kind, part.id, st?.active, st?.disabled, st?.open])

  const slots = hooks.hasMount && SLOT_PART_KINDS.includes(part.kind)
  const props: Record<string, unknown> = { ...(deco?.attrs ?? {}), ref: setRef, 'data-part': partAttr(part) }
  const className = joinClass(base.className, deco?.className)
  if (className) props.className = className
  const style = deco?.style ? ({ ...(base.style ?? {}), ...deco.style } as CSSProperties) : base.style
  if (style) props.style = style

  const lead =
    slots || deco?.before
      ? createElement(
          Fragment,
          null,
          slots ? createElement('span', { 'data-adapter-slot': 'before', 'data-adapter': '', key: 'sb' }) : null,
          deco?.before ? createElement('span', { 'data-adapter': '', key: 'b', style: { display: 'contents' } }, deco.before) : null,
        )
      : null
  const trail =
    slots || deco?.after
      ? createElement(
          Fragment,
          null,
          deco?.after ? createElement('span', { 'data-adapter': '', key: 'a', style: { display: 'contents' } }, deco.after) : null,
          slots ? createElement('span', { 'data-adapter-slot': 'after', 'data-adapter': '', key: 'sa' }) : null,
        )
      : null
  return { props, lead, trail, wrap: (node) => hooks.render(part, node) }
}
