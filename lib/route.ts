/**
 * The editable route model, and its translation to and from MDT presets.
 *
 * MDT's own shape (nested Lua tables with 1-based indices and mixed key
 * types) is awkward to edit against, so it is converted on the way in and
 * rebuilt on the way out. Anything not modelled here is carried through
 * untouched so re-exporting never silently drops fields.
 */
import {
  field, luaList, luaPairs, toLuaList,
  MDT_DIALECT, type Dialect,
} from './mdt-string'
import { markerForNote } from './markers'
import type { Dungeon } from './types'

/** MDT's default pull palette, cycled as pulls are added. */
export const PULL_COLORS = [
  'ff3eff', '3eff9e', 'ffb03e', '3ea6ff', 'ff5b5b', 'b45bff',
  '5bffd8', 'ffe45b', '8fce00', 'ff8fc7', '00c2a8', 'c78fff',
]

export interface Pull {
  id: string
  color: string
  /** enemyIdx -> cloneIdx[], both 1-based Lua indices. */
  enemies: Record<number, number[]>
}

export interface Drawing {
  id: string
  kind: 'pen' | 'line' | 'arrow'
  color: string
  size: number
  sublevel: number
  /** MDT canvas coordinates (y negative). */
  points: { x: number; y: number }[]
}

export interface Note {
  id: string
  kind: 'note'
  sublevel: number
  x: number
  y: number
  text: string
  /** Set when the text matches a known marker, so it draws as an icon. */
  markerId?: string
}

export type RouteObject = Drawing | Note

export interface Route {
  name: string
  uid?: string
  dungeonIdx: number
  sublevel: number
  pulls: Pull[]
  objects: RouteObject[]
  /** Everything from the source preset we don't model, kept for re-export. */
  carry: [string, unknown][]
  carryValue: [string, unknown][]
  dialect: Dialect
}

let seq = 0
const nextId = () => `o${Date.now().toString(36)}${(seq++).toString(36)}`

export const emptyRoute = (dungeonIdx: number, name = 'New Route'): Route => ({
  name,
  dungeonIdx,
  sublevel: 1,
  pulls: [{ id: nextId(), color: PULL_COLORS[0], enemies: {} }],
  objects: [],
  carry: [],
  carryValue: [],
  dialect: MDT_DIALECT,
})

/* ---------- import ---------- */

const MODELLED_TOP = new Set(['text', 'uid', 'value', 'objects'])
const MODELLED_VALUE = new Set(['currentDungeonIdx', 'currentSublevel', 'pulls'])

export function presetToRoute(preset: unknown, dialect: Dialect): Route {
  const value = field(preset, 'value')

  const pulls: Pull[] = luaList(field(value, 'pulls')).map((raw, i) => {
    const enemies: Record<number, number[]> = {}
    let color = PULL_COLORS[i % PULL_COLORS.length]
    for (const [key, val] of luaPairs(raw)) {
      if (key === 'color') {
        if (typeof val === 'string') color = val
      } else if (typeof key === 'number') {
        const clones = luaList(val).filter((c): c is number => typeof c === 'number')
        if (clones.length) enemies[key] = clones
      }
    }
    return { id: nextId(), color, enemies }
  })

  const objects: RouteObject[] = []
  for (const raw of luaList(field(preset, 'objects'))) {
    const d = luaList(field(raw, 'd'))
    const isNote = field(raw, 'n') === true
    if (isNote) {
      const text = String(d[4] ?? '')
      objects.push({
        id: nextId(),
        kind: 'note',
        x: Number(d[0]) || 0,
        y: Number(d[1]) || 0,
        sublevel: Number(d[2]) || 1,
        text,
        markerId: markerForNote(text)?.id,
      })
      continue
    }
    // d: size, lineFactor, sublevel, shown, colorHex, drawLayer, [smooth]
    // l: x1,y1,x2,y2,…
    const flat = luaList(field(raw, 'l')).map(Number)
    const points: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] })
    if (!points.length) continue
    objects.push({
      id: nextId(),
      kind: field(raw, 't') ? 'arrow' : points.length > 2 ? 'pen' : 'line',
      color: typeof d[4] === 'string' ? d[4] : 'ff0000',
      size: Number(d[0]) || 5,
      sublevel: Number(d[2]) || 1,
      points,
    })
  }

  return {
    name: String(field(preset, 'text') ?? 'Imported Route'),
    uid: typeof field(preset, 'uid') === 'string' ? (field(preset, 'uid') as string) : undefined,
    dungeonIdx: Number(field(value, 'currentDungeonIdx')),
    sublevel: Number(field(value, 'currentSublevel')) || 1,
    pulls: pulls.length ? pulls : [{ id: nextId(), color: PULL_COLORS[0], enemies: {} }],
    objects,
    carry: luaPairs(preset).filter(([k]) => typeof k === 'string' && !MODELLED_TOP.has(k)) as [string, unknown][],
    carryValue: luaPairs(value).filter(([k]) => typeof k === 'string' && !MODELLED_VALUE.has(k)) as [string, unknown][],
    dialect,
  }
}

