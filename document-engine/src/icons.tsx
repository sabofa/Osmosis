type IconProps = { size?: number }

export function MenuIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function ZoomInIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M10.5 7.5v6M7.5 10.5h6M20 20l-4.35-4.35" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function ZoomOutIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M7.5 10.5h6M20 20l-4.35-4.35" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function DownloadIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function HighlightIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M14.5 3.5 20.5 9.5 10 20H4v-6L14.5 3.5Z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M4 20h16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function EyeIcon({ size = 16, off = false }: IconProps & { off?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={1.8} />
      {off && <path d="M3 3l18 18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />}
    </svg>
  )
}

export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 5l14 14M19 5 5 19" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function RemoveHighlightIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M14.5 3.5 20.5 9.5 10 20H4v-6L14.5 3.5Z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M4 20h16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function FitIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Four outward corners.
export function GraphExpandIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Four inward corners.
export function GraphCollapseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Editor command glyphs: simple strokes on the same 24px grid.
const strokeProps = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function BoldIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z" {...strokeProps} />
    </svg>
  )
}

export function ItalicIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10 5h8M6 19h8M14.5 5l-5 14" {...strokeProps} />
    </svg>
  )
}

export function StrikeIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 12h16M16.5 7.5C15.8 6 14.2 5 12 5c-2.4 0-4 1.2-4 3 0 1.2.8 2 2.5 2.5M7.5 16.5C8.2 18 9.8 19 12 19c2.6 0 4.2-1.2 4.2-3 0-1-.5-1.8-1.7-2.5" {...strokeProps} />
    </svg>
  )
}

export function CodeIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" {...strokeProps} />
    </svg>
  )
}

export function LinkIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...strokeProps} />
    </svg>
  )
}

export function HeadingIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 5v14M18 5v14M6 12h12" {...strokeProps} />
    </svg>
  )
}

export function ListBulletIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10 6h10M10 12h10M10 18h10M5 6h.01M5 12h.01M5 18h.01" {...strokeProps} />
    </svg>
  )
}

export function ListNumberIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11 6h9M11 12h9M11 18h9M4.5 5l1.5-1v5M4 14.5c0-1 1-1.5 1.8-1.5s1.2.5 1.2 1.2c0 .8-.8 1.4-2.8 3.3H7" {...strokeProps} />
    </svg>
  )
}

export function ListTaskIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11 7h9M11 17h9M3.5 5.5h4v4h-4zM4 16l1.5 1.5L8 14.5" {...strokeProps} />
    </svg>
  )
}

export function QuoteIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 6v12M10 8h9M10 12h9M10 16h6" {...strokeProps} />
    </svg>
  )
}

export function UndoIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 7" {...strokeProps} />
    </svg>
  )
}

export function RedoIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 7" {...strokeProps} />
    </svg>
  )
}

export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.5" cy="10.5" r="6.5" {...strokeProps} />
      <path d="M20 20l-4.35-4.35" {...strokeProps} />
    </svg>
  )
}

export function DocPasteIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="5" width="14" height="16" rx="2" {...strokeProps} /><path d="M9 5V4h6v1M9 11h6M9 15h6" {...strokeProps} />
    </svg>
  )
}

export function DocCutIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="7" cy="17" r="2.5" {...strokeProps} /><circle cx="17" cy="17" r="2.5" {...strokeProps} /><path d="M8.5 15L16 4M15.5 15L8 4" {...strokeProps} />
    </svg>
  )
}

export function DocCopyIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="8" y="8" width="12" height="12" rx="2" {...strokeProps} /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...strokeProps} />
    </svg>
  )
}

export function DocSelectAllIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" {...strokeProps} /><path d="M8 10h8M8 14h5" {...strokeProps} />
    </svg>
  )
}

export function DocReplaceIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 9h13l-3-3M20 15H7l3 3" {...strokeProps} />
    </svg>
  )
}

export function DocIndentIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 5h16M12 10h8M12 14h8M4 19h16M4 9.5l3 2.5-3 2.5" {...strokeProps} />
    </svg>
  )
}

export function DocOutdentIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 5h16M12 10h8M12 14h8M4 19h16M7 9.5L4 12l3 2.5" {...strokeProps} />
    </svg>
  )
}

export function DocClearFormatIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 5h9M9.5 5L7 17M14 20l6-6M14 14l6 6" {...strokeProps} />
    </svg>
  )
}

export function DocHrIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 12h16M7 6h10M7 18h10" {...strokeProps} />
    </svg>
  )
}

export function DocCodeBlockIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" {...strokeProps} /><path d="M10 9l-3 3 3 3M14 9l3 3-3 3" {...strokeProps} />
    </svg>
  )
}

export function DocMathIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M18 5H7l6 7-6 7h11" {...strokeProps} />
    </svg>
  )
}

export function DocGraphIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 4v16h16" {...strokeProps} /><path d="M7 15c2-8 4-8 6-3s4 3 6-4" {...strokeProps} />
    </svg>
  )
}

export function DocImageIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" {...strokeProps} /><circle cx="9" cy="10" r="1.8" {...strokeProps} /><path d="M3 17l5-4 4 3 3-2 6 4" {...strokeProps} />
    </svg>
  )
}

export function DocTableIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" {...strokeProps} /><path d="M3 10h18M3 15h18M10 4v16" {...strokeProps} />
    </svg>
  )
}

export function DocUnderlineIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" {...strokeProps} />
    </svg>
  )
}

export function DocSubscriptIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6l8 9M12 6l-8 9M16 18c0-2 4-1.5 4-3.5S17 13 16 14" {...strokeProps} />
    </svg>
  )
}

export function DocSuperscriptIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 9l8 9M12 9l-8 9M16 8c0-2 4-1.5 4-3.5S17 3 16 4" {...strokeProps} />
    </svg>
  )
}

export function DocFontGrowIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 19l5-13 5 13M5 14h6M17 10V4M14 7h6" {...strokeProps} />
    </svg>
  )
}

export function DocFontShrinkIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 19l5-13 5 13M5 14h6M14 7h6" {...strokeProps} />
    </svg>
  )
}

export function DocFontIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 19l7-14 7 14M8 14h8" {...strokeProps} />
    </svg>
  )
}

export function DocTextColorIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 16l5-11 5 11M9 12h6M5 21h14" {...strokeProps} />
    </svg>
  )
}

export function DocAlignLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M4 10h10M4 14h16M4 18h10" {...strokeProps} />
    </svg>
  )
}

export function DocAlignCenterIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M7 10h10M4 14h16M7 18h10" {...strokeProps} />
    </svg>
  )
}

export function DocAlignRightIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M10 10h10M4 14h16M10 18h10" {...strokeProps} />
    </svg>
  )
}

export function DocAlignJustifyIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M4 10h16M4 14h16M4 18h16" {...strokeProps} />
    </svg>
  )
}

export function DocLineSpacingIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10 6h10M10 12h10M10 18h10M5 5v14M3 7l2-2 2 2M3 17l2 2 2-2" {...strokeProps} />
    </svg>
  )
}

export function DocMarginsIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="3" width="16" height="18" rx="1.5" {...strokeProps} /><path d="M8 3v18M16 3v18" {...strokeProps} />
    </svg>
  )
}

export function DocOrientationIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="7" width="18" height="11" rx="1.5" {...strokeProps} /><path d="M9 4h6" {...strokeProps} />
    </svg>
  )
}

export function DocPageSizeIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="6" y="3" width="12" height="18" rx="1.5" {...strokeProps} /><path d="M9 8h6M9 12h6" {...strokeProps} />
    </svg>
  )
}
