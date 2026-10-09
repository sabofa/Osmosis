import { describe, it, expect } from 'vitest'
import { serverSupportsWorkspace } from './api'

describe('serverSupportsWorkspace', () => {
  it.each([
    [{ themes: [] }, false],
    [{ active_workspace_theme_id: null }, true],
    [{ active_workspace_theme_id: 'builtin:ws-clean' }, true],
    [null, false],
    ['active_workspace_theme_id', false],
    [undefined, false],
    [42, false],
  ])('%j => %s', (payload, want) => {
    expect(serverSupportsWorkspace(payload)).toBe(want)
  })
})
