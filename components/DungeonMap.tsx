'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Dungeon, Enemy } from '@/lib/types'
import type { Route, RouteObject, Drawing, Note } from '@/lib/route'
import { pullIndexFor } from '@/lib/route'
import { markerById } from '@/lib/markers'
import { outlineFor } from '@/lib/hull'
import { MAP_BOUNDS, TILE_SIZE, SCALE, toLatLng, tileName } from '@/lib/map'

/** Serves MDT's flat `<sublevel>_<n>.png` grid through Leaflet's tile pipeline. */
const MdtTileLayer = L.TileLayer.extend({
  getTileUrl(this: { options: { folder: string; sublevel: number } }, coords: L.Coords) {
    const { folder, sublevel } = this.options
    return `/tiles/${folder}/${tileName(sublevel, coords.x, coords.y)}`
  },
})

/** Blip diameter in map units for an enemy of scale 1, matched to MDT's sizing. */
const BASE_BLIP = 26

/** Bosses get a bigger portrait than their raw scale would give them. */
const BOSS_BLIP_MULT = 1.7

/** Names come from game data, so escape before putting them in divIcon HTML. */
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)

export type Tool =
  /** Tap/click a mob to read its abilities without touching the route. */
  | 'inspect'
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'note'
  | 'eraser'
  | `marker:${string}`

interface Props {
  dungeon: Dungeon
  sublevel: number
  route: Route
  currentPull: number
  showOutlines: boolean
  tool: Tool
  drawColor: string
  onHover?: (enemy: Enemy | null) => void
  onToggleEnemy: (enemyIdx: number, cloneIdx: number, wholePack: boolean) => void
  onAddObject: (obj: RouteObject) => void
  onEraseObject: (id: string) => void
  onPlaceNote: (x: number, y: number) => void
}

/** Leaflet LatLng -> MDT canvas coordinates. */
const toMdt = (ll: L.LatLng) => ({ x: ll.lng / SCALE, y: ll.lat / SCALE })

