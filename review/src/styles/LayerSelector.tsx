import type { GraphType } from '../../../graph-engine/src/style/theme/types'
import { layerKey, type EditedLayer } from './controls'
import './controls.css'

export type { EditedLayer }

export interface LayerSelectorProps {
  layer: EditedLayer
  graphTypes: readonly GraphType[]
  onChange: (layer: EditedLayer) => void
}

// Which layer is being edited: the theme's, one graph type of the theme, or the document's.
export function LayerSelector({ layer, graphTypes, onChange }: LayerSelectorProps) {
  const current = layerKey(layer)
  const choices: { layer: EditedLayer; label: string }[] = [
    { layer: { kind: 'theme' }, label: 'theme' },
    ...graphTypes.map((graphType): { layer: EditedLayer; label: string } => ({ layer: { kind: 'themeType', graphType }, label: `theme / ${graphType}` })),
    { layer: { kind: 'document' }, label: 'document' },
  ]
  return (
    <div className="sp-layer" role="group" aria-label="Edited layer">
      {choices.map((c) => (
        <button key={layerKey(c.layer)} type="button" aria-pressed={layerKey(c.layer) === current} onClick={() => onChange(c.layer)}>
          {c.label}
        </button>
      ))}
    </div>
  )
}
