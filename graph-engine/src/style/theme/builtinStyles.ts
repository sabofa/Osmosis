import type { ThemeStyles } from '../layers'
import { checkThemeStyles } from '../resolve'
import slate from './builtinStyles/slate.json'
import forest from './builtinStyles/forest.json'
import ember from './builtinStyles/ember.json'
import plum from './builtinStyles/plum.json'

// The style sets of the four built-in themes, by preset id.
//
// Until Ben's theming overhaul a built-in theme carries its style settings here, in
// code, and a custom theme uses the defaults (graph styles design, 5.3): this avoids
// adding a server field that the overhaul would replace. The overhaul then supplies
// `ThemeInput.styles` from wherever themes live and this table goes away.
//
// The four sets are JSON files (builtinStyles/<id>.json), which the Style Lab's Save writes.
// All four are empty to start: Ben tunes them by eye in the Style Lab (Task 8). A set
// is a theme's settings for every graph type (`all`) and for each type (`byType`), as
// registry paths:
//
//   'builtin:ember': {
//     all: { set: { 'style.line.looseness': 0.2 } },
//     byType: { space: { set: { 'paint.value.terminatorSoftness': 0.4 } } },
//   },
//
// An empty set says nothing, and the adapter keeps `styles` undefined for it
// (`stylesForPreset`), so a theme with nothing to say keeps the key it has always had.
//
// The table is frozen, and so is each set in it: nothing at run time (a test, a lab) changes a
// built-in theme. A test that needs a built-in theme with a style set hands the adapter its own
// table (`stylesFromTable`) or its own `StylesFor`.
const deepFreeze = <T extends object>(o: T): T => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v)
  return Object.freeze(o)
}

// Reads each file's contents through checkThemeStyles and throws, naming the theme, on any error:
// a bad file must fail at once (in a test), not quietly at run time. Each entry is checked the first
// time it is read, not when this module loads: resolve.ts imports layers.ts, which re-exports this
// table, so checking at load would run checkThemeStyles before resolve.ts has finished loading
// whenever resolve.ts is the first module imported.
export function loadBuiltinStyles(files: Readonly<Record<string, unknown>>): Readonly<Record<string, ThemeStyles>> {
  const table: Record<string, ThemeStyles> = {}
  for (const [id, raw] of Object.entries(files)) {
    let checked: ThemeStyles | undefined
    Object.defineProperty(table, `builtin:${id}`, {
      enumerable: true,
      get() {
        if (!checked) {
          const { styles, errors } = checkThemeStyles(raw)
          if (errors.length) throw new Error(`Built-in theme style set "${id}" (style/theme/builtinStyles/${id}.json) is invalid: ${errors.join('; ')}`)
          checked = deepFreeze(styles)
        }
        return checked
      },
    })
  }
  return Object.freeze(table)
}

export const BUILTIN_THEME_STYLES: Readonly<Record<string, ThemeStyles>> = loadBuiltinStyles({ slate, forest, ember, plum })
