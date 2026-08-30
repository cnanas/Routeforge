/** Downloads the spell icons used by the route-marker tool. */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT = new URL('../public/markers/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const SLUGS = {
  bloodlust: 'spell_nature_bloodlust',
  heroism: 'ability_shaman_heroism',
  timewarp: 'ability_mage_timewarp',
  shroud: 'ability_rogue_shroudofconcealment',
  combatres: 'spell_nature_reincarnation',
  invis: 'inv_potion_83',
  sap: 'ability_sap',
  poly: 'spell_magic_polymorphrabbit',
  movement: 'ability_rogue_sprint',
  prepot: 'inv_drink_05',
}

let ok = 0
const missing = []
for (const [id, slug] of Object.entries(SLUGS)) {
  const dest = join(OUT, `${id}.jpg`)
  if (existsSync(dest)) { ok++; continue }
  const res = await fetch(`https://wow.zamimg.com/images/wow/icons/large/${slug}.jpg`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) { missing.push(`${id} (${slug})`); continue }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  ok++
}
console.log(`markers: ${ok} ready${missing.length ? `, missing: ${missing.join(', ')}` : ''}`)
