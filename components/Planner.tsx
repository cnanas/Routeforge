'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Dungeon, DungeonIndex, Enemy, SpellInfo } from '@/lib/types'
import type { Tool } from './DungeonMap'
import {
  emptyRoute, forcesFor, newPull, presetToRoute, routeToPreset,
  PULL_COLORS, type Route, type RouteObject, type Note,
} from '@/lib/route'
import { decodeMdtString, encodeMdtString } from '@/lib/mdt-string'
import { MARKERS, GROUP_LABELS, markerById } from '@/lib/markers'
import { listRoutes, saveRoute, deleteRoute, type StoredRoute } from '@/lib/storage'
import { parseRun, runToRoute, type KeystoneRun, type RunRoute } from '@/lib/run'
import RunPanel from './RunPanel'
import { historyReducer, initHistory } from '@/lib/history'
import Logo from './Logo'

// Leaflet touches `window` at import time, so it must not be server-rendered.
const DungeonMap = dynamic(() => import('./DungeonMap'), {
  ssr: false,
  loading: () => <div className="map map--loading">Loading map…</div>,
})

const ALL = '__all__'

const TOOLS: { id: Tool; label: string; glyph: string }[] = [
  { id: 'inspect', label: 'Inspect a mob', glyph: '◉' },
  { id: 'select', label: 'Select packs', glyph: '⬚' },
  { id: 'pen', label: 'Freehand', glyph: '✎' },
  { id: 'line', label: 'Line', glyph: '╱' },
  { id: 'arrow', label: 'Arrow', glyph: '↗' },
  { id: 'note', label: 'Text note', glyph: 'T' },
  { id: 'eraser', label: 'Erase', glyph: '⌫' },
]

const DRAW_COLORS = ['e03131', 'f59f00', '2f9e44', '1971c2', '9c36b5', '212529', 'ffffff']

interface PlannerProps {
  index: DungeonIndex
  /** Present when arriving via a /r/<id> share link. */
  shared?: { id: string; payload: string }
}

