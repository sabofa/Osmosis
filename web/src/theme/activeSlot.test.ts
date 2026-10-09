import { describe, it, expect } from 'vitest'
import { initSlot, choose, choiceSucceeded, choiceFailed, refreshStarted, refreshAdopt, deleted } from './activeSlot'

describe('activeSlot reducer', () => {
  it('choose is optimistic and the counter is monotonic', () => {
    const c1 = choose(initSlot('a'), 'b')
    const c2 = choose(c1.state, 'c')
    expect(c1.mine).toBe(1)
    expect(c2.mine).toBe(2)
    expect(c2.state.value).toBe('c')
    expect(c2.state.confirmed).toBe('a')
    expect(c2.state.req).toBe(2)
  })

  it('choose A, choose B, A fails after B succeeded => value B', () => {
    const a = choose(initSlot(null), 'A')
    const b = choose(a.state, 'B')
    let s = choiceSucceeded(b.state, b.mine, 'B')
    s = choiceFailed(s, a.mine)
    expect(s.value).toBe('B')
    expect(s.confirmed).toBe('B')
  })

  it('A succeeds then B fails => rolls back to A', () => {
    const a = choose(initSlot(null), 'A')
    let s = choiceSucceeded(a.state, a.mine, 'A')
    const b = choose(s, 'B')
    s = choiceFailed(b.state, b.mine)
    expect(s.value).toBe('A')
  })

  it('late success of A after B started updates confirmed but not value', () => {
    const a = choose(initSlot(null), 'A')
    const b = choose(a.state, 'B')
    const s = choiceSucceeded(b.state, a.mine, 'A')
    expect(s.confirmed).toBe('A')
    expect(s.value).toBe('B')
    expect(choiceFailed(s, b.mine).value).toBe('A')
  })

  it('stale failure never changes value', () => {
    const a = choose(initSlot('z'), 'A')
    const b = choose(a.state, 'B')
    expect(choiceFailed(b.state, a.mine)).toEqual(b.state)
  })

  it('refresh started, choose X, refresh returns old => keeps X; PUT success confirms X', () => {
    const { snapshot } = refreshStarted(initSlot('old'))
    const x = choose(initSlot('old'), 'X')
    let s = refreshAdopt(x.state, snapshot, 'old')
    expect(s.value).toBe('X')
    s = choiceSucceeded(s, x.mine, 'X')
    expect(s.value).toBe('X')
    expect(s.confirmed).toBe('X')
  })

  it('a refresh that began after the choice may adopt old, but the PUT success restores the choice', () => {
    const x = choose(initSlot('old'), 'X')
    const { snapshot } = refreshStarted(x.state)
    let s = refreshAdopt(x.state, snapshot, 'old')
    s = choiceSucceeded(s, x.mine, 'X')
    expect(s.value).toBe('X')
    expect(s.confirmed).toBe('X')
  })

  it('refresh with no concurrent choice adopts the server id', () => {
    const s0 = initSlot('a')
    const { snapshot } = refreshStarted(s0)
    const s = refreshAdopt(s0, snapshot, 'srv')
    expect(s.value).toBe('srv')
    expect(s.confirmed).toBe('srv')
  })

  it('delete clears value and confirmed when they match', () => {
    const s = deleted(initSlot('a'), 'a')
    expect(s.value).toBeNull()
    expect(s.confirmed).toBeNull()
    expect(deleted(initSlot('a'), 'b').value).toBe('a')
  })

  it('delete clears only the matching field', () => {
    const c = choose(initSlot('a'), 'b')
    const s = deleted(c.state, 'a')
    expect(s.value).toBe('b')
    expect(s.confirmed).toBeNull()
  })

  it('repeated identical choice is idempotent in value', () => {
    const a = choose(initSlot(null), 'A')
    const b = choose(a.state, 'A')
    let s = choiceSucceeded(b.state, b.mine, 'A')
    s = choiceSucceeded(s, a.mine, 'A')
    expect(s.value).toBe('A')
    expect(s.confirmed).toBe('A')
  })
})
