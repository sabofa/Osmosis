// The ribbon's UI: renders a Ribbon (ribbonModel.ts) as a flat tab strip over
// a panel of groups, or, when the container is narrow, as one icon row with an
// overflow popover. It knows nothing about the editor: every control calls the
// handler the model carries, then tells its owner (onDone) so focus can go
// back to the editor. Buttons never take focus from the editor on mouse down.
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react'
import type { IconSheetRef } from 'theme-core'
import { resolveIcon } from '../iconSheet'
import {
  flattenRibbon, type Ribbon as RibbonData, type RibbonControl, type RibbonGroup, type RibbonItem, type RibbonOption,
  type RibbonNumber, type RibbonColor, type RibbonSelect, type RibbonGallery,
} from './ribbonModel'
import {
  rovingIndex, nextEnabledIndex, firstFocusIndex, tabClosesPopover, controlTitle, galleryWindow, galleryTileCount, overflowSplit, controlSlots, isNarrow, previewLook, clampNumber,
} from './ribbonNav'
import { subscribeRibbonNotices, type RibbonNotices } from './ribbonNotice'
import { inkGeometry, inkTransform, popoverOriginX } from './ribbonMotion'
import { usePresence } from './usePresence'
import '../motion.css'
import './Ribbon.css'

export interface RibbonProps {
  ribbon: RibbonData
  icons: IconSheetRef
  /** Called after a control ran, so the owner can return focus to its editor. */
  onDone?: () => void
  /** Accessible name of the whole ribbon. */
  label?: string
  /** A private notice channel (createRibbonNotices); default: the shared module channel. */
  notices?: RibbonNotices
}

interface Ctx {
  icons: IconSheetRef
  run(fn: () => void): void
  /** Run without telling the owner (no focus return to the editor). */
  runQuiet(fn: () => void): void
  compact: boolean
  tiles: number
  mac: boolean
  boundary: RefObject<HTMLDivElement | null>
}

const prevent = (e: { preventDefault(): void }) => e.preventDefault()

// ---------------------------------------------------------------- small glyphs

