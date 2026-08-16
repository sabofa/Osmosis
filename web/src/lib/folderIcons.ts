import type { ReactElement } from 'react'
import {
  MathIcon,
  ChemIcon,
  HistoryIcon,
  PhysicsIcon,
  BoltIcon,
  BookIcon,
  StarIcon,
  FlameIcon,
  TargetIcon,
  TrophyIcon,
  FlagIcon,
  LayersIcon,
  BriefcaseIcon,
  CompassIcon,
  GlobeIcon,
  ClipboardIcon,
  PuzzleIcon,
} from '../components/icons'

// A real icon set (not emoji) for folder symbols, in the app's own line-art
// style. Key is what gets persisted on FolderMeta.icon.
export const FOLDER_ICON_LIBRARY: Record<string, (props: { size?: number }) => ReactElement> = {
  book: BookIcon,
  star: StarIcon,
  flame: FlameIcon,
  target: TargetIcon,
  trophy: TrophyIcon,
  flag: FlagIcon,
  layers: LayersIcon,
  briefcase: BriefcaseIcon,
  compass: CompassIcon,
  globe: GlobeIcon,
  clipboard: ClipboardIcon,
  puzzle: PuzzleIcon,
  math: MathIcon,
  chem: ChemIcon,
  history: HistoryIcon,
  physics: PhysicsIcon,
  bolt: BoltIcon,
}

export const FOLDER_COLOR_LIBRARY = [
  '#c65d22',
  '#d64545',
  '#e08a2b',
  '#c9a227',
  '#4a8f4f',
  '#2f9e8f',
  '#3b6fd1',
  '#7a5fd1',
  '#c04d94',
  '#6b6b5f',
]
