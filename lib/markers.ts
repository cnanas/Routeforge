/**
 * Route markers (Bloodlust, Combat Res, raid marks, …).
 *
 * MDT has no icon object type — its toolbar is only pencil/line/arrow/note/
 * mover/eraser. So a marker is stored as an ordinary MDT **note** whose text
 * is the marker's label. In game it reads as a labelled note; here it renders
 * as an icon. That keeps the round-trip lossless instead of inventing an
 * object type the addon would discard.
 */
export interface MarkerDef {
  id: string
  /** Exact note text used on the wire. Must stay stable to keep round-tripping. */
  label: string
  group: 'cooldown' | 'tactic' | 'mark'
  /** Downloaded spell icon, or a drawn raid mark. */
  icon?: string
  shape?: 'star' | 'circle' | 'diamond' | 'triangle' | 'moon' | 'square' | 'cross' | 'skull'
  color?: string
}

export const MARKERS: MarkerDef[] = [
  { id: 'bloodlust', label: 'Bloodlust', group: 'cooldown', icon: '/markers/bloodlust.jpg' },
  { id: 'heroism', label: 'Heroism', group: 'cooldown', icon: '/markers/heroism.jpg' },
  { id: 'timewarp', label: 'Time Warp', group: 'cooldown', icon: '/markers/timewarp.jpg' },
  { id: 'combatres', label: 'Combat Res', group: 'cooldown', icon: '/markers/combatres.jpg' },
  { id: 'prepot', label: 'Prepot', group: 'cooldown', icon: '/markers/prepot.jpg' },

  { id: 'shroud', label: 'Shroud', group: 'tactic', icon: '/markers/shroud.jpg' },
  { id: 'invis', label: 'Invis Potion', group: 'tactic', icon: '/markers/invis.jpg' },
  { id: 'sap', label: 'Sap', group: 'tactic', icon: '/markers/sap.jpg' },
  { id: 'poly', label: 'Polymorph', group: 'tactic', icon: '/markers/poly.jpg' },
  { id: 'movement', label: 'Movement CD', group: 'tactic', icon: '/markers/movement.jpg' },

  { id: 'skull', label: 'Skull', group: 'mark', shape: 'skull', color: '#e8e8e8' },
  { id: 'cross', label: 'Cross', group: 'mark', shape: 'cross', color: '#e03131' },
  { id: 'square', label: 'Square', group: 'mark', shape: 'square', color: '#4dabf7' },
  { id: 'moon', label: 'Moon', group: 'mark', shape: 'moon', color: '#dee2e6' },
  { id: 'triangle', label: 'Triangle', group: 'mark', shape: 'triangle', color: '#40c057' },
  { id: 'diamond', label: 'Diamond', group: 'mark', shape: 'diamond', color: '#cc5de8' },
  { id: 'circle', label: 'Circle', group: 'mark', shape: 'circle', color: '#fd7e14' },
  { id: 'star', label: 'Star', group: 'mark', shape: 'star', color: '#fcc419' },
]

const BY_LABEL = new Map(MARKERS.map((m) => [m.label.toLowerCase(), m]))

export const markerById = (id: string) => MARKERS.find((m) => m.id === id)

/** Resolves a note's text back to a marker, so imports render as icons. */
export const markerForNote = (text: string): MarkerDef | undefined =>
  BY_LABEL.get(text.trim().toLowerCase())

export const GROUP_LABELS: Record<MarkerDef['group'], string> = {
  cooldown: 'Cooldowns',
  tactic: 'Tactics',
  mark: 'Raid marks',
}
