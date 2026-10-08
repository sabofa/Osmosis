import { def, hex, mixTo, type DeriveCtx, type TokenDef, type TokenType } from './types.js'

/**
 * Copied from milestone-a/main graph-engine/src/parser/config.ts:22 (FeatureKind);
 * not present on main yet.
 */
export const FEATURE_KINDS = [
  'x-intercept', 'y-intercept', 'local-max', 'local-min', 'inflection',
  'center', 'focus', 'conic-vertex', 'intersection',
] as const

type Row = [string, string, (c: DeriveCtx) => string]

const alias = (to: string) => (c: DeriveCtx): string => c.get(to)

function build(g: 'graph' | 'document', type: TokenType, modeDependent: boolean, rows: Row[]): TokenDef[] {
  return rows.map(([name, meaning, derive]) => def(name, g, type, meaning, derive, { modeDependent }))
}

export const GRAPH_TOKENS: TokenDef[] = [
  ...build('graph', 'color', true, [
    ['graph-paper', 'Background of the graph plane (the "paper" the curves are drawn on).', alias('color-surface')],
    ['graph-ink', 'Colour of graph labels, tick text and default curve strokes.', alias('color-text')],
    ['graph-grid', 'Minor gridlines of the graph plane.', alias('color-border')],
    ['graph-grid-strong', 'Major gridlines and tick marks of the graph plane.', alias('color-border-strong')],
    ['graph-axis', 'The x and y axes; a little softer than the ink.', (c) => hex(mixTo(c.col('color-text'), c.col('color-surface'), 0.25))],
    ['graph-segment', 'Colour of drawn segments, rays and constructions marked as correct or given.', alias('color-good')],
    ['graph-point', 'Colour of plotted points the learner must notice or answer with.', alias('color-bad')],
    ['graph-hover', 'Highlight colour for the curve or point under the pointer.', alias('color-accent')],
    ...FEATURE_KINDS.map((kind, i): Row => [
      `graph-marker-${kind}`,
      `Marker colour for ${kind.replace('-', ' ')} features on a graph (data colour ${(i % 8) + 1}).`,
      alias(`color-series-${(i % 8) + 1}`),
    ]),
  ]),
  ...build('graph', 'number', false, [
    ['graph-region-alpha', 'Opacity of shaded regions (inequalities, areas under curves).', () => '0.18'],
  ]),
]

export const DOC_TOKENS: TokenDef[] = [
  ...build('document', 'color', true, [
    ['doc-page', 'Background of the document page.', alias('color-surface')],
    ['doc-text', 'Body text colour inside documents.', alias('color-text')],
    ['doc-rule', 'Horizontal rules and table borders inside documents.', alias('color-border')],
    ['doc-code-bg', 'Background of code blocks and inline code in documents.', alias('color-surface-sunken')],
    ['doc-code-text', 'Text colour of code in documents.', alias('color-text')],
    ['doc-table-header', 'Background of table header rows in documents.', alias('color-surface-sunken')],
    ['doc-table-stripe', 'Background of alternate (striped) table rows in documents.', (c) => hex(mixTo(c.col('color-surface'), c.col('color-text'), 0.03))],
  ]),
  ...build('document', 'length', false, [
    ['doc-measure', 'Maximum line length of document text, for comfortable reading.', () => '68ch'],
  ]),  ...build('document', 'font', false, [
    ['doc-font-body', "Font stack for document body text. Defaults to the UI body font; the document engine's reading themes override it without touching UI fonts.", alias('font-body')],
  ]),
]
