import { applyStyleDirective, applyStyleSet } from '../style/resolve'
import { GIVENS_POSITIONS, VIEW_NAMES, type FeatureKind, type GivensPosition, type GraphConfig, type ViewName } from './config'
import { parseSpaceDirective } from '../space/grammar/directives'

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
// `line` is the 1-based source line, which a @param binding keeps for errors.
export function parseConfigLine(rawLine: string, config: GraphConfig, line = 0): void {
  // "@param a = 1 range [0, 5]" has no colon after its key (SP6), so it is
  // recognised before the "@key: value" split and handed to space.
  const param = /^@param\s+(.*)$/.exec(rawLine.trim())
  if (param) {
    parseSpaceDirective('param', param[1].replace(/^:\s*/, ''), config, line)
    return
  }

  const body = rawLine.trim().slice(1) // strip leading "@"
  const colonIdx = body.indexOf(':')
  if (colonIdx === -1) throw new Error(`Expected "@key: value", got "@${body}"`)

  const key = body.slice(0, colonIdx).trim()
  const value = body.slice(colonIdx + 1).trim()

  // "@style-set: <registry path> <value>" sets any single setting (style.*, paint.*,
  // media.*, board.*) in the figure's layer of the six-layer stack (style/layers.ts).
  // A bad path or an out-of-range value throws before it touches the layer, as below.
  if (key === 'style-set') {
    applyStyleSet(config.style, value)
    return
  }

  // Figure styles — "@style: <preset>" and "@style-<setting>: <value>", in a
  // block of their own (the figure-styles design, D2). Validation and the
  // refusals naming the valid presets, settings and values live with the
  // style model in style/resolve.ts; a refused directive throws before it
  // touches the layer, so the figure draws in the style resolved without it.
  if (key === 'style' || key.startsWith('style-')) {
    applyStyleDirective(config.style, key, value)
    return
  }
  // Space's directives (SP7: @bounds3d, @aspect, @camera, ..., @param).
  if (parseSpaceDirective(key, value, config, line)) return

  switch (key) {
    case 'theme': {
      if (value !== 'light' && value !== 'dark') throw new Error(`@theme must be "light" or "dark", got "${value}"`)
      config.theme = value
      return
    }
    case 'hover': {
      if (value !== 'all' && value !== 'points' && value !== 'features' && value !== 'none') {
        throw new Error(`@hover must be "all", "points", "features", or "none", got "${value}"`)
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
    case 'scale': {
      // Both spellings on purpose. "@scale: false" is what the spec writes
      // and what an author reaching for "not to scale" types; on/off is this
      // parser's convention for every other boolean. Rejecting either would
      // be a papercut in the one place a figure most needs to be writable.
      const b = value === 'true' ? true : value === 'false' ? false : parseBoolean(value)
      if (b === null) throw new Error(`@scale must be "true"/"false" or "on"/"off", got "${value}"`)
      config.toScale = b
      return
    }
    case 'givens': {
      if (!(GIVENS_POSITIONS as readonly string[]).includes(value)) {
        throw new Error(`@givens must be one of ${GIVENS_POSITIONS.join(', ')}, got "${value}"`)
      }
      config.givens = value as GivensPosition
      return
    }
    case 'givens-title': {
      // Kept verbatim, including its case: it is a heading an author wrote,
      // not a keyword.
      config.givensTitle = value === '' ? null : value
      return
    }
    case 'view': {
      if (!(VIEW_NAMES as readonly string[]).includes(value)) {
        throw new Error(`@view must be one of ${VIEW_NAMES.join(', ')}, got "${value}"`)
      }
      config.view = value as ViewName
      return
    }
    case 'mode': {
      if (value !== 'graph' && value !== 'figure' && value !== 'table') {
        throw new Error(`@mode must be "graph", "figure" or "table", got "${value}"`)
      }
      config.mode = value
      // Recorded separately from the value, because "the author asked for a
      // graph" and "the author said nothing and graph is the default" have
      // to be told apart — see scene/mode.ts's resolveMode.
      config.modeDeclared = true
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
      // Group names expand to the concrete kinds they cover. "intercepts" and
      // "vertices" are v1's spellings, kept as aliases because stored
      // questions carry them and the server validates graph_spec with this
      // parser.
      const GROUPS: Record<string, FeatureKind[]> = {
        roots: ['x-intercept', 'y-intercept'],
        intercepts: ['x-intercept', 'y-intercept'],
        extrema: ['local-max', 'local-min'],
        vertices: ['local-max', 'local-min'],
        inflections: ['inflection'],
        intersections: ['intersection'],
        conic: ['center', 'focus', 'conic-vertex'],
      }
      const names = value.split(',').map((v) => v.trim())
      if (names.length === 1 && names[0] === 'none') {
        config.points = new Set()
        return
      }
      if (names.length === 1 && names[0] === 'all') {
        config.points = new Set<FeatureKind>(Object.values(GROUPS).flat())
        return
      }
      const next = new Set<FeatureKind>()
      for (const n of names) {
        const expanded = GROUPS[n]
        if (!expanded) {
          throw new Error(
            `@points entries must be "roots", "extrema", "inflections", "intersections", "conic", "all", or "none", got "${n}"`
          )
        }
        for (const kind of expanded) next.add(kind)
      }
      config.points = next
      return
    }
    case 'labels': {
      if (value !== 'all' && value !== 'coarse' && value !== 'none') {
        throw new Error(`@labels must be "all", "coarse", or "none", got "${value}"`)
      }
      config.labels = value
      return
    }
    case 'label-every': {
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n) || n < 1 || String(n) !== value) {
        throw new Error(`@label-every must be a positive whole number, got "${value}"`)
      }
      config.labelEvery = n
      return
    }
    case 'step-mode': {
      if (value !== 'nice' && value !== 'geometric' && value !== 'fixed') {
        throw new Error(`@step-mode must be "nice", "geometric", or "fixed", got "${value}"`)
      }
      config.stepMode = value
      return
    }
    case 'point-labels': {
      if (value !== 'off' && value !== 'coords') {
        throw new Error(`@point-labels must be "off" or "coords", got "${value}"`)
      }
      config.pointLabels = value
      return
    }
    default:
      throw new Error(`Unknown config key "@${key}"`)
  }
}