function Chevron() {
  return (
    <svg className="de-r-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MoreGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}

// ---------------------------------------------------------------- measuring

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW((prev) => (Math.abs(prev - el.clientWidth) < 1 ? prev : el.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// ---------------------------------------------------------------- sliding indicator

// One absolutely positioned bar that follows a target element inside `list`.
// Geometry comes from offsetLeft/offsetWidth (one layout read, no rects) and is
// written straight to the bar's transform, so the ribbon never re-renders for
// it. The first placement is instant; data-ready (set a frame later) switches
// the CSS transition on, so only later moves slide. `pick` finds the target
// (null hides the bar); `deps` say when to re-place it.
function useInk(
  list: RefObject<HTMLElement | null>,
  pick: (list: HTMLElement) => HTMLElement | null,
  deps: readonly unknown[],
  fixedWidth = false,
): RefObject<HTMLSpanElement | null> {
  const ink = useRef<HTMLSpanElement | null>(null)
  const pickRef = useRef(pick)
  pickRef.current = pick
  const place = useCallback(() => {
    const bar = ink.current
    const root = list.current
    if (!bar || !root) return
    const target = pickRef.current(root)
    if (!target) {
      bar.dataset.hidden = ''
      return
    }
    delete bar.dataset.hidden
    const g = inkGeometry(target)
    bar.style.transform = fixedWidth ? `translateX(${g.x}px)` : inkTransform(g)
    if (fixedWidth) bar.style.width = `${g.w}px`
  }, [list, fixedWidth])
  useLayoutEffect(() => {
    place()
    const bar = ink.current
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => { if (bar) bar.dataset.ready = '' }) : 0
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])
  useLayoutEffect(() => {
    place()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    const root = list.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(root)
    root.querySelectorAll('[role="tab"], [role="option"]').forEach((e) => ro.observe(e))
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ink
}

// ---------------------------------------------------------------- roving focus

// One tab stop per container; arrow keys move between its [data-rv] controls.
// Tabindex is written straight onto the DOM (React never renders it), so a
// control that re-renders keeps its place.
function useRoving(ref: RefObject<HTMLElement | null>) {
  const active = useRef<string | null>(null)
  const controls = useCallback((): HTMLElement[] => {
    const root = ref.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('[data-rv]')).filter(
      (e) => !(e as HTMLButtonElement).disabled && !e.closest('[data-pop-root]'),
    )
  }, [ref])
  const apply = useCallback(() => {
    const root = ref.current
    if (!root) return
    const list = controls()
    const cur = list.find((e) => e.dataset.rv === active.current) ?? list[0]
    root.querySelectorAll<HTMLElement>('[data-rv]').forEach((e) => {
      // controls inside an open popover keep their natural tab order
      if (e.closest('[data-pop-root]')) return
      e.tabIndex = e === cur ? 0 : -1
    })
  }, [ref, controls])
  useLayoutEffect(apply)
  return {
    onFocus(e: React.FocusEvent<HTMLElement>) {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-rv]')
      if (t && !t.closest('[data-pop-root]')) {
        active.current = t.dataset.rv ?? null
        apply()
      }
    },
    onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
      const target = e.target as HTMLElement
      if (target.closest('[data-pop-root]')) return
      if (target.tagName === 'INPUT') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const list = controls()
      const at = list.indexOf(target.closest<HTMLElement>('[data-rv]') as HTMLElement)
      const next = rovingIndex(e.key, at, list.length)
      if (next === null) return
      e.preventDefault()
      list[next]?.focus()
    },
  }
}

// ---------------------------------------------------------------- popover

// A flat popover placed just under its anchor, absolutely inside the ribbon
// (so the panel's own horizontal scroll cannot clip it and the viewer's
// --de-* variables still reach it). Esc / outside click / Tab close it.
function Popover({
  pop, ctx, children, role, label, className,
}: {
  pop: PopoverHandle
  ctx: Ctx
  children: ReactNode
  role: 'listbox' | 'menu' | 'dialog'
  label: string
  className?: string
}) {
  const { anchor, popRef: ref, close: onClose } = pop
  const [pos, setPos] = useState<{ left: number; top: number; origin: number } | null>(null)
  useLayoutEffect(() => {
    const a = anchor.current
    const p = ref.current
    const b = ctx.boundary.current
    if (!a || !p || !b) return
    const ar = a.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    const left = Math.max(4, Math.min(ar.left - br.left, br.width - p.offsetWidth - 4))
    setPos({ left, top: ar.bottom - br.top + 4, origin: popoverOriginX(ar.left - br.left, ar.width, left, p.offsetWidth) })
  }, [anchor, ref, ctx.boundary])
  // Focus the selected (or first) item once the popover is placed and visible.
  const placed = pos !== null
  const popItems = (): HTMLElement[] => {
    const root = ref.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('[data-pop], [data-rv]')).filter((e) => e.closest('[data-pop-root]') === root)
  }
  const isOff = (e: HTMLElement) => (e as HTMLButtonElement).disabled === true
  useEffect(() => {
    if (!placed) return
    const items = popItems()
    const sel = items.findIndex((e) => e.getAttribute('aria-selected') === 'true')
    const at = firstFocusIndex(items.map(isOff), sel)
    items[at]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed])
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return
      onClose(false)
    }
    const away = () => onClose(false)
    document.addEventListener('pointerdown', down)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('pointerdown', down)
      window.removeEventListener('resize', away)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      onClose(true)
      return
    }
    if (e.key === 'Tab') {
      // a dialog popover lets Tab walk its controls (and out); menus and lists close
      if (tabClosesPopover(role)) onClose(true)
      return
    }
    const items = popItems()
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-pop], [data-rv]')
    if (!items.length || (e.target as HTMLElement).tagName === 'INPUT') return
    const next = nextEnabledIndex(e.key, target ? items.indexOf(target) : -1, items.map(isOff))
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    items[next]?.focus()
  }
  const style: CSSProperties = pos ? { left: pos.left, top: pos.top, transformOrigin: `${pos.origin}px 0` } : { left: 0, top: 0, visibility: 'hidden' }
  return (
    <div
      ref={ref}
      className={`de-r-pop${className ? ' ' + className : ''}`}
      data-pop-root=""
      data-state={pop.state}
      role={role}
      aria-label={label}
      style={style}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // focus walked out of the popover (and not back onto its own trigger): close without stealing it back
        const to = e.relatedTarget as Node | null
        if (to && !ref.current?.contains(to) && !anchor.current?.contains(to)) onClose(false)
      }}
      onMouseDown={(e) => {
        // keep editor focus, except where the field itself needs the pointer
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) e.preventDefault()
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- option list

function OptionList({ options, value, onPick, strength }: { options: RibbonOption[]; value: string; onPick(v: string): void; strength: number }) {
  return (
    <>
      {options.map((o) => {
        const look = previewLook(o.preview, strength)
        const style: CSSProperties = {
          fontSize: `${look.fontSizeEm}em`,
          fontWeight: look.fontWeight,
          fontStyle: look.italic ? 'italic' : 'normal',
          fontFamily: o.preview?.family ?? (look.mono ? 'var(--de-font-stack-code)' : undefined),
          color: o.preview?.color,
        }
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            data-pop=""
            className="de-r-opt"
            aria-selected={o.value === value}
            onClick={() => onPick(o.value)}
          >
            <span style={style}>{o.label}</span>
          </button>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------- controls

function ButtonControl({ item, ctx }: { item: Extract<RibbonControl, { kind: 'button' | 'toggle' }>; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const large = item.size === 'large' && !ctx.compact
  return (
    <button
      type="button"
      onMouseDown={prevent}
      data-component="ribbon-button"
      data-rv={item.id}
      data-size={large ? 'large' : 'small'}
      className="de-rb"
      aria-label={item.label}
      aria-pressed={item.kind === 'toggle' ? item.active : undefined}
      title={controlTitle(item, ctx.mac)}
      disabled={!item.enabled}
      onClick={() => ctx.run(item.run)}
    >
      <Icon size={large ? 18 : 16} />
      {large && <span className="de-rb-label">{item.label}</span>}
    </button>
  )
}

// Opens a popover under a trigger; the trigger keeps focus handling uniform.
function usePopover() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }, [])
  // The popover stays mounted (data-state="closed") while its exit animation plays.
  const presence = usePresence(open, popRef)
  return { open, setOpen, anchor, trigger, close, popRef, mounted: presence.mounted, state: presence.state, gen: presence.gen }
}
type PopoverHandle = ReturnType<typeof usePopover>

function SelectControl({ item, ctx }: { item: RibbonSelect; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const pop = usePopover()
  const current = item.options.find((o) => o.value === item.value)
  const showText = !ctx.compact
  const showIcon = ctx.compact || item.id !== 'font-family'
  return (
    <span className="de-r-anchor" ref={pop.anchor}>
      <button
        type="button"
        ref={pop.trigger}
        data-component="ribbon-select"
        data-rv={item.id}
        data-compact={ctx.compact || undefined}
        className="de-rsel"
        aria-label={`${item.label}: ${current?.label ?? item.value}`}
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        title={controlTitle(item, ctx.mac)}
        disabled={!item.enabled}
        onMouseDown={prevent}
        onClick={() => pop.setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !pop.open) {
            e.preventDefault()
            e.stopPropagation() // inside a popover, opening this list wins over moving focus
            pop.setOpen(true)
          }
        }}
      >
        {showIcon && <Icon size={16} />}
        {showText && <span className="de-rsel-text" style={{ fontFamily: current?.preview?.family }}>{current?.label ?? item.value}</span>}
        <Chevron />
      </button>
      {pop.mounted && (
        <Popover key={pop.gen} pop={pop} ctx={ctx} role="listbox" label={item.label}>
          <OptionList
            options={item.options}
            value={item.value}
            strength={0.6}
            onPick={(v) => {
              pop.close(false)
              ctx.run(() => item.onChange(v))
            }}
          />
        </Popover>
      )}
    </span>
  )
}

// The selected tile's accent outline: one bar that slides to the new tile.
function GalleryInk({ list, value, count }: { list: RefObject<HTMLElement | null>; value: string; count: number }) {
  const ink = useInk(list, (root) => root.querySelector<HTMLElement>('[aria-selected="true"]'), [value, count], true)
  return <span ref={ink} className="de-gal-ink" aria-hidden="true" />
}

function GalleryControl({ item, ctx }: { item: RibbonGallery; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const pop = usePopover()
  const galRef = useRef<HTMLSpanElement | null>(null)
  const pick = (v: string) => {
    pop.close(false)
    ctx.run(() => item.onChange(v))
  }
  const list = (
    <Popover key={pop.gen} pop={pop} ctx={ctx} role="listbox" label={item.label} className="de-r-pop-gallery">
      <OptionList options={item.options} value={item.value} strength={0.8} onPick={pick} />
    </Popover>
  )
  if (ctx.compact) {
    return (
      <span className="de-r-anchor" ref={pop.anchor}>
        <button
          type="button"
          ref={pop.trigger}
          data-component="ribbon-select"
          data-rv={item.id}
          data-compact
          className="de-rsel"
          aria-label={`${item.label}: ${item.options.find((o) => o.value === item.value)?.label ?? item.value}`}
          aria-haspopup="listbox"
          aria-expanded={pop.open}
          title={controlTitle(item, ctx.mac)}
          disabled={!item.enabled}
          onMouseDown={prevent}
          onClick={() => pop.setOpen((o) => !o)}
        >
          <Icon size={16} />
          <Chevron />
        </button>
        {pop.mounted && list}
      </span>
    )
  }
  const tiles = galleryWindow(item.options, item.value, ctx.tiles)
  return (
    <span className="de-r-anchor" ref={pop.anchor}>
      <span data-component="ribbon-gallery" className="de-gal-wrap">
        <span ref={galRef} role="listbox" aria-label={item.label} className="de-gal">
        <GalleryInk list={galRef} value={item.value} count={tiles.length} />
        {tiles.map((o) => {
          const look = previewLook(o.preview, 0.25)
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              data-rv={`${item.id}:${o.value}`}
              className="de-gal-tile"
              aria-selected={o.value === item.value}
              aria-label={o.label}
              title={o.label}
              disabled={!item.enabled}
              onMouseDown={prevent}
              onClick={() => ctx.run(() => item.onChange(o.value))}
            >
              <span
                className="de-gal-name"
                style={{
                  fontSize: `${look.fontSizeEm}em`,
                  fontWeight: look.fontWeight,
                  fontStyle: look.italic ? 'italic' : 'normal',
                  fontFamily: o.preview?.family ?? (look.mono ? 'var(--de-font-stack-code)' : undefined),
                  color: o.preview?.color,
                }}
              >
                {o.label}
              </span>
            </button>
          )
        })}
        </span>
        <button
          type="button"
          ref={pop.trigger}
          data-rv={`${item.id}:more`}
          className="de-gal-more"
          aria-label="All styles"
          aria-haspopup="listbox"
          aria-expanded={pop.open}
          title="All styles"
          disabled={!item.enabled}
          onMouseDown={prevent}
          onClick={() => pop.setOpen((o) => !o)}
        >
          <Chevron />
        </button>
      </span>
      {pop.mounted && list}
    </span>
  )
}

function NumberInput({ item, ctx }: { item: RibbonNumber; ctx: Ctx }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string | null) => {
    if (raw === null) return
    setDraft(null)
    const n = clampNumber(parseFloat(raw), item.min, item.max)
    // a blur means focus is going elsewhere on purpose: never pull it back to the editor
    if (n !== null && n !== item.value) ctx.runQuiet(() => item.onChange(n))
  }
  const step = (dir: 1 | -1) => {
    const n = clampNumber(item.value + dir * item.step, item.min, item.max)
    if (n !== null && n !== item.value) ctx.run(() => item.onChange(n))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      role="spinbutton"
      data-rv={item.id}
      className="de-rnum"
      aria-label={item.label}
      aria-valuemin={item.min}
      aria-valuemax={item.max}
      aria-valuenow={item.value}
      title={controlTitle(item, ctx.mac)}
      disabled={!item.enabled}
      value={draft ?? String(item.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(draft ?? String(item.value))
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          step(e.key === 'ArrowUp' ? 1 : -1)
        } else if (e.key === 'Escape') {
          setDraft(null)
        }
      }}
    />
  )
}

function NumberControl({ item, ctx }: { item: RibbonNumber; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const pop = usePopover()
  if (!ctx.compact) {
    return (
      <span className="de-rnum-wrap" data-component="ribbon-button">
        <NumberInput item={item} ctx={ctx} />
      </span>
    )
  }
  return (
    <span className="de-r-anchor" ref={pop.anchor}>
      <button
        type="button"
        ref={pop.trigger}
        data-component="ribbon-button"
        data-rv={item.id}
        className="de-rb"
        data-size="small"
        aria-label={`${item.label}: ${item.value}`}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        title={controlTitle(item, ctx.mac)}
        disabled={!item.enabled}
        onMouseDown={prevent}
        onClick={() => pop.setOpen((o) => !o)}
      >
        <Icon size={16} />
      </button>
      {pop.mounted && (
        <Popover key={pop.gen} pop={pop} ctx={ctx} role="dialog" label={item.label}>
          <span className="de-rnum-wrap">
            <NumberInput item={item} ctx={ctx} />
            <span className="de-rnum-unit">{item.unit}</span>
          </span>
        </Popover>
      )}
    </span>
  )
}

function ColorControl({ item, ctx }: { item: RibbonColor; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const pop = usePopover()
  const pick = (v: string | null) => {
    pop.close(false)
    ctx.run(() => item.onChange(v))
  }
  return (
    <span className="de-r-anchor" ref={pop.anchor}>
      <button
        type="button"
        ref={pop.trigger}
        data-component="ribbon-button"
        data-rv={item.id}
        data-size="small"
        className="de-rb de-rcolor"
        aria-label={item.label}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        title={controlTitle(item, ctx.mac)}
        disabled={!item.enabled}
        onMouseDown={prevent}
        onClick={() => pop.setOpen((o) => !o)}
      >
        <Icon size={16} />
        <span className="de-rcolor-bar" style={item.value ? { background: item.value } : undefined} data-auto={item.value ? undefined : ''} />
      </button>
      {pop.mounted && (
        <Popover key={pop.gen} pop={pop} ctx={ctx} role="dialog" label={item.label} className="de-r-pop-swatches">
          <div className="de-swatches">
            {item.swatches.map((c) => (
              <button
                key={c}
                type="button"
                data-pop=""
                className="de-swatch"
                aria-label={c}
                title={c}
                aria-pressed={item.value === c}
                style={{ background: c }}
                onClick={() => pick(c)}
              />
            ))}
          </div>
          <button type="button" data-pop="" className="de-r-opt" onClick={() => pick(null)}>
            Automatic
          </button>
        </Popover>
      )}
    </span>
  )
}

function Control({ item, ctx, brk }: { item: RibbonItem; ctx: Ctx; brk?: boolean }) {
  switch (item.kind) {
    case 'separator':
      return <span className={brk ? 'de-r-sep de-r-brk' : 'de-r-sep'} role="separator" aria-orientation="vertical" />
    case 'button':
    case 'toggle':
      return <ButtonControl item={item} ctx={ctx} />
    case 'select':
      return <SelectControl item={item} ctx={ctx} />
    case 'gallery':
      return <GalleryControl item={item} ctx={ctx} />
    case 'number':
      return <NumberControl item={item} ctx={ctx} />
    case 'color':
      return <ColorControl item={item} ctx={ctx} />
  }
}

// ---------------------------------------------------------------- groups & tabs

function Group({ group, ctx, index }: { group: RibbonGroup; ctx: Ctx; index: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rv = useRoving(ref)
  const twoRows = group.items.some((i) => i.kind === 'select' || i.kind === 'number')
  const hasGallery = group.items.some((i) => i.kind === 'gallery')
  const breakId = twoRows ? group.items.find((i) => i.kind === 'separator')?.id : undefined
  return (
    <div
      ref={ref}
      role="group"
      aria-label={group.label}
      data-component="ribbon-group"
      data-rows={twoRows ? 2 : 1}
      data-gallery={hasGallery || undefined}
      className="de-rg"
      style={{ '--i': index } as CSSProperties}
      onFocus={rv.onFocus}
      onKeyDown={rv.onKeyDown}
    >
      <div className="de-rg-body">
        {group.items.map((item) => (
          <Control key={item.id} item={item} ctx={ctx} brk={item.id === breakId} />
        ))}
      </div>
      <div className="de-rg-label" aria-hidden="true">{group.label}</div>
    </div>
  )
}

function NarrowRow({ ribbon, ctx, width, label }: { ribbon: RibbonData; ctx: Ctx; width: number; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rv = useRoving(ref)
  const all = useMemo(() => flattenRibbon(ribbon), [ribbon])
  // Each control is 28px + 2px gap; the row has 8px padding each side.
  const capacity = Math.floor((width - 16) / 30)
  const { shown, overflow } = overflowSplit(all, capacity, (c) => controlSlots(c.kind))
  const pop = usePopover()
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className="de-rrow"
      onFocus={rv.onFocus}
      onKeyDown={rv.onKeyDown}
    >
      {shown.map((item) => (
        <Control key={item.id} item={item} ctx={ctx} />
      ))}
      {overflow.length > 0 && (
        <span className="de-r-anchor" ref={pop.anchor}>
          <button
            type="button"
            ref={pop.trigger}
            data-component="ribbon-button"
            data-rv="__more"
            data-size="small"
            className="de-rb"
            aria-label="More commands"
            title="More commands"
            aria-haspopup="dialog"
            aria-expanded={pop.open}
            onMouseDown={prevent}
            onClick={() => pop.setOpen((o) => !o)}
          >
            <MoreGlyph />
          </button>
          {pop.mounted && (
            <Popover key={pop.gen} pop={pop} ctx={ctx} role="dialog" label="More commands" className="de-r-pop-more">
              <div className="de-more-grid">
                {overflow.map((item) => (
                  <Control key={item.id} item={item} ctx={ctx} />
                ))}
              </div>
            </Popover>
          )}
        </span>
      )}
    </div>
  )
}

// The active tab's underline: one bar that slides between tabs.
function TabInk({ list, tabs, active }: { list: RefObject<HTMLElement | null>; tabs: RefObject<(HTMLButtonElement | null)[]>; active: number }) {
  const ink = useInk(list, () => tabs.current[active] ?? null, [active])
  return <span ref={ink} className="de-rtab-ink" aria-hidden="true" />
}

export default function Ribbon({ ribbon, icons, onDone, label = 'Formatting', notices }: RibbonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const width = useWidth(rootRef)
  const wasNarrow = useRef(false)
  const narrow = isNarrow(width, wasNarrow.current)
  wasNarrow.current = narrow
  const [notice, setNotice] = useState<string | null>(null)
  // the notice line slides in and out: keep its text while the exit plays
  const noteRef = useRef<HTMLSpanElement | null>(null)
  const notePresence = usePresence(notice !== null, noteRef)
  const lastNotice = useRef('')
  if (notice !== null) lastNotice.current = notice
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = (notices ? notices.subscribe : subscribeRibbonNotices)((m) => {
      setNotice(m)
      clearTimeout(timer)
      timer = setTimeout(() => setNotice(null), 4000)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [notices])
  const uid = useId()
  const [tabId, setTabId] = useState<string>(ribbon.tabs[0]?.id ?? '')
  const tab = ribbon.tabs.find((t) => t.id === tabId) ?? ribbon.tabs[0]
  // motion only after the first user-driven change: the ribbon does not animate in on mount
  const [moved, setMoved] = useState(false)
  const selectTab = (id: string) => {
    if (id === tab?.id) return
    setMoved(true)
    setTabId(id)
  }
  // the tabs <-> icon-row swap fades in; the very first measurement (width 0 -> real) is not a swap
  const wasNarrowOnce = useRef(narrow)
  const prevWidth = useRef(0)
  const [swapped, setSwapped] = useState(false)
  if (wasNarrowOnce.current !== narrow) {
    wasNarrowOnce.current = narrow
    if (prevWidth.current > 0) setSwapped(true)
  }
  prevWidth.current = width
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  const ctx: Ctx = {
    icons,
    run: (fn) => {
      fn()
      doneRef.current?.()
    },
    runQuiet: (fn) => fn(),
    compact: narrow,
    tiles: galleryTileCount(width),
    mac,
    boundary: rootRef,
  }
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  function onTabKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const at = ribbon.tabs.findIndex((t) => t.id === tab?.id)
    const next = rovingIndex(e.key === 'ArrowUp' || e.key === 'ArrowDown' ? '' : e.key, at, ribbon.tabs.length)
    if (next === null) return
    e.preventDefault()
    selectTab(ribbon.tabs[next].id)
    tabRefs.current[next]?.focus()
  }
  if (!tab) return null
  return (
    <div ref={rootRef} className="de-ribbon" data-component="ribbon" data-narrow={narrow || undefined}>
      <div className="de-rlayout" key={narrow ? 'narrow' : 'wide'} data-swap={swapped || undefined}>
      {narrow ? (
        <NarrowRow ribbon={ribbon} ctx={ctx} width={width} label={label} />
      ) : (
        <>
          <div ref={tabListRef} role="tablist" aria-label={label} className="de-rtabs" onKeyDown={onTabKey}>
            <TabInk list={tabListRef} tabs={tabRefs} active={ribbon.tabs.findIndex((t) => t.id === tab.id)} />
            {ribbon.tabs.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.id}`}
                aria-controls={`${uid}-panel-${t.id}`}
                aria-selected={t.id === tab.id}
                tabIndex={t.id === tab.id ? 0 : -1}
                data-component="ribbon-tab"
                className="de-rtab"
                onMouseDown={prevent}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${uid}-panel-${tab.id}`}
            aria-labelledby={`${uid}-tab-${tab.id}`}
            className="de-rpanel"
          >
            <PanelToolbar tab={tab} ctx={ctx} animate={moved} />
          </div>
        </>
      )}
      </div>
      <div className="de-r-status" role="status" aria-live="polite">
        {notePresence.mounted && (
          <span key={notePresence.gen} ref={noteRef} className="de-r-note" data-state={notePresence.state}>{lastNotice.current}</span>
        )}
      </div>
    </div>
  )
}

// The toolbar of one tab: groups side by side. Group-level roving lives in Group.
function PanelToolbar({ tab, ctx, animate }: { tab: RibbonData['tabs'][number]; ctx: Ctx; animate: boolean }) {
  return (
    <div role="toolbar" key={tab.id} data-anim={animate || undefined} aria-label={tab.label} aria-orientation="horizontal" className="de-rtoolbar">
      {tab.groups.map((g, i) => (
        <Group key={g.id} group={g} ctx={ctx} index={i} />
      ))}
    </div>
  )
}