export default function DungeonMap(props: Props) {
  const {
    dungeon, sublevel, route, currentPull, tool, drawColor, showOutlines,
    onHover, onToggleEnemy, onAddObject, onEraseObject, onPlaceNote,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const blipsRef = useRef(new Map<string, { el: HTMLElement; enemyIdx: number; cloneIdx: number }>())
  const packsRef = useRef(new Map<number, HTMLElement[]>())

  // Handlers change every render; refs keep the Leaflet bindings stable.
  const cb = useRef(props)
  cb.current = props

  /* ---------- map lifecycle ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return

    const map = L.map(el, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 3,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      attributionControl: false,
      zoomControl: false,
      maxBoundsViscosity: 0.7,
    })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.fitBounds(MAP_BOUNDS)
    map.setMaxBounds(L.latLngBounds(MAP_BOUNDS).pad(0.25))

    // Blips are sized in map units so they grow with the map like MDT's do.
    // One CSS variable drives all of them instead of touching 350 icons.
    const applyZoom = () => {
      const z = Math.min(3, Math.max(0.35, Math.pow(2, map.getZoom())))
      el.style.setProperty('--zs', String(z))
    }
    map.on('zoom zoomend', applyZoom)
    applyZoom()

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  /* ---------- tiles + enemy blips ---------- */

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const layers = L.layerGroup().addTo(map)
    const blips = new Map<string, { el: HTMLElement; enemyIdx: number; cloneIdx: number }>()
    const packs = new Map<number, HTMLElement[]>()

    new (MdtTileLayer as unknown as new (url: string, opts: object) => L.TileLayer)('', {
      folder: dungeon.textureFolder,
      sublevel,
      tileSize: TILE_SIZE,
      // GridLayer carries its OWN minZoom (default 0), independent of the
      // map's. Leave it and Leaflet drops every tile below zoom 0 — which is
      // where fitBounds starts — so the map renders blank until you zoom in.
      minZoom: -3,
      maxZoom: 3,
      minNativeZoom: 0,
      maxNativeZoom: 0,
      noWrap: true,
      bounds: L.latLngBounds(MAP_BOUNDS),
    }).addTo(layers)

    for (const enemy of dungeon.enemies) {
      for (const clone of enemy.clones) {
        if (clone.sublevel !== sublevel) continue

        if (clone.patrol.length > 1) {
          L.polyline(clone.patrol.map((p) => toLatLng(p.x, p.y)), {
            color: '#a1662f', weight: 1.5, opacity: 0.45, dashArray: '5 5', interactive: false,
          }).addTo(layers)
        }

        const size = BASE_BLIP * (enemy.scale || 1) * (enemy.isBoss ? BOSS_BLIP_MULT : 1)
        const marker = L.marker(toLatLng(clone.x, clone.y), {
          keyboard: false,
          // Bosses render above trash so their ring and name are never buried.
          zIndexOffset: enemy.isBoss ? 1000 : 0,
          icon: L.divIcon({
            className: enemy.isBoss ? 'blip blip--boss' : 'blip',
            iconSize: [0, 0],
            html:
              (enemy.isBoss ? `<span class="boss-ring" style="--s:${size.toFixed(1)}px"></span>` : '') +
              `<i style="--s:${size.toFixed(1)}px;background-image:url(/portraits/${enemy.displayId}.webp)"></i>` +
              `<b></b>` +
              (enemy.isBoss ? `<em class="blip-name" style="--s:${size.toFixed(1)}px">${esc(enemy.name)}</em>` : ''),
          }),
        }).addTo(layers)

        const el = marker.getElement()
        if (el) {
          const key = `${enemy.mdtIdx}:${clone.mdtIdx}`
          blips.set(key, { el, enemyIdx: enemy.mdtIdx, cloneIdx: clone.mdtIdx })
          if (clone.g != null) {
            const list = packs.get(clone.g)
            if (list) list.push(el)
            else packs.set(clone.g, [el])
          }
        }

        const group = () => (clone.g != null ? packs.get(clone.g) ?? [] : el ? [el] : [])
        marker.on('mouseover', () => {
          for (const e of group()) e.classList.add('blip--hot')
          cb.current.onHover?.(enemy)
        })
        marker.on('mouseout', () => {
          for (const e of group()) e.classList.remove('blip--hot')
          cb.current.onHover?.(null)
        })
        marker.on('click', (ev: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(ev)
          const t = cb.current.tool
          // Touch has no hover, so a tap is the only way to inspect a mob.
          // Inspect mode makes that explicit instead of editing the route.
          if (t === 'inspect') {
            cb.current.onHover?.(enemy)
            return
          }
          if (t !== 'select' && t !== 'eraser') return
          // Alt-click isolates one spawn; a plain click takes the whole pack,
          // because that's how the group actually aggros.
          const single = ev.originalEvent.altKey || ev.originalEvent.metaKey
          cb.current.onToggleEnemy(enemy.mdtIdx, clone.mdtIdx, !single && clone.g != null)
        })

        const pct = dungeon.totalCount ? (enemy.count / dungeon.totalCount) * 100 : 0
        marker.bindTooltip(
          `<b>${enemy.name}</b>` +
            (enemy.count ? `<span class="tip-pct">${pct.toFixed(2)}%</span>` : '') +
            (clone.g != null ? `<span class="tip-pack">pack ${clone.g}</span>` : ''),
          { direction: 'top', className: 'mdt-tip', offset: [0, -size / 2] }
        )
      }
    }

    for (const poi of dungeon.pois[String(sublevel)] ?? []) {
      // The entrance is where every route begins, so it gets the loudest
      // treatment on the map rather than being one more green dot.
      if (poi.type === 'dungeonEntrance') {
        L.marker(toLatLng(poi.x, poi.y), {
          keyboard: false,
          interactive: false,
          zIndexOffset: 2000,
          icon: L.divIcon({
            className: 'poi poi--start',
            iconSize: [0, 0],
            html: '<span class="start-pulse"></span><span class="start-pin">▶</span><em>START</em>',
          }),
        }).addTo(layers)
        continue
      }

      const label = typeof poi.info?.name === 'string' ? poi.info.name : poi.type
      L.marker(toLatLng(poi.x, poi.y), {
        keyboard: false,
        icon: L.divIcon({
          className: `poi poi--${poi.type}`,
          iconSize: [0, 0],
          html: '<span class="poi-dot"></span>',
        }),
      })
        .bindTooltip(esc(label), { direction: 'top', className: 'mdt-tip' })
        .addTo(layers)
    }

    blipsRef.current = blips
    packsRef.current = packs
    return () => {
      layers.remove()
      blipsRef.current = new Map()
      packsRef.current = new Map()
    }
  }, [dungeon, sublevel])

  /* ---------- pull colouring ---------- */

  useEffect(() => {
    for (const [, blip] of blipsRef.current) {
      const idx = pullIndexFor(route, blip.enemyIdx, blip.cloneIdx)
      const badge = blip.el.querySelector('b')
      if (idx < 0) {
        blip.el.classList.remove('blip--pulled')
        blip.el.style.removeProperty('--pull')
        if (badge) badge.textContent = ''
      } else {
        blip.el.classList.add('blip--pulled')
        blip.el.style.setProperty('--pull', `#${route.pulls[idx].color}`)
        if (badge) badge.textContent = String(idx + 1)
      }
    }
  }, [route, dungeon, sublevel])

  /* ---------- pull outlines ---------- */

  useEffect(() => {
    const map = mapRef.current
    if (!map || !showOutlines) return
    const layer = L.layerGroup().addTo(map)

    // Same idea as MDT's PullOutlines: a convex hull round each pull's
    // spawns, numbered at the centroid.
    const spawnAt = new Map<string, { x: number; y: number }>()
    for (const e of dungeon.enemies) {
      for (const c of e.clones) {
        if (c.sublevel === sublevel) spawnAt.set(`${e.mdtIdx}:${c.mdtIdx}`, { x: c.x, y: c.y })
      }
    }

    route.pulls.forEach((pull, i) => {
      const pts: { x: number; y: number }[] = []
      for (const [idx, clones] of Object.entries(pull.enemies)) {
        for (const c of clones) {
          const p = spawnAt.get(`${idx}:${c}`)
          if (p) pts.push(p)
        }
      }
      if (!pts.length) return

      const { shape, label } = outlineFor(pts, 16)
      if (shape.length > 2) {
        L.polygon(shape.map((p) => toLatLng(p.x, p.y)), {
          color: `#${pull.color}`,
          weight: 2,
          opacity: 0.9,
          fillColor: `#${pull.color}`,
          fillOpacity: 0.12,
          interactive: false,
          className: 'pull-outline',
        }).addTo(layer)
      }

      L.marker(toLatLng(label.x, label.y), {
        keyboard: false,
        interactive: false,
        icon: L.divIcon({
          className: 'pull-label',
          iconSize: [0, 0],
          html: `<span style="--pc:#${pull.color}">${i + 1}</span>`,
        }),
      }).addTo(layer)
    })

    return () => {
      layer.remove()
    }
  }, [route, dungeon, sublevel, showOutlines])

  /* ---------- drawings, notes and markers ---------- */

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = L.layerGroup().addTo(map)

    for (const obj of route.objects) {
      if (obj.sublevel !== sublevel) continue

      if (obj.kind === 'note') {
        const note = obj as Note
        const marker = markerById(note.markerId ?? '')
        const html = marker
          ? marker.icon
            ? `<span class="marker-icon" style="background-image:url(${marker.icon})"></span>`
            : `<span class="marker-shape marker-shape--${marker.shape}" style="--mc:${marker.color}"></span>`
          : `<span class="note-text">${note.text.replace(/[<>&]/g, '')}</span>`

        L.marker(toLatLng(note.x, note.y), {
          keyboard: false,
          icon: L.divIcon({ className: 'route-note', iconSize: [0, 0], html }),
        })
          .on('click', (ev: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(ev)
            if (cb.current.tool === 'eraser') cb.current.onEraseObject(note.id)
          })
          .bindTooltip(marker?.label ?? note.text, { direction: 'top', className: 'mdt-tip' })
          .addTo(layer)
        continue
      }

      const d = obj as Drawing
      const line = L.polyline(d.points.map((p) => toLatLng(p.x, p.y)), {
        color: `#${d.color}`,
        weight: Math.max(2, d.size * 0.6),
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(layer)
      line.on('click', (ev: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(ev)
        if (cb.current.tool === 'eraser') cb.current.onEraseObject(d.id)
      })

      if (d.kind === 'arrow' && d.points.length >= 2) {
        const a = d.points[d.points.length - 2]
        const b = d.points[d.points.length - 1]
        const angle = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI
        L.marker(toLatLng(b.x, b.y), {
          keyboard: false,
          interactive: false,
          icon: L.divIcon({
            className: 'arrow-head',
            iconSize: [0, 0],
            html: `<span style="--ac:#${d.color};--aa:${-angle}deg;--as:${Math.max(9, d.size * 2)}px"></span>`,
          }),
        }).addTo(layer)
      }
    }

    return () => {
      layer.remove()
    }
  }, [route.objects, sublevel, dungeon])

  /* ---------- drawing interaction ---------- */

  useEffect(() => {
    const map = mapRef.current
    const el = containerRef.current
    if (!map || !el) return

    const drawing = tool === 'pen' || tool === 'line' || tool === 'arrow'
    el.dataset.tool = tool.startsWith('marker:') ? 'marker' : tool

    if (!drawing) {
      map.dragging.enable()
      // A click on empty map places notes and markers.
      const onClick = (ev: L.LeafletMouseEvent) => {
        const t = cb.current.tool
        if (t !== 'note' && !t.startsWith('marker:')) return
        const { x, y } = toMdt(ev.latlng)
        cb.current.onPlaceNote(x, y)
      }
      map.on('click', onClick)
      return () => {
        map.off('click', onClick)
      }
    }

    // Freehand and straight lines both need the map to stop panning.
    map.dragging.disable()
    // Pointer events cover mouse, touch and pen with one code path. Leaflet's
    // own mouse* events never fire for touch, so binding those would leave
    // drawing silently dead on phones and tablets.
    el.style.touchAction = 'none'

    let points: { x: number; y: number }[] = []
    let preview: L.Polyline | null = null
    let active: number | null = null

    const at = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      return map.containerPointToLatLng([ev.clientX - rect.left, ev.clientY - rect.top])
    }

    const down = (ev: PointerEvent) => {
      if (ev.button > 0 || active !== null) return
      active = ev.pointerId
      el.setPointerCapture(ev.pointerId)
      const ll = at(ev)
      points = [toMdt(ll)]
      preview = L.polyline([ll], {
        color: `#${drawColor}`, weight: 3, opacity: 0.9, dashArray: '4 4', interactive: false,
      }).addTo(map)
      ev.preventDefault()
    }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== active || !preview) return
      const p = toMdt(at(ev))
      // Pen records the path; line and arrow only ever have two ends.
      if (tool === 'pen') points.push(p)
      else points = [points[0], p]
      preview.setLatLngs(points.map((q) => toLatLng(q.x, q.y)))
      ev.preventDefault()
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== active) return
      active = null
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
      if (!preview) return
      preview.remove()
      preview = null

      const enough = tool === 'pen' ? points.length > 2 : points.length === 2
      const last = points[points.length - 1]
      const moved =
        points.length > 1 &&
        (Math.abs(points[0].x - last.x) > 1 || Math.abs(points[0].y - last.y) > 1)

      if (enough && moved) {
        cb.current.onAddObject({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          kind: tool,
          color: cb.current.drawColor,
          size: 5,
          sublevel,
          points,
        } as Drawing)
      }
      points = []
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      preview?.remove()
      el.style.touchAction = ''
      map.dragging.enable()
    }
  }, [tool, drawColor, sublevel])

  return <div ref={containerRef} className="map" />
}
