import type { IconKey } from '../components/icons'

export interface TemplateSummary {
  id: string
  name: string
  icon: IconKey
  meta: string
  description: string
  tags: string[]
  questionCount: number
  calculatorPolicy: 'allowed' | 'forbidden' | 'any'
  weighting: 'random' | 'weak_weighted' | null
  mcRatio: number | null
  difficultyMin: number | null
  difficultyMax: number | null
  frozen: boolean
  timeLimitSec: number | null
}

// Mock data standing in for GET /api/templates. Replace with a real fetch
// when wiring this screen to the local backend.
export const mockTemplates: TemplateSummary[] = [
  {
    id: 'math-no-calc',
    name: 'Math — No Calculator',
    icon: 'math',
    meta: '20 questions · math · forbidden',
    description: '20 questions from math, by hand only · weighted toward what you miss',
    tags: ['math'],
    questionCount: 20,
    calculatorPolicy: 'forbidden',
    weighting: 'weak_weighted',
    mcRatio: 0.7,
    difficultyMin: null,
    difficultyMax: null,
    frozen: false,
    timeLimitSec: 1800,
  },
  {
    id: 'daily-quiz',
    name: 'Daily Quiz',
    icon: 'bolt',
    meta: '10 questions · whole bank',
    description: "Today's quiz, drawn fresh across the whole bank",
    tags: [],
    questionCount: 10,
    calculatorPolicy: 'any',
    weighting: 'random',
    mcRatio: null,
    difficultyMin: null,
    difficultyMax: null,
    frozen: false,
    timeLimitSec: null,
  },
  {
    id: 'history-17c',
    name: 'History — 17th Century',
    icon: 'history',
    meta: '25 questions · history:17c',
    description: '25 questions on the 17th century, sampled at random',
    tags: ['history:17c'],
    questionCount: 25,
    calculatorPolicy: 'any',
    weighting: 'random',
    mcRatio: null,
    difficultyMin: null,
    difficultyMax: null,
    frozen: false,
    timeLimitSec: null,
  },
  {
    id: 'chem-equilibrium',
    name: 'Chem — Equilibrium Drill',
    icon: 'chem',
    meta: '15 questions · weak_weighted',
    description: '15 questions on equilibrium, weighted toward your weakest lineages',
    tags: ['chem:equilibrium'],
    questionCount: 15,
    calculatorPolicy: 'any',
    weighting: 'weak_weighted',
    mcRatio: null,
    difficultyMin: 2,
    difficultyMax: 5,
    frozen: false,
    timeLimitSec: null,
  },
  {
    id: 'physics-mix',
    name: 'Physics — Full Mix',
    icon: 'physics',
    meta: '30 questions · any calculator',
    description: '30 questions across all of physics, calculator allowed',
    tags: ['physics'],
    questionCount: 30,
    calculatorPolicy: 'allowed',
    weighting: 'random',
    mcRatio: 0.8,
    difficultyMin: null,
    difficultyMax: null,
    frozen: false,
    timeLimitSec: 2700,
  },
]

// Mock activity heatmap: one score bucket (0-4) per cell, oldest first.
// Replace with real data derived from GET /api/results/tags or attempt history.
export function mockHeatmap(cols: number, rows: number, seedOffset = 0): number[] {
  let seed = 7 + seedOffset * 101
  const cells: number[] = []
  for (let i = 0; i < cols * rows; i++) {
    seed = (seed * 9301 + 49297) % 233280
    const r = seed / 233280
    cells.push(r < 0.32 ? 0 : r < 0.52 ? 1 : r < 0.72 ? 2 : r < 0.9 ? 3 : 4)
  }
  return cells
}

export interface MockQuestion {
  id: string
  type: 'mc' | 'written'
  tag: string
  icon: IconKey
  calculator: 'allowed' | 'forbidden' | 'n_a'
  prompt: string
  explanation: string
  choices?: string[]
  correctIndex?: number
  modelAnswer?: string
  rubric?: string
  // Graph/Desmos/document side-panel fields. These mirror the real API's
  // QuestionDetail fields but are opt-in here since Take/Review still run on
  // mock data (see components/Take.tsx, Review.tsx) rather than the real
  // GET /api/questions/:id. No mock `documentId` is set on any question below
  // — there's no seeded mock Asset to resolve it against, and DocumentPanel
  // fetches over the real /api/assets/:id endpoint, so wiring one up here
  // would just render a permanent fetch error. Document-panel exercise is
  // left to the real-API path (QuestionDetail) until mock assets exist.
  graphSpec?: string
  desmosAllowed?: boolean
  documentId?: string
  documentAnchorLabel?: string
  documentAnchorStart?: number
  documentAnchorEnd?: number
}

