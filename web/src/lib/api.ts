import type { SessionStreamData, StreamContext } from './sessionStream'
export interface NodeStatus {
  online: boolean
  canonical: boolean
  node: { id: string; label: string; canonical: boolean }
  last_pull_at: string | null
  last_push_at: string | null
  last_write_at: string | null
  remote_url: string | null
  outbox_depth: number
  dead_outbox_depth: number
  dead_outbox: { id: number; entity_type: string; entity_id: string; tries: number; last_try_at: string | null; last_error: string | null }[]
  slices: string[]
  protocol_version: number
  remote_protocol_version: number | null
  // Today's daily attempts, when they exist: the Home cards grey out after
  // one go.
  daily_taken?: { question: string | null; quiz: string | null }
}

export async function getStatus(): Promise<NodeStatus> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`GET /api/status ${res.status}`)
  return res.json()
}

export interface TagSummary {
  slug: string
  label: string
  parent_slug: string | null
  description: string | null
  created_at: string
  retired_at: string | null
  question_count: number
}

export async function getTags(): Promise<{ tags: TagSummary[] }> {
  const res = await fetch('/api/tags')
  if (!res.ok) throw new Error(`GET /api/tags ${res.status}`)
  return res.json()
}

export interface QuestionSummary {
  id: string
  lineage_id: string
  version: number
  type: 'mc' | 'written'
  prompt: string
  difficulty: number
  calculator_policy: 'allowed' | 'forbidden' | 'n_a'
  source_note: string | null
  created_by: 'claude' | 'human'
  created_at: string
  retired_at: string | null
  tags: string[]
  has_graph: boolean
  desmos_allowed: boolean
  has_document: boolean
}

export async function getQuestions(params: { tag?: string; text?: string } = {}): Promise<{ total: number; questions: QuestionSummary[] }> {
  const qs = new URLSearchParams()
  if (params.tag) qs.set('tag', params.tag)
  if (params.text) qs.set('text', params.text)
  const res = await fetch(`/api/questions?${qs}`)
  if (!res.ok) throw new Error(`GET /api/questions ${res.status}`)
  return res.json()
}

export interface QuestionDetail {
  id: string
  lineage_id: string
  version: number
  supersedes_id: string | null
  type: 'mc' | 'written'
  prompt: string
  explanation: string | null
  model_answer: string | null
  rubric: string | null
  difficulty: number
  calculator_policy: 'allowed' | 'forbidden' | 'n_a'
  source_note: string | null
  created_by: 'claude' | 'human'
  created_at: string
  retired_at: string | null
  retired_reason: string | null
  tags: string[]
  choices: { id: string; body: string; is_correct: boolean; ordinal: number }[]
  graph_spec: string | null
  desmos_allowed: boolean
  document_id: string | null
  document_anchor_label: string | null
  document_anchor_start: number | null
  document_anchor_end: number | null
  document_marker_offset: number | null
}

export async function getQuestion(id: string): Promise<QuestionDetail> {
  const res = await fetch(`/api/questions/${id}`)
  if (!res.ok) throw new Error(`GET /api/questions/${id} ${res.status}`)
  return res.json()
}

export interface Asset {
  id: string
  title: string
  type: 'url' | 'text' | 'file'
  content: string | null
  filename: string | null
  mime: string | null
  storage_path: string | null
  extracted_text: string | null
  created_by: 'claude' | 'human'
  created_at: string
}

export interface AssetSummary {
  id: string
  title: string
  type: 'url' | 'text' | 'file'
  created_at: string
  created_by: 'claude' | 'human'
}

export async function getAsset(id: string): Promise<Asset> {
  const res = await fetch(`/api/assets/${id}`)
  if (!res.ok) throw new Error(`GET /api/assets/${id} ${res.status}`)
  return res.json()
}

export async function listAssets(): Promise<AssetSummary[]> {
  const res = await fetch('/api/assets')
  if (!res.ok) throw new Error(`GET /api/assets ${res.status}`)
  const data = await res.json()
  return data.assets
}

