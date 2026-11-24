import '@fontsource-variable/inter/wght.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './style.css'

import {
  HOT,
  POINTS,
  Session,
  deal,
  describe,
  modelGuess,
  mulberry32,
  type Grade,
  type Guess,
  type PitchResult,
} from './game'
import { shareCard } from './card'
import { dailyAtBats, dayKey, dayNumber, result, shareText, streak, type Result } from './daily'
import { loadNotebook, loadResults, saveNotebook, saveResult } from './store'
import { PITCHES, PITCH_ORDER, escape, ordinal, pct, spot } from './labels'
import type { Stage } from './stage'
import {
  CUES,
  CUE_KINDS,
  TIERS,
  UNLOCK,
  bookLines,
  cuesFor,
  emptyNotes,
  pointsTo,
  record,
  repertoire,
  slotFit,
  slotTilt,
  tellsFor,
  tierOf,
  unlocked,
  wayOdds,
  wayOf,
  type Cues,
  type Notes,
  type PitcherBook,
  type Scouting,
  type Tell,
  type Way,
} from './tells'
import type { AtBat, Commentary, GameData, ModelSummary, Pitch, PitchCall } from './types'
import { wayName, zoneGrid } from './zone'

const AT_BATS_PER_GAME = 3
// the arrows point the way the pitch goes, as the catcher sees it
const ARROWS: Record<string, Way> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}
/** seconds he holds the set, for a quick set and a long one */
const HOLDS = [0.35, 1.6]

/** calling: you're picking. pitching: the windup and the throw. reveal: how you did */
type Phase = 'title' | 'calling' | 'pitching' | 'reveal' | 'done'

interface State {
  data: GameData
  summary: ModelSummary | null
  booth: Commentary | null
  book: Scouting | null
  session: Session | null
  mode: 'daily' | 'practice'
  today: string
  phase: Phase
  pick: Partial<Guess>
  /** he's finished his motion up to the freeze, so the cues are all showing */
  readDone: boolean
  notes: Record<string, Notes>
  last: PitchResult | null
}

const app = document.querySelector<HTMLElement>('#app')!
let state: State

// the ballpark is one webgl view for the whole visit. three.js loads in the background
// after the first paint, then the canvas moves into whichever screen is up: behind the
// title card, or front and center while you play. without webgl the game still works,
// with a flat zone instead
let stage: Stage | null = null
let stageBroken = false
let stageLoading: Promise<Stage | null> | null = null
/** which pitch the stage is set up for, so a re-render doesn't reset it */
let staged = ''

function loadStage(): Promise<Stage | null> {
  stageLoading ??= import('./stage')
    .then(({ Stage, webglAvailable }) => {
      if (!webglAvailable()) throw new Error('no webgl here')
      stage = new Stage()
      stage.onLayout = placeZone
      return stage
    })
    .catch((err) => {
      console.warn('the 3d ballpark is off:', err)
      stageBroken = true
      document.querySelectorAll('.stage').forEach((el) => el.classList.add('flat'))
      return null
    })
  return stageLoading
}

function mountStage(): void {
  const host = document.querySelector<HTMLElement>('#stage')
  if (!host || stageBroken) return
  void loadStage().then((s) => {
    if (!s || !host.isConnected) return
    if (s.canvas.parentElement !== host) host.prepend(s.canvas)
    host.classList.add('live')
    syncStage(s)
    placeZone()
  })
}

/** set the players and the zone for whatever is on screen */
function syncStage(s: Stage): void {
  const session = state.session
  if (!session || state.phase === 'done') {
    // the title and final screens: someone idling on the mound
    const ab = session?.atBat ?? state.data.atBats[0]
    const key = `idle:${ab.id}`
    if (staged !== key) s.ready(ab.pitches[0], ab.pitcher.throws, ab.batter.stands)
    staged = key
    return
  }
  s.showCam = true
  const ab = session.atBat
  const p = session.pitch
  const key = `${ab.id}:${p.n}`
  if (state.phase === 'calling' && staged !== key) {
    staged = key
    startRead(s)
  }
}

/** he comes set and starts his motion, showing this pitch's tells, and stops before he lets go */
function startRead(s: Stage): void {
  const session = state.session!
  const ab = session.atBat
  const p = session.pitch
  const cues = currentCues()
  const style = { glove: cues.glove, kick: cues.kick, tilt: slotTilt(p, bookFor(ab)) }
  s.read(p, ab.pitcher.throws, ab.batter.stands, style, HOLDS[cues.hold], () => {
    if (state.phase !== 'calling' || state.session?.pitch !== p || state.readDone) return
    state.readDone = true
    render()
  })
}