export default function Planner({ index, shared }: PlannerProps) {
  const byIdx = useMemo(() => new Map(index.dungeons.map((d) => [d.idx, d])), [index])
  const seasons = useMemo(() => index.seasons ?? [], [index])

  // Resolved before state so the first render already has a route: gating the
  // whole shell on the dungeon fetch made the app flash "Loading…" and cost
  // the server-rendered sidebar.
  const initial = useMemo(() => {
    const live = seasons.find((s) => s.current)
    return (
      (live?.dungeonIdx ?? []).map((i) => byIdx.get(i)).find((d) => d !== undefined) ??
      index.dungeons[0]
    )
  }, [seasons, byIdx, index])

  const [season, setSeason] = useState(
    () => (seasons.find((s) => s.current) ?? seasons[0])?.name ?? ALL
  )
  const [slug, setSlug] = useState(initial.slug)

  const [dungeon, setDungeon] = useState<Dungeon | null>(null)
  // Lets the dungeon-load effect see the live route without depending on it.
  const routeRef = useRef<Route | null>(null)
  const [history, dispatch] = useReducer(historyReducer, emptyRoute(initial.idx), initHistory)
  const route = history.present
  routeRef.current = route
  /** Records an undo step. */
  const editRoute = useCallback((fn: (r: Route) => Route) => dispatch({ type: 'edit', fn }), [])
  /** Swaps the whole route in (import, load, new) and clears history. */
  const setRoute = useCallback((r: Route) => dispatch({ type: 'replace', route: r }), [])
  const [currentPull, setCurrentPull] = useState(0)
  const [tool, setTool] = useState<Tool>('select')
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0])
  /*
   * The inspected mob persists after the pointer leaves the map. Clearing on
   * mouseout made the ability list unreadable — it vanished the moment you
   * moved toward it. Click can't pin instead, since click assigns packs to
   * pulls, so hover sets and an explicit × clears.
   */
  const [inspected, setInspected] = useState<Enemy | null>(null)
  /** Which panel is raised as a bottom sheet on mobile. Unused on desktop. */
  const [sheet, setSheet] = useState<'dungeons' | 'route' | 'tools' | 'enemy' | null>(null)
  const [dialog, setDialog] = useState<'import' | 'export' | 'library' | 'share' | 'run' | null>(null)
  // A logged run, once one is loaded: the pulls that actually happened.
  const [loadedRun, setLoadedRun] = useState<{ run: KeystoneRun; imported: RunRoute } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  // A run for a dungeon that isn't open yet: held until that dungeon loads.
  const [pendingRun, setPendingRun] = useState<KeystoneRun | null>(null)
  const [showOutlines, setShowOutlines] = useState(true)
  const [spells, setSpells] = useState<Record<string, SpellInfo>>({})
  const [saved, setSaved] = useState<StoredRoute[]>([])
  const [routeId, setRouteId] = useState(() => `r${Date.now().toString(36)}`)
  const [shareId, setShareId] = useState<string | null>(shared?.id ?? null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => setSaved(listRoutes()), [])

  // A run names its dungeon; the index keys on slug. Short names disagree
  // between sources (Raider.IO "MR" vs MDT "MURD") and so do apostrophes, so
  // match on the name with everything but letters and digits stripped out.
  const dungeonForRun = useCallback(
    (run: KeystoneRun) => {
      const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
      const wanted = flat(run.run.dungeon ?? '')
      return index.dungeons.find((d) => flat(d.name) === wanted)
    },
    [index]
  )

  // Once the dungeon a held run belongs to has loaded, apply it.
  useEffect(() => {
    if (!pendingRun || !dungeon) return
    if (dungeon.mapID !== pendingRun.run.challengeModeId) return
    setLoadedRun({ run: pendingRun, imported: runToRoute(pendingRun, dungeon) })
    setPendingRun(null)
    setCurrentPull(0)
  }, [pendingRun, dungeon])

  // A shared link arrives as an MDT string, so it decodes through exactly the
  // same path as a route pasted out of the game.
  useEffect(() => {
    if (!shared) return
    try {
      const { preset, dialect } = decodeMdtString(shared.payload)
      const loaded = presetToRoute(preset, dialect)
      const target = index.dungeons.find((d) => d.idx === loaded.dungeonIdx)
      if (target) setSlug(target.slug)
      dispatch({ type: 'replace', route: loaded })
      setCurrentPull(0)
    } catch {
      setShareError('That shared route could not be read.')
    }
  }, [shared, index])

  // Spell names/icons are one shared file, loaded once and reused everywhere.
  useEffect(() => {
    fetch('/data/spells.json')
      .then((r) => r.json())
      .then(setSpells)
      .catch(() => setSpells({}))
  }, [])

  const visible = useMemo(() => {
    if (season === ALL) return index.dungeons
    const s = seasons.find((x) => x.name === season)
    if (!s) return index.dungeons
    return s.dungeonIdx.map((i) => byIdx.get(i)).filter((d) => d !== undefined)
  }, [season, seasons, index, byIdx])

  // Load the dungeon, and start a fresh route unless one was just imported.
  useEffect(() => {
    let cancelled = false
    setDungeon(null)
    fetch(`/data/dungeons/${slug}.json`)
      .then((r) => r.json())
      .then((d: Dungeon) => {
        if (cancelled) return
        setDungeon(d)
        setInspected(null)
        // Keep the route when it already belongs to this dungeon (an import
        // selects the dungeon it needs); otherwise start a fresh one.
        if (routeRef.current?.dungeonIdx !== d.idx) {
          dispatch({ type: 'replace', route: emptyRoute(d.idx) })
          setCurrentPull(0)
        }
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const forces = useMemo(() => (dungeon ? forcesFor(route, dungeon) : []), [route, dungeon])
  const totalPct = forces.length ? forces[forces.length - 1].cumulativePct : 0

  const forcesPct = (count: number) =>
    dungeon?.totalCount ? (count / dungeon.totalCount) * 100 : 0

  /* ---------- pull editing ---------- */

  const toggleEnemy = useCallback(
    (enemyIdx: number, cloneIdx: number, wholePack: boolean) => {
      if (!dungeon) return
      editRoute((prev) => {
        // A pack is every spawn sharing a group id on this floor, across NPC
        // types — that's the set that actually pulls together.
        let targets: [number, number][] = [[enemyIdx, cloneIdx]]
        if (wholePack) {
          const src = dungeon.enemies
            .find((e) => e.mdtIdx === enemyIdx)
            ?.clones.find((c) => c.mdtIdx === cloneIdx)
          if (src?.g != null) {
            targets = []
            for (const e of dungeon.enemies) {
              for (const c of e.clones) {
                if (c.sublevel === src.sublevel && c.g === src.g) targets.push([e.mdtIdx, c.mdtIdx])
              }
            }
          }
        }

        const pulls = prev.pulls.map((p) => ({ ...p, enemies: { ...p.enemies } }))
        const pull = pulls[currentPull]
        if (!pull) return prev

        const has = ([ei, ci]: [number, number]) => pull.enemies[ei]?.includes(ci)
        const removing = tool === 'eraser' || targets.every(has)

        for (const [ei, ci] of targets) {
          // A spawn belongs to at most one pull, so drop it everywhere first.
          for (const p of pulls) {
            if (!p.enemies[ei]) continue
            p.enemies[ei] = p.enemies[ei].filter((c) => c !== ci)
            if (!p.enemies[ei].length) delete p.enemies[ei]
          }
          if (!removing) pull.enemies[ei] = [...(pull.enemies[ei] ?? []), ci]
        }
        return { ...prev, pulls }
      })
    },
    [dungeon, currentPull, tool, editRoute]
  )

  // Selection is moved outside the reducer: a state updater must stay pure.
  const addPull = () => {
    editRoute((prev) => ({ ...prev, pulls: [...prev.pulls, newPull(prev.pulls.length)] }))
    setCurrentPull(route.pulls.length)
  }

  const removePull = (i: number) => {
    if (route.pulls.length <= 1) return
    editRoute((prev) => ({ ...prev, pulls: prev.pulls.filter((_, n) => n !== i) }))
    setCurrentPull((c) => Math.max(0, Math.min(c > i ? c - 1 : c, route.pulls.length - 2)))
  }

  const movePull = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= route.pulls.length) return
    editRoute((prev) => {
      const pulls = [...prev.pulls]
      ;[pulls[i], pulls[j]] = [pulls[j], pulls[i]]
      return { ...prev, pulls }
    })
    setCurrentPull(j)
  }

  /* ---------- objects ---------- */

  const addObject = useCallback(
    (obj: RouteObject) => editRoute((p) => ({ ...p, objects: [...p.objects, obj] })),
    [editRoute]
  )
  const eraseObject = useCallback(
    (id: string) => editRoute((p) => ({ ...p, objects: p.objects.filter((o) => o.id !== id) })),
    [editRoute]
  )
  const placeNote = useCallback(
    (x: number, y: number) => {
      const marker = tool.startsWith('marker:') ? markerById(tool.slice(7)) : null
      const text = marker ? marker.label : window.prompt('Note text')?.trim()
      if (!text) return
      const note: Note = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind: 'note',
        x, y,
        sublevel: route.sublevel,
        text,
        markerId: marker?.id,
      }
      editRoute((p) => ({ ...p, objects: [...p.objects, note] }))
    },
    [tool, route.sublevel, editRoute]
  )

  /* ---------- import / export ---------- */

  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<string | null>(null)

  const doImport = () => {
    setImportError(null)
    try {
      const { preset, dialect } = decodeMdtString(importText)
      const imported = presetToRoute(preset, dialect)
      const target = index.dungeons.find((d) => d.idx === imported.dungeonIdx)
      if (!target) {
        setImportError(
          `Route is for dungeon index ${imported.dungeonIdx}, which this build has no data for. ` +
            `MDT only ships the current two seasons.`
        )
        return
      }
      setImportInfo(
        `Imported "${imported.name}" — ${imported.pulls.length} pulls, ` +
          `${imported.objects.length} drawings. Wire format: ${dialect.compression} deflate, ` +
          `lists as ${dialect.lists}.`
      )
      setSlug(target.slug)
      setRoute(imported)
      setCurrentPull(0)
      setDialog(null)
      setImportText('')
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    }
  }

  const exportString = useMemo(
    () => encodeMdtString(routeToPreset(route), route.dialect),
    [route]
  )

  const persist = () => setSaved(saveRoute(routeId, route))

  /** Edit tokens are the only proof of ownership, so they live client-side. */
  const tokenKey = (id: string) => `mdt-web.share-token.${id}`

  const shareUrl = shareId ? `${typeof window === 'undefined' ? '' : window.location.origin}/r/${shareId}` : ''

  const share = async () => {
    setShareBusy(true)
    setShareError(null)
    try {
      const payload = encodeMdtString(routeToPreset(route), route.dialect)
      let token: string | null = shareId ? localStorage.getItem(tokenKey(shareId)) : null

      // Updating in place keeps the link you already handed out working;
      // without the token we can only publish a new one.
      if (shareId && token) {
        const res = await fetch(`/api/routes/${shareId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload, name: route.name, editToken: token }),
        })
        if (res.ok) {
          setDialog('share')
          return
        }
        if (res.status !== 403) throw new Error((await res.json())?.error ?? 'Could not update the link.')
        // Not ours to edit — fall through and publish a fresh one.
      }

      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload, name: route.name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not create a link.')
      token = data.editToken as string
      try {
        localStorage.setItem(tokenKey(data.id), token)
      } catch {
        // A viewer with storage disabled just loses the ability to re-edit.
      }
      setShareId(data.id as string)
      setDialog('share')
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e))
      setDialog('share')
    } finally {
      setShareBusy(false)
    }
  }

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Don't hijack the route-name field or the import textarea.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pulls = route.pulls

  return (
    <div className="shell" data-sheet={sheet ?? undefined}>
      {/* ---------- dungeons ---------- */}
      <aside className={sheet === 'dungeons' ? 'sidebar sidebar--open' : 'sidebar'}>
        <header className="brand">
          <h1>
            <Logo />
            Routeforge
          </h1>
          <button className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">×</button>
        </header>

        {seasons.length > 0 && (
          <div className="seasons" role="tablist">
            {seasons.map((s) => (
              <button
                key={s.name}
                role="tab"
                aria-selected={season === s.name}
                className={season === s.name ? 'season season--active' : 'season'}
                onClick={() => setSeason(s.name)}
              >
                {s.name.replace(/^Midnight /, '')}
                {s.current && <span className="dot" aria-label="current season" />}
              </button>
            ))}
            <button
              role="tab"
              aria-selected={season === ALL}
              className={season === ALL ? 'season season--active' : 'season'}
              onClick={() => setSeason(ALL)}
            >
              All
            </button>
          </div>
        )}

        <nav className="dungeon-list">
          {visible.map((d) => (
            <button
              key={d.slug}
              className={d.slug === slug ? 'dungeon dungeon--active' : 'dungeon'}
              onClick={() => {
                setSlug(d.slug)
                setSheet(null)
              }}
            >
              <span className="tag">{d.shortName}</span>
              <span className="dungeon-name">{d.name}</span>
              <span className="forces">{d.totalCount ?? '—'}</span>
            </button>
          ))}
        </nav>

      </aside>

      <section className="inspector">
        <div className="inspector-head">
          <button className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">×</button>
        </div>
        <div className="inspector-body">
          {inspected ? (
            <>
              <h2 className="panel-title">
                <span>{inspected.name}</span>
                <button className="panel-clear" onClick={() => setInspected(null)} title="Back to dungeon summary">
                  ×
                </button>
              </h2>
              <dl>
                <div>
                  <dt>Forces</dt>
                  <dd>
                    {inspected.count || '—'}
                    {inspected.count > 0 && <span className="pct">{forcesPct(inspected.count).toFixed(2)}%</span>}
                  </dd>
                </div>
                <div><dt>Health</dt><dd>{inspected.health.toLocaleString()}</dd></div>
                <div><dt>Type</dt><dd>{inspected.creatureType}</dd></div>
                <div><dt>Level</dt><dd>{inspected.level}</dd></div>
                <div><dt>Spawns</dt><dd>{inspected.clones.length}</dd></div>
              </dl>
              {inspected.characteristics.length > 0 && (
                <ul className="chips">
                  {inspected.characteristics.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
              {inspected.spells.length > 0 && (
                <ul className="spells">
                  {/* Kicks and dispels first — that's what you plan around. */}
                  {[...inspected.spells]
                    .sort((a, b) => Number(!!b.interruptible) - Number(!!a.interruptible))
                    .map((ref) => {
                      const info = spells[String(ref.id)]
                      const flags = (['interruptible', 'magic', 'enrage', 'bleed', 'poison', 'curse', 'disease'] as const)
                        .filter((f) => ref[f])
                      return (
                        <li key={ref.id}>
                          <span
                            className="spell-icon"
                            style={info?.icon ? { backgroundImage: `url(/spells/${info.icon}.jpg)` } : undefined}
                          />
                          <span className="spell-body">
                            <span className="spell-name">
                              {info?.name ?? `Spell ${ref.id}`}
                              {flags.map((f) => (
                                <em key={f} className={`flag flag--${f}`}>
                                  {f === 'interruptible' ? 'Kick' : f[0].toUpperCase() + f.slice(1)}
                                </em>
                              ))}
                            </span>
                            {info?.text && <span className="spell-text">{info.text}</span>}
                          </span>
                        </li>
                      )
                    })}
                </ul>
              )}
            </>
          ) : (
            dungeon && (
              <>
                <h2>{dungeon.name}</h2>
                <dl>
                  <div><dt>Forces required</dt><dd>{dungeon.totalCount ?? '—'}</dd></div>
                  <div><dt>Bosses</dt><dd>{dungeon.enemies.filter((e) => e.isBoss).length}</dd></div>
                </dl>
                <p className="hint">
                  Click a pack to add it to the selected pull, alt-click for one mob.
                  Hover a mob to inspect its abilities.
                </p>
              </>
            )
          )}
        </div>
      </section>

      {/* ---------- map ---------- */}
      <main className="stage">
        <button
          className="dungeon-picker"
          onClick={() => setSheet((v) => (v === 'dungeons' ? null : 'dungeons'))}
          aria-expanded={sheet === 'dungeons'}
        >
          <span className="tag">{dungeon?.shortName ?? '—'}</span>
          <span className="dungeon-picker-name">{dungeon?.name ?? 'Choose a dungeon'}</span>
          <i aria-hidden>▾</i>
        </button>

        <div className="toolbar">
          <button className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">×</button>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? 'tool tool--active' : 'tool'}
              title={t.label}
              onClick={() => setTool(t.id)}
            >
              {t.glyph}
            </button>
          ))}

          <span className="tool-sep" />

          {DRAW_COLORS.map((c) => (
            <button
              key={c}
              className={drawColor === c ? 'swatch swatch--active' : 'swatch'}
              style={{ background: `#${c}` }}
              title={`Draw in #${c}`}
              onClick={() => setDrawColor(c)}
            />
          ))}

          <span className="tool-sep" />

          <div className="markers">
            {(['cooldown', 'tactic', 'mark'] as const).map((g) => (
              <div key={g} className="marker-group" title={GROUP_LABELS[g]}>
                {MARKERS.filter((m) => m.group === g).map((m) => (
                  <button
                    key={m.id}
                    className={tool === `marker:${m.id}` ? 'marker-btn marker-btn--active' : 'marker-btn'}
                    title={m.label}
                    onClick={() => setTool(`marker:${m.id}`)}
                  >
                    {m.icon ? (
                      <span className="marker-icon" style={{ backgroundImage: `url(${m.icon})` }} />
                    ) : (
                      <span className={`marker-shape marker-shape--${m.shape}`} style={{ ['--mc' as string]: m.color }} />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {dungeon && dungeon.sublevels.length > 1 && (
          <div className="floors">
            {dungeon.sublevels.map((name, i) => (
              <button
                key={name}
                className={route.sublevel === i + 1 ? 'floor floor--active' : 'floor'}
                onClick={() => editRoute((p) => ({ ...p, sublevel: i + 1 }))}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {dungeon ? (
          <DungeonMap
            dungeon={dungeon}
            sublevel={route.sublevel}
            route={loadedRun ? loadedRun.imported.route : route}
            currentPull={currentPull}
            showOutlines={showOutlines}
            tool={tool}
            drawColor={drawColor}
            onHover={(e) => e && setInspected(e)}
            onInspect={(e) => {
              setInspected(e)
              // The inspector is a sheet on mobile, so surface it deliberately.
              if (window.matchMedia?.('(max-width: 860px)').matches) setSheet('enemy')
            }}
            onToggleEnemy={toggleEnemy}
            onAddObject={addObject}
            onEraseObject={eraseObject}
            onPlaceNote={placeNote}
          />
        ) : (
          <div className="map map--loading">Loading dungeon…</div>
        )}
      </main>

      {/* ---------- route ---------- */}
      <aside className="route-panel">
        {loadedRun && dungeon ? (
          <RunPanel
            run={loadedRun.run}
            imported={loadedRun.imported}
            planned={route}
            currentPull={currentPull}
            onSelectPull={setCurrentPull}
            onClear={() => { setLoadedRun(null); setCurrentPull(0) }}
          />
        ) : (
        <>
        <div className="route-head">
          <button className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">×</button>
          <input
            className="route-name"
            value={route.name}
            onChange={(e) => editRoute((p) => ({ ...p, name: e.target.value }))}
            aria-label="Route name"
          />
          <div className="progress" title={`${totalPct.toFixed(1)}% of required forces`}>
            <div className="progress-bar" style={{ width: `${Math.min(100, totalPct)}%` }} />
            <span className="progress-label">{totalPct.toFixed(1)}%</span>
          </div>
          <div className="route-actions">
            <button disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl/Cmd+Z)">
              ↶ Undo
            </button>
            <button disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })} title="Redo (Shift+Ctrl/Cmd+Z)">
              ↷ Redo
            </button>
            <button
              className={showOutlines ? 'toggle-on' : undefined}
              onClick={() => setShowOutlines((v) => !v)}
              title="Show an outline around each pull"
            >
              ◌ Outlines
            </button>
            <button onClick={() => { setRunError(null); setDialog('run') }} title="Load a run logged by Keystone">
              Run
            </button>
            <button onClick={() => setDialog('import')}>Import</button>
            <button onClick={() => setDialog('export')}>Export</button>
            <button onClick={share} disabled={shareBusy}>
              {shareBusy ? 'Sharing…' : shareId ? 'Update link' : 'Share'}
            </button>
            <button onClick={persist}>Save</button>
            <button onClick={() => setDialog('library')}>Library</button>
            <button
              onClick={() => {
                if (!dungeon) return
                setRouteId(`r${Date.now().toString(36)}`)
                setRoute(emptyRoute(dungeon.idx))
                setCurrentPull(0)
              }}
            >
              New
            </button>
          </div>
        </div>

        <div className="pulls">
          {pulls.map((pull, i) => {
            const f = forces[i]
            const mobs = Object.values(pull.enemies).reduce((n, c) => n + c.length, 0)
            return (
              <div
                key={pull.id}
                className={i === currentPull ? 'pull pull--active' : 'pull'}
                onClick={() => setCurrentPull(i)}
              >
                <span className="pull-swatch" style={{ background: `#${pull.color}` }}>{i + 1}</span>
                <span className="pull-meta">
                  <span className="pull-count">{mobs} mob{mobs === 1 ? '' : 's'}</span>
                  <span className="pull-forces">
                    +{f?.count ?? 0} <em>{(f?.pct ?? 0).toFixed(1)}%</em>
                  </span>
                </span>
                <span className="pull-cum">{(f?.cumulativePct ?? 0).toFixed(1)}%</span>
                <span className="pull-buttons">
                  <button onClick={(e) => { e.stopPropagation(); movePull(i, -1) }} title="Move up">↑</button>
                  <button onClick={(e) => { e.stopPropagation(); movePull(i, 1) }} title="Move down">↓</button>
                  <button onClick={(e) => { e.stopPropagation(); removePull(i) }} title="Delete pull">×</button>
                </span>
              </div>
            )
          })}
          <button className="add-pull" onClick={addPull}>+ Add pull</button>
        </div>
        </>
        )}
      </aside>

      {/* ---------- mobile chrome (hidden on desktop) ---------- */}
      <header className="mbar">
        <button className="mbar-dungeon" onClick={() => setSheet('dungeons')}>
          <Logo size={18} />
          <span>{dungeon?.shortName ?? '—'}</span>
          <i aria-hidden>▾</i>
        </button>
        <button className="mbar-route" onClick={() => setSheet('route')}>
          <span className="mbar-name">{route.name}</span>
          <span className="mbar-pct">{totalPct.toFixed(0)}%</span>
        </button>
      </header>

      <div className="mfoot">
        <button className="mfoot-pull" onClick={() => setSheet('route')}>
          <span className="pull-swatch" style={{ background: `#${pulls[currentPull]?.color ?? '888'}` }}>
            {currentPull + 1}
          </span>
          <span className="mfoot-meta">
            <b>Pull {currentPull + 1} of {pulls.length}</b>
            <span>{(forces[currentPull]?.cumulativePct ?? 0).toFixed(1)}% by here</span>
          </span>
        </button>
        <button
          className="fab"
          onClick={() => setSheet((v) => (v === 'tools' ? null : 'tools'))}
          aria-label="Tools"
        >
          {tool === 'inspect' ? '◉' : TOOLS.find((t) => t.id === tool)?.glyph ?? '✎'}
        </button>
      </div>

      {sheet && <div className="sheet-backdrop" onClick={() => setSheet(null)} />}

      {/* ---------- dialogs ---------- */}
      {dialog && (
        <div className="overlay" onClick={() => setDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {dialog === 'run' && (
              <>
                <h2>Load a logged run</h2>
                <p className="modal-hint">
                  Keystone reads WoW&apos;s combat log and exports a run as JSON
                  (<code>npm run export-run</code>), which lands in{' '}
                  <code>~/Developer/keystone/build/runs/</code>. Pick one to see the pulls that
                  actually happened, laid over this route — if it&apos;s for another dungeon, this
                  switches to it.
                </p>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file || !dungeon) return
                    try {
                      const parsed = parseRun(await file.text())

                      if (parsed.run.challengeModeId === dungeon.mapID) {
                        setLoadedRun({ run: parsed, imported: runToRoute(parsed, dungeon) })
                        setCurrentPull(0)
                        setRunError(null)
                        setDialog(null)
                        return
                      }

                      // The run is for another dungeon: switch to it rather
                      // than making that the reader's problem.
                      const target = dungeonForRun(parsed)
                      if (!target) {
                        setRunError(
                          `That run is ${parsed.run.dungeon}, which isn't in this season's data.`
                        )
                        return
                      }
                      setSlug(target.slug)
                      setPendingRun(parsed)
                      setRunError(null)
                      setDialog(null)
                    } catch (err) {
                      setRunError(err instanceof Error ? err.message : 'Could not read that file.')
                    }
                  }}
                />
                {runError && <p className="modal-error">{runError}</p>}
                <div className="modal-actions">
                  <button onClick={() => setDialog(null)}>Cancel</button>
                </div>
              </>
            )}

            {dialog === 'import' && (
              <>
                <h2>Import an MDT route</h2>
                <p className="modal-hint">
                  In game: open MDT, click the route dropdown, choose Export, then paste the string here.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="!~MDT2~…"
                  spellCheck={false}
                />
                {importError && <p className="modal-error">{importError}</p>}
                <div className="modal-actions">
                  <button onClick={() => setDialog(null)}>Cancel</button>
                  <button className="primary" onClick={doImport}>Import</button>
                </div>
              </>
            )}

            {dialog === 'export' && (
              <>
                <h2>Export to MDT</h2>
                <p className="modal-hint">
                  Copy this and paste it into MDT&apos;s import dialog in game.
                </p>
                <textarea readOnly value={exportString} spellCheck={false} onFocus={(e) => e.target.select()} />
                <div className="modal-actions">
                  <button onClick={() => setDialog(null)}>Close</button>
                  <button
                    className="primary"
                    onClick={() => navigator.clipboard?.writeText(exportString)}
                  >
                    Copy
                  </button>
                </div>
              </>
            )}

            {dialog === 'share' && (
              <>
                <h2>{shareError ? 'Could not share' : 'Share this route'}</h2>
                {shareError ? (
                  <>
                    <p className="modal-error">{shareError}</p>
                    <p className="modal-hint">
                      Sharing needs a database. Export the route string instead — it works
                      anywhere and never expires.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="modal-hint">
                      Anyone with this link can open the route. Editing and pressing
                      <strong> Update link </strong> keeps the same URL.
                    </p>
                    <div className="share-row">
                      <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                      <button
                        className="primary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard?.writeText(shareUrl)
                            setCopied(true)
                            window.setTimeout(() => setCopied(false), 1600)
                          } catch {
                            setCopied(false)
                          }
                        }}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </>
                )}
                <div className="modal-actions">
                  <button onClick={() => setDialog(null)}>Close</button>
                </div>
              </>
            )}

            {dialog === 'library' && (
              <>
                <h2>Saved routes</h2>
                {saved.length === 0 && <p className="modal-hint">Nothing saved yet.</p>}
                <ul className="library">
                  {saved.map((row) => (
                    <li key={row.id}>
                      <button
                        className="lib-open"
                        onClick={() => {
                          const target = index.dungeons.find((d) => d.idx === row.route.dungeonIdx)
                          if (target) setSlug(target.slug)
                          setRoute(row.route)
                          setRouteId(row.id)
                          setCurrentPull(0)
                          setDialog(null)
                        }}
                      >
                        <strong>{row.route.name}</strong>
                        <span>
                          {byIdx.get(row.route.dungeonIdx)?.name ?? 'Unknown dungeon'} ·{' '}
                          {row.route.pulls.length} pulls
                        </span>
                      </button>
                      <button className="lib-del" onClick={() => setSaved(deleteRoute(row.id))}>×</button>
                    </li>
                  ))}
                </ul>
                <div className="modal-actions">
                  <button onClick={() => setDialog(null)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {importInfo && (
        <div className="toast" onClick={() => setImportInfo(null)}>
          {importInfo}
        </div>
      )}
    </div>
  )
}
