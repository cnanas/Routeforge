/**
 * Extracts MDT's Lua dungeon data into JSON by executing it in a real Lua VM.
 *
 * The dungeon files are code, not data (string concatenation, L[] locale
 * lookups), so they're run against a stubbed MDT/LibStub environment rather
 * than parsed. Re-run this after any MDT update.
 */
import { LuaFactory } from 'wasmoon'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const ADDON = process.env.MDT_PATH ||
  '/Applications/World of Warcraft/_retail_/Interface/AddOns/MythicDungeonTools'
const OUT = new URL('../public/data/', import.meta.url).pathname

// MDT's map canvas at scale 1: a 15x10 grid of square tiles (840 / 15 = 56).
const CANVAS = { width: 840, height: 560, cols: 15, rows: 10 }

/** Tactical markers MDT attaches to a spell. */
const SPELL_FLAGS = ['interruptible', 'magic', 'enrage', 'bleed', 'poison', 'curse', 'disease']

const factory = new LuaFactory()
const lua = await factory.createEngine()

// Minimal stand-ins for the addon environment the data files touch.
await lua.doString(`
  MDT = { AddonName = "MythicDungeonTools", L = {} }
  for _, k in ipairs({
    "dungeonList", "mapInfo", "zoneIdToDungeonIdx", "dungeonMaps",
    "dungeonSubLevels", "dungeonTotalCount", "mapPOIs", "dungeonEnemies",
    "dungeonBosses", "scaleMultiplier", "dungeonEnemyIds",
  }) do MDT[k] = {} end

  tinsert = table.insert
  function MDT:IsRetail() return true end
  function MDT:IsSeasonalDungeon() return false end

  LibStub = setmetatable({ GetLibrary = function() return setmetatable({}, {
    __index = function() return function() end end }) end },
    { __call = function(_, ...) return LibStub.GetLibrary(...) end })

  -- Runs a data file the way the addon loads it: chunk(addonName, MDT)
  function LOAD(path, src)
    local chunk, err = load(src, path)
    if not chunk then error(path .. ": " .. tostring(err)) end
    chunk("MythicDungeonTools", MDT)
  end
`)

const load = (path) => {
  const fn = lua.global.get('LOAD')
  fn(path, readFileSync(path, 'utf8'))
}

// Locale first: dungeon files resolve display names through L[...] at load time.
load(join(ADDON, 'Locales', 'enUS.lua'))

// Season membership lives in the dungeon-select UI module, not the data files.
load(join(ADDON, 'Modules', 'DungeonSelect.lua'))

const dungeonDir = join(ADDON, 'Midnight')
const files = readdirSync(dungeonDir).filter((f) => f.endsWith('.lua') && !f.startsWith('load_'))
for (const f of files) load(join(dungeonDir, f))

const MDTData = lua.global.get('MDT')

/**
 * Collects a Lua array-like table in key order.
 *
 * These tables are NOT dense: MDT leaves nil holes behind when a spawn or
 * enemy is deleted, so walking 1..n until undefined silently truncates
 * (Temple of Sethraliss loses 72% of its spawns that way). Iterate the keys
 * that actually exist and keep each one's original index, because route
 * strings address enemies and clones by that Lua index.
 */
const entries = (t) => {
  if (!t) return []
  // wasmoon hands back a 0-based JS array for DENSE Lua tables but a 1-based
  // object for sparse ones, so the two shapes disagree about what index a
  // value sits at. Normalise both to Lua's 1-based numbering — route strings
  // address enemies and clones by that index, so an off-by-one here silently
  // corrupts every exported route.
  if (Array.isArray(t)) {
    return t
      .map((v, i) => [i + 1, v])
      .filter(([, v]) => v !== undefined && v !== null)
  }
  return Object.keys(t)
    .map(Number)
    .filter((k) => Number.isInteger(k))
    .sort((a, b) => a - b)
    .map((k) => [k, t[k]])
}
const seq = (t) => entries(t).map(([, v]) => v)

const textureFolder = (maps) => {
  const custom = maps?.[1]?.customTextures
  return custom ? custom.split('\\').pop() : null
}

mkdirSync(join(OUT, 'dungeons'), { recursive: true })

