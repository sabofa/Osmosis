import { HomeIcon, TagIcon, ChartIcon, GearIcon, LayersIcon, BoltIcon } from './icons'
import './Rail.css'

export type Page = 'home' | 'bank' | 'library' | 'live' | 'take' | 'review' | 'results' | 'settings'

const items: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'home', label: 'Home', icon: <HomeIcon size={16} /> },
  { page: 'bank', label: 'Bank', icon: <TagIcon size={16} /> },
  { page: 'library', label: 'Library', icon: <LayersIcon size={16} /> },
  { page: 'live', label: 'Live', icon: <BoltIcon size={16} /> },
  { page: 'results', label: 'Results', icon: <ChartIcon size={16} /> },
  { page: 'settings', label: 'Settings', icon: <GearIcon size={16} /> },
]

// Auto-retracting nav: collapsed to icon-only pills on the right edge, expands
// on hover to show labels. Rendered on every page except Take (mid-quiz), so
// it never distracts during a test.
export default function Rail({ active, onNavigate }: { active: Page; onNavigate: (p: Page) => void }) {
  return (
    <nav className="rail">
      {items.map((item, i) => (
        <button
          key={i}
          className={`rail-item${item.page === active ? ' active' : ''}`}
          onClick={() => onNavigate(item.page)}
        >
          <span className="rail-icon">{item.icon}</span>
          <span className="rail-label">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
