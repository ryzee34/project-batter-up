// your daily results, kept in this browser only. storage can be missing or blocked
// (private windows, previews), so every read and write is allowed to fail quietly

import type { Result } from './daily'
import type { Notes } from './tells'

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

// your notebook on every pitcher you've faced: the cues he showed and what came. it's how
// the scouts' notes unlock, and it's yours to read for tells they haven't told you about

const NOTES = 'batter-up:notebook:v1'

export function loadNotebook(): Record<string, Notes> {
  try {
    const raw = window.localStorage.getItem(NOTES)
    return raw ? (JSON.parse(raw) as Record<string, Notes>) : {}
  } catch {
    return {}
  }
}

export function saveNotebook(all: Record<string, Notes>): void {
  try {
    window.localStorage.setItem(NOTES, JSON.stringify(all))
  } catch {
    // not saved, the notebook just starts over next visit
  }
}

// pitch recognition runs: the daily one by date, practice ones by when they ended

const RECS = 'batter-up:recognition:v1'

export interface RecSaved {
  score: number
  read: number
  grid: string
}

export function loadRecs(): Record<string, RecSaved> {
  try {
    const raw = window.localStorage.getItem(RECS)
    return raw ? (JSON.parse(raw) as Record<string, RecSaved>) : {}
  } catch {
    return {}
  }
}

export function saveRec(key: string, r: RecSaved): void {
  try {
    const all = loadRecs()
    all[key] = r
    window.localStorage.setItem(RECS, JSON.stringify(all))
  } catch {
    // not saved, the game still works
  }
}
