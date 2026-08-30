/**
 * Coarse write limiting for anonymous sharing.
 *
 * Serverless instances share no memory, so the counter lives in Postgres.
 * This is abuse control, not security — it exists so one client can't fill
 * the table, and it fails open if the database misbehaves rather than
 * blocking legitimate saves.
 */
import type { Sql } from './db'

export interface Limit {
  windowMs: number
  max: number
}

export const SHARE_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 40 }

export async function allow(sql: Sql, key: string, limit: Limit = SHARE_LIMIT): Promise<boolean> {
  const expires = new Date(Date.now() + limit.windowMs)
  try {
    const rows = (await sql`
      insert into write_limits (bucket, hits, expires_at)
      values (${key}, 1, ${expires.toISOString()})
      on conflict (bucket) do update set
        -- Restart the window once the old one has lapsed.
        hits = case when write_limits.expires_at < now() then 1 else write_limits.hits + 1 end,
        expires_at = case when write_limits.expires_at < now() then excluded.expires_at else write_limits.expires_at end
      returning hits
    `) as { hits: number }[]
    return (rows[0]?.hits ?? 1) <= limit.max
  } catch {
    return true
  }
}

/** Best-effort client identity from proxy headers. */
export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
  return `${scope}:${ip}`
}
