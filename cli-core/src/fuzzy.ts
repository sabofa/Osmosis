// Fuzzy ranking for completion: the closest match to what was typed wins,
// `econ` finds `economics`, and every candidate that matches at all stays
// reachable with the arrow keys.
//
// Scoring, higher is better: exact > prefix > word-start prefix > ordered
// subsequence. A candidate that does not contain the typed characters in
// order scores below zero and is dropped.

export function fuzzyScore(query: string, candidate: string): number {
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  if (q === '') return 1
  if (c === q) return 1000
  if (c.startsWith(q)) return 500 - (c.length - q.length) * 0.1
  // Word-start prefix: "demand quiz" matched by "quiz", "math:algebra" by "alg".
  const words = c.split(/[\s:_\-/]+/)
  if (words.some((w) => w.startsWith(q))) return 300 - (c.length - q.length) * 0.1
  if (c.includes(q)) return 200 - c.indexOf(q) - (c.length - q.length) * 0.05
  // Ordered subsequence with a penalty for gaps.
  let qi = 0
  let gaps = 0
  let last = -1
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) {
      if (last >= 0 && i - last > 1) gaps += i - last - 1
      last = i
      qi++
    }
  }
  if (qi < q.length) return -1
  return 100 - gaps - (c.length - q.length) * 0.05
}

export function rank<T>(query: string, items: T[], text: (item: T) => string, limit = 12): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || text(a.item).localeCompare(text(b.item)))
    .slice(0, limit)
}
