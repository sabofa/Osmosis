// Pure state machine for one active-theme pointer (ambience or workspace).
// `value` is what the UI shows (optimistic), `confirmed` is the last id the
// server acknowledged, `req` counts choices, `lastChoice` is the newest one.
export type SlotState = { value: string | null; confirmed: string | null; req: number; lastChoice: number }

export const initSlot = (id: string | null): SlotState => ({ value: id, confirmed: id, req: 0, lastChoice: 0 })

export function choose(state: SlotState, id: string | null): { state: SlotState; mine: number } {
  const mine = state.req + 1
  return { state: { ...state, value: id, req: mine, lastChoice: mine }, mine }
}

// A success always confirms its id; it only drives `value` if it is still the newest choice.
export function choiceSucceeded(state: SlotState, mine: number, id: string | null): SlotState {
  return { ...state, confirmed: id, value: mine === state.lastChoice ? id : state.value }
}

// A stale failure (superseded by a newer choice) is ignored.
export function choiceFailed(state: SlotState, mine: number): SlotState {
  return mine !== state.lastChoice ? state : { ...state, value: state.confirmed }
}

export function refreshStarted(state: SlotState): { snapshot: number } {
  return { snapshot: state.req }
}

// Server truth: adopt it unless a choice was made since the refresh began.
export function refreshAdopt(state: SlotState, snapshot: number, serverId: string | null): SlotState {
  return snapshot !== state.req ? state : { ...state, value: serverId, confirmed: serverId }
}

export function deleted(state: SlotState, id: string): SlotState {
  return {
    ...state,
    value: state.value === id ? null : state.value,
    confirmed: state.confirmed === id ? null : state.confirmed,
  }
}
