/** Applies db/schema.sql. Safe to re-run — every statement is idempotent. */
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.\n')
  console.error('Create a Neon database, then either export it:')
  console.error('  export DATABASE_URL="postgresql://…"')
  console.error('or put it in .env.local and run: npm run db:setup')
  process.exit(1)
}

const sql = neon(url)
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8')

// neon() sends one statement per call, so split on the blank-line boundaries
// between statements rather than shipping the whole file.
const statements = schema
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.split('\n').every((l) => l.trim().startsWith('--')))

for (const statement of statements) {
  await sql.query(statement)
  console.log('  ok  ' + statement.split('\n')[0].slice(0, 68))
}

const [{ count }] = await sql.query('select count(*)::int as count from routes')
console.log(`\nSchema ready. ${count} shared route(s) stored.`)
