/**
 * Undo/redo for the route being edited.
 *
 * A reducer rather than nested setState calls: React may invoke a state
 * updater twice under StrictMode, so pushing history from inside one would
 * record phantom entries. Reducers are pure, so this stays correct.
 */
import type { Route } from './route'

export interface HistoryState {
  present: Route
  past: Route[]
  future: Route[]
}

export type HistoryAction =
  /** Edit the current route; recorded on the undo stack. */
  | { type: 'edit'; fn: (r: Route) => Route }
  /** Swap in a different route entirely (import, load, new) — clears history. */
  | { type: 'replace'; route: Route }
  | { type: 'undo' }
  | { type: 'redo' }

/** Plenty for hand editing, and bounded so long sessions can't grow forever. */
const LIMIT = 60

export const initHistory = (route: Route): HistoryState => ({ present: route, past: [], future: [] })

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'edit': {
      const next = action.fn(state.present)
      // Handlers return the same object when nothing changed; don't record it.
      if (next === state.present) return state
      return { present: next, past: [...state.past, state.present].slice(-LIMIT), future: [] }
    }
    case 'replace':
      return initHistory(action.route)
    case 'undo': {
      const prev = state.past[state.past.length - 1]
      if (!prev) return state
      return { present: prev, past: state.past.slice(0, -1), future: [state.present, ...state.future] }
    }
    case 'redo': {
      const [next, ...rest] = state.future
      if (!next) return state
      return { present: next, past: [...state.past, state.present], future: rest }
    }
  }
}
