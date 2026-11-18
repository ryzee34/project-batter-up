// your daily results, kept in this browser only. storage can be missing or blocked
// (private windows, previews), so every read and write is allowed to fail quietly

import type { Result } from './daily'

const KEY = 'batter-up:daily:v1'

export function loadResults(): Record<string, Result> {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, Result>) : {}
  } catch {
    return {}
  }
}

export function saveResult(r: Result): void {
  try {
    const all = loadResults()
    all[r.key] = r
    window.localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // not saved, the game still works
  }
}
