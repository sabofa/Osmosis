import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { EXAMPLES } from '../../../graph-engine/src/examples'
import { renderFigure } from '../../../graph-engine/src/figure/render'
import { parseSpec } from '../../../graph-engine/src/parser/parseSpec'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../../graph-engine/src/render/palette'
import { SPACE_EXAMPLES } from '../../../graph-engine/src/space/examples'
import { SpaceRenderer } from '../../../graph-engine/src/space/SpaceRenderer'
import type { SettingsLayer, ThemeStyles } from '../../../graph-engine/src/style/layers'
import { PRESET_NAMES, type PresetName } from '../../../graph-engine/src/style/presets'
import { fillPaperTiles, releaseUnusedPaperTiles } from '../../../graph-engine/src/style/papers/host'
import type { StyleLayer } from '../../../graph-engine/src/style/resolve'
import { GRAPH_TYPES, type GraphType } from '../../../graph-engine/src/style/theme/types'
import { themeInputOf, type ThemeChoice } from './controls'

// Graph types as rows, presets as columns. The figures are drawn by the figure renderer through the
// stack: the theme's layers (with the column's preset as the theme-all layer's preset), the document
// layer, and the example's own directives. The page owns the state; this only draws it.

export interface ShowcaseProps {
  choice: ThemeChoice
  // The theme's layers (undefined = none) and the document's.
  themeStyles: ThemeStyles | undefined
  document: SettingsLayer | undefined
  // One big figure of this preset instead of the grid (a close look at a paper).
  solo?: PresetName
}

const FIGURES: Partial<Record<GraphType, readonly string[]>> = {
  figure2d: ['Measured + notation', 'Circle vocabulary'],
  figure3d: ['Cube and its net', 'AIME tetrahedron'],
}

const specOf = (label: string): string => EXAMPLES.find((e) => e.label === label)?.spec ?? ''

// The column's preset stands in for the theme-all layer's own preset; that layer's single settings stay on top of it.
const withPreset = (styles: ThemeStyles | undefined, preset: PresetName): ThemeStyles => ({ ...styles, all: { ...styles?.all, preset } })

function drawFigure(label: string, choice: ThemeChoice, styles: ThemeStyles | undefined, doc: SettingsLayer | undefined, preset: PresetName): string {
  const theme = themeInputOf(choice, withPreset(styles, preset))
  const parsed = parseSpec(specOf(label))
  const base = doc && (doc.preset !== undefined || Object.keys(doc.set ?? {}).length > 0) ? (doc as StyleLayer) : undefined
  return renderFigure(parsed.statements, parsed.config, theme.mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE, base, theme).svg
}

function Figure({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) void fillPaperTiles(ref.current).then(() => releaseUnusedPaperTiles())
  }, [html])
  return <div ref={ref} className="sc-figure" dangerouslySetInnerHTML={{ __html: html }} />
}

// SpaceRenderer on a bare canvas, as review/src/space.tsx mounts it.
function SpaceCell({ mode }: { mode: 'light' | 'dark' }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', 'Space view')
    host.appendChild(canvas)
    const renderer = new SpaceRenderer(canvas, { palette: mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE, theme: mode, onError: setError })
    const parsed = parseSpec(SPACE_EXAMPLES[0].spec)
    renderer.setSpec(parsed.statements, parsed.config, parsed.statementLines, SPACE_EXAMPLES[0].spec)
    return () => {
      renderer.dispose()
      canvas.remove()
    }
  }, [mode])
  return (
    <div className="sc-space">
      <div ref={hostRef} className="sc-space-host" />
      {error && <p className="sc-note">{error}</p>}
    </div>
  )
}

export function Showcase(props: ShowcaseProps) {
  const { solo } = props
  const choice = useDeferredValue(props.choice)
  const themeStyles = useDeferredValue(props.themeStyles)
  const doc = useDeferredValue(props.document)
  const mode = useMemo(() => themeInputOf(choice).mode, [choice])
  const cells = useMemo(() => {
    const out: Partial<Record<GraphType, Record<string, string[]>>> = {}
    for (const graphType of GRAPH_TYPES) {
      const labels = FIGURES[graphType]
      if (!labels) continue
      out[graphType] = Object.fromEntries((solo ? [solo] : PRESET_NAMES).map((preset) => [preset, labels.map((label) => drawFigure(label, choice, themeStyles, doc, preset))]))
    }
    return out
  }, [choice, themeStyles, doc, solo])

  if (solo) {
    return (
      <div className="sc-solo">
        {(cells.figure2d?.[solo] ?? []).slice(0, 1).map((html, i) => (
          <Figure key={i} html={html} />
        ))}
      </div>
    )
  }
  return (
    <div className="sc" style={{ gridTemplateColumns: `90px repeat(${PRESET_NAMES.length}, minmax(0, 1fr))` }}>
      <span />
      {PRESET_NAMES.map((p) => (
        <span key={p} className="sc-head">
          {p}
        </span>
      ))}
      {GRAPH_TYPES.map((graphType) => (
        <Row key={graphType} graphType={graphType} mode={mode} cells={cells[graphType]} />
      ))}
    </div>
  )
}

function Row({ graphType, mode, cells }: { graphType: GraphType; mode: 'light' | 'dark'; cells: Record<string, string[]> | undefined }) {
  const label = <span className="sc-rowlabel">{graphType}</span>
  if (cells) {
    return (
      <>
        {label}
        {PRESET_NAMES.map((p) => (
          <div key={p} className="sc-cell">
            {(cells[p] ?? []).map((html, i) => (
              <Figure key={i} html={html} />
            ))}
          </div>
        ))}
      </>
    )
  }
  if (graphType === 'space') {
    return (
      <>
        {label}
        <div className="sc-cell" style={{ gridColumn: 'span 2' }}>
          <SpaceCell mode={mode} />
        </div>
        <p className="sc-note" style={{ gridColumn: 'span 6' }}>
          One clean cell: space draws no presets yet.
        </p>
      </>
    )
  }
  return (
    <>
      {label}
      <p className="sc-cell sc-placeholder" style={{ gridColumn: `span ${PRESET_NAMES.length}` }}>
        {graphType}: styles reach this graph type later.
      </p>
    </>
  )
}
