/**
 * A logged Mythic+ run, imported and laid over the plan.
 *
 * Keystone reads WoW's combat log and exports a run as JSON. It identifies
 * creatures by npc id and nothing else, which is the whole reason the two
 * projects fit together: MDT's enemy table is keyed by the same id, so a run
 * can be turned into the same `Pull` shape a planned route uses -- and then
 * everything here that draws or measures a route works on it unchanged.
 *
 * What it cannot know: *which* of several identical packs you pulled. The log
 * says "these npcs died together", not where. `runToRoute` matches each pull
 * against MDT's pack groupings, which is right the great majority of the time
 * and wrong when a dungeon repeats the same pack composition. Treat the map
 * placement as a strong guess and the forces totals as exact.
 */

import { PULL_COLORS, emptyRoute, makeId, type Pull, type Route } from './route'
import type { Dungeon } from './types'

export interface RunKill {
  npcId: number
  /** Enemy forces this kill awarded, as Keystone resolved it. */
  count: number
  /** Seconds from the key starting. */
  at: number
}

export interface RunPull {
  index: number
  name: string
  boss: boolean
  start: number
  end: number
  count: number
  cumulative: number
  kills: RunKill[]
}

export interface RunDeath {
  player: string
  at: number
  killer: string
  source: string
  segment: string
}

export interface KeystoneRun {
  format: string
  version: number
  run: {
    challengeModeId: number
    dungeon: string
    shortName?: string | null
    level: number
    affixes: number[]
    startedAt: number
    durationSeconds: number
    parSeconds: number | null
    success: boolean
    upgrades: number
  }
  totalForces: number | null
  pulls: RunPull[]
  deaths: RunDeath[]
  bosses: { name: string; at: number }[]
}

/** Parses and sanity-checks an exported run, with errors a person can act on. */
export function parseRun(text: string): KeystoneRun {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That doesn't look like JSON.")
  }

  const run = data as KeystoneRun
  if (!run || run.format !== 'keystone.run') {
    throw new Error('Not a Keystone run export — expected a file with "format": "keystone.run".')
  }
  if (!Array.isArray(run.pulls) || !run.run) {
    throw new Error('That run file is missing its pulls.')
  }
  return run
}

/** A spawn on the map, and the pack it belongs to. */
interface Slot {
  enemyIdx: number
  cloneIdx: number
  npcId: number
  packKey: string
}

function slotsFor(dungeon: Dungeon) {
  const byNpc = new Map<number, Slot[]>()
  const byPack = new Map<string, Slot[]>()

  for (const enemy of dungeon.enemies) {
    for (const clone of enemy.clones) {
      // Clones with no group are their own pack, so a lone mob can still match.
      const packKey =
        clone.g == null
          ? `s${clone.sublevel}:solo:${enemy.mdtIdx}:${clone.mdtIdx}`
          : `s${clone.sublevel}:g${clone.g}`
      const slot: Slot = { enemyIdx: enemy.mdtIdx, cloneIdx: clone.mdtIdx, npcId: enemy.id, packKey }

      const forNpc = byNpc.get(enemy.id)
      if (forNpc) forNpc.push(slot)
      else byNpc.set(enemy.id, [slot])

      const forPack = byPack.get(packKey)
      if (forPack) forPack.push(slot)
      else byPack.set(packKey, [slot])
    }
  }

  return { byNpc, byPack }
}

export interface RunRoute {
  route: Route
  /** Kills with no spawn left to attach them to — usually a re-spawned pack. */
  unmatched: { npcId: number; count: number }[]
  /** Pack keys the run actually visited, for comparing against the plan. */
  packsPulled: Set<string>
  slotPack: Map<string, string>
}

const slotKey = (enemyIdx: number, cloneIdx: number) => `${enemyIdx}:${cloneIdx}`

/**
 * Turns a run's pulls into a route: each pull becomes a `Pull` whose enemies
 * are real spawns, so the map can draw it exactly like a planned one.
 */
