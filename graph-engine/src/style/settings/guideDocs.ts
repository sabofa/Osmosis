// The settings guide as markdown: GUIDE (the table joined to its prose) plus the sweep's measurements,
// written out as one page per engine and an index (docs/styles/*.md). Pure and deterministic: the same
// inputs give the same text, LF line endings, so tools/build-guide.mts can write it and guide.test.ts
// can hold the committed pages equal to it. Imports guide.ts (the prose), so no renderer may import this.

import { GUIDE, type GuideEntry } from './guide'
import type { SweepEntry, SweepFile } from './sweepTypes'

export const GUIDE_PAGES = ['paint.md', 'figures.md', 'media.md', 'backgrounds.md'] as const
type Page = (typeof GUIDE_PAGES)[number]

const TITLES: Record<Page, string> = {
  'paint.md': 'Paint',
  'figures.md': 'Figures',
  'media.md': 'Media',
  'backgrounds.md': 'Backgrounds',
}

const HEADERS: Record<Page, string> = {
  'paint.md': 'The settings of the painter (`paint.*`). Ratings are measured on the per-frame painter; see each meaning for bake differences.',
  'figures.md': 'The settings of the 2D figure styles (`style.*`, except the paper). Ratings are measured on the figure renderer.',
  'media.md': 'The settings of the drawing media (`media.*`). Ratings are measured on a fixed set of strokes drawn in each medium.',
  'backgrounds.md': 'The settings of the board and the paper (`board.*` and `style.paper.*`). Ratings are measured on the board and the paper tile.',
}

const COLUMNS = ['path', 'label', 'meaning', 'range', 'default', 'unit', 'rating', 'active range', 'safe range', 'interactions', 'applies to']

// Which page a setting is on.
export function pageOf(path: string): Page {
  if (path.startsWith('paint.')) return 'paint.md'
  if (path.startsWith('media.')) return 'media.md'
  if (path.startsWith('board.') || path.startsWith('style.paper.')) return 'backgrounds.md'
  return 'figures.md'
}

const cell = (text: string): string => text.replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|')
const show = (value: unknown): string => (Array.isArray(value) ? JSON.stringify(value) : String(value))

function rangeOf(entry: GuideEntry): string {
  if (entry.choices !== undefined) return entry.choices.join(', ')
  if (entry.min !== undefined && entry.max !== undefined) return `${entry.min} to ${entry.max}${entry.step !== undefined ? ` (step ${entry.step})` : ''}`
  return '—'
}

// The active range widened by one swept step on each side, clamped to the swept values.
function safeRange(sweep: SweepEntry): [number | string, number | string] | null {
  if (sweep.activeRange === null) return null
  const low = sweep.values.indexOf(sweep.activeRange[0])
  const high = sweep.values.indexOf(sweep.activeRange[1])
  if (low < 0 || high < 0) return sweep.activeRange
  return [sweep.values[Math.max(0, low - 1)], sweep.values[Math.min(sweep.values.length - 1, high + 1)]]
}

const span = (range: [number | string, number | string] | null): string => (range === null ? 'none' : `${range[0]} to ${range[1]}`)

function appliesOf(entry: GuideEntry): string {
  const media = entry.appliesTo.media === 'all' ? 'all media' : entry.appliesTo.media.join(', ')
  return `${entry.appliesTo.graphTypes.join(', ')}; ${media}`
}

function row(entry: GuideEntry, sweep: SweepEntry | undefined): string {
  const measured = sweep !== undefined && sweep.rating !== 'not-drawn-yet'
  const rating = sweep === undefined ? '—' : sweep.rating === 'not-drawn-yet' ? 'not drawn yet' : sweep.rating
  const cells = [
    `\`${entry.path}\``,
    entry.label,
    entry.meaning,
    rangeOf(entry),
    show(entry.default),
    entry.unit ?? '—',
    rating,
    measured ? span(sweep.activeRange) : '—',
    measured ? span(safeRange(sweep)) : '—',
    entry.interactions.length === 0 ? '—' : entry.interactions.map((path) => `\`${path}\``).join(', '),
    appliesOf(entry),
  ]
  return `| ${cells.map(cell).join(' | ')} |`
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const lf = (text: string): string => text.replace(/\r\n/g, '\n')

export function buildGuideDocs(sweep: SweepFile, recipes: Readonly<Record<string, string>>, overview: string): Record<string, string> {
  const sweepAt = new Map(sweep.entries.map((entry) => [entry.path, entry]))
  const out: Record<string, string> = {}
  const counts = new Map<Page, number>()
  for (const page of GUIDE_PAGES) {
    const entries = GUIDE.filter((entry) => pageOf(entry.path) === page).sort((a, b) => compare(a.group, b.group) || compare(a.path, b.path))
    counts.set(page, entries.length)
    const lines = [`# ${TITLES[page]}`, '', HEADERS[page], '', `| ${COLUMNS.join(' | ')} |`, `| ${COLUMNS.map(() => '---').join(' | ')} |`]
    for (const entry of entries) lines.push(row(entry, sweepAt.get(entry.path)))
    out[page] = `${lines.join('\n')}\n`
  }
  const index = GUIDE_PAGES.map((page) => `- [${TITLES[page]}](${page}): ${counts.get(page)} settings`)
  const parts = [lf(overview).trimEnd(), `## Engine pages\n\n${index.join('\n')}`]
  const names = Object.keys(recipes).sort(compare)
  if (names.length > 0) parts.push(['## Recipes', ...names.map((name) => lf(recipes[name]).trimEnd())].join('\n\n'))
  out['GUIDE.md'] = `${parts.join('\n\n')}\n`
  return out
}
