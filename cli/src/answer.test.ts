import { describe, it, expect } from 'vitest'
import { plain, formatQuestion, parseChoice, parseConfidence, formatOutcome, type AttemptDetail } from './answer.js'
import { formatTable } from './terminal.js'

const mc: AttemptDetail['responses'][number] = {
  id: 'r1',
  selected_choice_id: null,
  response_text: null,
  question: {
    id: 'q1',
    type: 'mc',
    prompt: 'What is $\\frac{1}{2} + \\frac{1}{2}$?',
    tags: ['math:arith'],
    choices: [
      { id: 'a', body: '$1$', ordinal: 0, is_correct: true },
      { id: 'b', body: '$2$', ordinal: 1 },
    ],
    explanation: 'Halves make a whole.',
  },
}

describe('terminal answering', () => {
  it('strips TeX delimiters for the terminal', () => {
    expect(plain('What is $\\frac{1}{2}$ of \\ce{H2O}?')).toBe('What is \\frac{1}{2} of H2O?')
    expect(plain('a \\[x^2\\] b')).toBe('a \n  x^2\n b')
  })

  it('formats a question with lettered choices', () => {
    const s = formatQuestion(mc, 0, 3)
    expect(s).toContain('[1/3] math:arith')
    expect(s).toContain('A)  1')
    expect(s).toContain('B)  2')
  })

  it('parses letters, numbers and confidence', () => {
    expect(parseChoice('b', 2)).toBe(1)
    expect(parseChoice('1', 2)).toBe(0)
    expect(parseChoice('c', 2)).toBeNull()
    expect(parseConfidence('c')).toBe('confident')
    expect(parseConfidence('un')).toBe('unsure')
    expect(parseConfidence('')).toBeNull()
  })

  it('prints the outcome with the key on a miss', () => {
    const s = formatOutcome({
      id: 'a1',
      responses: [{ ...mc, outcome: 'incorrect', grade: { score: 0, grader: 'auto_mc' } }],
    })
    expect(s).toContain('1. incorrect  →  1')
    expect(s).toContain('Halves make a whole.')
    expect(s).toContain('Score 0.00 · 1 incorrect')
  })

  it('draws a table', () => {
    const t = formatTable([{ tag_slug: 'math', mean_score: 0.5, misses: 3 }])
    expect(t.split('\n')[0]).toBe('tag slug  mean score  misses')
    expect(t.split('\n')[2]).toBe('math      0.50        3')
  })
})
