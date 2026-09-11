'use client'

import { useMemo } from 'react'
import { compareToPlan, type KeystoneRun, type RunRoute } from '@/lib/run'
import type { Route } from '@/lib/route'

const mmss = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

interface Props {
  run: KeystoneRun
  imported: RunRoute
  planned: Route
  currentPull: number
  onSelectPull: (index: number) => void
  onClear: () => void
}

/**
 * A logged run, read against the plan.
 *
 * The pulls here are the ones that actually happened, in the order they
 * happened, with the enemy forces they actually awarded -- so the cumulative
 * percentage is the real one, including whatever was killed that didn't need
 * to be.
 */
export default function RunPanel({
  run, imported, planned, currentPull, onSelectPull, onClear,
}: Props) {
  const comparison = useMemo(() => compareToPlan(planned, imported), [planned, imported])

  const total = run.totalForces || 0
  const finalForces = run.pulls.length ? run.pulls[run.pulls.length - 1].cumulative : 0
  const percent = total ? (finalForces / total) * 100 : 0
  const par = run.run.parSeconds ?? 0
  const overPar = par > 0 && run.run.durationSeconds > par
  const plannedAnything = planned.pulls.some((p) => Object.keys(p.enemies).length > 0)

  return (
    <>
      <div className="route-head">
        <div className="run-title">
          <b>{run.run.dungeon} +{run.run.level}</b>
          <span className={run.run.success ? 'run-badge run-badge--timed' : 'run-badge run-badge--depleted'}>
            {run.run.success ? `+${run.run.upgrades}` : 'depleted'}
          </span>
        </div>

        <div className="run-facts">
          <span className={overPar ? 'run-over' : undefined}>
            {mmss(run.run.durationSeconds)}{par ? ` of ${mmss(par)}` : ''}
          </span>
          <span>{run.deaths.length} death{run.deaths.length === 1 ? '' : 's'}</span>
          <span title="Enemy forces killed. Anything over 100% is trash you didn't need.">
            {percent.toFixed(0)}% forces
          </span>
        </div>

        {plannedAnything ? (
          <p className="run-compare">
            {comparison.pulledPacks} packs pulled ·{' '}
            <b>{comparison.skipped.length}</b> planned pack{comparison.skipped.length === 1 ? '' : 's'} skipped ·{' '}
            <b>{comparison.extra.length}</b> pulled that weren&apos;t in the route
          </p>
        ) : (
          <p className="run-compare run-compare--muted">
            Load or build a route to compare this run against it.
          </p>
        )}

        {(imported.unmatched.length > 0 || imported.adds.length > 0) && (
          <p className="run-compare run-compare--muted">
            {imported.adds.length > 0 && (
              <>
                {imported.adds.reduce((n, a) => n + a.count, 0)} summoned adds killed — they award
                no forces and aren&apos;t on the map.
              </>
            )}
            {imported.unmatched.length > 0 && (
              <>
                {' '}
                {imported.unmatched.reduce((n, u) => n + u.count, 0)} other kills had no spawn left
                to sit on, usually a respawn.
              </>
            )}
          </p>
        )}

        <div className="route-actions">
          <button onClick={onClear}>Close run</button>
        </div>
      </div>

      <div className="pulls">
        {run.pulls.map((pull, i) => {
          const routePull = imported.route.pulls[i]
          const mobs = routePull
            ? Object.values(routePull.enemies).reduce((n, c) => n + c.length, 0)
            : pull.kills.length
          return (
            <div
              key={pull.index}
              className={i === currentPull ? 'pull pull--active' : 'pull'}
              onClick={() => onSelectPull(i)}
            >
              <span
                className="pull-swatch"
                style={{ background: routePull ? `#${routePull.color}` : 'var(--muted)' }}
              >
                {pull.boss ? '★' : i + 1}
              </span>
              <span className="pull-meta">
                <span className="pull-count">{pull.name}</span>
                <span className="pull-forces">
                  {mmss(pull.start)} · {mobs} mob{mobs === 1 ? '' : 's'} · +{pull.count}
                </span>
              </span>
              <span className="pull-cum">
                {total ? `${((pull.cumulative / total) * 100).toFixed(0)}%` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
