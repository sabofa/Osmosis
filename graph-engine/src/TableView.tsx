import { useCallback, useEffect, useRef, useState } from 'react'
import type { NamedTableData } from './scene/buildTable'
import type { GraphConfig } from './parser/config'
import './TableView.css'

export interface TableViewProps {
  tables: NamedTableData[]
  theme: GraphConfig['theme']
  // Mirrors GraphConfig's "@formulas: on/off" directive — shows each
  // generator-built table's source formula in its card when true. A table
  // built only from "header:"/"row:" lines has no formula regardless.
  showFormulas: boolean
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const CARD_WIDTH = 300
const CARD_GAP = 56
// Matches the dot-grid background-size baked into TableView.css's
// .table-view-light/-dark rules — kept in sync here so the dots can be
// panned/zoomed in lockstep with .table-view-content below instead of
// staying fixed to the container while the cards move past them.
const DOT_SPACING = 28

function isNumericCell(cell: string): boolean {
  const trimmed = cell.trim()
  return trimmed !== '' && trimmed !== 'undefined' && Number.isFinite(Number(trimmed))
}

// A column reads as numeric (right-aligned, tabular figures) only if every
// row actually has a numeric-looking value in it — a table built from
// "row:" lines can hold arbitrary text, so this only kicks in for columns
// that are consistently numbers (typically a "table: y = f(x) ..." generator).
function numericColumns(rows: string[][]): boolean[] {
  if (rows.length === 0) return []
  const colCount = rows[0].length
  const result: boolean[] = []
  for (let c = 0; c < colCount; c++) {
    result.push(rows.every((row) => row[c] !== undefined && isNumericCell(row[c])))
  }
  return result
}

function TableCard({ table, x, showFormula }: { table: NamedTableData; x: number; showFormula: boolean }) {
  const numericCols = numericColumns(table.rows)
  return (
    <div className="table-view-card" style={{ left: x, top: 0, width: CARD_WIDTH }}>
      {table.name && <div className="table-view-card-name">{table.name}</div>}
      <table>
        {table.headers.length > 0 && (
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className={numericCols[i] ? 'table-view-numeric' : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={numericCols[j] ? 'table-view-numeric' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {showFormula && table.formula && (
        <div className="table-view-card-formula">
          <span className="table-view-card-formula-mark">ƒ</span>
          {table.formula}
        </div>
      )}
    </div>
  )
}

// The non-graph render path: used when "@mode: table" is set. An open,
// pannable/zoomable canvas (drag to pan, scroll to zoom — same interaction
// model as GraphViewer's own 2D view, just driving a CSS transform instead
// of a WebGL camera) holding one card per table a spec defines (see
// scene/buildTable.ts and parser/types.ts's "<name>.header:" grammar) laid
// out side by side, so a question needing several tables just gets another
// card next to the first rather than a single fixed static table.
//
// Deliberately not WebGL — crisp text and native selection/copy-paste
// matter more here than a canvas ever gives you, so panning/zooming is done
// by transforming real DOM <table> elements, not by drawing them.
export default function TableView({ tables, theme, showFormulas }: TableViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState({ x: 40, y: 40, zoom: 1 })
  const draggingRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    try {
      ;(e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      // ignore — pointer capture is a nicety, not required for panning to work
    }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const dx = e.clientX - lastPointerRef.current.x
    const dy = e.clientY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => {
    draggingRef.current = false
  }, [])

  // Zoom around the cursor (keeps the point under it fixed) — same
  // before/after-anchor technique as Camera2D.zoomAt, just applied to a CSS
  // translate+scale instead of an orthographic camera's projection.
  //
  // A native listener rather than React's onWheel prop: React registers
  // wheel handlers as passive by default, so e.preventDefault() inside a
  // synthetic onWheel is silently ignored (and logs a warning) — it never
  // actually stops the page from scrolling underneath the canvas while you
  // zoom it. SceneRenderer.ts's own wheel handling (for the graph view) hits
  // the same DOM behavior, which is why it's a plain addEventListener there
  // too, not JSX.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.001)
      setTransform((t) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.zoom * factor))
        const canvasX = (cursorX - t.x) / t.zoom
        const canvasY = (cursorY - t.y) / t.zoom
        return { x: cursorX - canvasX * zoom, y: cursorY - canvasY * zoom, zoom }
      })
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`table-view table-view-${theme}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        backgroundPosition: `${transform.x}px ${transform.y}px`,
        backgroundSize: `${DOT_SPACING * transform.zoom}px ${DOT_SPACING * transform.zoom}px`,
      }}
    >
      {tables.length === 0 ? (
        <div className="table-view-empty">
          <div className="table-view-empty-title">No table yet</div>
          <div className="table-view-empty-hint">
            Add "header:"/"row:" lines, or a "table: y = f(x) for x in [a,b] step s" line. Prefix with "name." (e.g.
            "scores.header: ...") to add more than one table.
          </div>
        </div>
      ) : (
        <>
          <div
            className="table-view-content"
            style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})` }}
          >
            {tables.map((table, i) => (
              <TableCard
                key={table.name || '__default'}
                table={table}
                x={i * (CARD_WIDTH + CARD_GAP)}
                showFormula={showFormulas}
              />
            ))}
          </div>
          <div className="table-view-hint">drag to pan · scroll to zoom</div>
        </>
      )}
    </div>
  )
}
