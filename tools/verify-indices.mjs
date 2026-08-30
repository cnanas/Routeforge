/**
 * Cross-checks the JSON's mdtIdx values against Lua's own view of the tables.
 *
 * Route strings address enemies and clones by their 1-based Lua index, so this
 * guards the single assumption the whole import/export round-trip rests on.
 */
import { LuaFactory } from 'wasmoon'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ADDON = process.env.MDT_PATH ||
  '/Applications/World of Warcraft/_retail_/Interface/AddOns/MythicDungeonTools'
const DATA = new URL('../public/data/dungeons/', import.meta.url).pathname

const lua = await (new LuaFactory()).createEngine()
await lua.doString(`
  MDT = { AddonName = "MythicDungeonTools", L = {} }
  for _, k in ipairs({ "dungeonList","mapInfo","zoneIdToDungeonIdx","dungeonMaps",
    "dungeonSubLevels","dungeonTotalCount","mapPOIs","dungeonEnemies" }) do MDT[k] = {} end
  tinsert = table.insert
  function MDT:IsRetail() return true end
  LibStub = setmetatable({ GetLibrary = function() return setmetatable({}, {
    __index = function() return function() end end }) end },
    { __call = function(_, ...) return LibStub.GetLibrary(...) end })
  function LOAD(path, src) load(src, path)("MythicDungeonTools", MDT) end

  -- Flatten to a string so the fingerprint never crosses the JS table bridge
  -- that caused the off-by-one in the first place.
  function FINGERPRINT(dungeonIdx)
    local out = {}
    for enemyIdx, enemy in pairs(MDT.dungeonEnemies[dungeonIdx]) do
      local clones = {}
      for cloneIdx in pairs(enemy.clones or {}) do table.insert(clones, cloneIdx) end
      table.sort(clones)
      table.insert(out, enemyIdx .. "|" .. enemy.name .. "|" .. table.concat(clones, ","))
    end
    table.sort(out)
    return table.concat(out, "\\n")
  end
`)
const load = (p) => lua.global.get('LOAD')(p, readFileSync(p, 'utf8'))
load(join(ADDON, 'Locales', 'enUS.lua'))
for (const f of readdirSync(join(ADDON, 'Midnight')).filter((f) => f.endsWith('.lua') && !f.startsWith('load_')))
  load(join(ADDON, 'Midnight', f))

const fingerprint = lua.global.get('FINGERPRINT')
let bad = 0
for (const f of readdirSync(DATA)) {
  const d = JSON.parse(readFileSync(join(DATA, f), 'utf8'))
  const mine = d.enemies
    .map((e) => `${e.mdtIdx}|${e.name}|${e.clones.map((c) => c.mdtIdx).sort((a, b) => a - b).join(',')}`)
    .sort()
    .join('\n')
  const theirs = fingerprint(d.idx)
  if (mine === theirs) {
    console.log(`  ok   ${d.name}`)
  } else {
    bad++
    const m = mine.split('\n'), t = theirs.split('\n')
    const i = m.findIndex((line, n) => line !== t[n])
    console.log(`  FAIL ${d.name}\n         json: ${m[i]}\n         lua : ${t[i]}`)
  }
}
lua.global.close()
console.log(bad ? `\n${bad} dungeon(s) mismatched` : '\nAll 16 dungeons match Lua exactly.')
process.exit(bad ? 1 : 0)