const index = []
for (const [idxRaw, name] of Object.entries(MDTData.dungeonList ?? {})) {
  const idx = Number(idxRaw)
  const info = MDTData.mapInfo?.[idx]
  const folder = textureFolder(MDTData.dungeonMaps?.[idx])
  if (!info || !folder) continue

  const slug = folder.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

  // enemyIdx / cloneIdx are preserved explicitly: MDT route strings address
  // enemies by their 1-based Lua index, which array positions would lose.
  const enemies = entries(MDTData.dungeonEnemies?.[idx]).map(([enemyIdx, e]) => ({
    mdtIdx: enemyIdx,
    id: e.id,
    name: e.name,
    count: e.count ?? 0,
    health: e.health,
    level: e.level,
    scale: e.scale ?? 1,
    displayId: e.displayId,
    creatureType: e.creatureType,
    isBoss: !!e.isBoss,
    characteristics: e.characteristics ? Object.keys(e.characteristics) : [],
    // MDT flags what matters tactically: what to kick, dispel or soothe.
    // Keeping only the ids would throw all of that away.
    spells: entries(e.spells).map(([id, meta]) => ({
      id,
      ...Object.fromEntries(
        SPELL_FLAGS.filter((f) => meta?.[f]).map((f) => [f, true])
      ),
    })),
    clones: entries(e.clones).map(([cloneIdx, c]) => ({
      mdtIdx: cloneIdx,
      x: c.x,
      y: c.y,
      sublevel: c.sublevel ?? 1,
      g: c.g ?? null,
      patrol: seq(c.patrol).map((p) => ({ x: p.x, y: p.y })),
      teeming: !!c.teeming,
      negativeTeeming: !!c.negativeTeeming,
    })),
  }))

  const sublevels = seq(MDTData.dungeonSubLevels?.[idx])
  const dungeon = {
    idx,
    slug,
    name,
    shortName: info.shortName,
    englishName: info.englishName,
    mapID: info.mapID,
    teleportId: info.teleportId,
    textureFolder: folder,
    canvas: CANVAS,
    totalCount: MDTData.dungeonTotalCount?.[idx]?.normal ?? null,
    sublevels: sublevels.length ? sublevels : [name],
    pois: Object.fromEntries(
      Object.entries(MDTData.mapPOIs?.[idx] ?? {}).map(([sl, list]) => [sl, seq(list)])
    ),
    enemies,
  }

  writeFileSync(join(OUT, 'dungeons', `${slug}.json`), JSON.stringify(dungeon))
  index.push({
    idx, slug, name,
    shortName: dungeon.shortName,
    totalCount: dungeon.totalCount,
    sublevels: dungeon.sublevels.length,
    enemyCount: enemies.length,
    cloneCount: enemies.reduce((n, e) => n + e.clones.length, 0),
  })
}

// Map tiles ship with the addon as PNGs, so they only need copying — no
// extraction from the game's archives.
const TILES = new URL('../public/tiles/', import.meta.url).pathname
const tileSrc = join(dungeonDir, 'Textures')
if (existsSync(tileSrc)) {
  mkdirSync(TILES, { recursive: true })
  cpSync(tileSrc, TILES, { recursive: true })
  const folders = readdirSync(TILES).length
  const tiles = readdirSync(TILES).reduce(
    (n, d) => n + readdirSync(join(TILES, d)).filter((f) => f.endsWith('.png')).length,
    0
  )
  console.log(`Copied ${tiles} map tiles across ${folders} dungeons\n`)
} else {
  console.warn(`! No tiles at ${tileSrc} — the maps will render blank.\n`)
}

index.sort((a, b) => a.name.localeCompare(b.name))

// MDT lists seasons newest-first, and a dungeon may belong to more than one.
const known = new Set(index.map((d) => d.idx))
const seasonSets = new Map(entries(MDTData.dungeonSelectionToIndex))
const seasons = entries(MDTData.seasonList).map(([i, name], order) => {
  const ids = seq(seasonSets.get(i))
  return {
    name,
    // MDT lists the live season first.
    current: order === 0,
    dungeonIdx: ids.filter((id) => known.has(id)),
    missing: ids.filter((id) => !known.has(id)),
  }
})

for (const s of seasons) {
  if (s.missing.length) {
    console.warn(`  ! ${s.name}: no data for dungeon idx ${s.missing.join(', ')}`)
  }
}

writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify({ canvas: CANVAS, seasons, dungeons: index }, null, 2)
)

console.log(`Extracted ${index.length} dungeons\n`)
for (const d of index) {
  const forces = `${d.totalCount ?? '?'}`.padStart(5)
  console.log(`  ${d.shortName.padEnd(8)} ${d.name.padEnd(26)} ${String(d.enemyCount).padStart(3)} npcs  ${String(d.cloneCount).padStart(4)} spawns  ${forces} forces`)
}
lua.global.close()
