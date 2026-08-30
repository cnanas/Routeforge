/**
 * Geometry shared by the map renderer.
 *
 * MDT positions enemies in an 840x560 canvas, but the tiles it ships are
 * 128px, so the native image is 15x128 by 10x128 = 1920x1280. We use the
 * native pixel size as the Leaflet coordinate space (so zoom 0 shows tiles
 * 1:1, unscaled) and multiply MDT coordinates by SCALE to match.
 */
export const TILE_SIZE = 128
export const GRID_COLS = 15
export const GRID_ROWS = 10

export const MAP_WIDTH = TILE_SIZE * GRID_COLS // 1920
export const MAP_HEIGHT = TILE_SIZE * GRID_ROWS // 1280

/** MDT canvas units -> native map pixels. */
export const SCALE = MAP_WIDTH / 840 // 2.2857…

/**
 * MDT coordinate -> Leaflet LatLng under CRS.Simple.
 *
 * Leaflet's lat axis increases upward and MDT's y is already negative
 * (measured downward from the top edge), so the two cancel out and the
 * mapping is a straight scale with no flip.
 */
export function toLatLng(x: number, y: number): [number, number] {
  return [y * SCALE, x * SCALE]
}

/** Full extent of the map, top-left at lat 0. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [
  [-MAP_HEIGHT, 0],
  [0, MAP_WIDTH],
]

/** Tiles are named `<sublevel>_<n>.png`, n running 1..150 row-major. */
export function tileName(sublevel: number, col: number, row: number): string {
  return `${sublevel}_${row * GRID_COLS + col + 1}.png`
}
