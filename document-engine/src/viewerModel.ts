import type { Chrome, DocumentAnchor, DocumentLayer, Interaction } from './types'

export interface Capabilities {
  selection: boolean
  highlight: boolean
  highlightPopover: boolean
  settingsMenu: boolean
  layers: boolean
  editStub: boolean
}

export const EDIT_STUB_MESSAGE = 'Editing arrives in a later release'

export function capabilities(interaction: Interaction, chrome: Chrome): Capabilities {
  const full = chrome === 'full'
  const annotate = full && interaction === 'annotate'
  return {
    selection: true,
    highlight: annotate,
    highlightPopover: annotate,
    settingsMenu: full,
    layers: full,
    editStub: interaction === 'edit',
  }
}

export const GATED_DEFAULT_LABEL = 'Hidden'

export interface GatedPresentation {
  gated: boolean
  contentHidden: boolean
  placeholder: string | null
}

// What the viewer shows while the host has gated it. The viewer does not know
// why; it only hides content from sight and the accessibility tree. Zoom and
// scroll are viewer state and are deliberately not part of this.
export function gatedPresentation(gated: boolean | undefined, label?: string): GatedPresentation {
  if (!gated) return { gated: false, contentHidden: false, placeholder: null }
  return { gated: true, contentHidden: true, placeholder: label && label.trim() ? label : GATED_DEFAULT_LABEL }
}

export interface ResolvedMarker {
  id: string
  offset: number
  quote?: string
  prefix?: string
  suffix?: string
  activate: () => void
}

// The text offsets are converted and quotes re-found against. A PDF is painted
// against the PdfLayer's own pdfjs text, so that wins once it has loaded;
// otherwise empty (see awaitingPdfText); non-PDF uses the asset text.
export function offsetText(usesPdfLayer: boolean, pdfText: string, assetText: string): string {
  return usesPdfLayer ? pdfText : assetText
}

// A PDF layer whose text has not arrived yet: offsets/quotes have nothing valid
// to resolve against, so nothing is painted (never fall back to the asset text).
export function awaitingPdfText(usesPdfLayer: boolean, pdfText: string): boolean {
  return usesPdfLayer && !pdfText
}

// `getLayers` lets marker activation read the CURRENT layers at click time, so a
// callback that changes between renders is honoured even though this result is
// memoised on the layers' data only.
export function resolveLayers(
  layers: DocumentLayer[],
  getLayers?: () => DocumentLayer[]
): { anchors: DocumentAnchor[]; markers: ResolvedMarker[] } {
  const anchors: DocumentAnchor[] = []
  const markers: ResolvedMarker[] = []
  layers.forEach((layer, idx) => {
    if (layer.anchor) anchors.push(layer.anchor)
    for (const m of layer.markers ?? []) {
      markers.push({ id: m.id, offset: m.offset, quote: m.quote, prefix: m.prefix, suffix: m.suffix, activate: () => (getLayers ? getLayers()[idx] : layer)?.onMarkerActivate?.(m.id) })
    }
  })
  return { anchors, markers }
}
