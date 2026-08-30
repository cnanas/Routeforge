export interface Clone {
  mdtIdx: number
  x: number
  /** MDT stores y as negative, measured downward from the canvas top edge. */
  y: number
  sublevel: number
  /** Pack id. Clones sharing a `g` on the same sublevel pull together. */
  g: number | null
  patrol: { x: number; y: number }[]
  teeming: boolean
  negativeTeeming: boolean
}

/** A spell an NPC casts, with MDT's tactical flags. */
export interface SpellRef {
  id: number
  /** Can be kicked. */
  interruptible?: true
  magic?: true
  enrage?: true
  bleed?: true
  poison?: true
  curse?: true
  disease?: true
}

/** Looked-up spell detail from public/data/spells.json. */
export interface SpellInfo {
  name: string
  icon: string | null
  text: string
}

export interface Enemy {
  /** 1-based index in MDT's Lua table. Route strings address enemies by this. */
  mdtIdx: number
  id: number
  name: string
  /** Enemy forces this NPC awards, per kill. */
  count: number
  health: number
  level: number
  scale: number
  displayId: number
  creatureType: string
  isBoss: boolean
  characteristics: string[]
  spells: SpellRef[]
  clones: Clone[]
}

export interface Poi {
  /** dungeonEntrance | genericItem | genericAssignablePOI | mapLink */
  type: string
  x: number
  y: number
  sizeMult?: number
  info?: {
    name?: string
    spellId?: number
    texture?: number
    atlas?: string
    size?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface Dungeon {
  idx: number
  slug: string
  name: string
  shortName: string
  englishName: string
  mapID: number
  teleportId: number
  textureFolder: string
  canvas: { width: number; height: number; cols: number; rows: number }
  totalCount: number | null
  sublevels: string[]
  pois: Record<string, Poi[]>
  enemies: Enemy[]
}

export interface DungeonSummary {
  idx: number
  slug: string
  name: string
  shortName: string
  totalCount: number | null
  sublevels: number
  enemyCount: number
  cloneCount: number
}

export interface Season {
  name: string
  /** MDT lists the live season first. */
  current: boolean
  dungeonIdx: number[]
  /** Season entries MDT names but ships no map/enemy data for. */
  missing: number[]
}

export interface DungeonIndex {
  canvas: { width: number; height: number; cols: number; rows: number }
  seasons: Season[]
  dungeons: DungeonSummary[]
}
