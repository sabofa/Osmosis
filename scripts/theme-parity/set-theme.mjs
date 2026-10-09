// Tiny API helper for the parity backend (default http://localhost:8082, env PARITY_API).
//   node set-theme.mjs active <id|null> [workspace]   set the ambience (or workspace) pointer
//   node set-theme.mjs save <manifest.json>           PUT /api/themes/<manifest.id> {manifest}
//   node set-theme.mjs delete <id>                    DELETE /api/themes/<id>
//   node set-theme.mjs list                           print pointers + theme ids
const api = process.env.PARITY_API ?? 'http://localhost:8082'
const [cmd, a, b] = process.argv.slice(2)
const call = async (method, path, body) => {
  const r = await fetch(api + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  console.log(method, path, r.status, t.slice(0, 200))
  if (!r.ok) process.exit(1)
  return t
}
if (cmd === 'active') {
  const body = { id: a === 'null' ? null : a }
  if (b) body.layer = b
  await call('PUT', '/api/themes/active', body)
} else if (cmd === 'save') {
  const { readFileSync } = await import('node:fs')
  const manifest = JSON.parse(readFileSync(a, 'utf8'))
  await call('PUT', '/api/themes/' + encodeURIComponent(manifest.id), { manifest })
} else if (cmd === 'delete') {
  await call('DELETE', '/api/themes/' + encodeURIComponent(a))
} else if (cmd === 'list') {
  const j = JSON.parse(await (await fetch(api + '/api/themes')).text())
  console.log({ ambience: j.active_theme_id, workspace: j.active_workspace_theme_id, themes: j.themes.map((t) => t.id), builtins: j.builtins.map((t) => t.id) })
} else { console.error('usage: see header'); process.exit(2) }
