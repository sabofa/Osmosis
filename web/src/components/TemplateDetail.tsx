import { SubjectIcon, XIcon, TagIcon, PinIcon } from './icons'
import type { TemplateSummary } from '../data/templates'
import './TemplateDetail.css'

function formatTime(sec: number | null): string | null {
  if (!sec) return null
  const mins = Math.round(sec / 60)
  return `${mins} min limit`
}

export default function TemplateDetail({
  template,
  onClose,
  onStart,
  onOpenTag,
  pinned,
  canUnpin,
  onTogglePin,
}: {
  template: TemplateSummary
  onClose: () => void
  onStart: () => void
  onOpenTag?: (slug: string) => void
  pinned: boolean
  canUnpin: boolean
  onTogglePin: () => void
}) {
  const timeLabel = formatTime(template.timeLimitSec)

  return (
    <div className="template-detail-backdrop" onClick={onClose}>
      <div className="template-detail no-scrollbar" onClick={(e) => e.stopPropagation()}>
        <div className="template-detail-header">
          <span className="template-detail-icon">
            <SubjectIcon icon={template.icon} size={22} />
          </span>
          <div>
            <h2>{template.name}</h2>
            <div className="template-detail-id">{template.id}</div>
          </div>
          <button
            className={`template-detail-pin${pinned ? ' pinned' : ''}`}
            onClick={onTogglePin}
            disabled={pinned && !canUnpin}
            title={pinned ? (canUnpin ? 'Remove from quick access' : 'Always in quick access') : 'Add to quick access'}
          >
            <PinIcon size={14} filled={pinned} />
          </button>
          <button className="template-detail-close" onClick={onClose} aria-label="Close">
            <XIcon size={14} />
          </button>
        </div>

        <div className="template-detail-text">{template.description}</div>

        <div className="template-detail-meta">
          <span className="template-detail-badge">{template.questionCount} questions</span>
          <span className="template-detail-badge">
            calculator {template.calculatorPolicy === 'any' ? 'any' : template.calculatorPolicy}
          </span>
          {template.weighting && <span className="template-detail-badge">{template.weighting}</span>}
          {template.mcRatio !== null && <span className="template-detail-badge">{Math.round(template.mcRatio * 100)}% MC</span>}
          {(template.difficultyMin !== null || template.difficultyMax !== null) && (
            <span className="template-detail-badge">
              difficulty {template.difficultyMin ?? 1}–{template.difficultyMax ?? 5}
            </span>
          )}
          {template.frozen && <span className="template-detail-badge frozen">frozen</span>}
          {timeLabel && <span className="template-detail-badge">{timeLabel}</span>}
        </div>

        <div className="template-detail-section">
          <div className="template-detail-label">Drawn from</div>
          <div className="template-detail-tags">
            {template.tags.length === 0 ? (
              <span className="template-detail-tag whole-bank">
                <TagIcon size={11} />
                whole bank
              </span>
            ) : (
              template.tags.map((t) => (
                <button
                  className="template-detail-tag clickable"
                  key={t}
                  onDoubleClick={() => onOpenTag?.(t)}
                  title="Double-click to view this tag in the Bank"
                >
                  <TagIcon size={11} />
                  {t}
                </button>
              ))
            )}
          </div>
        </div>

        <button className="template-detail-start" onClick={onStart}>
          Start &rarr;
        </button>
      </div>
    </div>
  )
}