function watchAgain(): void {
  if (state.phase !== 'calling') return
  if (!stage || stageBroken) return
  state.readDone = false
  startRead(stage)
  render()
}

// the scouting: his real book, his made up tells, and your notebook on him

function bookFor(ab: AtBat): PitcherBook | undefined {
  return state.book?.pitchers[String(ab.pitcher.id)]
}

function tellsOf(ab: AtBat): Tell[] {
  const book = bookFor(ab)
  return tellsFor(ab.pitcher.id, repertoire(ab, book), tierOf(book))
}

function currentCues(): Cues {
  const s = state.session!
  return cuesFor(s.atBat, s.pitch, tellsOf(s.atBat), tierOf(bookFor(s.atBat)))
}

function notesOn(ab: AtBat): Notes {
  return state.notes[String(ab.pitcher.id)] ?? emptyNotes()
}


/** line the clickable zone up with the one in the ballpark */
function placeZone(): void {
  const cam = document.querySelector<HTMLElement>('.cam-frame')
  if (cam && stage) {
    const c = stage.camRect()
    cam.style.left = `${c.left}px`
    cam.style.top = `${c.top}px`
    cam.style.width = `${c.width}px`
    cam.style.height = `${c.height}px`
  }
  const el = document.querySelector<HTMLElement>('.zone-overlay')
  if (!el || !stage || !el.isConnected || stage.canvas.parentElement !== el.parentElement) return
  const r = stage.frame()
  el.style.left = `${r.left}px`
  el.style.top = `${r.top}px`
  el.style.width = `${r.width}px`
  el.style.height = `${r.height}px`
}

async function load<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  return res.json() as Promise<T>
}

async function boot(): Promise<void> {
  try {
    const [data, summary, booth, book] = await Promise.all([
      load<GameData>('atbats.json'),
      load<ModelSummary>('model.json').catch(() => null),
      // claude's lines are optional, the game plays fine without them
      load<Commentary>('commentary.json').catch(() => null),
      // the book is optional too, without it you only have the tells
      load<Scouting>('scouting.json').catch(() => null),
    ])
    state = {
      data,
      summary,
      booth,
      book,
      session: null,
      mode: 'daily',
      today: dayKey(),
      phase: 'title',
      pick: {},
      readDone: false,
      notes: loadNotebook(),
      last: null,
    }
    render()
  } catch (err) {
    app.innerHTML = `<section class="card"><h1 class="wordmark">batter up</h1><p>couldn't load the at-bats (${escape(String(err))})</p></section>`
  }
}

// rendering

function render(): void {
  const banner = state.data.synthetic
    ? `<p class="banner"><b>practice data</b> these at-bats come from a made up league, not real dodgers games yet</p>`
    : ''
  const body = {
    title: renderTitle,
    calling: renderGame,
    pitching: renderGame,
    reveal: renderGame,
    done: renderDone,
  }[state.phase]()
  app.dataset.phase = state.phase
  const backdrop = state.phase === 'title' || state.phase === 'done'
  app.innerHTML = (backdrop ? '<div class="backdrop stage" id="stage"></div>' : '') + banner + body
  if (stageBroken) document.querySelectorAll('.stage').forEach((el) => el.classList.add('flat'))
  if (stage && !stageBroken) {
    mountStage()
  } else if (!stageBroken) {
    // let the first screen paint before pulling in three.js
    requestAnimationFrame(() => setTimeout(mountStage, 50))
  }
}

// title

function renderTitle(): string {
  const s = state.summary
  const stats = s
    ? `<div class="stats">
        <div class="stat model"><b>${pct(s.model.pitch_type)}</b><span>the model gets the pitch type right, on a season it never saw</span></div>
        <div class="stat"><b>${pct(s.baseline.pitch_type)}</b><span>always guessing the pitcher's favorite pitch</span></div>
      </div>`
    : ''
  return `
    <section class="card title">
      <p class="eyebrow">${escape(state.data.team)} · ${state.data.season} season</p>
      <h1 class="wordmark">batter up</h1>
      <p class="lede">read the pitcher and call the next pitch in real at-bats, before it's thrown. a model calls it too. try to beat it.</p>
      <ol class="how">
        <li><b>watch him come set</b><span>every pitcher gives something away in his delivery: where his glove sits, how high he kicks, how long he holds, where his arm comes from. it stops just before he lets go</span></li>
        <li><b>call the pitch and where it goes</b><span>use what he showed, his real scouting book and your own notes on him. the more you face him, the more the scouts tell you</span></li>
        <li><b>hit ready</b><span>he throws the real pitch, on its real path, and you see who read it</span></li>
      </ol>
      ${stats}
      <p class="rules"><span><b>${POINTS.pitch}</b> right pitch</span><span><b>${POINTS.way}</b> up, down, in or away</span><span><b>×2</b> after ${HOT} reads in a row</span></p>
      ${dailyBox()}
    </section>`
}

