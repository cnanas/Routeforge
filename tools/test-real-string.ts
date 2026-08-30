/**
 * Fidelity check against a genuine in-game MDT export.
 *
 * The bar is byte-identical re-encoding: decode the addon's own string,
 * rebuild it through our model, and require the result to match exactly.
 * Anything less means the addon may reject what we produce.
 */
import { readFileSync } from 'node:fs'
import { inflateRaw } from 'pako'
import { decodeMdtString, encodeMdtString, field, luaList, luaPairs } from '../lib/mdt-string'
import { presetToRoute, routeToPreset, forcesFor } from '../lib/route'

const SAMPLE = readFileSync(new URL('./fixtures/real-route.txt', import.meta.url).pathname, 'utf8').trim()

let failed = 0
const check = (n: string, c: boolean, d = '') => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c || !d ? '' : `\n         ${d}`}`)
  if (!c) failed++
}

const { preset, dialect } = decodeMdtString(SAMPLE)
console.log('  dialect:', JSON.stringify(dialect))

check('reads the route name', field(preset, 'text') === 'Default', String(field(preset, 'text')))
check('reads the dungeon', field(field(preset, 'value'), 'currentDungeonIdx') === 162)
check('keys decoded as text', luaPairs(preset).every(([k]) => typeof k === 'string'))

const pulls = luaList(field(field(preset, 'value'), 'pulls'))
check('reads all pulls', pulls.length === 14, `got ${pulls.length}`)
check('pull has integer enemy keys', luaPairs(pulls[0]).some(([k]) => typeof k === 'number'))
check('pull has a colour', typeof field(pulls[0], 'color') === 'string', String(field(pulls[0], 'color')))

/*
 * The bar is the CBOR payload, not the final string: deflate is not
 * canonical, so pako and Blizzard's compressor emit different (equally
 * valid) streams for identical input. What must match exactly is what the
 * addon actually deserialises.
 */
const payload = (s: string) => inflateRaw(Uint8Array.from(atob(s.slice('!~MDT2~'.length)), (c) => c.charCodeAt(0)))
const gameBytes = payload(SAMPLE)
const ourBytes = payload(encodeMdtString(preset, dialect))
check(
  're-encoded CBOR is byte-identical to the game payload',
  gameBytes.length === ourBytes.length && gameBytes.every((v, i) => v === ourBytes[i]),
  `game ${gameBytes.length}B vs ours ${ourBytes.length}B`
)

// And again after a full trip through the editable model.
const route = presetToRoute(preset, dialect)
check('model reads the pulls', route.pulls.length === 14, `got ${route.pulls.length}`)
check('model preserves the name', route.name === 'Default')
check('model carries unmodelled fields', route.carry.some(([k]) => k === 'difficulty'))

const rebuilt = decodeMdtString(encodeMdtString(routeToPreset(route), route.dialect))
check('round-trip keeps the dungeon', field(field(rebuilt.preset, 'value'), 'currentDungeonIdx') === 162)
check('round-trip keeps every pull', luaList(field(field(rebuilt.preset, 'value'), 'pulls')).length === 14)
check('round-trip keeps difficulty', field(rebuilt.preset, 'difficulty') === 10)
check('round-trip keeps addonVersion', field(rebuilt.preset, 'addonVersion') === 629)
check('round-trip keeps colorPaletteInfo', field(field(rebuilt.preset, 'colorPaletteInfo'), 'colorPaletteIdx') === 4)

const dungeon = JSON.parse(readFileSync(new URL('../public/data/dungeons/the-blinding-vale.json', import.meta.url).pathname, 'utf8'))
const rows = forcesFor(route, dungeon)
const pct = rows[rows.length - 1].cumulativePct
console.log(`  route completes ${pct.toFixed(1)}% of ${dungeon.name} forces across ${rows.length} pulls`)
check('a real route reaches at least 100% forces', pct >= 100, `got ${pct.toFixed(1)}%`)
// Zero-force pulls are legitimate: bosses and their adds award no enemy
// forces, so a boss pull contributes 0 by design.
const counts = new Map<number, number>(dungeon.enemies.map((e: { mdtIdx: number; count: number }) => [e.mdtIdx, e.count]))
const zeroPulls = rows.filter((r) => r.count === 0)
const explained = zeroPulls.every((r) => {
  const pull = route.pulls.find((p) => p.id === r.pullId)!
  const keys = Object.keys(pull.enemies).map(Number).filter((k) => pull.enemies[k].length > 0)
  return keys.every((k) => (counts.get(k) ?? 0) === 0)
})
check('zero-force pulls hold only 0-force enemies', explained, `${zeroPulls.length} zero-force pulls`)
check('most pulls do award forces', rows.filter((r) => r.count > 0).length >= 10, `${rows.filter((r) => r.count > 0).length}/14`)

console.log(failed ? `\n${failed} check(s) failed` : '\nReal-string fidelity confirmed.')
process.exit(failed ? 1 : 0)
