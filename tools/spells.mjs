/**
 * Builds public/data/spells.json — name, icon and description per spell id.
 *
 * MDT reads these from the game client at runtime; a browser can't, so they
 * are fetched once and served locally. Re-run after `extract` picks up new
 * dungeons. Existing entries are kept, so this is cheap to re-run.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DATA = new URL('../public/data/', import.meta.url).pathname
const OUT = join(DATA, 'spells.json')
const ICONS = new URL('../public/spells/', import.meta.url).pathname
mkdirSync(ICONS, { recursive: true })

const ids = new Set()
for (const f of readdirSync(join(DATA, 'dungeons'))) {
  for (const e of JSON.parse(readFileSync(join(DATA, 'dungeons', f), 'utf8')).enemies) {
    for (const s of e.spells ?? []) ids.add(s.id)
  }
}

const known = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const todo = [...ids].filter((id) => !known[id])
console.log(`${ids.size} spells referenced, ${todo.length} to fetch`)

/** Wowhead's tooltip HTML -> the one-line effect description. */
const describe = (html) => {
  const m = /<div class="q(?:\d)?">([\s\S]*?)<\/div>/.exec(html ?? '')
  if (!m) return ''
  return m[1]
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

let done = 0
const failures = []
const queue = [...todo]
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const id = queue.pop()
      try {
        const res = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
        if (!res.ok) { failures.push(id); continue }
        const j = await res.json()
        if (!j?.name) { failures.push(id); continue }
        known[id] = { name: j.name, icon: j.icon ?? null, text: describe(j.tooltip) }
        if (++done % 200 === 0) console.log(`  ${done}/${todo.length}`)
      } catch {
        failures.push(id)
      }
    }
  })
)

writeFileSync(OUT, JSON.stringify(known))
console.log(`spells.json: ${Object.keys(known).length} entries, ${failures.length} failed`)

// Icons are shared across spells, so this is far fewer than one per spell.
const slugs = [...new Set(Object.values(known).map((s) => s.icon).filter(Boolean))]
const iconQueue = slugs.filter((s) => !existsSync(join(ICONS, `${s}.jpg`)))
console.log(`${slugs.length} distinct icons, ${iconQueue.length} to download`)
let icons = 0
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (iconQueue.length) {
      const slug = iconQueue.pop()
      try {
        const res = await fetch(`https://wow.zamimg.com/images/wow/icons/medium/${slug}.jpg`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
        if (!res.ok) continue
        writeFileSync(join(ICONS, `${slug}.jpg`), Buffer.from(await res.arrayBuffer()))
        icons++
      } catch {
        // a missing icon just falls back to no image
      }
    }
  })
)
console.log(`icons downloaded: ${icons}`)