function dailyBox(): string {
  const results = loadResults()
  const done = results[state.today]
  const days = streak(Object.keys(results), state.today)
  const streakLine = days > 1 ? `<p class="muted center small">${days} days in a row</p>` : ''
  if (!done) {
    return `
      <button class="primary" data-action="daily">play today's three at-bats <small>#${dayNumber(state.today)}</small></button>
      <button class="secondary wide" data-action="practice">practice with random at-bats</button>
      ${streakLine}`
  }
  return `
    <div class="today">
      <p class="eyebrow">today's done</p>
      <p class="score-line">${scoreLine(done.you, done.model)}</p>
      <pre class="grid">${done.grid.join('\n')}</pre>
      ${shareButtons()}
      ${streakLine}
      <p class="muted small center">new at-bats at midnight in los angeles</p>
    </div>
    <button class="secondary wide" data-action="practice">practice with random at-bats</button>`
}

function scoreLine(you: number, model: number): string {
  return `<span class="side you"><small>you</small><b>${you}</b></span>
    <span class="dash">–</span>
    <span class="side model"><small>model</small><b>${model}</b></span>`
}

function shareButtons(): string {
  return `<div class="share">
    <button class="secondary" data-action="share-text">share result</button>
    <button class="secondary" data-action="share-card">save image</button>
    <span class="share-note" aria-live="polite"></span>
  </div>`
}

// the game screens share a header: the scorebug and who's facing who

function scorebug(ab: AtBat, p: Pitch): string {
  const [balls, strikes] = p.count.split('-').map(Number)
  const dots = (n: number, of: number, cls: string) =>
    Array.from({ length: of }, (_, i) => `<i class="${cls} ${i < n ? 'on' : ''}"></i>`).join('')
  const base = (i: number, x: number, y: number) =>
    `<rect class="${ab.runners[i] ? 'on' : ''}" x="${x}" y="${y}" width="11" height="11" transform="rotate(45 ${x + 5.5} ${y + 5.5})"/>`
  const pitching = { abbr: ab.team, runs: ab.score.pitching, bat: false }
  const batting = { abbr: ab.opponent, runs: ab.score.batting, bat: true }
  // away team on top, like every scorebug
  const rows = ab.home ? [batting, pitching] : [pitching, batting]
  const runners = ab.runners.filter(Boolean).length
  return `
    <header class="bug" aria-label="game situation">
      <div class="bug-teams">
        ${rows
          .map(
            (t) => `<div class="team ${t.bat ? 'batting' : ''}">
              <span class="abbr">${escape(t.abbr)}</span><b>${t.runs}</b>
            </div>`,
          )
          .join('')}
      </div>
      <div class="bug-inning" aria-label="${ab.half} of the ${ordinal(ab.inning)}">
        <span class="arrow">${ab.half === 'top' ? '▲' : '▼'}</span><b>${ab.inning}</b>
      </div>
      <div class="bug-bases" aria-label="${runners ? `${runners} on` : 'bases empty'}">
        <svg viewBox="0 0 46 34" width="46" height="34">${base(1, 17.5, 3)}${base(0, 31, 16)}${base(2, 4, 16)}</svg>
      </div>
      <div class="bug-count" aria-label="${balls} balls, ${strikes} strikes">
        <b>${balls}-${strikes}</b>
        <span class="lights"><span>${dots(balls, 3, 'ball')}</span><span>${dots(strikes, 2, 'strike')}</span></span>
      </div>
      <div class="bug-outs" aria-label="${ab.outs} out">
        <span class="lights"><span>${dots(ab.outs, 2, 'out')}</span></span><small>${ab.outs} out</small>
      </div>
    </header>`
}

function matchup(ab: AtBat): string {
  const s = state.session!
  const t = s.totals()
  return `
    <section class="matchup">
      <div class="player">
        <small>pitching</small>
        <b>${escape(ab.pitcher.name)}</b>
        <span>${ab.pitcher.throws === 'R' ? 'righty' : 'lefty'} · ${ab.pitcher.pitchesToday} pitches today</span>
      </div>
      <span class="vs">vs</span>
      <div class="player">
        <small>at bat</small>
        <b>${escape(ab.batter.name)}</b>
        <span>bats ${ab.batter.stands === 'R' ? 'right' : 'left'}</span>
      </div>
      <div class="tally">
        <small>at-bat ${s.atBatIndex + 1} of ${s.atBats.length} · ${ab.date}</small>
        <span class="you">you <b>${t.you}</b></span>
        <span class="model">model <b>${t.model}</b></span>
      </div>
    </section>`
}

