/**
 * Neon Postgres access for shared routes.
 *
 * Sharing is optional: without DATABASE_URL the app still runs entirely
 * locally, so every caller must handle a null client rather than assume a
 * database exists.
 */
import { neon } from '@neondatabase/serverless'

export type Sql = ReturnType<typeof neon>

let cached: Sql | null | undefined

export function db(): Sql | null {
  if (cached !== undefined) return cached
  const url = process.env.DATABASE_URL
  cached = url ? neon(url) : null
  return cached
}

export const sharingEnabled = () => Boolean(process.env.DATABASE_URL)
