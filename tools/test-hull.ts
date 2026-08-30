import { convexHull, centroid, outlineFor } from '../lib/hull'

let failed = 0
const check = (n: string, c: boolean, d = '') => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c || !d ? '' : `\n         ${d}`}`)
  if (!c) failed++
}

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
check('hull of a square has 4 points', convexHull(square).length === 4)
check('interior points are dropped', convexHull([...square, { x: 5, y: 5 }]).length === 4)
check('centroid of a square is its middle', centroid(square).x === 5 && centroid(square).y === 5)
check('fewer than 3 points has no hull', convexHull([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length === 0)

const one = outlineFor([{ x: 5, y: 5 }], 3)
check('a single spawn still gets a shape', one.shape.length > 2, `${one.shape.length} points`)
check('single-spawn label sits on the spawn', one.label.x === 5 && one.label.y === 5)

const two = outlineFor([{ x: 0, y: 0 }, { x: 20, y: 0 }], 3)
check('two spawns get a capsule', two.shape.length > 2, `${two.shape.length} points`)

// Collinear spawns have no area; the fallback must still produce something.
const line = outlineFor([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], 3)
check('collinear spawns still outline', line.shape.length > 2, `${line.shape.length} points`)

const pad = outlineFor(square, 4)
const maxX = Math.max(...pad.shape.map((p) => p.x))
check('padding pushes the hull outward', maxX > 10, `maxX=${maxX.toFixed(1)}`)
check('padded outline stays centred', Math.abs(centroid(pad.shape).x - 5) < 0.001)

console.log(failed ? `\n${failed} check(s) failed` : '\nAll hull checks passed.')
process.exit(failed ? 1 : 0)
