import type { ThemeStyles } from '../layers'

// The style sets of the four built-in themes, by preset id.
//
// Until Ben's theming overhaul a built-in theme carries its style settings here, in
// code, and a custom theme uses the defaults (graph styles design, 5.3): this avoids
// adding a server field that the overhaul would replace. The overhaul then supplies
// `ThemeInput.styles` from wherever themes live and this table goes away.
//
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
export const BUILTIN_THEME_STYLES: Record<string, ThemeStyles> = {
  'builtin:slate': {},
  'builtin:forest': {},
  'builtin:ember': {},
  'builtin:plum': {},
}
