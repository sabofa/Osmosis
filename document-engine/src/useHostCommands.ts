import { useEffect, useRef } from 'react'
import type { DocumentHost } from './types'
import { buildCommands, commandsShape, type CommandState } from './commands'

// Publishes the viewer's toolbar commands to the host. `run` goes through a
// ref to the latest callbacks, so it is never stale; the list is only
// republished when its visible shape (ids/labels/icons/enabled/active)
// changes or the host's toolbar identity changes. Clears on unmount.
export function useHostCommands(host: DocumentHost | undefined, latest: CommandState): void {
  const latestRef = useRef(latest)
  latestRef.current = latest
  const commandsKey = commandsShape(buildCommands(latest))
  const toolbar = host?.toolbar
  useEffect(() => {
    if (!toolbar) return
    const cmds = buildCommands({
      ...latestRef.current,
      onZoomIn: () => latestRef.current.onZoomIn(),
      onZoomOut: () => latestRef.current.onZoomOut(),
      onFit: (m) => latestRef.current.onFit(m),
      onToggleOverlays: () => latestRef.current.onToggleOverlays(),
      onRemoveHighlight: () => latestRef.current.onRemoveHighlight(),
      onDownload: () => latestRef.current.onDownload(),
      graph: latestRef.current.graph
        ? {
            ...latestRef.current.graph,
            onExpand: () => latestRef.current.graph?.onExpand(),
            onCollapse: () => latestRef.current.graph?.onCollapse(),
          }
        : null,
    })
    toolbar.publishCommands(cmds)
    return () => toolbar.clear()
  }, [toolbar, commandsKey])
}