export async function uploadAsset(formData: FormData): Promise<Asset> {
  const res = await fetch('/api/assets', { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`POST /api/assets ${res.status}`)
  return res.json()
}

export async function deleteAsset(id: string): Promise<void> {
  const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /api/assets/${id} ${res.status}`)
}

export function assetDownloadUrl(id: string): string {
  return `/api/assets/${id}/download`
}

export interface DocumentMarker {
  id: string
  document_marker_offset: number
}

export async function getDocumentMarkers(assetId: string): Promise<{ markers: DocumentMarker[] }> {
  const res = await fetch(`/api/assets/${assetId}/questions`)
  if (!res.ok) throw new Error(`GET /api/assets/${assetId}/questions ${res.status}`)
  return res.json()
}

export interface TemplateSummary {
  id: string
  name: string
  description: string | null
  tag_query: { all?: string[]; any?: string[]; none?: string[] }
  question_count: number
  mc_ratio: number | null
  difficulty_min: number | null
  difficulty_max: number | null
  calculator_policy: 'allowed' | 'forbidden' | 'any'
  weighting: 'random' | 'weak_weighted' | null
  frozen: boolean
  time_limit_sec: number | null
  eligible_count: number
  attempt_count: number
  mean_score: number | null
  retired_at: string | null
  created_at: string
  updated_at: string
  downloaded: boolean
  downloaded_at: string | null
  update_available: boolean
  estimated_bytes: number
}

export async function getTemplates(): Promise<{ templates: TemplateSummary[] }> {
  const res = await fetch('/api/templates')
  if (!res.ok) throw new Error(`GET /api/templates ${res.status}`)
  return res.json()
}

export async function getTemplate(id: string): Promise<TemplateSummary> {
  const res = await fetch(`/api/templates/${id}`)
  if (!res.ok) throw new Error(`GET /api/templates/${id} ${res.status}`)
  return res.json()
}

export interface TemplateQuestionPreview {
  id: string
  type: 'mc' | 'written'
  prompt: string
  difficulty: number
  created_at: string
}

export async function getTemplateQuestions(id: string): Promise<{ questions: TemplateQuestionPreview[] }> {
  const res = await fetch(`/api/templates/${id}/questions`)
  if (!res.ok) throw new Error(`GET /api/templates/${id}/questions ${res.status}`)
  return res.json()
}

export async function downloadTemplate(id: string): Promise<{ id: string; downloaded_at: string }> {
  const res = await fetch(`/api/templates/${id}/download`, { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/templates/${id}/download ${res.status}`)
  return res.json()
}

