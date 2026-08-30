/** Share-link id and token properties. */
import { newShareId, newEditToken, isShareId } from '../lib/share-id'

let failed = 0
const check = (n: string, c: boolean, d = '') => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c || !d ? '' : `\n         ${d}`}`)
  if (!c) failed++
}

const ids = Array.from({ length: 20000 }, newShareId)

check('ids are 7 characters', ids.every((i) => i.length === 7))
check('ids validate', ids.every(isShareId))

// Ambiguous glyphs would make links unreadable over voice or from a screenshot.
const ambiguous = /[01loiIO]/
check('no ambiguous glyphs', !ids.some((i) => ambiguous.test(i)), ids.find((i) => ambiguous.test(i)))

check('ids are unique in bulk', new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} collisions in ${ids.length}`)

// A weak generator would concentrate on a few characters.
const seen = new Set(ids.join(''))
check('uses the whole alphabet', seen.size === 31, `${seen.size} distinct characters`)

check('rejects wrong length', !isShareId('abc12') && !isShareId('abc12345'))
check('rejects excluded glyphs', !isShareId('abc12l4') && !isShareId('abc120x'))
check('rejects uppercase', !isShareId('ABC2345'))
check('rejects empty', !isShareId(''))

const tokens = Array.from({ length: 5000 }, newEditToken)
check('tokens are 32 characters', tokens.every((t) => t.length === 32))
check('tokens are unique', new Set(tokens).size === tokens.length)
check('tokens differ from ids', !tokens.some((t) => isShareId(t)))

console.log(failed ? `\n${failed} check(s) failed` : '\nAll share checks passed.')
process.exit(failed ? 1 : 0)
