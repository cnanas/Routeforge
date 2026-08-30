import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Planner from '@/components/Planner'
import type { DungeonIndex } from '@/lib/types'

export default async function Page() {
  const raw = await readFile(join(process.cwd(), 'public/data/index.json'), 'utf8')
  const index: DungeonIndex = JSON.parse(raw)
  return <Planner index={index} />
}
