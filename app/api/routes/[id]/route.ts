import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isShareId } from '@/lib/share-id'
import { decodeMdtString } from '@/lib/mdt-string'

const MAX_PAYLOAD = 128 * 1024
const MAX_NAME = 120

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const sql = db()
  if (!sql) return NextResponse.json({ error: 'Sharing is not configured.' }, { status: 503 })
  if (!isShareId(id)) return NextResponse.json({ error: 'Not a route link.' }, { status: 400 })

  const rows = (await sql`
    select id, name, dungeon_idx, payload, updated_at from routes where id = ${id}
  `) as { id: string; name: string; dungeon_idx: number; payload: string; updated_at: string }[]

  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'No route with that link.' }, { status: 404 })

  // Best-effort; a failed counter must never break loading a route.
  sql`update routes set views = views + 1 where id = ${id}`.catch(() => {})

  return NextResponse.json(
    { id: row.id, name: row.name, dungeonIdx: row.dungeon_idx, payload: row.payload, updatedAt: row.updated_at },
    // Shared routes change rarely; let the CDN absorb repeat views.
    { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } }
  )
}

/** Overwrites a shared route. Requires the edit token issued at creation. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params
  const sql = db()
  if (!sql) return NextResponse.json({ error: 'Sharing is not configured.' }, { status: 503 })
  if (!isShareId(id)) return NextResponse.json({ error: 'Not a route link.' }, { status: 400 })

  let body: { payload?: unknown; name?: unknown; editToken?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const payload = typeof body.payload === 'string' ? body.payload : ''
  const editToken = typeof body.editToken === 'string' ? body.editToken : ''
  if (!payload || !editToken) {
    return NextResponse.json({ error: 'Missing payload or edit token.' }, { status: 400 })
  }
  if (payload.length > MAX_PAYLOAD) {
    return NextResponse.json({ error: 'That route is too large to share.' }, { status: 413 })
  }

  let dungeonIdx: number
  try {
    const { preset } = decodeMdtString(payload)
    const value = (preset as Map<string, unknown>).get?.('value')
    const idx = value instanceof Map ? value.get('currentDungeonIdx') : undefined
    if (typeof idx !== 'number') throw new Error('no dungeon index')
    dungeonIdx = idx
  } catch {
    return NextResponse.json({ error: 'That does not decode as a route.' }, { status: 400 })
  }

  const name = String(body.name ?? 'Untitled route').slice(0, MAX_NAME) || 'Untitled route'

  // The token is matched in the WHERE clause, so a wrong one updates nothing
  // and is indistinguishable from a missing route.
  const rows = (await sql`
    update routes
       set payload = ${payload}, name = ${name}, dungeon_idx = ${dungeonIdx}, updated_at = now()
     where id = ${id} and edit_token = ${editToken}
    returning id
  `) as { id: string }[]

  if (!rows.length) {
    return NextResponse.json(
      { error: 'That link is not yours to edit, or no longer exists.' },
      { status: 403 }
    )
  }
  return NextResponse.json({ id, updated: true })
}