// Mock draw for the Take flow. Replace with the response of POST /api/attempts.
export const mockQuestions: MockQuestion[] = [
  {
    id: 'q1',
    type: 'mc',
    tag: 'math:functions:quadratic',
    icon: 'math',
    calculator: 'forbidden',
    prompt: 'Solve for x: 2x² − 5x − 3 = 0',
    explanation: 'Factor as (2x + 1)(x − 3) = 0, so x = 3 or x = −1/2.',
    choices: ['x = 3 or x = −1/2', 'x = −3 or x = 1/2', 'x = 3 or x = 1/2', 'no real solution'],
    correctIndex: 0,
    graphSpec: 'y = 2x^2 - 5x - 3\nA = (3, 0)\nB = (-0.5, 0)',
    desmosAllowed: true,
  },
  {
    id: 'q2',
    type: 'mc',
    tag: 'history:17c:english_civil_war',
    icon: 'history',
    calculator: 'n_a',
    prompt: 'In what year did the Battle of Naseby take place?',
    explanation: 'Naseby was fought in June 1645 and broke the main Royalist field army.',
    choices: ['1642', '1645', '1649'],
    correctIndex: 1,
  },
  {
    id: 'q3',
    type: 'written',
    tag: 'chem:equilibrium',
    icon: 'chem',
    calculator: 'n_a',
    prompt: 'Explain why increasing pressure shifts this equilibrium toward fewer moles of gas.',
    explanation: 'Higher pressure favors the side with fewer gas moles, since that reduces total moles and partially relieves the pressure increase.',
    modelAnswer: 'Higher pressure favors the side with fewer gas moles, since that reduces total moles and partially relieves the pressure increase.',
    rubric: 'mentions Le Chatelier (0.4) · mentions mole count (0.6)',
  },
  {
    id: 'q4',
    type: 'mc',
    tag: 'physics:kinematics',
    icon: 'physics',
    calculator: 'allowed',
    prompt: 'A ball is thrown horizontally at 12 m/s from a 20 m cliff. How far does it travel horizontally before landing? (g = 10 m/s²)',
    explanation: 'Fall time t = √(2h/g) = 2s, so horizontal range = 12 × 2 = 24 m ≈ 24.2 m accounting for rounding.',
    choices: ['12 m', '18.9 m', '24.2 m', '30 m'],
    correctIndex: 2,
    desmosAllowed: true,
  },
]

export interface SubjectStat {
  label: string
  score: number
  icon: IconKey
  responses: number
  trend: number[]
}

export const mockSubjectStats: SubjectStat[] = [
  { label: 'history', score: 0.41, icon: 'history', responses: 62, trend: [0.55, 0.5, 0.46, 0.44, 0.4, 0.38, 0.41] },
  { label: 'physics', score: 0.68, icon: 'physics', responses: 88, trend: [0.5, 0.55, 0.58, 0.6, 0.63, 0.65, 0.68] },
  { label: 'chem', score: 0.74, icon: 'chem', responses: 101, trend: [0.6, 0.62, 0.65, 0.7, 0.69, 0.72, 0.74] },
  { label: 'math', score: 0.81, icon: 'math', responses: 140, trend: [0.65, 0.7, 0.68, 0.74, 0.77, 0.79, 0.81] },
]

export const mockWorstQuestions = [
  { text: '"Le Chatelier shifts equilibrium toward..."', score: 0.32 },
  { text: '"Cause of the English Civil War, 1642..."', score: 0.38 },
  { text: '"Projectile range at 45° with no drag..."', score: 0.51 },
]

// Mastery trend, oldest first — replace with GET /api/results/tags history.
export const mockMasteryTrend = [0.42, 0.48, 0.45, 0.6, 0.57, 0.66, 0.63, 0.74, 0.7, 0.78]
