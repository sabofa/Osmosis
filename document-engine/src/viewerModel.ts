import type { Chrome, DocumentAnchor, DocumentLayer, DocumentMarker, Interaction } from './types'

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

// TODO(T3.6): remove adapter. Legacy props from before layers existed; the
// legacy marker callback is a question-jump and is only named here.
export interface LegacyViewerProps {
  mode?: 'full' | 'simple'
  anchor?: DocumentAnchor | null
  markers?: DocumentMarker[]
  onJumpToQuestion?: (questionId: string) => void
}

export interface NormalizableProps extends LegacyViewerProps {
  interaction?: Interaction
  chrome?: Chrome
  layers?: DocumentLayer[]
}

export interface NormalizedProps {
  interaction: Interaction
  chrome: Chrome
  layers: DocumentLayer[]
}

// TODO(T3.6): remove adapter — keep only the interaction/chrome/layers part.
export function normalizeProps(p: NormalizableProps): NormalizedProps {
  const legacyInteraction: Interaction | undefined = p.mode === 'simple' ? 'view' : p.mode === 'full' ? 'annotate' : undefined
  const legacyChrome: Chrome | undefined = p.mode === 'simple' ? 'embedded' : p.mode === 'full' ? 'full' : undefined
  const layers = [...(p.layers ?? [])]
  if (p.anchor || (p.markers && p.markers.length > 0) || p.onJumpToQuestion) {
    layers.push({ anchor: p.anchor ?? null, markers: p.markers ?? [], onMarkerActivate: p.onJumpToQuestion })
  }
  return {
    interaction: p.interaction ?? legacyInteraction ?? 'annotate',
    chrome: p.chrome ?? legacyChrome ?? 'full',
    layers,
  }
}

export interface ResolvedMarker {
  id: string
  offset: number
  quote?: string
  prefix?: string
  suffix?: string
  activate: () => void
}

export function resolveLayers(layers: DocumentLayer[]): { anchors: DocumentAnchor[]; markers: ResolvedMarker[] } {
  const anchors: DocumentAnchor[] = []
  const markers: ResolvedMarker[] = []
  for (const layer of layers) {
    if (layer.anchor) anchors.push(layer.anchor)
    for (const m of layer.markers ?? []) {
      markers.push({ id: m.id, offset: m.offset, quote: m.quote, prefix: m.prefix, suffix: m.suffix, activate: () => layer.onMarkerActivate?.(m.id) })
    }
  }
  return { anchors, markers }
}