/* ---------- export ---------- */

export function routeToPreset(route: Route): unknown {
  const { lists } = route.dialect

  const pulls = route.pulls.map((pull) => {
    // Integer enemy keys and the string "color" key share one table, so this
    // must be a Map: a plain object would stringify the enemy indices.
    const m = new Map<number | string, unknown>()
    for (const [idx, clones] of Object.entries(pull.enemies)) {
      if (clones.length) m.set(Number(idx), toLuaList(clones, lists))
    }
    m.set('color', pull.color)
    return m
  })

  const objects = route.objects.map((obj) => {
    const m = new Map<string, unknown>()
    if (obj.kind === 'note') {
      // d: x, y, sublevel, shown, text, drawLayer
      m.set('d', toLuaList([obj.x, obj.y, obj.sublevel, true, obj.text, 0], lists))
      m.set('n', true)
      return m
    }
    const flat: number[] = []
    for (const p of obj.points) flat.push(p.x, p.y)
    m.set('d', toLuaList([obj.size, 1, obj.sublevel, true, obj.color, 0, true], lists))
    m.set('l', toLuaList(flat, lists))
    if (obj.kind === 'arrow') m.set('t', toLuaList([obj.size * 2], lists))
    return m
  })

  const value = new Map<string, unknown>([
    ['currentDungeonIdx', route.dungeonIdx],
    ['currentSublevel', route.sublevel],
    ['currentPull', 1],
    ['pulls', toLuaList(pulls, lists)],
  ])
  for (const [k, v] of route.carryValue) if (!value.has(k)) value.set(k, v)

  const preset = new Map<string, unknown>([
    ['text', route.name],
    ['uid', route.uid ?? nextId()],
    ['value', value],
    ['objects', toLuaList(objects, lists)],
  ])
  for (const [k, v] of route.carry) if (!preset.has(k)) preset.set(k, v)
  return preset
}

/* ---------- forces ---------- */

export interface ForcesRow {
  pullId: string
  count: number
  cumulative: number
  pct: number
  cumulativePct: number
}

/** Per-pull and running enemy-forces totals for a route. */
export function forcesFor(route: Route, dungeon: Dungeon): ForcesRow[] {
  const byIdx = new Map(dungeon.enemies.map((e) => [e.mdtIdx, e]))
  const total = dungeon.totalCount || 0
  let running = 0
  return route.pulls.map((pull) => {
    let count = 0
    for (const [idx, clones] of Object.entries(pull.enemies)) {
      const enemy = byIdx.get(Number(idx))
      if (enemy) count += enemy.count * clones.length
    }
    running += count
    return {
      pullId: pull.id,
      count,
      cumulative: running,
      pct: total ? (count / total) * 100 : 0,
      cumulativePct: total ? (running / total) * 100 : 0,
    }
  })
}

/** Looks up which pull a given spawn belongs to, for map colouring. */
export function pullIndexFor(route: Route, enemyIdx: number, cloneIdx: number): number {
  return route.pulls.findIndex((p) => p.enemies[enemyIdx]?.includes(cloneIdx))
}

export const newPull = (index: number): Pull => ({
  id: nextId(),
  color: PULL_COLORS[index % PULL_COLORS.length],
  enemies: {},
})

export const makeId = nextId
