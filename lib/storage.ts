/**
 * Local route library. Routes live in the browser only — no account, no
 * server — so this is best-effort and must never throw into the UI.
 */
import type { Route } from './route'

const KEY = 'mdt-web.routes.v1'

export interface StoredRoute {
  id: string
  savedAt: number
  route: Route
}

const read = (): StoredRoute[] => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StoredRoute[]) : []
  } catch {
    return []
  }
}

const write = (rows: StoredRoute[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    // Quota or a browser with site data disabled — saving is a convenience.
  }
}

export const listRoutes = (): StoredRoute[] => read().sort((a, b) => b.savedAt - a.savedAt)

export function saveRoute(id: string, route: Route): StoredRoute[] {
  const rows = read().filter((r) => r.id !== id)
  rows.push({ id, savedAt: Date.now(), route })
  write(rows)
  return listRoutes()
}

export function deleteRoute(id: string): StoredRoute[] {
  write(read().filter((r) => r.id !== id))
  return listRoutes()
}
