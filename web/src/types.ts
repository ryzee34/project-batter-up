// the shapes batter-up export writes to public/data. see src/batter_up/export.py

export type PitchCall =
  | 'changeup'
  | 'curveball'
  | 'cutter'
  | 'fastball'
  | 'sinker'
  | 'slider'
  | 'splitter'

export type Zone = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'chase'

export interface Pitch {
  n: number
  count: string
  pitch: PitchCall
  zone: Zone
  name: string
  mph: number
  spin: number | null
  result: string
  plate: [number, number]
  sz: [number, number]
  release: [number, number, number]
  /** statcast vx0, vy0, vz0, ax, ay, az, measured at y = 50 ft */
  flight: [number, number, number, number, number, number]
  model: { call: [PitchCall, Zone]; pitch: number[]; zone: number[] }
  baseline: [PitchCall, Zone]
}

export interface AtBat {
  id: string
  date: string
  team: string
  opponent: string
  home: boolean
  inning: number
  half: 'top' | 'bottom'
  outs: number
  runners: [boolean, boolean, boolean]
  score: { pitching: number; batting: number }
  pitcher: {
    id: number
    name: string
    throws: 'L' | 'R'
    pitchesToday: number
    mix: Partial<Record<PitchCall, number>>
    mixVsSide: Partial<Record<PitchCall, number>>
  }
  batter: { id: number; name: string; stands: 'L' | 'R' }
  result: string
  des: string
  pitches: Pitch[]
}

export interface GameData {
  version: number
  synthetic: boolean
  season: number
  team: string
  pitchCalls: PitchCall[]
  zones: Zone[]
  atBats: AtBat[]
}

export interface Scores {
  pitches: number
  pitch_type: number
  zone: number
  both: number
}

export interface ModelSummary {
  version: number
  synthetic: boolean
  testSeason: number
  trainSeasons: number[]
  model: Scores
  baseline: Scores
  team: string
  teamOnly: { model: Scores; baseline: Scores }
  byCount: Record<string, { pitches: number; model: number; baseline: number }>
  importance: [string, number][]
}

export interface Commentary {
  version: number
  model: string
  atBats: Record<string, { pitches: string[]; wrap: string }>
}
