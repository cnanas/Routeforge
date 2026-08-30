/** Round-trip: MDT string -> Route -> MDT string, with nothing lost. */
import { encodeMdtString, decodeMdtString, field, luaList, luaPairs, toLuaList, type ListStyle, type StringStyle } from '../lib/mdt-string'
import { presetToRoute, routeToPreset, forcesFor, type Route } from '../lib/route'
import { markerForNote } from '../lib/markers'
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n: string, c: boolean, d = '') => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c || !d ? '' : `\n         ${d}`}`)
  if (!c) failed++
}

const build = (lists: ListStyle) =>
  new Map<string, unknown>([
    ['text', 'Voidscar Speedrun'],
    ['uid', 'zz9'],
    ['value', new Map<string, unknown>([
      ['currentDungeonIdx', 163],
      ['currentSublevel', 1],
      ['pulls', toLuaList([
        new Map<number | string, unknown>([[1, toLuaList([2, 3], lists)], [16, toLuaList([1], lists)], ['color', 'ff3eff']]),
        new Map<number | string, unknown>([[19, toLuaList([1, 2], lists)], ['color', '3eff9e']]),
      ], lists)],
      // An unmodelled field: must survive re-export untouched.
      ['riftOffsets', new Map<string, unknown>([['a', 1]])],
    ])],
    ['objects', toLuaList([
      new Map<string, unknown>([['d', toLuaList([5, 1, 1, true, 'ff0000', 0, true], lists)], ['l', toLuaList([100, -200, 150, -250, 180, -300], lists)]]),
      new Map<string, unknown>([['d', toLuaList([300, -400, 1, true, 'Bloodlust', 0], lists)], ['n', true]]),
      new Map<string, unknown>([['d', toLuaList([310, -410, 1, true, 'kite here', 0], lists)], ['n', true]]),
    ], lists)],
    ['week', 7],
    ['difficulty', 12],
  ])

for (const lists of ['array', 'map'] as ListStyle[])
for (const strings of ['bytes', 'text'] as StringStyle[]) {
  console.log(`\n[ ${lists} lists, ${strings} strings ]`)
  const original = encodeMdtString(build(lists), { compression: 'raw', lists, strings })
  const { preset, dialect } = decodeMdtString(original)
  const route = presetToRoute(preset, dialect)

  check('reads route name', route.name === 'Voidscar Speedrun')
  check('reads dungeon', route.dungeonIdx === 163)
  check('reads both pulls', route.pulls.length === 2)
  check('reads pull colour', route.pulls[0].color === 'ff3eff')
  check('reads enemy -> clones', JSON.stringify(route.pulls[0].enemies[1]) === '[2,3]', JSON.stringify(route.pulls[0].enemies))
  check('classifies a 3-point line as pen', route.objects[0].kind === 'pen')
  check('reads note text', (route.objects[1] as { text: string }).text === 'Bloodlust')
  check('recognises the marker', (route.objects[1] as { markerId?: string }).markerId === 'bloodlust')
  check('leaves a plain note unmarked', (route.objects[2] as { markerId?: string }).markerId === undefined)

  // Re-export and decode again: the shape MDT would receive.
  const round = decodeMdtString(encodeMdtString(routeToPreset(route), dialect))
  const value = field(round.preset, 'value')
  check('re-exports the dungeon', field(value, 'currentDungeonIdx') === 163)

  const pulls = luaList(field(value, 'pulls'))
  check('re-exports both pulls', pulls.length === 2)
  const keys = luaPairs(pulls[0]).map(([k]) => k)
  check('enemy keys stay integers', keys.filter((k) => typeof k === 'number').length === 2, keys.map((k) => `${typeof k}:${String(k)}`).join(', '))
  check('colour survives', field(pulls[0], 'color') === 'ff3eff')
  check('clone list survives', JSON.stringify(luaList(luaPairs(pulls[0]).find(([k]) => k === 1)?.[1])) === '[2,3]')

  check('unmodelled value field carried through', field(field(value, 'riftOffsets'), 'a') === 1)
  check('unmodelled top field carried through', field(round.preset, 'week') === 7)
  check('difficulty carried through', field(round.preset, 'difficulty') === 12)

  const objs = luaList(field(round.preset, 'objects'))
  check('re-exports all objects', objs.length === 3, `got ${objs.length}`)
  check('drawing coords survive', JSON.stringify(luaList(field(objs[0], 'l'))) === '[100,-200,150,-250,180,-300]')
  check('note stays a note', field(objs[1], 'n') === true)
  check('marker note keeps its label', luaList(field(objs[1], 'd'))[4] === 'Bloodlust')
  check('marker label resolves back', markerForNote('Bloodlust')?.id === 'bloodlust')
}

console.log('\n[ forces ]')
const dungeon = JSON.parse(readFileSync(new URL('../public/data/dungeons/voidscar-arena.json', import.meta.url).pathname, 'utf8'))
const r = presetToRoute(decodeMdtString(encodeMdtString(build('array'), { compression: 'raw', lists: 'array', strings: 'bytes' })).preset, { compression: 'raw', lists: 'array', strings: 'bytes' }) as Route
const rows = forcesFor(r, dungeon)
const byIdx = new Map<number, { count: number }>(dungeon.enemies.map((e: { mdtIdx: number; count: number }) => [e.mdtIdx, e]))
const expect0 = (byIdx.get(1)?.count ?? 0) * 2 + (byIdx.get(16)?.count ?? 0) * 1
check('pull 1 forces match the data', rows[0].count === expect0, `got ${rows[0].count}, expected ${expect0}`)
check('cumulative accumulates', rows[1].cumulative === rows[0].count + rows[1].count)
check('percentages track the dungeon total', Math.abs(rows[1].cumulativePct - (rows[1].cumulative / dungeon.totalCount) * 100) < 1e-9)

console.log(failed ? `\n${failed} check(s) failed` : '\nAll route checks passed.')
process.exit(failed ? 1 : 0)
