import { useMemo } from 'react'
import type { SettingSpec, SettingValue } from '../../../graph-engine/src/style/settings/types'
import { clampNumber, curvePath, formatNumber, groupSpecs, shownValue } from './controls'
import './controls.css'

export interface SettingsPanelProps {
  specs: readonly SettingSpec[]
  // This layer's own values.
  values: ReadonlyMap<string, SettingValue>
  // The value from the layers below, shown when the layer has none.
  inherited: ReadonlyMap<string, SettingValue>
  meanings?: (path: string) => string | undefined
  ratings?: (path: string) => string | undefined
  // undefined = clear back to inherited.
  onChange: (path: string, value: SettingValue | undefined) => void
}

// The settings of any list of specs, grouped in collapsible sections. Props in, events out.
export function SettingsPanel({ specs, values, inherited, meanings, ratings, onChange }: SettingsPanelProps) {
  const groups = useMemo(() => groupSpecs(specs), [specs])
  return (
    <div className="sp">
      {groups.map((g) => (
        <details key={g.group} className="sp-group" open>
          <summary>
            {g.group}
            <span className="sp-count">{g.specs.length}</span>
          </summary>
          <div className="sp-rows">
            {g.specs.map((spec) => (
              <SettingRow key={spec.path} spec={spec} values={values} inherited={inherited} meanings={meanings} ratings={ratings} onChange={onChange} />
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

type RowProps = Pick<SettingsPanelProps, 'values' | 'inherited' | 'meanings' | 'ratings' | 'onChange'> & { spec: SettingSpec }

function SettingRow({ spec, values, inherited, meanings, ratings, onChange }: RowProps) {
  const own = values.has(spec.path)
  const shown = shownValue(spec.path, values, inherited) ?? spec.default
  const hint = [meanings?.(spec.path), ratings?.(spec.path)].filter((s): s is string => !!s).join('\n\n')
  const set = (v: SettingValue) => onChange(spec.path, v)
  return (
    <div className={`sp-row${own ? '' : ' is-inherited'}`} title={hint || undefined}>
      <span className="sp-label">{spec.label}</span>
      <div className="sp-ctl">
        <Control spec={spec} value={shown} set={set} />
        {spec.unit !== undefined && <span className="sp-unit">{spec.unit}</span>}
        {!own && (
          <button type="button" className="sp-set" title="Set a value on this layer" onClick={() => set(shown)}>
            set
          </button>
        )}
      </div>
      {own ? (
        <button type="button" className="sp-btn" aria-label={`Clear ${spec.label}`} title="Clear back to inherited" onClick={() => onChange(spec.path, undefined)}>
          ×
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

function Control({ spec, value, set }: { spec: SettingSpec; value: SettingValue; set: (v: SettingValue) => void }) {
  if (spec.type === 'number') {
    const n = typeof value === 'number' ? value : Number(spec.default)
    const commit = (raw: number) => {
      const v = clampNumber(spec, raw)
      if (v !== undefined) set(v)
    }
    return (
      <>
        <input type="range" aria-label={spec.label} min={spec.min} max={spec.max} step={spec.integer === true ? Math.max(1, spec.step ?? 1) : spec.step} value={n} onChange={(e) => commit(e.target.valueAsNumber)} />
        <input type="number" aria-label={`${spec.label}, value`} min={spec.min} max={spec.max} step={spec.step} value={formatNumber(spec, n)} onChange={(e) => commit(e.target.valueAsNumber)} />
      </>
    )
  }
  if (spec.type === 'choice') {
    return (
      <select aria-label={spec.label} value={String(value)} onChange={(e) => set(e.target.value)}>
        {(spec.choices ?? []).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    )
  }
  if (spec.type === 'colour') {
    return <input type="color" aria-label={spec.label} value={typeof value === 'string' ? value : '#000000'} onChange={(e) => set(e.target.value)} />
  }
  const points = Array.isArray(value) ? value : []
  return (
    <svg width="96" height="32" viewBox="0 0 96 32" role="img" aria-label={`${spec.label}, curve`}>
      <path d={curvePath(points, spec, 96, 32)} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
