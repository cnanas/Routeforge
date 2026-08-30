/**
 * Round-trip tests for the MDT2 codec.
 *
 * Shapes mirror what's actually in SavedVariables — notably a pull table that
 * mixes integer enemy keys with a string "color" key, which is the detail the
 * whole import/export round-trip depends on.
 */
import {
  encodeMdtString, decodeMdtString, MDT2_PREFIX, field, luaList, luaPairs, toLuaList,
  type Compression, type ListStyle, type StringStyle,
} from '../lib/mdt-string'

let failed = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : `\n         ${detail}`}`)
  if (!cond) failed++
}

const buildPreset = (lists: ListStyle) => {
  const pull1 = new Map<number | string, unknown>([
    [1, toLuaList([2, 3], lists)],
    [16, toLuaList([1], lists)],
    ['color', 'ff3eff'],
  ])
  const pull2 = new Map<number | string, unknown>([
    [19, toLuaList([1, 2], lists)],
    ['color', '3eff9e'],
  ])
  return new Map<string, unknown>([
    ['text', 'Test Route'],
    ['uid', 'abc123'],
    ['value', new Map<string, unknown>([
      ['currentDungeonIdx', 163],
      ['currentSublevel', 1],
      ['pulls', toLuaList([pull1, pull2], lists)],
    ])],
    ['objects', toLuaList([
      new Map<string, unknown>([['d', toLuaList([5, 1, 1, true, 'ff0000', 0], lists)], ['l', toLuaList([100, -200, 150, -250], lists)]]),
      new Map<string, unknown>([['d', toLuaList([300, -400, 1, true, 'Bloodlust', 0], lists)], ['n', true]]),
    ], lists)],
    ['week', 3],
  ])
}

for (const lists of ['array', 'map'] as ListStyle[])
for (const strings of ['bytes', 'text'] as StringStyle[]) {
  console.log(`\n[ lists as ${lists}, strings as ${strings} ]`)
  const preset = buildPreset(lists)
  const str = encodeMdtString(preset, { compression: 'raw', lists, strings })
  check('encodes with the !~MDT2~ prefix', str.startsWith(MDT2_PREFIX))

  const { preset: back, dialect } = decodeMdtString(str)
  check('detects the list style', dialect.lists === lists, `detected ${dialect.lists}`)
  check('detects the string style', dialect.strings === strings, `detected ${dialect.strings}`)
  check('detects compression', dialect.compression === 'raw', `detected ${dialect.compression}`)
  check('keeps route name', field(back, 'text') === 'Test Route')

  const value = field(back, 'value')
  check('keeps dungeon index', field(value, 'currentDungeonIdx') === 163)

  const pulls = luaList(field(value, 'pulls'))
  check('keeps both pulls', pulls.length === 2, `got ${pulls.length}`)

  // If integer enemy keys come back as text, MDT silently drops every pull.
  const keys = luaPairs(pulls[0]).map(([k]) => k)
  check('integer enemy keys stay numbers', keys.filter((k) => typeof k === 'number').length === 2, `keys: ${keys.map((k) => `${typeof k}:${String(k)}`).join(', ')}`)
  check('string colour key stays a string', field(pulls[0], 'color') === 'ff3eff')
  check('clone list survives', JSON.stringify(luaList(luaPairs(pulls[0]).find(([k]) => k === 16)?.[1])) === '[1]')

  const objects = luaList(field(back, 'objects'))
  check('drawing coords survive', JSON.stringify(luaList(field(objects[0], 'l'))) === '[100,-200,150,-250]')
  check('note flag survives', field(objects[1], 'n') === true)
  check('note text survives', luaList(field(objects[1], 'd'))[4] === 'Bloodlust')
}

console.log('\n[ compression detection ]')
for (const how of ['raw', 'zlib', 'gzip'] as Compression[]) {
  const r = decodeMdtString(encodeMdtString(buildPreset('array'), { compression: how, lists: 'array', strings: 'bytes' }))
  check(`auto-detects ${how}`, r.dialect.compression === how, `detected ${r.dialect.compression}`)
}

console.log('\n[ rejections ]')
check('rejects a legacy string', (() => {
  try { decodeMdtString('!abcdef'); return false } catch (e) { return String(e).includes('legacy') }
})())
check('rejects junk', (() => {
  try { decodeMdtString('hello'); return false } catch { return true }
})())
check('rejects empty input', (() => {
  try { decodeMdtString('   '); return false } catch { return true }
})())

console.log(failed ? `\n${failed} check(s) failed` : '\nAll codec checks passed.')
process.exit(failed ? 1 : 0)