export async function deleteLocalTemplate(id: string): Promise<{ id: string }> {
  const res = await fetch(`/api/templates/${id}/download`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /api/templates/${id}/download ${res.status}`)
  return res.json()
}

export interface LocalSlice {
  tag_slug: string
  pulled_at: string
  question_count: number
}

export async function getSlices(): Promise<{ slices: LocalSlice[] }> {
  const res = await fetch('/api/slices')
  if (!res.ok) throw new Error(`GET /api/slices ${res.status}`)
  return res.json()
}

export async function addSlice(tagSlug: string): Promise<{ tag_slug: string }> {
  const res = await fetch('/api/slices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_slug: tagSlug }),
  })
  if (!res.ok) throw new Error(`POST /api/slices ${res.status}`)
  return res.json()
}

export async function removeSlice(tagSlug: string): Promise<{ pruned_questions: number }> {
  const res = await fetch(`/api/slices/${encodeURIComponent(tagSlug)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /api/slices/${tagSlug} ${res.status}`)
  return res.json()
}

export async function triggerSync(): Promise<{ pushed: number; pulled: number; online: boolean }> {
  const res = await fetch('/api/sync', { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/sync ${res.status}`)
  return res.json()
}

export async function getConfig(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/config')
  if (!res.ok) throw new Error(`GET /api/config ${res.status}`)
  return res.json()
}

export async function setConfig(key: string, value: unknown): Promise<{ key: string; value: unknown; updated_at: string }> {
  const res = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (!res.ok) throw new Error(`PATCH /api/config ${res.status}`)
  return res.json()
}

export interface AttemptQuestionChoice {
  id: string
  body: string
  ordinal: number
  is_correct?: boolean
}

export interface AttemptQuestion {
  id: string
  type: 'mc' | 'written'
  prompt: string
  difficulty: number
  calculator_policy: 'allowed' | 'forbidden' | 'n_a'
  tags: string[]
  graph_spec: string | null
  desmos_allowed: boolean
  document_id: string | null
  document_anchor_label: string | null
  document_anchor_start: number | null
  document_anchor_end: number | null
  document_marker_offset: number | null
  choices: AttemptQuestionChoice[]
  explanation?: string | null
  model_answer?: string | null
  rubric?: unknown
}

export interface AttemptGrade {
  grader: 'auto_mc' | 'self' | 'model'
  score: number
  feedback: string | null
  graded_at: string
}

export interface AttemptResponse {
  id: string
  ordinal: number
  question: AttemptQuestion
  selected_choice_id: string | null
  response_text: string | null
  skipped: boolean
  answered_at: string | null
  elapsed_ms: number | null
  confidence?: 'unsure' | 'somewhat' | 'confident' | null
  idk?: boolean
  misapplied_method?: string | null
  // The guess the learner offered alongside an "I don't know". It echoes back
  // unconditionally; whether it was right does not (see best_guess_correct).
  best_guess_choice_id?: string | null
  // Answer-key material, all of it: under a deferred reveal the server omits
  // these keys outright rather than nulling them, so `undefined` here means
  // "not yet", not "no verdict".
  best_guess_correct?: boolean | null
  chosen_misconception?: string | null
  diagnosis?: string | null
  outcome?: 'correct' | 'partial' | 'incorrect' | 'dont_know' | 'ungraded'
  grade: AttemptGrade | null
}

export interface AttemptDetail {
  id: string
  node_id: string
  source: 'template' | 'adhoc'
  template_id: string | null
  session_id?: string | null
  // Whether this attempt's key is held back until the session ends, and
  // whether it has in fact been handed over yet.
  reveal?: 'immediate' | 'deferred'
  revealed?: boolean
  // Where in the course the tutor said this item comes from (§5.1). Null
  // unless present_item named one.
  context?: StreamContext | null
  started_at: string
  submitted_at: string | null
  abandoned_at: string | null
  // Set while the learner has stepped away (§2.8); paused_ms is the total
  // already banked, which the server excludes from the abandon sweep.
  paused_at?: string | null
  paused_ms?: number
  offline: boolean
  responses: AttemptResponse[]
}

// Whether an attempt payload carries its answer key. A node that predates
// `revealed` reveals on submit, which is what the fallback says.
export function attemptRevealed(attempt: AttemptDetail): boolean {
  return attempt.revealed ?? attempt.submitted_at !== null
}

// Template/adhoc attempt creation (POST /api/attempts with source: 'template'
// or 'adhoc') only ever returns attempt_id + questions — the draw-shape
// fields below are daily-attempt-only, see CreateDailyAttemptResult.
export interface CreateAttemptResult {
  attempt_id: string
  questions: { id: string; lineage_id: string; type: 'mc' | 'written' }[]
}

// Daily attempt creation (POST /api/attempts with daily_kind) additionally
// reports how the draw was resolved.
export interface CreateDailyAttemptResult extends CreateAttemptResult {
  short_draw: boolean
  requested: number
  returned: number
  mix_adjusted?: boolean
}

export async function createAttempt(templateId: string): Promise<CreateAttemptResult> {
  const res = await fetch('/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'template', template_id: templateId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const reason = body.reason || body.error
    const message =
      reason === 'template_requires_connection'
        ? 'This test needs a connection, or download it first to use it offline.'
        : reason === 'empty_draw'
          ? 'No questions match this test on this device yet.'
          : reason || `POST /api/attempts ${res.status}`
    throw new Error(message)
  }
  return res.json()
}

export async function createDailyAttempt(kind: 'question' | 'quiz'): Promise<CreateDailyAttemptResult> {
  const res = await fetch('/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_kind: kind }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.reason || body.error || `POST /api/attempts ${res.status}`)
  }
  return res.json()
}

export async function getAttempt(id: string): Promise<AttemptDetail> {
  const res = await fetch(`/api/attempts/${id}`)
  if (!res.ok) throw new Error(`GET /api/attempts/${id} ${res.status}`)
  return res.json()
}

export interface AnswerResponseChanges {
  selected_choice_id?: string | null
  response_text?: string | null
  skipped?: boolean
  elapsed_ms?: number
  confidence?: 'unsure' | 'somewhat' | 'confident' | null
  idk?: boolean
  misapplied_method?: string | null
  // Only valid alongside idk: true — the server rejects it otherwise with
  // `best_guess_requires_idk`, and clearing idk drops the guess server-side.
  best_guess_choice_id?: string | null
}

export async function answerResponse(
  attemptId: string,
  responseId: string,
  changes: AnswerResponseChanges
): Promise<AttemptResponse> {
  const res = await fetch(`/api/attempts/${attemptId}/responses/${responseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error(`PATCH /api/attempts/${attemptId}/responses/${responseId} ${res.status}`)
  return res.json()
}

export async function submitAttempt(attemptId: string): Promise<AttemptDetail> {
  const res = await fetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/attempts/${attemptId}/submit ${res.status}`)
  return res.json()
}

// Stepping away from a live item and coming back (§2.8/§7.6). A paused
// attempt is never swept as abandoned, and answering resumes it server-side,
// so the app never has to sequence resume-then-answer itself.
export async function pauseAttempt(attemptId: string): Promise<{ id: string; paused_at: string }> {
  const res = await fetch(`/api/attempts/${attemptId}/pause`, { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/attempts/${attemptId}/pause ${res.status}`)
  return res.json()
}

export async function resumeAttempt(attemptId: string): Promise<{ id: string; paused_at: null; paused_ms: number }> {
  const res = await fetch(`/api/attempts/${attemptId}/resume`, { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/attempts/${attemptId}/resume ${res.status}`)
  return res.json()
}

export async function gradeResponse(
  responseId: string,
  input: { grader: 'self'; score: number; feedback?: string | null; override?: boolean }
): Promise<{ id: string; response_id: string; grader: string; score: number; graded_at: string }> {
  const res = await fetch(`/api/responses/${responseId}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`POST /api/responses/${responseId}/grade ${res.status}`)
  return res.json()
}

export type AttemptSourceKind = 'tutor' | 'self'

// Who set an attempt going: the tutor (it belongs to a tutoring session, or it
// was delivered live into the app) or Ben himself. Only the tutor case is
// worth a pill — "self" is the unmarked default everywhere else in the app.
export function attemptSourceLabel(kind: AttemptSourceKind | undefined): string | null {
  return kind === 'tutor' ? 'tutor' : null
}

export interface AttemptSummary {
  id: string
  source: 'template' | 'adhoc'
  source_kind: AttemptSourceKind
  template_id: string | null
  template_name: string | null
  submitted_at: string | null
  abandoned_at: string | null
  offline: boolean
  question_count: number
  mean_score: number | null
  ungraded: number
}

export async function listAttempts(params: { limit?: number; offset?: number } = {}): Promise<{ total: number; attempts: AttemptSummary[] }> {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  const res = await fetch(`/api/attempts?${qs}`)
  if (!res.ok) throw new Error(`GET /api/attempts ${res.status}`)
  return res.json()
}

export interface TagResultStat {
  tag_slug: string
  responses: number
  graded: number
  mean_score: number | null
  misses: number
  last_seen: string
  trend_30d: number | null
}

export async function getResultsTags(params: { tag?: string; since?: string; limit?: number } = {}): Promise<{ tags: TagResultStat[] }> {
  const qs = new URLSearchParams()
  if (params.tag) qs.set('tag', params.tag)
  if (params.since) qs.set('since', params.since)
  if (params.limit) qs.set('limit', String(params.limit))
  const res = await fetch(`/api/results/tags?${qs}`)
  if (!res.ok) throw new Error(`GET /api/results/tags ${res.status}`)
  return res.json()
}

export interface DailyResultStat {
  draw_date: string
  kind: string
  score: number | null
  ungraded: number
  question_count: number
  completed: boolean
}

export async function getResultsDaily(limit?: number): Promise<{ daily: DailyResultStat[] }> {
  const qs = new URLSearchParams()
  if (limit) qs.set('limit', String(limit))
  const res = await fetch(`/api/results/daily?${qs}`)
  if (!res.ok) throw new Error(`GET /api/results/daily ${res.status}`)
  return res.json()
}

export type SessionStatus = 'open' | 'closed'

export interface SessionSummary {
  id: string
  name: string
  tag_slug: string | null
  created_at: string
  ended_at: string | null
  // The tutor's closing recap (markdown), written when the session ended.
  summary: string | null
  status: SessionStatus
  source: 'tutor'
}

// `status` is the server's word for it; ended_at is the fallback for a node
// that predates the field.
export function sessionIsOpen(session: { status?: SessionStatus; ended_at: string | null }): boolean {
  return (session.status ?? (session.ended_at ? 'closed' : 'open')) === 'open'
}

export async function getSessions(params: { limit?: number; offset?: number } = {}): Promise<{ total: number; sessions: SessionSummary[] }> {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  const res = await fetch(`/api/sessions?${qs}`)
  if (!res.ok) throw new Error(`GET /api/sessions ${res.status}`)
  return res.json()
}

export interface SessionAttemptSummary {
  id: string
  source: 'template' | 'adhoc'
  delivery_mode: string | null
  template_id: string | null
  template_name: string | null
  started_at: string
  submitted_at: string | null
  abandoned_at: string | null
  offline: boolean
  question_count: number
  // Null while the session's deferred reveal still holds.
  mean_score: number | null
  revealed?: boolean
  ungraded: number
}

export interface SessionTemplateSummary {
  id: string
  name: string
  description: string | null
  question_count: number
  frozen: boolean
  time_limit_sec: number | null
  created_at: string
  retired_at: string | null
}

export interface SessionDetail extends SessionSummary {
  attempts: SessionAttemptSummary[]
  templates: SessionTemplateSummary[]
}

// The tutor normally ends its own session, but it can walk away and leave one
// open. Same server-side path either way, so the counts and the ephemeral
// retirement are identical.
export async function endSession(id: string, summary?: string): Promise<{ id: string; ended_at: string; summary_text: string | null }> {
  const res = await fetch(`/api/sessions/${id}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary === undefined ? {} : { summary }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `POST /api/sessions/${id}/end ${res.status}`)
  }
  return res.json()
}

export async function getSessionDetail(id: string): Promise<SessionDetail> {
  const res = await fetch(`/api/sessions/${id}`)
  if (!res.ok) throw new Error(`GET /api/sessions/${id} ${res.status}`)
  return res.json()
}

// A live item is an adhoc, app_live-delivered attempt still in progress —
// the tutor creates one via MCP, and this is how the app finds it. `attempt`
// is null when the tutor hasn't handed anything off yet (or Ben already
// finished whatever was pending); the caller keeps polling either way.
export async function getLivePendingAttempt(sessionId: string): Promise<{ attempt: AttemptDetail | null }> {
  const res = await fetch(`/api/attempts/live-pending?session_id=${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(`GET /api/attempts/live-pending ${res.status}`)
  return res.json()
}

// ---- The session stream (§5.3) --------------------------------------------
// Everything the tutor has put on this session's screen, in order. Item
// entries are references: the stream component fetches /api/attempts/:id for
// the one it is actually rendering rather than this route carrying every
// answer key in the session.

export type { StreamContext, StreamEntry, ItemEntry, ShowEntry, SessionStreamData } from './sessionStream'

export async function getSessionStream(sessionId: string): Promise<SessionStreamData> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stream`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `GET /api/sessions/${sessionId}/stream ${res.status}`)
  }
  return res.json()
}