function pitchPicker(ab: AtBat, selected: PitchCall | undefined, locked: boolean): string {
  const mine = repertoire(ab, bookFor(ab))
  const shown = mine.length ? mine : PITCH_ORDER
  const rare = PITCH_ORDER.filter((c) => !shown.includes(c))
  const chip = (c: PitchCall, mini = false) => `
    <button class="pitch ${mini ? 'mini' : ''} ${selected === c ? 'selected' : ''}" data-pitch="${c}"
      style="--c:${PITCHES[c].color}" aria-pressed="${selected === c}" ${locked ? 'disabled' : ''}>
      <span class="swatch"></span><span class="name">${c}</span>
      <kbd>${PITCHES[c].key}</kbd>
    </button>`
  const others = rare.length
    ? `<details class="never"><summary>${rare.length} he hardly ever throws</summary>
        <div class="pitches">${rare.map((c) => chip(c, true)).join('')}</div></details>`
    : ''
  return `<div class="pitches">${shown.map((c) => chip(c)).join('')}</div>${others}`
}

function pitchLog(ab: AtBat, history: Pitch[], results: PitchResult[]): string {
  if (!history.length) return '<p class="muted small">first pitch of the at-bat</p>'
  const items = history
    .map((p, i) => {
      const r = results[i]
      return `<li style="--c:${PITCHES[p.pitch].color}">
        <span class="n">${p.n}</span>
        <span class="chip">${PITCHES[p.pitch].short}</span>
        <span class="what">${p.mph} · ${spot(p.zone, ab.batter.stands)} · ${describe(p.result)}</span>
        ${r ? `<span class="marks" title="you ${r.you.points}, model ${r.model.points}">${square(r.you)}${square(r.model)}</span>` : ''}
      </li>`
    })
    .join('')
  return `<ol class="log">${items}</ol>`
}

function square(g: Pick<Grade, 'pitch' | 'way'>): string {
  return `<i class="sq ${g.pitch && g.way ? 'full' : g.pitch || g.way ? 'part' : 'none'}"></i>`
}

function compare(r: PitchResult, you: Guess, model: Guess, stands: 'L' | 'R'): string {
  const p = r.pitch
  const cell = (text: string, right: boolean) =>
    `<td class="${right ? 'right' : 'wrong'}"><span class="mark">${right ? '✓' : '✗'}</span>${text}</td>`
  const row = (who: 'you' | 'model', g: Guess, grade: Grade) => `
    <tr class="${who}">
      <th>${who}</th>
      ${cell(g.pitch, grade.pitch)}
      ${cell(wayName(g.way, stands), grade.way)}
      <td class="pts ${grade.pitch && grade.way ? 'perfect' : grade.points ? 'some' : ''}">+${grade.points}</td>
    </tr>`
  return `
    <table class="compare">
      <thead><tr><th></th><th>pitch</th><th>went</th><th>pts</th></tr></thead>
      <tbody>
        <tr class="actual"><th>actual</th><td>${p.pitch}</td><td>${wayName(wayOf(p.plate, p.sz), stands)}</td><td></td></tr>
        ${row('you', you, r.you)}
        ${row('model', model, r.model)}
      </tbody>
    </table>`
}

function verdictLine(g: Grade): string {
  if (g.pitch && g.way) return 'read it'
  if (g.pitch) return 'right pitch'
  if (g.way) return 'right way, wrong pitch'
  return 'he fooled you'
}

