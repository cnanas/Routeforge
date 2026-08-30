import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { newShareId, newEditToken } from '@/lib/share-id'
import { allow, clientKey } from '@/lib/rate-limit'
import { decodeMdtString } from '@/lib/mdt-string'

/** Generous next to a heavily drawn route (~6KB), mean next to a paste bomb. */
const MAX_PAYLOAD = 128 * 1024
const MAX_NAME = 120

export async function POST(req: Request) {
  const sql = db()
  if (!sql) {
    return NextResponse.json(
      { error: 'Sharing is not configured on this deployment (no DATABASE_URL).' },
      { status: 503 }
    )
  }

  let body: { payload?: unknown; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const payload = typeof body.payload === 'string' ? body.payload : ''
  if (!payload) return NextResponse.json({ error: 'Missing route payload.' }, { status: 400 })
  if (payload.length > MAX_PAYLOAD) {
    return NextResponse.json({ error: 'That route is too large to share.' }, { status: 413 })
  }

  // Validate by decoding: never store a string the app can't read back.
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

  if (!(await allow(sql, clientKey(req, 'share')))) {
    return NextResponse.json(
      { error: 'Too many routes shared from here recently. Try again later.' },
      { status: 429 }
    )
  }

  const name = String(body.name ?? 'Untitled route').slice(0, MAX_NAME) || 'Untitled route'
  const editToken = newEditToken()

  // Retry on the vanishingly rare id collision rather than failing the save.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newShareId()
    try {
      await sql`
        insert into routes (id, edit_token, name, dungeon_idx, payload)
        values (${id}, ${editToken}, ${name}, ${dungeonIdx}, ${payload})
      `
      return NextResponse.json({ id, editToken }, { status: 201 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('duplicate key')) {
        return NextResponse.json({ error: 'Could not save the route.' }, { status: 500 })
      }
    }
  }
  return NextResponse.json({ error: 'Could not allocate a link. Try again.' }, { status: 500 })
}
