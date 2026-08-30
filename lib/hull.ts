/**
 * Convex hull for pull outlines, matching what MDT draws
 * (Modules/PullOutlines.lua): a hull around a pull's spawns with the pull
 * number at its centroid.
 */
export interface Pt {
  x: number
  y: number
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Andrew's monotone chain. Returns points in order; [] for fewer than 3. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return []
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  const half = (src: Pt[]) => {
    const out: Pt[] = []
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }

  return [...half(pts), ...half([...pts].reverse())]
}

export function centroid(points: Pt[]): Pt {
  if (!points.length) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

/** Pushes the hull outward so the outline clears the blips it encloses. */
export function inflate(points: Pt[], by: number): Pt[] {
  const c = centroid(points)
  return points.map((p) => {
    const dx = p.x - c.x
    const dy = p.y - c.y
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by }
  })
}

/**
 * Outline for a set of spawns. One or two spawns have no hull, so a small
 * ring or a capsule around the segment stands in.
 */
export function outlineFor(points: Pt[], pad: number): { shape: Pt[]; label: Pt } {
  if (points.length === 0) return { shape: [], label: { x: 0, y: 0 } }
  const label = centroid(points)

  if (points.length <= 2) {
    const ring: Pt[] = []
    const steps = 16
    for (const p of points) {
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        ring.push({ x: p.x + Math.cos(a) * pad, y: p.y + Math.sin(a) * pad })
      }
    }
    return { shape: convexHull(ring), label }
  }

  const hull = convexHull(points)
  // Spawns strung along a corridor are collinear, and a hull of 2 points is
  // a line with no area — degenerate, not just empty. Fall back to the
  // capsule so the pack still reads as an enclosed shape.
  if (hull.length < 3) return { ...outlineFor([points[0], points[points.length - 1]], pad), label }
  return { shape: inflate(hull, pad), label }
}
