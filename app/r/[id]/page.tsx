import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Planner from '@/components/Planner'
import Setup from '@/components/Setup'
import { db } from '@/lib/db'
import { isShareId } from '@/lib/share-id'
import type { DungeonIndex } from '@/lib/types'

interface Props {
  params: Promise<{ id: string }>
}

interface Shared {
  name: string
  dungeonIdx: number
  payload: string
}

async function loadShared(id: string): Promise<Shared | null> {
  const sql = db()
  if (!sql || !isShareId(id)) return null
  const rows = (await sql`
    select name, dungeon_idx, payload from routes where id = ${id}
  `) as { name: string; dungeon_idx: number; payload: string }[]
  const row = rows[0]
  return row ? { name: row.name, dungeonIdx: row.dungeon_idx, payload: row.payload } : null
}

async function loadIndex(): Promise<DungeonIndex | null> {
  try {
    const raw = await readFile(join(process.cwd(), 'public/data/index.json'), 'utf8')
    const index = JSON.parse(raw) as DungeonIndex
    return index?.dungeons?.length ? index : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const shared = await loadShared(id).catch(() => null)
  if (!shared) return { title: 'Routeforge' }
  const index = await loadIndex()
  const dungeon = index?.dungeons.find((d) => d.idx === shared.dungeonIdx)
  return {
    title: `${shared.name} · Routeforge`,
    description: dungeon ? `A Mythic+ route for ${dungeon.name}.` : 'A Mythic+ dungeon route.',
  }
}

export default async function SharedRoute({ params }: Props) {
  const { id } = await params
  const index = await loadIndex()
  if (!index) return <Setup />

  const shared = await loadShared(id).catch(() => null)
  if (!shared) notFound()

  // Handed to the client as the MDT string and decoded there, so shared links
  // travel the same import path as a route pasted from the game.
  return <Planner index={index} shared={{ id, payload: shared.payload }} />
}