export function runToRoute(run: KeystoneRun, dungeon: Dungeon): RunRoute {
  const { byNpc, byPack } = slotsFor(dungeon)
  const used = new Set<string>()
  const unmatched = new Map<number, number>()
  const packsPulled = new Set<string>()
  const slotPack = new Map<string, string>()

  for (const slots of byNpc.values()) {
    for (const slot of slots) slotPack.set(slotKey(slot.enemyIdx, slot.cloneIdx), slot.packKey)
  }

  const pulls: Pull[] = run.pulls.map((runPull, index) => {
    const wanted = new Map<number, number>()
    for (const kill of runPull.kills) wanted.set(kill.npcId, (wanted.get(kill.npcId) ?? 0) + 1)

    const enemies: Record<number, number[]> = {}
    const take = (slot: Slot) => {
      used.add(slotKey(slot.enemyIdx, slot.cloneIdx))
      packsPulled.add(slot.packKey)
      const list = enemies[slot.enemyIdx]
      if (list) list.push(slot.cloneIdx)
      else enemies[slot.enemyIdx] = [slot.cloneIdx]
    }

    // Prefer a whole pack: score every group by how much of this pull it
    // explains with spawns nothing has claimed yet.
    let bestPack: string | null = null
    let bestScore = 0
    for (const [packKey, members] of byPack) {
      const remaining = new Map(wanted)
      let score = 0
      for (const slot of members) {
        if (used.has(slotKey(slot.enemyIdx, slot.cloneIdx))) continue
        const want = remaining.get(slot.npcId) ?? 0
        if (want > 0) {
          score++
          remaining.set(slot.npcId, want - 1)
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestPack = packKey
      }
    }

    if (bestPack) {
      for (const slot of byPack.get(bestPack) ?? []) {
        if (used.has(slotKey(slot.enemyIdx, slot.cloneIdx))) continue
        const want = wanted.get(slot.npcId) ?? 0
        if (want <= 0) continue
        wanted.set(slot.npcId, want - 1)
        take(slot)
      }
    }

    // Whatever the pack didn't cover: the nearest unclaimed spawn of that npc.
    for (const [npcId, remaining] of wanted) {
      let left = remaining
      for (const slot of byNpc.get(npcId) ?? []) {
        if (left <= 0) break
        if (used.has(slotKey(slot.enemyIdx, slot.cloneIdx))) continue
        take(slot)
        left--
      }
      if (left > 0) unmatched.set(npcId, (unmatched.get(npcId) ?? 0) + left)
    }

    return {
      id: makeId(),
      color: PULL_COLORS[index % PULL_COLORS.length],
      enemies,
    }
  })

  // Built on emptyRoute so the fields this doesn't care about -- dialect, the
  // carry-through preset data -- stay whatever a route is supposed to have.
  const route: Route = {
    ...emptyRoute(dungeon.idx, `${run.run.dungeon} +${run.run.level}`),
    pulls,
  }

  return {
    route,
    unmatched: [...unmatched].map(([npcId, count]) => ({ npcId, count })),
    packsPulled,
    slotPack,
  }
}

export interface PlanComparison {
  /** Packs in the plan that nothing in the run killed. */
  skipped: string[]
  /** Packs the run killed that the plan never mentioned. */
  extra: string[]
  plannedPacks: number
  pulledPacks: number
}

/**
 * Plan against reality, compared by pack rather than by individual spawn --
 * which pack you pulled is a much safer claim than which copy of it.
 */
export function compareToPlan(planned: Route, actual: RunRoute): PlanComparison {
  const plannedPacks = new Set<string>()
  for (const pull of planned.pulls) {
    for (const [enemyIdx, clones] of Object.entries(pull.enemies)) {
      for (const cloneIdx of clones) {
        const pack = actual.slotPack.get(slotKey(Number(enemyIdx), cloneIdx))
        if (pack) plannedPacks.add(pack)
      }
    }
  }

  return {
    skipped: [...plannedPacks].filter((p) => !actual.packsPulled.has(p)),
    extra: [...actual.packsPulled].filter((p) => !plannedPacks.has(p)),
    plannedPacks: plannedPacks.size,
    pulledPacks: actual.packsPulled.size,
  }
}

/** Cumulative enemy forces after each pull, as a percentage of the requirement. */
export function forcesCurve(run: KeystoneRun): { at: number; percent: number }[] {
  const total = run.totalForces || 0
  if (!total) return []
  return run.pulls.map((pull) => ({ at: pull.end, percent: (pull.cumulative / total) * 100 }))
}
