/**
 * Downloads NPC portrait thumbnails, keyed by creature displayId.
 *
 * The addon renders these from the game client via displayId, which a browser
 * can't do, so we pull the equivalent thumbnails once and serve them locally
 * (offline-capable, and no hotlinking someone else's CDN at runtime).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DATA = new URL('../public/data/dungeons/', import.meta.url).pathname
const OUT = new URL('../public/portraits/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const ids = new Set()
for (const f of readdirSync(DATA)) {
  for (const e of JSON.parse(readFileSync(join(DATA, f), 'utf8')).enemies) {
    if (e.displayId) ids.add(e.displayId)
  }
}

const all = [...ids]
console.log(`${all.length} unique display ids`)

let ok = 0, cached = 0, missing = []
// Modest concurrency: this is someone else's CDN, not ours.
const queue = [...all]
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const id = queue.pop()
      const dest = join(OUT, `${id}.webp`)
      if (existsSync(dest)) { cached++; continue }
      const url = `https://wow.zamimg.com/modelviewer/live/webthumbs/npc/${id % 256}/${id}.webp`
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!res.ok) { missing.push(id); continue }
        writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
        ok++
      } catch { missing.push(id) }
    }
  })
)

console.log(`downloaded ${ok}, already had ${cached}, missing ${missing.length}`)
if (missing.length) console.log('missing ids:', missing.slice(0, 20).join(', '))