export interface ShowOutcome {
  show_id: string
  status: 'pending' | 'seen' | 'acknowledged'
  seen_at: string | null
  dwell_ms: number | null
  acknowledged_at: string | null
}

async function postShow(showId: string, action: 'seen' | 'acknowledge', dwellMs: number): Promise<ShowOutcome> {
  const res = await fetch(`/api/shows/${encodeURIComponent(showId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dwell_ms: Math.max(0, Math.round(dwellMs)) }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `POST /api/shows/${showId}/${action} ${res.status}`)
  }
  return res.json()
}

// The card stood in front of the learner for this long. Sent when it scrolls
// away or the session ends under it — not a claim that they did anything.
export function markShowSeen(showId: string, dwellMs: number): Promise<ShowOutcome> {
  return postShow(showId, 'seen', dwellMs)
}

// They pressed OK (or Space). This is the tutor's cue to move on.
export function acknowledgeShow(showId: string, dwellMs: number): Promise<ShowOutcome> {
  return postShow(showId, 'acknowledge', dwellMs)
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ---- Themes (synced through the node; canonical is authoritative) ----

export interface ThemeTokens {
  light: Record<string, string>
  dark: Record<string, string>
}

export interface ThemeRecord {
  id: string
  name: string
  tokens: ThemeTokens
  custom_css: string
  updated_at: string
}

async function themeError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}))
  if (body.reason === 'theme_requires_connection') return new Error('Theme changes need a connection to the server.')
  return new Error(body.message || body.error || fallback)
}

export async function getThemes(): Promise<{ themes: ThemeRecord[]; active_theme_id: string | null }> {
  const res = await fetch('/api/themes')
  if (!res.ok) throw new Error(`GET /api/themes ${res.status}`)
  return res.json()
}

export async function putTheme(theme: { id: string; name: string; tokens: ThemeTokens; custom_css: string }): Promise<ThemeRecord> {
  const res = await fetch(`/api/themes/${encodeURIComponent(theme.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: theme.name, tokens: theme.tokens, custom_css: theme.custom_css }),
  })
  if (!res.ok) throw await themeError(res, `PUT /api/themes/${theme.id} ${res.status}`)
  return res.json()
}

