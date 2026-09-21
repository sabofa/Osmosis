// A rubric is free JSON from the author: a string, a list of strings, a list
// of {criterion|text, points} objects, or {criteria: [...]}. Flatten all of
// those to lines the learner can tick.
export function rubricLines(rubric: unknown): { text: string; points: number | null }[] {
  if (rubric == null) return []
  if (typeof rubric === 'string') {
    const trimmed = rubric.trim()
    if (!trimmed) return []
    // A JSON string stored as text, or plain prose with one criterion per line.
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return rubricLines(JSON.parse(trimmed))
      } catch {
        /* prose after all */
      }
    }
    return trimmed
      .split(/\n+/)
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .map((text) => ({ text, points: null }))
  }
  if (Array.isArray(rubric)) {
    return rubric.flatMap((item) => {
      if (typeof item === 'string') return [{ text: item, points: null }]
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        const text = String(o.criterion ?? o.text ?? o.description ?? o.name ?? '')
        const points = typeof o.points === 'number' ? o.points : typeof o.weight === 'number' ? o.weight : null
        return text ? [{ text, points }] : []
      }
      return []
    })
  }
  if (typeof rubric === 'object') {
    const o = rubric as Record<string, unknown>
    if (Array.isArray(o.criteria)) return rubricLines(o.criteria)
    if (Array.isArray(o.items)) return rubricLines(o.items)
    return Object.entries(o).map(([k, v]) => ({
      text: typeof v === 'string' ? `${k}: ${v}` : k,
      points: typeof v === 'number' ? v : null,
    }))
  }
  return []
}
