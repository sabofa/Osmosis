export interface ResponseState {
  selectedIndex: number | null
  writtenText: string
  verdict: 'correct' | 'partial' | 'incorrect' | null
}

export function initialResponses(count: number): ResponseState[] {
  return Array.from({ length: count }, () => ({ selectedIndex: null, writtenText: '', verdict: null }))
}