function odds(p: Pitch): string {
  const calls = state.data.pitchCalls
  return calls
    .map((c, i) => ({ c, v: p.model.pitch[i] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(
      ({ c, v }) => `
      <div class="odds-row ${c === p.pitch ? 'hit' : ''}" style="--c:${PITCHES[c].color}">
        <span>${c}</span>
        <span class="bar"><i style="width:${v * 100}%"></i></span>
        <span>${pct(v)}</span>
      </div>`,
    )
    .join('')
}

// the game: the ballpark with the zone laid over it, and a panel beside it that changes
// with the phase. you call it, watch it, then see how you did, all on one screen

function renderGame(): string {
  const s = state.session!
  const ab = s.atBat
  const reveal = state.phase === 'reveal'
  const p = reveal ? state.last!.pitch : s.pitch
  return `
    <div class="game-top">
      ${scorebug(ab, p)}
      ${matchup(ab)}
    </div>
    <section class="arena ${state.phase}">
      <div class="stage ${stage ? 'live' : ''}" id="stage">
        <div class="zone-overlay">${overlay()}</div>
        <div class="cam-frame" aria-hidden="true"><span>pitcher cam</span></div>
        ${stageHud()}
      </div>
      <aside class="side">${reveal ? revealPanel() : callPanel()}${scoutPanel()}</aside>
    </section>`
}

function overlay(): string {
  const s = state.session!
  const stands = s.atBat.batter.stands
  if (state.phase === 'reveal') {
    const r = state.last!
    return zoneGrid(
      {
        you: state.pick.way,
        model: modelGuess(r.pitch).way,
        heat: wayOdds(r.pitch.model.zone),
        pitch: r.pitch,
        history: s.history,
        stands,
      },
      false,
    )
  }
  return zoneGrid(
    {
      selected: state.pick.way,
      you: state.phase === 'pitching' ? state.pick.way : undefined,
      history: s.history,
      stands,
    },
    state.phase === 'calling',
  )
}

function stageHud(): string {
  if (state.phase === 'calling') {
    if (!state.readDone && stage && !stageBroken) {
      return `<p class="stage-toast reading">watch him come set</p>`
    }
    const again = stage && !stageBroken
      ? `<button class="stage-replay" data-action="watch" aria-label="watch his delivery again">↻ watch again</button>`
      : ''
    const hint = state.pick.way
      ? ''
      : `<p class="stage-hint"><b>tap where it's going</b><span>up, down, in or away</span></p>`
    return hint + again
  }
  if (state.phase === 'pitching') {
    return `<p class="stage-toast">here it comes</p>`
  }
  const r = state.last!
  const grade = r.you.pitch && r.you.way ? 'perfect' : r.you.points ? 'part' : 'miss'
  return `
    <p class="stage-flash ${grade}"><b>+${r.you.points}</b>${verdictLine(r.you)}</p>
    <button class="stage-replay" data-action="replay" aria-label="replay the pitch">↻ replay</button>
    <span class="stage-legend"><i class="you"></i>you <i class="model"></i>model</span>`
}

/** what he showed on this pitch: the three made up cues and his real arm slot */
function readout(p: Pitch, ab: AtBat, cues: Cues): string {
  const book = bookFor(ab)
  const chips = CUE_KINDS.map(
    (k) => `<li><small>${CUES[k].name}</small><b>${CUES[k].levels[cues[k]]}</b></li>`,
  )
  const fit = slotFit(p, book)
  if (fit.length >= 2) {
    // only call it when one pitch's slot is clearly closer than the next
    const clear = fit[1].distance - fit[0].distance > 0.6
    chips.push(
      `<li class="real"><small>arm slot <i>real</i></small><b>${clear ? `like his ${fit[0].call}` : 'his usual'}</b></li>`,
    )
  }
  return `<ul class="cues">${chips.join('')}</ul>`
}

function callPanel(): string {
  const s = state.session!
  const ab = s.atBat
  const stands = ab.batter.stands
  const { pitch, way } = state.pick
  const locked = state.phase === 'pitching'
  const showing = state.readDone || !stage || stageBroken || locked
  const read = showing
    ? readout(s.pitch, ab, currentCues())
    : `<p class="muted small reading-note">watch his delivery. it stops just before he lets go</p>`
  const call = pitch
    ? `<span class="call-pitch" style="--c:${PITCHES[pitch].color}">${pitch}</span>`
    : '<span class="muted">pick a pitch</span>'
  const where = way
    ? `<span class="call-spot">${wayName(way, stands)}</span>`
    : '<span class="muted">tap the zone</span>'
  const button = locked
    ? `<button class="primary ready" disabled>watch the pitch…</button>`
    : pitch && way
      ? `<button class="primary ready" data-action="call">ready <small>${pitch} · ${wayName(way, stands)}</small></button>`
      : `<button class="primary ready" disabled>${pitch ? 'tap where it goes' : 'pick a pitch'}</button>`
  const streakNote = streakLine()
  return `
    <div class="panel call ${locked ? 'locked' : ''}">
      <p class="eyebrow">pitch ${s.pitch.n} · ${s.pitch.count} count${streakNote}</p>
      <h2 class="ask">read him</h2>
      <div class="read">${read}</div>
      <div class="pitch-pick">${pitchPicker(ab, pitch, locked)}</div>
      ${pitch ? goesLine(ab, pitch) : ''}
      <p class="your-call"><small>your call</small>${call}${where}</p>
      <div class="call-bar">${button}</div>
      <p class="keys"><kbd>${PITCHES.fastball.key}</kbd><kbd>${PITCHES.slider.key}</kbd>… pitch <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> where <kbd>w</kbd> watch again <kbd>enter</kbd> ready</p>
    </div>
    <div class="panel so-far ${s.history.length ? '' : 'empty'}">
      <h3>this at-bat so far</h3>
      ${pitchLog(ab, s.history, s.results[s.atBatIndex])}
    </div>`
}

function streakLine(): string {
  const last = state.session!.results.flat().at(-1)
  const run = last?.you.streak ?? 0
  if (run >= HOT) return ` · <b class="hot">${run} in a row, double points</b>`
  if (run > 0) return ` · ${run} in a row`
  return ''
}

/** where the pitch you picked goes against this side, from his book */
function goesLine(ab: AtBat, pitch: PitchCall): string {
  const loc = bookFor(ab)?.sides[ab.batter.stands].location[pitch]
  if (!loc || !Object.keys(loc).length) return ''
  const side = ab.batter.stands === 'L' ? 'lefties' : 'righties'
  const parts = (Object.entries(loc) as [Way, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([w, v]) => `${wayName(w, ab.batter.stands)} <b>${pct(v)}</b>`)
  return `<p class="goes">his ${pitch} to ${side}: ${parts.join(' · ')}</p>`
}

/** a bar of his pitches. shares show as percents, or `counts` show as plain numbers */
function mixBar(mix: Partial<Record<PitchCall, number>>, counts = false): string {
  const parts = (Object.entries(mix) as [PitchCall, number][]).sort((a, b) => b[1] - a[1])
  const segs = parts
    .map(([c, v]) => `<i style="flex:${v};--c:${PITCHES[c].color}" title="${c} ${pct(v)}"></i>`)
    .join('')
  const words = parts
    .slice(0, 3)
    .map(([c, v]) => `<span style="--c:${PITCHES[c].color}">${c} ${counts ? v : pct(v)}</span>`)
    .join('')
  return `<span class="mix-bar">${segs}</span><span class="mix-words">${words}</span>`
}

/** what you know about him: the tier, the scouts' notes, your notebook, and his real book */
function scoutPanel(): string {
  const s = state.session!
  const ab = s.atBat
  const book = bookFor(ab)
  const tier = TIERS[tierOf(book)]
  const tells = tellsOf(ab)
  const notes = notesOn(ab)
  const mine = repertoire(ab, book)
  const known = unlocked(notes.seen, tells)
  const scoutNotes = known.map(
    (t) =>
      `<li><b>${CUES[t.kind].name}</b>: ${[0, 1]
        .map((l) => `${CUES[t.kind].levels[l]} → ${pointsTo(t, l as 0 | 1, mine).join(' or ') || 'nothing'}`)
        .join(', ')}</li>`,
  )
  const nextAt = UNLOCK[known.length]
  if (known.length < tells.length && nextAt !== undefined) {
    const left = nextAt - notes.seen
    scoutNotes.push(
      `<li class="muted">the scouts will have his ${known.length ? 'next' : 'first'} tell after ${left} more pitch${left === 1 ? '' : 'es'}. until then, spot it yourself</li>`,
    )
  } else if (known.length === tells.length) {
    scoutNotes.push(
      `<li class="muted">that's all he tips. it shows about ${pct(tier.honest + (1 - tier.honest) / 2)} of the time, the rest is a bluff</li>`,
    )
  }
  const notebook = notes.seen
    ? `<table class="notebook">
        <tbody>${CUE_KINDS.map(
          (k) => `
          <tr><th rowspan="2">${CUES[k].name}</th><td>${CUES[k].levels[0]}</td><td>${mixBar(notes.cues[k][0], true)}</td></tr>
          <tr><td>${CUES[k].levels[1]}</td><td>${mixBar(notes.cues[k][1], true)}</td></tr>`,
        ).join('')}</tbody>
      </table>`
    : '<p class="muted small">nothing yet. every pitch you see from him goes in here, with what he showed before it</p>'
  const lines = state.book
    ? bookLines(book, state.book.buckets, ab, s.pitch, s.history.at(-1))
    : []
  const bookHtml = lines.length
    ? `<ul class="book">${lines.map((l) => `<li><small>${escape(l.label)}</small>${mixBar(l.mix)}</li>`).join('')}</ul>
       ${book ? `<p class="muted small">from ${book.pitches.toLocaleString()} real pitches, ${state.book!.seasons[0]}-${state.book!.seasons.at(-1)}. his arm slot alone names the pitch ${pct(book.slotRead)} of the time</p>` : ''}`
    : '<p class="muted small">no book on him from earlier seasons</p>'
  return `
    <div class="panel scout">
      <h3>the book on ${escape(ab.pitcher.name)} <span class="tier t${tierOf(book)}" title="${tier.blurb}">${tier.name}</span></h3>
      <p class="muted small">${tier.blurb}</p>
      <h4>scouts' notes</h4>
      <ul class="notes">${scoutNotes.join('')}</ul>
      <h4>your notebook <small>${notes.seen} pitch${notes.seen === 1 ? '' : 'es'} seen</small></h4>
      ${notebook}
      <h4>his real tendencies</h4>
      ${bookHtml}
    </div>`
}

function revealPanel(): string {
  const s = state.session!
  const r = state.last!
  const p = r.pitch
  const ab = s.atBat
  const stands = ab.batter.stands
  const you = { pitch: state.pick.pitch!, way: state.pick.way! }
  const model = modelGuess(p)
  const lines = state.booth?.atBats[ab.id]
  const line = lines?.pitches[s.pitchIndex]
  const booth = line
    ? `<blockquote class="booth"><span>from the booth</span>${escape(line)}</blockquote>`
    : ''
  const wrap = s.atBatDone && lines?.wrap ? `<p class="wrap">${escape(lines.wrap)}</p>` : ''
  const ending = s.atBatDone
    ? `<div class="ending"><p class="eyebrow">at-bat over · ${escape(ab.result)}</p><p>${escape(ab.des)}</p>${wrap}</div>`
    : ''
  const nextLabel = s.done ? 'see how you did' : s.atBatDone ? 'next at-bat' : 'next pitch'
  const run = r.you.streak
  const hot = run >= HOT
    ? `<p class="streak hot">${run} reads in a row. double points until you miss</p>`
    : run > 0
      ? `<p class="streak">${run} in a row. ${HOT - run} more for double points</p>`
      : ''
  const cues = cuesFor(ab, p, tellsOf(ab), tierOf(bookFor(ab)))
  const showed = CUE_KINDS.map((k) => CUES[k].levels[cues[k]]).join(' · ')
  return `
    <div class="panel result">
      <div class="pitch-card" style="--c:${PITCHES[p.pitch].color}">
        <p class="eyebrow">pitch ${p.n} · ${p.count} count</p>
        <h2>${p.mph} <small>mph</small> ${escape(p.name.toLowerCase())}</h2>
        <p>${spot(p.zone, stands)} · <b>${describe(p.result)}</b>${p.spin ? ` · ${p.spin} rpm` : ''}</p>
      </div>
      ${compare(r, you, model, stands)}
      ${hot}
      <p class="showed"><small>he showed</small>${showed} <span class="muted">→ ${p.pitch}, in your notebook</span></p>
      ${booth}
      ${ending}
      <details class="model-odds">
        <summary>what the model saw coming</summary>
        ${odds(p)}
        <p class="muted small">the model only knows the situation, not his tells. shading on the zone is where it thought the pitch would go</p>
      </details>
      <div class="call-bar"><button class="primary" data-action="next">${nextLabel}</button></div>
    </div>`
}

// done

function renderDone(): string {
  const s = state.session!
  const t = s.totals()
  const won =
    t.you > t.model
      ? 'you beat the model'
      : t.you === t.model
        ? 'dead even'
        : 'the model wins this one'
  const rows = s.atBats
    .map(
      (ab, i) => `<li>
        <div class="who"><b>${escape(ab.pitcher.name)}</b> vs <b>${escape(ab.batter.name)}</b> <span class="muted">· ${escape(ab.result)}</span></div>
        <div class="squares you"><span>you</span>${s.results[i].map((r) => square(r.you)).join('')}</div>
        <div class="squares model"><span>model</span>${s.results[i].map((r) => square(r.model)).join('')}</div>
      </li>`,
    )
    .join('')
  const tag = state.mode === 'daily' ? `batter up #${dayNumber(state.today)}` : 'practice round'
  return `
    <section class="card done">
      <p class="eyebrow">${tag}</p>
      <h1>${won}</h1>
      <p class="score-line big">${scoreLine(t.you, t.model)}</p>
      <p class="muted center small">you read ${t.youRead} of ${t.pitches} pitches, the model ${t.modelRead}. best run ${t.best} in a row</p>
      <ol class="recap">${rows}</ol>
      <p class="legend"><span>${square({ pitch: true, way: true })} pitch and where</span><span>${square({ pitch: true, way: false })} one of them</span><span>${square({ pitch: false, way: false })} missed</span></p>
      ${state.mode === 'daily' ? shareButtons() : ''}
      <button class="primary" data-action="home">${state.mode === 'daily' ? 'back to the start' : 'play again'}</button>
    </section>`
}

// actions

function startGame(mode: 'daily' | 'practice'): void {
  state.mode = mode
  state.today = dayKey()
  const atBats =
    mode === 'daily'
      ? dailyAtBats(state.data.atBats, state.today, AT_BATS_PER_GAME)
      : deal(state.data.atBats, AT_BATS_PER_GAME, mulberry32(Math.floor(Math.random() * 2 ** 31)))
  state.session = new Session(atBats)
  state.phase = 'calling'
  state.pick = {}
  state.readDone = false
  state.last = null
  render()
  window.scrollTo({ top: 0 })
}

function choosePitch(pitch: PitchCall): void {
  if (state.phase !== 'calling') return
  state.pick.pitch = pitch
  render()
}

function chooseWay(way: Way): void {
  if (state.phase !== 'calling') return
  state.pick.way = way
  render()
}

/** ready: the call is in, so he throws it. the result shows once the ball gets there */
function lockIn(): void {
  const { pitch, way } = state.pick
  if (state.phase !== 'calling' || !pitch || !way) return
  const s = state.session!
  const ab = s.atBat
  // what he showed goes in your notebook with what it turned out to be
  const id = String(ab.pitcher.id)
  state.notes[id] = record(notesOn(ab), currentCues(), s.pitch.pitch)
  saveNotebook(state.notes)
  state.readDone = true
  state.last = s.call({ pitch, way })
  if (!stage || stageBroken) {
    state.phase = 'reveal'
    render()
    return
  }
  state.phase = 'pitching'
  render()
  const result = state.last
  const reveal = () => {
    if (state.phase !== 'pitching' || state.last !== result) return
    state.phase = 'reveal'
    render()
  }
  stage.throw(result.pitch, ab.pitcher.throws, ab.batter.stands, reveal)
  // the ballpark only draws while the tab is showing, so don't leave you waiting on it
  setTimeout(reveal, 6000)
}

function next(): void {
  if (state.phase !== 'reveal') return
  const s = state.session!
  if (!s.next()) {
    state.phase = 'done'
    if (state.mode === 'daily') saveResult(todaysResult())
  } else {
    state.phase = 'calling'
    state.pick = {}
    state.readDone = false
  }
  render()
  window.scrollTo({ top: 0 })
}

function todaysResult(): Result {
  const saved = loadResults()[state.today]
  if (saved && (!state.session || state.mode !== 'daily')) return saved
  return result(state.today, state.session!.results)
}

function note(text: string): void {
  const el = document.querySelector('.share-note')
  if (el) el.textContent = text
}

async function share(kind: 'text' | 'card'): Promise<void> {
  const r = todaysResult()
  try {
    if (kind === 'card') {
      note((await shareCard(r)) === 'shared' ? '' : 'image saved')
      return
    }
    const text = shareText(r)
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      note('copied')
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') note("couldn't share, sorry")
  }
}

function home(): void {
  state.phase = 'title'
  state.session = null
  render()
  window.scrollTo({ top: 0 })
}

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'daily') return startGame('daily')
  if (action === 'practice') return startGame('practice')
  if (action === 'home') return home()
  if (action === 'share-text') return void share('text')
  if (action === 'share-card') return void share('card')
  if (action === 'call') return lockIn()
  if (action === 'next') return next()
  if (action === 'replay') return stage?.replay()
  if (action === 'watch') return watchAgain()
  const pitch = target.closest<HTMLElement>('[data-pitch]')?.dataset.pitch
  if (pitch) return choosePitch(pitch as PitchCall)
  // only the zone you're calling on takes clicks, the one on the reveal is a picture
  const way = target.closest<HTMLElement>('.interactive [data-way]')?.dataset.way
  if (way) return chooseWay(way as Way)
})

// keys: letters for pitches (f s c l u h p), arrows for where, w to watch again, enter to go
window.addEventListener('keydown', (e) => {
  if (!state || e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'enter' || key === ' ') {
    // let a focused button do its own thing
    if ((e.target as HTMLElement).closest('button, summary, a')) return
    e.preventDefault()
    if (state.phase === 'calling') lockIn()
    else if (state.phase === 'reveal') next()
    return
  }
  if (key === 'r' && state.phase === 'reveal') return stage?.replay()
  if (key === 'w' && state.phase === 'calling') return watchAgain()
  const pitch = PITCH_ORDER.find((c) => PITCHES[c].key === key)
  if (pitch) return choosePitch(pitch)
  const way = ARROWS[e.key]
  if (way && state.phase === 'calling') {
    e.preventDefault()
    return chooseWay(way)
  }
})

boot()
