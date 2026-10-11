import type { ComponentType } from 'react'
import type { IconSheetRef } from 'theme-core'
import { MenuIcon, ZoomInIcon, ZoomOutIcon, FitIcon, DownloadIcon, HighlightIcon, RemoveHighlightIcon, EyeIcon, CloseIcon, GraphExpandIcon, GraphCollapseIcon, BoldIcon, ItalicIcon, StrikeIcon, CodeIcon, LinkIcon, HeadingIcon, ListBulletIcon, ListNumberIcon, ListTaskIcon, QuoteIcon, UndoIcon, RedoIcon, SearchIcon, DocPasteIcon, DocCutIcon, DocCopyIcon, DocSelectAllIcon, DocReplaceIcon, DocIndentIcon, DocOutdentIcon, DocClearFormatIcon, DocHrIcon, DocCodeBlockIcon, DocMathIcon, DocGraphIcon, DocImageIcon, DocTableIcon, DocUnderlineIcon, DocSubscriptIcon, DocSuperscriptIcon, DocFontGrowIcon, DocFontShrinkIcon, DocFontIcon, DocTextColorIcon, DocAlignLeftIcon, DocAlignCenterIcon, DocAlignRightIcon, DocAlignJustifyIcon, DocLineSpacingIcon, DocMarginsIcon, DocOrientationIcon, DocPageSizeIcon } from './icons'

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
  'doc-bold',
  'doc-italic',
  'doc-strike',
  'doc-code',
  'doc-link',
  'doc-heading',
  'doc-list-bullet',
  'doc-list-number',
  'doc-list-task',
  'doc-quote',
  'doc-undo',
  'doc-redo',
  'doc-search',
  'doc-paste',
  'doc-cut',
  'doc-copy',
  'doc-select-all',
  'doc-replace',
  'doc-indent',
  'doc-outdent',
  'doc-clear-format',
  'doc-hr',
  'doc-code-block',
  'doc-math',
  'doc-graph',
  'doc-image',
  'doc-table',
  'doc-underline',
  'doc-subscript',
  'doc-superscript',
  'doc-font-grow',
  'doc-font-shrink',
  'doc-font',
  'doc-text-color',
  'doc-align-left',
  'doc-align-center',
  'doc-align-right',
  'doc-align-justify',
  'doc-line-spacing',
  'doc-margins',
  'doc-orientation',
  'doc-page-size',
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
  'doc-bold': BoldIcon,
  'doc-italic': ItalicIcon,
  'doc-strike': StrikeIcon,
  'doc-code': CodeIcon,
  'doc-link': LinkIcon,
  'doc-heading': HeadingIcon,
  'doc-list-bullet': ListBulletIcon,
  'doc-list-number': ListNumberIcon,
  'doc-list-task': ListTaskIcon,
  'doc-quote': QuoteIcon,
  'doc-undo': UndoIcon,
  'doc-redo': RedoIcon,
  'doc-search': SearchIcon,
  'doc-paste': DocPasteIcon,
  'doc-cut': DocCutIcon,
  'doc-copy': DocCopyIcon,
  'doc-select-all': DocSelectAllIcon,
  'doc-replace': DocReplaceIcon,
  'doc-indent': DocIndentIcon,
  'doc-outdent': DocOutdentIcon,
  'doc-clear-format': DocClearFormatIcon,
  'doc-hr': DocHrIcon,
  'doc-code-block': DocCodeBlockIcon,
  'doc-math': DocMathIcon,
  'doc-graph': DocGraphIcon,
  'doc-image': DocImageIcon,
  'doc-table': DocTableIcon,
  'doc-underline': DocUnderlineIcon,
  'doc-subscript': DocSubscriptIcon,
  'doc-superscript': DocSuperscriptIcon,
  'doc-font-grow': DocFontGrowIcon,
  'doc-font-shrink': DocFontShrinkIcon,
  'doc-font': DocFontIcon,
  'doc-text-color': DocTextColorIcon,
  'doc-align-left': DocAlignLeftIcon,
  'doc-align-center': DocAlignCenterIcon,
  'doc-align-right': DocAlignRightIcon,
  'doc-align-justify': DocAlignJustifyIcon,
  'doc-line-spacing': DocLineSpacingIcon,
  'doc-margins': DocMarginsIcon,
  'doc-orientation': DocOrientationIcon,
  'doc-page-size': DocPageSizeIcon,
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
