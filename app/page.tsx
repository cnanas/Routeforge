import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Planner from '@/components/Planner'
import Setup from '@/components/Setup'
import type { DungeonIndex } from '@/lib/types'

/**
 * Dungeon data is generated from a local WoW install by `npm run data`, so a
 * fresh clone (or a CI/Vercel build) legitimately has none. Render setup
 * instructions instead of failing the build with an ENOENT from deep inside
 * prerendering, which says nothing about the actual cause.
 */
async function loadIndex(): Promise<DungeonIndex | null> {
  try {
    const raw = await readFile(join(process.cwd(), 'public/data/index.json'), 'utf8')
    const index = JSON.parse(raw) as DungeonIndex
    return index?.dungeons?.length ? index : null
  } catch {
    return null
  }
}

export default async function Page() {
  const index = await loadIndex()
  return index ? <Planner index={index} /> : <Setup />
}
