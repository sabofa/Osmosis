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
  rovingIndex, controlTitle, galleryWindow, galleryTileCount, overflowSplit, controlSlots, isNarrow, previewLook, clampNumber,
} from './ribbonNav'
import { subscribeRibbonNotices } from './ribbonNotice'
import './Ribbon.css'

export interface RibbonProps {
  ribbon: RibbonData
  icons: IconSheetRef
  /** Called after a control ran, so the owner can return focus to its editor. */
  onDone?: () => void
  /** Accessible name of the whole ribbon. */
  label?: string
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
  anchor, ctx, onClose, children, role, label, className,
}: {
  anchor: RefObject<HTMLElement | null>
  ctx: Ctx
  onClose(refocus: boolean): void
  children: ReactNode
  role: 'listbox' | 'menu' | 'dialog'
  label: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const a = anchor.current
    const p = ref.current
    const b = ctx.boundary.current
    if (!a || !p || !b) return
    const ar = a.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    const left = Math.max(4, Math.min(ar.left - br.left, br.width - p.offsetWidth - 4))
    setPos({ left, top: ar.bottom - br.top + 4 })
  }, [anchor, ctx.boundary])
  // Focus the selected (or first) item once the popover is placed and visible.
  const placed = pos !== null
  useEffect(() => {
    if (!placed) return
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"], [data-pop]')?.focus()
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
      onClose(true)
      return
    }
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-pop]') ?? [])
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-pop]')
    if (!items.length || (e.target as HTMLElement).tagName === 'INPUT') return
    const next = rovingIndex(e.key, target ? items.indexOf(target) : -1, items.length)
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    items[next]?.focus()
  }
  const style: CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }
  return (
    <div
      ref={ref}
      className={`de-r-pop${className ? ' ' + className : ''}`}
      data-pop-root=""
      role={role}
      aria-label={label}
      style={style}
      onKeyDown={onKeyDown}
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
function usePopover(ctx: Ctx) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }, [])
  void ctx
  return { open, setOpen, anchor, trigger, close }
}

function SelectControl({ item, ctx }: { item: RibbonSelect; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const pop = usePopover(ctx)
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
            pop.setOpen(true)
          }
        }}
      >
        {showIcon && <Icon size={16} />}
        {showText && <span className="de-rsel-text" style={{ fontFamily: current?.preview?.family }}>{current?.label ?? item.value}</span>}
        <Chevron />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} ctx={ctx} onClose={pop.close} role="listbox" label={item.label}>
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

function GalleryControl({ item, ctx }: { item: RibbonGallery; ctx: Ctx }) {
  const Icon = resolveIcon(item.icon, ctx.icons)
  const pop = usePopover(ctx)
  const pick = (v: string) => {
    pop.close(false)
    ctx.run(() => item.onChange(v))
  }
  const list = (
    <Popover anchor={pop.anchor} ctx={ctx} onClose={pop.close} role="listbox" label={item.label} className="de-r-pop-gallery">
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
        {pop.open && list}
      </span>
    )
  }
  const tiles = galleryWindow(item.options, item.value, ctx.tiles)
  return (
    <span className="de-r-anchor" ref={pop.anchor}>
      <span data-component="ribbon-gallery" className="de-gal-wrap">
        <span role="listbox" aria-label={item.label} className="de-gal">
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
      {pop.open && list}
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
  const pop = usePopover(ctx)
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
      {pop.open && (
        <Popover anchor={pop.anchor} ctx={ctx} onClose={pop.close} role="dialog" label={item.label}>
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
  const pop = usePopover(ctx)
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
      {pop.open && (
        <Popover anchor={pop.anchor} ctx={ctx} onClose={pop.close} role="dialog" label={item.label} className="de-r-pop-swatches">
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

function Group({ group, ctx }: { group: RibbonGroup; ctx: Ctx }) {
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
  const pop = usePopover(ctx)
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
          {pop.open && (
            <Popover anchor={pop.anchor} ctx={ctx} onClose={pop.close} role="dialog" label="More commands" className="de-r-pop-more">
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

export default function Ribbon({ ribbon, icons, onDone, label = 'Formatting' }: RibbonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const width = useWidth(rootRef)
  const wasNarrow = useRef(false)
  const narrow = isNarrow(width, wasNarrow.current)
  wasNarrow.current = narrow
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeRibbonNotices((m) => {
      setNotice(m)
      clearTimeout(timer)
      timer = setTimeout(() => setNotice(null), 4000)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])
  const uid = useId()
  const [tabId, setTabId] = useState<string>(ribbon.tabs[0]?.id ?? '')
  const tab = ribbon.tabs.find((t) => t.id === tabId) ?? ribbon.tabs[0]
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
    setTabId(ribbon.tabs[next].id)
    tabRefs.current[next]?.focus()
  }
  if (!tab) return null
  return (
    <div ref={rootRef} className="de-ribbon" data-component="ribbon" data-narrow={narrow || undefined}>
      {narrow ? (
        <NarrowRow ribbon={ribbon} ctx={ctx} width={width} label={label} />
      ) : (
        <>
          <div role="tablist" aria-label={label} className="de-rtabs" onKeyDown={onTabKey}>
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
                onClick={() => setTabId(t.id)}
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
            <PanelToolbar tab={tab} ctx={ctx} />
          </div>
        </>
      )}
      <div className="de-r-status" role="status" aria-live="polite">{notice}</div>
    </div>
  )
}

// The toolbar of one tab: groups side by side. Group-level roving lives in Group.
function PanelToolbar({ tab, ctx }: { tab: RibbonData['tabs'][number]; ctx: Ctx }) {
  return (
    <div role="toolbar" aria-label={tab.label} aria-orientation="horizontal" className="de-rtoolbar">
      {tab.groups.map((g) => (
        <Group key={g.id} group={g} ctx={ctx} />
      ))}
    </div>
  )
}
