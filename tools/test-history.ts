/** Undo/redo semantics, including the StrictMode double-invoke hazard. */
import { historyReducer, initHistory, type HistoryState } from '../lib/history'
import { emptyRoute, newPull, type Route } from '../lib/route'

let failed = 0
const check = (n: string, c: boolean, d = '') => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c || !d ? '' : `\n         ${d}`}`)
  if (!c) failed++
}

const addPull = (r: Route): Route => ({ ...r, pulls: [...r.pulls, newPull(r.pulls.length)] })
const rename = (name: string) => (r: Route): Route => ({ ...r, name })

let s: HistoryState = initHistory(emptyRoute(163, 'Start'))
check('starts with nothing to undo', s.past.length === 0 && s.future.length === 0)

s = historyReducer(s, { type: 'edit', fn: addPull })
s = historyReducer(s, { type: 'edit', fn: addPull })
check('records each edit', s.past.length === 2, `past=${s.past.length}`)
check('applies the edits', s.present.pulls.length === 3, `${s.present.pulls.length} pulls`)

s = historyReducer(s, { type: 'undo' })
check('undo steps back one', s.present.pulls.length === 2)
check('undo fills the redo stack', s.future.length === 1)

s = historyReducer(s, { type: 'redo' })
check('redo restores', s.present.pulls.length === 3 && s.future.length === 0)

// A no-op handler returns the same object; that must not create a bogus step.
const before = s.past.length
s = historyReducer(s, { type: 'edit', fn: (r) => r })
check('no-op edits are not recorded', s.past.length === before, `past=${s.past.length}`)

// Reducers must be pure: React may invoke them twice under StrictMode.
const base = initHistory(emptyRoute(163, 'Pure'))
const once = historyReducer(base, { type: 'edit', fn: rename('A') })
const twice = historyReducer(base, { type: 'edit', fn: rename('A') })
check('reducer is pure across repeat calls', once.past.length === twice.past.length && once.present.name === twice.present.name)
check('the original state is untouched', base.past.length === 0 && base.present.name === 'Pure')

s = historyReducer(s, { type: 'edit', fn: rename('Edited') })
check('a new edit clears the redo stack', s.future.length === 0)

s = historyReducer(s, { type: 'replace', route: emptyRoute(150, 'Imported') })
check('replace swaps the route', s.present.name === 'Imported')
check('replace clears history', s.past.length === 0 && s.future.length === 0)

const empty = initHistory(emptyRoute(163))
check('undo at the start is a no-op', historyReducer(empty, { type: 'undo' }) === empty)
check('redo at the end is a no-op', historyReducer(empty, { type: 'redo' }) === empty)

let deep = initHistory(emptyRoute(163))
for (let i = 0; i < 200; i++) deep = historyReducer(deep, { type: 'edit', fn: addPull })
check('history stays bounded', deep.past.length === 60, `past=${deep.past.length}`)
check('bounded history still undoes', historyReducer(deep, { type: 'undo' }).present.pulls.length === 200)

console.log(failed ? `\n${failed} check(s) failed` : '\nAll history checks passed.')
process.exit(failed ? 1 : 0)
