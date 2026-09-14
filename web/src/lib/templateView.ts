import type { IconKey } from '../components/icons'
import type { TemplateSummary as ViewTemplateSummary } from '../data/templates'
import type { TemplateSummary as ApiTemplateSummary } from './api'

// Maps the real API's TemplateSummary (snake_case, no icon/meta/tags) onto the
// view-model shape TemplateDetail.tsx and Home.tsx were already built against
// (see data/templates.ts). Keeps those presentational components untouched
// while Home switches from mock data to GET /api/templates.

const SUBJECT_ICONS: Record<string, IconKey> = {
  math: 'math',
  chem: 'chem',
  chemistry: 'chem',
  history: 'history',
  physics: 'physics',
}

function subjectOf(tagQuery: ApiTemplateSummary['tag_query']): string | null {
  return tagQuery.all?.[0]?.split(':')[0] ?? tagQuery.any?.[0]?.split(':')[0] ?? null
}

function iconForSubject(subject: string | null): IconKey {
  if (!subject) return 'bolt'
  return SUBJECT_ICONS[subject] ?? 'bolt'
}

function tagsOf(tagQuery: ApiTemplateSummary['tag_query']): string[] {
  return [...(tagQuery.all ?? []), ...(tagQuery.any ?? [])]
}

export function iconForTags(tags: string[]): IconKey {
  return iconForSubject(tags[0]?.split(':')[0] ?? null)
}

export function toViewTemplate(t: ApiTemplateSummary): ViewTemplateSummary {
  const subject = subjectOf(t.tag_query)
  const tags = tagsOf(t.tag_query)
  const calc = t.calculator_policy === 'allowed' || t.calculator_policy === 'forbidden' ? t.calculator_policy : 'any'
  const metaParts = [
    `${t.question_count} question${t.question_count === 1 ? '' : 's'}`,
    tags.length > 0 ? tags.join(', ') : 'whole bank',
    calc,
    t.downloaded ? 'downloaded' : 'cloud',
  ]
  return {
    id: t.id,
    name: t.name,
    icon: iconForSubject(subject),
    meta: metaParts.join(' · '),
    description: t.description ?? '',
    tags,
    questionCount: t.question_count,
    calculatorPolicy: calc,
    weighting: t.weighting as ViewTemplateSummary['weighting'],
    mcRatio: t.mc_ratio,
    difficultyMin: t.difficulty_min,
    difficultyMax: t.difficulty_max,
    frozen: t.frozen,
    timeLimitSec: t.time_limit_sec,
    downloaded: t.downloaded,
  }
}

// Whether Start should be enabled for a template on this device right now.
// Canonical holds the whole bank; a downloaded template draws locally; a
// cloud template needs the node to be online. `status` null = unknown, so be
// permissive and let the server say no.
export function templateAvailable(
  t: { downloaded: boolean },
  status: { online: boolean; canonical: boolean } | null
): boolean {
  if (!status) return true
  return status.canonical || t.downloaded || status.online
}

export const OFFLINE_CLOUD_HINT = 'Offline — download this test to use it offline'