export async function deleteThemeRecord(id: string): Promise<void> {
  const res = await fetch(`/api/themes/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw await themeError(res, `DELETE /api/themes/${id} ${res.status}`)
}

export async function putActiveTheme(id: string | null): Promise<{ active_theme_id: string | null }> {
  const res = await fetch('/api/themes/active', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) throw await themeError(res, `PUT /api/themes/active ${res.status}`)
  return res.json()
}

// ---- Results subpages ------------------------------------------------------

export interface ParentTagStat {
  tag_slug: string
  label: string
  responses: number
  graded: number
  mean_score: number | null
  misses: number
  last_seen: string | null
  child_count: number
}

export async function getResultsParents(): Promise<{ parents: ParentTagStat[] }> {
  const res = await fetch('/api/results/parents')
  if (!res.ok) throw new Error(`GET /api/results/parents ${res.status}`)
  return res.json()
}

export interface TagHistory {
  tag: { slug: string; label: string; description: string | null; parent_slug: string | null }
  overall: { responses: number; graded: number; mean_score: number | null; misses: number; last_seen: string | null }
  points: { at: string; mean_score: number; responses: number }[]
  children: { tag_slug: string; label: string; responses: number; graded: number; mean_score: number | null; misses: number }[]
}

export async function getTagHistory(slug: string, days?: number): Promise<TagHistory> {
  const qs = new URLSearchParams()
  if (days) qs.set('days', String(days))
  const res = await fetch(`/api/results/tags/${encodeURIComponent(slug)}/history?${qs}`)
  if (!res.ok) throw new Error(`GET /api/results/tags/${slug}/history ${res.status}`)
  return res.json()
}

export interface DailyDayDetail {
  draw_date: string
  draws: {
    kind: string
    attempt_id: string | null
    submitted_at: string | null
    mean_score: number | null
    responses: {
      question_id: string
      prompt: string
      type: string
      tags: string[]
      outcome: string
      score: number | null
      answer: string | null
      correct_answer: string | null
      explanation: string | null
    }[]
  }[]
  tags_touched: { tag_slug: string; responses: number; day_mean: number | null; overall_mean: number | null }[]
}

export async function getDailyDayDetail(date: string): Promise<DailyDayDetail> {
  const res = await fetch(`/api/results/daily/${encodeURIComponent(date)}`)
  if (!res.ok) throw new Error(`GET /api/results/daily/${date} ${res.status}`)
  return res.json()
}
