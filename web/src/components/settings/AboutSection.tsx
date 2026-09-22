import { useEffect, useState } from 'react'
import { getVersion, type NodeStatus, type VersionInfo } from '../../lib/api'

// What this is and where it runs: versions, the node, and how to reach the
// same commands from a terminal.
export default function AboutSection({ status }: { status: NodeStatus | null }) {
  const [version, setVersion] = useState<VersionInfo | null>(null)
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])

  const rows: [string, string][] = [
    ['Node', status ? `${status.node.label} · ${status.node.canonical ? 'canonical' : 'local'} · ${status.node.id}` : '…'],
    ['Server', status?.remote_url ?? (status?.canonical ? 'this is the server' : '…')],
    ['Protocol', status ? `v${status.protocol_version}${status.remote_protocol_version ? ` · server v${status.remote_protocol_version}` : ''}` : '…'],
    ['Tools', status ? `v${status.tools_version}` : '…'],
    ['Build', version?.commit ? `${version.commit.commit.slice(0, 7)} on ${version.branch} · ${version.commit.subject}` : version?.error ?? '…'],
    ['Checkout', version?.repo_dir ?? '—'],
    ['Push', status ? (status.push ? 'live updates over SSE' : 'polling') : '…'],
  ]

  return (
    <div className="settings-section">
      <div className="settings-section-title">About</div>
      <div className="about-grid">
        {rows.map(([k, v]) => (
          <div className="about-row" key={k}>
            <span className="about-key">{k}</span>
            <span className="about-val">{v}</span>
          </div>
        ))}
      </div>
      <div className="settings-row quiet">
        <div>
          <div className="settings-row-title">The command line</div>
          <div className="settings-row-sub">
            press / anywhere, or in a terminal: <code>npx osmosis</code> · <code>osmosis daily q</code> · <code>osmosis update</code>
          </div>
        </div>
      </div>
      <div className="settings-row quiet">
        <div>
          <div className="settings-row-title">Where data lives</div>
          <div className="settings-row-sub">
            the bank is the server's; this device holds downloaded slices and its own attempts, pushed up when online. Updating
            never touches either.
          </div>
        </div>
      </div>
    </div>
  )
}
