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
