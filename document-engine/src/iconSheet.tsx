import type { ComponentType } from 'react'
import type { IconSheetRef } from 'theme-core'
import { MenuIcon, ZoomInIcon, ZoomOutIcon, FitIcon, DownloadIcon, HighlightIcon, RemoveHighlightIcon, EyeIcon, CloseIcon, GraphExpandIcon, GraphCollapseIcon } from './icons'

export type IconComponent = ComponentType<{ size?: number }>

// Every icon name this package asks the host's toolbar or its own chrome for.
export const ICON_NAMES = [
  'doc-menu',
  'doc-zoom-in',
  'doc-zoom-out',
  'doc-fit',
  'doc-download',
  'doc-highlight',
  'doc-highlight-remove',
  'doc-eye',
  'doc-eye-off',
  'doc-close',
  'graph-expand',
  'graph-collapse',
] as const

export type IconName = (typeof ICON_NAMES)[number]

const EyeOnIcon: IconComponent = ({ size }) => <EyeIcon size={size} />
const EyeOffIcon: IconComponent = ({ size }) => <EyeIcon size={size} off />

const DEFAULT_SHEET: Record<IconName, IconComponent> = {
  'doc-menu': MenuIcon,
  'doc-zoom-in': ZoomInIcon,
  'doc-zoom-out': ZoomOutIcon,
  'doc-fit': FitIcon,
  'doc-download': DownloadIcon,
  'doc-highlight': HighlightIcon,
  'doc-highlight-remove': RemoveHighlightIcon,
  'doc-eye': EyeOnIcon,
  'doc-eye-off': EyeOffIcon,
  'doc-close': CloseIcon,
  'graph-expand': GraphExpandIcon,
  'graph-collapse': GraphCollapseIcon,
}

// Harmless placeholder for a name nobody knows: an empty square.
const EmptyIcon: IconComponent = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth={1.2} strokeDasharray="2 2" />
  </svg>
)

// Resolve an icon name against the host's chosen sheet. This package has no
// glyph source for the builtin/asset sheets yet (the shell supplies those
// later), so for those refs every icon falls back, per icon, to the default
// sheet. Unknown names return the empty square; never throws.
export function resolveIcon(name: string, ref: IconSheetRef): IconComponent {
  void ref
  return Object.prototype.hasOwnProperty.call(DEFAULT_SHEET, name) ? DEFAULT_SHEET[name as IconName] : EmptyIcon
}
