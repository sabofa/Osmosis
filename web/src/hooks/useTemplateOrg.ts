import { useCallback, useEffect, useState } from 'react'

export interface FolderMeta {
  id: string
  name: string
  parentId: string | null
  icon: string | null
  color: string | null
}

const FOLDERS_KEY = 'osmosis:template-folders'
const ASSIGN_KEY = 'osmosis:template-folder-assign' // templateId -> folderId
const ORDER_KEY = 'osmosis:template-order' // containerId ('root' | folderId) -> ordered child ids
const PINNED_KEY = 'osmosis:template-pinned' // ordered templateIds, excludes daily-quiz
const COLLAPSED_KEY = 'osmosis:template-folders-collapsed'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
function persist<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function useTemplateOrg(allTemplateIds: string[]) {
  const [folders, setFolders] = useState<FolderMeta[]>(() => load(FOLDERS_KEY, []))
  const [assignments, setAssignments] = useState<Record<string, string>>(() => load(ASSIGN_KEY, {}))
  const [order, setOrder] = useState<Record<string, string[]>>(() => load(ORDER_KEY, {}))
  const [pinned, setPinned] = useState<string[]>(() => {
    const loaded = load<string[]>(PINNED_KEY, ['daily-quiz'])
    return loaded.includes('daily-quiz') ? loaded : ['daily-quiz', ...loaded]
  })
  const [collapsed, setCollapsed] = useState<string[]>(() => load(COLLAPSED_KEY, []))

  // A folder that loses its last child (template moved/reassigned elsewhere,
  // or its last subfolder relocated) disappears on its own — no manual delete
  // needed for the common case.
  useEffect(() => {
    const empty = folders.filter(
      (f) => !folders.some((sub) => sub.parentId === f.id) && !Object.values(assignments).includes(f.id)
    )
    if (empty.length === 0) return
    const emptyIds = new Set(empty.map((f) => f.id))
    setFolders((prev) => {
      const next = prev.filter((f) => !emptyIds.has(f.id))
      persist(FOLDERS_KEY, next)
      return next
    })
    setOrder((prev) => {
      const next = { ...prev }
      for (const id of emptyIds) delete next[id]
      persist(ORDER_KEY, next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, assignments])

  // Ground truth for container membership is folders[].parentId and
  // assignments — `order` is just a preferred sequence layered on top, so it
  // never needs to be kept perfectly in sync; missing/stale ids are patched
  // up here at read time.
  const computeChildren = useCallback(
    (containerId: string): string[] => {
      const folderChildren = folders.filter((f) => (f.parentId ?? 'root') === containerId).map((f) => f.id)
      const templateChildren = allTemplateIds.filter((id) => (assignments[id] ?? 'root') === containerId)
      const raw = new Set([...folderChildren, ...templateChildren])
      const stored = order[containerId] ?? []
      const ordered = stored.filter((id) => raw.has(id))
      for (const id of raw) if (!ordered.includes(id)) ordered.push(id)
      return ordered
    },
    [folders, assignments, order, allTemplateIds]
  )

  const isFolder = useCallback((id: string) => folders.some((f) => f.id === id), [folders])

  const createFolder = useCallback((name: string, parentId: string | null): string => {
    const id = crypto.randomUUID()
    const folder: FolderMeta = { id, name: name.trim() || 'Untitled', parentId, icon: null, color: null }
    setFolders((prev) => {
      const next = [...prev, folder]
      persist(FOLDERS_KEY, next)
      return next
    })
    return id
  }, [])

  const renameFolder = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
      persist(FOLDERS_KEY, next)
      return next
    })
  }, [])

  const setFolderStyle = useCallback((id: string, icon: string | null, color: string | null) => {
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, icon, color } : f))
      persist(FOLDERS_KEY, next)
      return next
    })
  }, [])

  const deleteFolder = useCallback(
    (id: string) => {
      const folder = folders.find((f) => f.id === id)
      const parentId = folder?.parentId ?? null
      setAssignments((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(next)) if (next[key] === id) {
          if (parentId) next[key] = parentId
          else delete next[key]
        }
        persist(ASSIGN_KEY, next)
        return next
      })
      setFolders((prev) => {
        const next = prev.filter((f) => f.id !== id).map((f) => (f.parentId === id ? { ...f, parentId } : f))
        persist(FOLDERS_KEY, next)
        return next
      })
    },
    [folders]
  )

  const setTemplateFolder = useCallback((templateId: string, folderId: string | null) => {
    setAssignments((prev) => {
      const next = { ...prev }
      if (folderId) next[templateId] = folderId
      else delete next[templateId]
      persist(ASSIGN_KEY, next)
      return next
    })
  }, [])

  const setFolderParent = useCallback((folderId: string, parentId: string | null) => {
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === folderId ? { ...f, parentId } : f))
      persist(FOLDERS_KEY, next)
      return next
    })
  }, [])

  // Places `id` into `containerId` at `index` among `siblingIds` (the
  // rendered list at drag time, so no dependency on fresh state).
  const reorderInto = useCallback(
    (id: string, containerId: string, index: number, siblingIds: string[]) => {
      if (isFolder(id)) setFolderParent(id, containerId === 'root' ? null : containerId)
      else setTemplateFolder(id, containerId === 'root' ? null : containerId)

      const list = siblingIds.filter((x) => x !== id)
      list.splice(Math.max(0, Math.min(index, list.length)), 0, id)
      setOrder((prev) => {
        const next = { ...prev, [containerId]: list }
        persist(ORDER_KEY, next)
        return next
      })
    },
    [isFolder, setFolderParent, setTemplateFolder]
  )

  // Drop directly onto another item: two templates merge into a new (or the
  // target's existing) folder; anything dropped onto a folder moves into it.
  const mergeOnto = useCallback(
    (draggedId: string, targetId: string, targetContainerId: string, containerSiblingIds: string[]) => {
      if (draggedId === targetId) return
      const draggedIsFolder = isFolder(draggedId)
      const targetIsFolder = isFolder(targetId)

      if (targetIsFolder) {
        if (draggedIsFolder) setFolderParent(draggedId, targetId)
        else setTemplateFolder(draggedId, targetId)
        return
      }

      if (draggedIsFolder) return // dropping a folder onto a plain template is a no-op

      // Two templates dropped onto each other always spin up a new (sub)folder
      // at that spot — even if the target already sits inside a folder, so
      // grouping items that are already siblings still nests them deeper
      // instead of being a no-op.
      const untitledCount = folders.filter((f) => /^Untitled( \d+)?$/.test(f.name)).length
      const name = untitledCount === 0 ? 'Untitled' : `Untitled ${untitledCount + 1}`
      const folderId = createFolder(name, targetContainerId === 'root' ? null : targetContainerId)
      const list = containerSiblingIds.map((x) => (x === targetId ? folderId : x)).filter((x) => x !== draggedId)
      setOrder((prev) => {
        const next = { ...prev, [targetContainerId]: list, [folderId]: [targetId, draggedId] }
        persist(ORDER_KEY, next)
        return next
      })
      setTemplateFolder(targetId, folderId)
      setTemplateFolder(draggedId, folderId)
    },
    [folders, isFolder, createFolder, setFolderParent, setTemplateFolder]
  )

  const pinTemplate = useCallback((templateId: string) => {
    setPinned((prev) => {
      if (prev.includes(templateId)) return prev
      const next = [...prev, templateId]
      persist(PINNED_KEY, next)
      return next
    })
  }, [])

  const unpinTemplate = useCallback((templateId: string) => {
    if (templateId === 'daily-quiz') return
    setPinned((prev) => {
      const next = prev.filter((id) => id !== templateId)
      persist(PINNED_KEY, next)
      return next
    })
  }, [])

  // Daily Quiz can move around within quick access like any other pin, but
  // it can never be reordered out of existence — always re-add it if a
  // reorder somehow dropped it.
  const reorderPinned = useCallback((next: string[]) => {
    const safe = next.includes('daily-quiz') ? next : ['daily-quiz', ...next]
    setPinned(safe)
    persist(PINNED_KEY, safe)
  }, [])

  const isPinned = useCallback((templateId: string) => pinned.includes(templateId), [pinned])

  const toggleCollapse = useCallback((folderId: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
      persist(COLLAPSED_KEY, next)
      return next
    })
  }, [])

  const isCollapsed = useCallback((folderId: string) => collapsed.includes(folderId), [collapsed])

  return {
    folders,
    assignments,
    pinned,
    isFolder,
    computeChildren,
    createFolder,
    renameFolder,
    setFolderStyle,
    deleteFolder,
    reorderInto,
    mergeOnto,
    pinTemplate,
    unpinTemplate,
    reorderPinned,
    isPinned,
    toggleCollapse,
    isCollapsed,
  }
}
