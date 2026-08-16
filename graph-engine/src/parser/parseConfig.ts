import type { FeaturePointKind, GraphConfig } from './config'

export function isConfigLine(rawLine: string): boolean {
  return rawLine.trim().startsWith('@')
}

function parseBoolean(value: string): boolean | null {
  if (value === 'on') return true
  if (value === 'off') return false
  return null
}

// Mutates `config` in place with the directive on one "@key: value" line.
// Throws with a human-readable message on an unknown key or a bad value —
// caught by the caller (parseSpec) the same way a bad statement line is.
export function parseConfigLine(rawLine: string, config: GraphConfig): void {
  const body = rawLine.trim().slice(1) // strip leading "@"
  const colonIdx = body.indexOf(':')
  if (colonIdx === -1) throw new Error(`Expected "@key: value", got "@${body}"`)

  const key = body.slice(0, colonIdx).trim()
  const value = body.slice(colonIdx + 1).trim()

  switch (key) {
    case 'theme': {
      if (value !== 'light' && value !== 'dark') throw new Error(`@theme must be "light" or "dark", got "${value}"`)
      config.theme = value
      return
    }
    case 'hover': {
      if (value !== 'all' && value !== 'points' && value !== 'none') {
        throw new Error(`@hover must be "all", "points", or "none", got "${value}"`)
      }
      config.hover = value
      return
    }
    case 'xstep':
    case 'ystep': {
      const n = Number.parseFloat(value)
      if (!Number.isFinite(n) || n <= 0) throw new Error(`@${key} must be a positive number, got "${value}"`)
      config[key] = n
      return
    }
    case 'bounds': {
      const parts = value.split(',').map((p) => Number.parseFloat(p.trim()))
      if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
        throw new Error(`@bounds must be "xMin,xMax,yMin,yMax", got "${value}"`)
      }
      const [xMin, xMax, yMin, yMax] = parts
      if (xMin >= xMax || yMin >= yMax) throw new Error(`@bounds min must be less than max, got "${value}"`)
      config.bounds = { xMin, xMax, yMin, yMax }
      return
    }
    case 'grid':
    case 'axes':
    case 'asymptotes': {
      const b = parseBoolean(value)
      if (b === null) throw new Error(`@${key} must be "on" or "off", got "${value}"`)
      config[key] = b
      return
    }
    case 'formulas': {
      const b = parseBoolean(value)
      if (b === null) throw new Error(`@${key} must be "on" or "off", got "${value}"`)
      config.tableFormulas = b
      return
    }
    case 'angle': {
      if (value !== 'degrees' && value !== 'radians') throw new Error(`@angle must be "degrees" or "radians", got "${value}"`)
      config.angle = value
      return
    }
    case 'mode': {
      if (value !== 'graph' && value !== 'table') throw new Error(`@mode must be "graph" or "table", got "${value}"`)
      config.mode = value
      return
    }
    case 'hide':
    case 'show': {
      const names = value.split(',').map((v) => v.trim())
      for (const n of names) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error(`@${key} entries must be plain names, got "${n}"`)
        if (key === 'hide') config.hidden.add(n)
        else config.hidden.delete(n)
      }
      return
    }
    case 'points': {
      const kinds = value.split(',').map((v) => v.trim())
      if (kinds.length === 1 && kinds[0] === 'none') {
        config.points = new Set()
        return
      }
      if (kinds.length === 1 && kinds[0] === 'all') {
        config.points = new Set<FeaturePointKind>(['intercepts', 'vertices'])
        return
      }
      const valid: FeaturePointKind[] = ['intercepts', 'vertices']
      for (const k of kinds) {
        if (!valid.includes(k as FeaturePointKind)) {
          throw new Error(`@points entries must be "intercepts", "vertices", "all", or "none", got "${k}"`)
        }
      }
      config.points = new Set(kinds as FeaturePointKind[])
      return
    }
    default:
      throw new Error(`Unknown config key "@${key}"`)
  }
}
