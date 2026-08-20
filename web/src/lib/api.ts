export interface NodeStatus {
  online: boolean
  canonical: boolean
  node: { id: string; label: string; canonical: boolean }
  last_pull_at: string | null
  last_push_at: string | null
  outbox_depth: number
  dead_outbox_depth: number
  dead_outbox: { id: number; entity_type: string; entity_id: string; tries: number; last_try_at: string | null; last_error: string | null }[]
  slices: string[]
  protocol_version: number
  remote_protocol_version: number | null
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
  grade: AttemptGrade | null
}

export interface AttemptDetail {
  id: string
  node_id: string
  source: 'template' | 'adhoc'
  template_id: string | null
  started_at: string
  submitted_at: string | null
  abandoned_at: string | null
  offline: boolean
  responses: AttemptResponse[]
}

export interface CreateAttemptResult {
  attempt_id: string
  questions: { id: string; lineage_id: string; type: 'mc' | 'written' }[]
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
    throw new Error(body.reason || body.error || `POST /api/attempts ${res.status}`)
  }
  return res.json()
}

export async function createDailyAttempt(kind: 'question' | 'quiz'): Promise<CreateAttemptResult> {
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

export interface AttemptSummary {
  id: string
  source: 'template' | 'adhoc'
  template_id: string | null
  template_name: string | null
  submitted_at: string | null
  abandoned_at: string | null
  offline: boolean
  question_count: number
  mean_score: number | null
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
  mean_score: number
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
