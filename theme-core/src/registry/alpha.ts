import { LAYER_TOKENS, dialDefault, formatAlpha } from '../layerTokens.js'
import { def, type Group, type TokenDef } from './types.js'

/** Six layer transparency tokens. Defaults, floors and the dial rule come from LAYER_TOKENS (graph-region-alpha lives in engines.ts). */
const ROWS: ReadonlyArray<readonly [string, Group, string]> = [
  ['doc-sheet-alpha', 'document', 'Opacity of the document sheet (the page the text sits on). 1 is solid paper; lower lets the ambience show through behind the text. Never below its floor, so text stays readable.'],
  ['doc-surface-alpha', 'document', 'Opacity of surfaces inside a document: tables, code blocks, quotes and boxes drawn over the sheet.'],
  ['doc-media-alpha', 'document', 'Opacity of pictures and PDFs placed in a document. Never less opaque than the document sheet.'],
  ['graph-paper-alpha', 'graph', 'Opacity of the graph paper background. Chalk and whiteboard papers keep a higher floor so curves stay legible.'],
  ['graph-grid-alpha', 'graph', 'Opacity of the graph gridlines.'],
  ['callout-alpha', 'surface', 'Opacity of callouts and note boxes that sit over content.'],
]

export const ALPHA_TOKENS: TokenDef[] = ROWS.map(([name, group, meaning]) => {
  const l = LAYER_TOKENS.find((t) => t.token === name)!
  return def(name, group, 'number', meaning, (c) => formatAlpha(dialDefault(name, c.dials.translucency)), {
    modeDependent: false, min: l.floor, max: 1,
  })
})
