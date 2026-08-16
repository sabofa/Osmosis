import { useState } from 'react'
import type { FolderMeta } from '../hooks/useTemplateOrg'
import { FOLDER_ICON_LIBRARY, FOLDER_COLOR_LIBRARY } from '../lib/folderIcons'
import { FolderIcon, TrashIcon, ChevronLeftIcon } from './icons'
import './FolderMenu.css'

type View = 'main' | 'icons' | 'colors'

export default function FolderMenu({
  folder,
  closing = false,
  onRename,
  onChangeIcon,
  onChangeColor,
  onDelete,
  onClose,
}: {
  folder: FolderMeta
  closing?: boolean
  onRename: (name: string) => void
  onChangeIcon: (icon: string | null) => void
  onChangeColor: (color: string | null) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [view, setView] = useState<View>('main')
  const [nameDraft, setNameDraft] = useState(folder.name)

  const IconComp = folder.icon ? FOLDER_ICON_LIBRARY[folder.icon] : null
  const closingClass = closing ? ' closing' : ''

  function commitName() {
    onRename(nameDraft)
  }

  if (view === 'icons') {
    return (
      <div className={`folder-menu drill${closingClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="folder-menu-subheader">
          <button className="folder-menu-back" onClick={() => setView('main')} aria-label="Back">
            <ChevronLeftIcon size={13} />
          </button>
          Choose an icon
        </div>
        <div className="icon-pack-grid">
          <button
            className={`icon-pack-btn${folder.icon === null ? ' active' : ''}`}
            style={{ animationDelay: '0ms' }}
            onClick={() => {
              onChangeIcon(null)
              setView('main')
            }}
            title="Default"
          >
            <FolderIcon size={14} />
          </button>
          {Object.entries(FOLDER_ICON_LIBRARY).map(([key, Icon], i) => (
            <button
              key={key}
              className={`icon-pack-btn${folder.icon === key ? ' active' : ''}`}
              style={{ animationDelay: `${(i + 1) * 15}ms` }}
              onClick={() => {
                onChangeIcon(key)
                setView('main')
              }}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (view === 'colors') {
    return (
      <div className={`folder-menu drill${closingClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="folder-menu-subheader">
          <button className="folder-menu-back" onClick={() => setView('main')} aria-label="Back">
            <ChevronLeftIcon size={13} />
          </button>
          Choose a color
        </div>
        <div className="color-pack-grid">
          <button
            className={`color-pack-btn none${folder.color === null ? ' active' : ''}`}
            style={{ animationDelay: '0ms' }}
            onClick={() => {
              onChangeColor(null)
              setView('main')
            }}
            title="Default"
          />
          {FOLDER_COLOR_LIBRARY.map((c, i) => (
            <button
              key={c}
              className={`color-pack-btn${folder.color === c ? ' active' : ''}`}
              style={{ background: c, animationDelay: `${(i + 1) * 15}ms` }}
              onClick={() => {
                onChangeColor(c)
                setView('main')
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`folder-menu${closingClass}`} onClick={(e) => e.stopPropagation()}>
      <button className="folder-menu-icon" onClick={() => setView('icons')} title="Change icon">
        {IconComp ? <IconComp size={14} /> : <FolderIcon size={14} />}
      </button>
      <input
        className="folder-menu-name"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitName()
            onClose()
          }
        }}
      />
      <button
        className="folder-menu-color"
        onClick={() => setView('colors')}
        title="Change color"
        style={{ background: folder.color ?? 'transparent', borderStyle: folder.color ? 'solid' : 'dashed' }}
      />
      <button className="folder-menu-delete" onClick={onDelete} title="Delete folder">
        <TrashIcon size={13} />
      </button>
    </div>
  )
}
