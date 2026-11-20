import '@fontsource-variable/inter/wght.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './style.css'

import { PERFECT, Session, deal, describe, mulberry32, type Guess, type PitchResult } from './game'
import { shareCard } from './card'
import { dailyAtBats, dayKey, dayNumber, result, shareText, streak, type Result } from './daily'
import { loadResults, saveResult } from './store'
import { PITCHES, PITCH_ORDER, escape, ordinal, pct, spot } from './labels'
import type { Stage } from './stage'
import type { AtBat, Commentary, GameData, ModelSummary, Pitch, PitchCall, Zone } from './types'
import { zoneGrid } from './zone'

const AT_BATS_PER_GAME = 3
// arrows point at the side of the zone a chase misses on, as the catcher sees it
const ARROWS: Record<string, Zone> = {
  ArrowUp: 'chase_up',
  ArrowDown: 'chase_down',
  ArrowLeft: 'chase_left',
  ArrowRight: 'chase_right',
}

/** calling: you're picking. pitching: the windup and the throw. reveal: how you did */
type Phase = 'title' | 'calling' | 'pitching' | 'reveal' | 'done'

interface State {
  data: GameData
  summary: ModelSummary | null
  booth: Commentary | null
  session: Session | null
  mode: 'daily' | 'practice'
  today: string
  phase: Phase
  pick: Partial<Guess>
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
  const ab = session.atBat
  const key = `${ab.id}:${session.pitch.n}`
  if (state.phase === 'calling' && staged !== key) {
    s.ready(session.pitch, ab.pitcher.throws, ab.batter.stands)
    staged = key
  }
}

/** line the clickable zone up with the one in the ballpark */
function placeZone(): void {
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
    const [data, summary, booth] = await Promise.all([
      load<GameData>('atbats.json'),
      load<ModelSummary>('model.json').catch(() => null),
      // claude's lines are optional, the game plays fine without them
      load<Commentary>('commentary.json').catch(() => null),
    ])
    state = {
      data,
      summary,
      booth,
      session: null,
      mode: 'daily',
      today: dayKey(),
      phase: 'title',
      pick: {},
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
      <p class="lede">call the next pitch in real at-bats, before it's thrown. a model calls it too. try to beat it.</p>
      <ol class="how">
        <li><b>tap where it's going</b><span>right on the zone, or around it for a chase. his go-to pitch is already picked, change it if you know better</span></li>
        <li><b>hit ready</b><span>he winds up and throws the real pitch, on its real path</span></li>
        <li><b>see who called it</b><span>you, the model, or neither</span></li>
      </ol>
      ${stats}
      <p class="rules"><span><b>2</b> right pitch</span><span><b>1</b> right spot</span><span><b>+1</b> both</span><span class="muted">${PERFECT} is perfect</span></p>
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

/** his mix against this side of the plate, or overall when he has no history vs them */
function mixFor(ab: AtBat): Partial<Record<PitchCall, number>> {
  return Object.keys(ab.pitcher.mixVsSide).length ? ab.pitcher.mixVsSide : ab.pitcher.mix
}

/** his go-to pitch, which your call starts on so all you have to pick is the spot */
function favorite(ab: AtBat): PitchCall {
  const mix = mixFor(ab)
  const thrown = PITCH_ORDER.filter((c) => (mix[c] ?? 0) > 0)
  if (!thrown.length) return 'fastball'
  return thrown.reduce((a, b) => (mix[b]! > mix[a]! ? b : a))
}

function pitchPicker(ab: AtBat, selected: PitchCall | undefined, locked: boolean): string {
  const mix = mixFor(ab)
  const side = ab.batter.stands === 'L' ? 'lefties' : 'righties'
  const thrown = PITCH_ORDER.filter((c) => (mix[c] ?? 0) > 0).sort((a, b) => mix[b]! - mix[a]!)
  const shown = thrown.length ? thrown : PITCH_ORDER
  const never = PITCH_ORDER.filter((c) => !shown.includes(c))
  const chip = (c: PitchCall, mini = false) => `
    <button class="pitch ${mini ? 'mini' : ''} ${selected === c ? 'selected' : ''}" data-pitch="${c}"
      style="--c:${PITCHES[c].color}" aria-pressed="${selected === c}" ${locked ? 'disabled' : ''}>
      <span class="swatch"></span><span class="name">${c}</span>
      ${mini ? '' : `<span class="pct">${pct(mix[c] ?? 0)}</span>`}
      <kbd>${PITCHES[c].key}</kbd>
    </button>`
  const rare = never.length
    ? `<details class="never"><summary>${never.length} he's never thrown to ${side}</summary>
        <div class="pitches">${never.map((c) => chip(c, true)).join('')}</div></details>`
    : ''
  return `<div class="pitches">${shown.map((c) => chip(c)).join('')}</div>${rare}`
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
        ${r ? `<span class="marks" title="you ${r.you.points}, model ${r.model.points}">${square(r.you.points)}${square(r.model.points)}</span>` : ''}
      </li>`
    })
    .join('')
  return `<ol class="log">${items}</ol>`
}

function square(points: number): string {
  return `<i class="sq ${points === PERFECT ? 'full' : points > 0 ? 'part' : 'none'}"></i>`
}

function compare(r: PitchResult, you: Guess, model: Guess, stands: 'L' | 'R'): string {
  const p = r.pitch
  const cell = (text: string, right: boolean) =>
    `<td class="${right ? 'right' : 'wrong'}"><span class="mark">${right ? '✓' : '✗'}</span>${text}</td>`
  const row = (who: 'you' | 'model', g: Guess, grade: PitchResult['you']) => `
    <tr class="${who}">
      <th>${who}</th>
      ${cell(g.pitch, grade.pitch)}
      ${cell(spot(g.zone, stands), grade.zone)}
      <td class="pts ${grade.points === PERFECT ? 'perfect' : grade.points ? 'some' : ''}">+${grade.points}</td>
    </tr>`
  return `
    <table class="compare">
      <thead><tr><th></th><th>pitch</th><th>spot</th><th>pts</th></tr></thead>
      <tbody>
        <tr class="actual"><th>actual</th><td>${p.pitch}</td><td>${spot(p.zone, stands)}</td><td></td></tr>
        ${row('you', you, r.you)}
        ${row('model', model, r.model)}
      </tbody>
    </table>`
}

function verdictLine(g: PitchResult['you']): string {
  if (g.points === PERFECT) return 'nailed it'
  if (g.pitch) return 'right pitch, wrong spot'
  if (g.zone) return 'right spot, wrong pitch'
  return 'missed this one'
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
        ${stageHud()}
      </div>
      <aside class="side">${reveal ? revealPanel() : callPanel()}</aside>
    </section>`
}

function overlay(): string {
  const s = state.session!
  const stands = s.atBat.batter.stands
  if (state.phase === 'reveal') {
    const r = state.last!
    return zoneGrid(
      {
        you: state.pick.zone,
        model: r.pitch.model.call[1],
        heat: r.pitch.model.zone,
        pitch: r.pitch,
        history: s.history,
        stands,
      },
      false,
    )
  }
  return zoneGrid(
    {
      selected: state.pick.zone,
      you: state.phase === 'pitching' ? state.pick.zone : undefined,
      history: s.history,
      stands,
    },
    state.phase === 'calling',
  )
}

function stageHud(): string {
  if (state.phase === 'calling') {
    return state.pick.zone
      ? ''
      : `<p class="stage-hint"><b>tap where it crosses the plate</b><span>in the zone, or around it for a chase</span></p>`
  }
  if (state.phase === 'pitching') {
    return `<p class="stage-toast">here it comes</p>`
  }
  const r = state.last!
  const grade = r.you.points === PERFECT ? 'perfect' : r.you.points ? 'part' : 'miss'
  return `
    <p class="stage-flash ${grade}"><b>+${r.you.points}</b>${verdictLine(r.you)}</p>
    <button class="stage-replay" data-action="replay" aria-label="replay the pitch">↻ replay</button>
    <span class="stage-legend"><i class="you"></i>you <i class="model"></i>model</span>`
}

function callPanel(): string {
  const s = state.session!
  const ab = s.atBat
  const stands = ab.batter.stands
  const { pitch, zone } = state.pick
  const locked = state.phase === 'pitching'
  const call = pitch
    ? `<span class="call-pitch" style="--c:${PITCHES[pitch].color}">${pitch}</span>`
    : '<span class="muted">pick a pitch</span>'
  const where = zone
    ? `<span class="call-spot">${spot(zone, stands)}</span>`
    : '<span class="muted">tap the zone</span>'
  const button = locked
    ? `<button class="primary ready" disabled>watch the pitch…</button>`
    : pitch && zone
      ? `<button class="primary ready" data-action="call">ready <small>${pitch} · ${spot(zone, stands)}</small></button>`
      : `<button class="primary ready" disabled>tap a spot first</button>`
  return `
    <div class="panel call ${locked ? 'locked' : ''}">
      <p class="eyebrow">pitch ${s.pitch.n} · ${s.pitch.count} count</p>
      <h2 class="ask">what's coming?</h2>
      <p class="your-call"><small>your call</small>${call}${where}</p>
      <div class="pitch-pick">
        <p class="note">his go-to is picked. switch if you know better</p>
        ${pitchPicker(ab, pitch, locked)}
      </div>
      <div class="call-bar">${button}</div>
      <p class="keys"><kbd>1</kbd>–<kbd>9</kbd> zone <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> chase <kbd>enter</kbd> ready</p>
    </div>
    <div class="panel so-far ${s.history.length ? '' : 'empty'}">
      <h3>this at-bat so far</h3>
      ${pitchLog(ab, s.history, s.results[s.atBatIndex])}
    </div>`
}

function revealPanel(): string {
  const s = state.session!
  const r = state.last!
  const p = r.pitch
  const ab = s.atBat
  const stands = ab.batter.stands
  const you = { pitch: state.pick.pitch!, zone: state.pick.zone! }
  const model = { pitch: p.model.call[0], zone: p.model.call[1] }
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
  return `
    <div class="panel result">
      <div class="pitch-card" style="--c:${PITCHES[p.pitch].color}">
        <p class="eyebrow">pitch ${p.n} · ${p.count} count</p>
        <h2>${p.mph} <small>mph</small> ${escape(p.name.toLowerCase())}</h2>
        <p>${spot(p.zone, stands)} · <b>${describe(p.result)}</b>${p.spin ? ` · ${p.spin} rpm` : ''}</p>
      </div>
      ${compare(r, you, model, stands)}
      ${booth}
      ${ending}
      <details class="model-odds">
        <summary>what the model saw coming</summary>
        ${odds(p)}
        <p class="muted small">shading on the zone is where it thought the pitch would go</p>
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
        <div class="squares you"><span>you</span>${s.results[i].map((r) => square(r.you.points)).join('')}</div>
        <div class="squares model"><span>model</span>${s.results[i].map((r) => square(r.model.points)).join('')}</div>
      </li>`,
    )
    .join('')
  const tag = state.mode === 'daily' ? `batter up #${dayNumber(state.today)}` : 'practice round'
  return `
    <section class="card done">
      <p class="eyebrow">${tag}</p>
      <h1>${won}</h1>
      <p class="score-line big">${scoreLine(t.you, t.model)}</p>
      <p class="muted center small">out of ${t.perfect} possible, over ${t.pitches} pitches</p>
      <ol class="recap">${rows}</ol>
      <p class="legend"><span>${square(PERFECT)} pitch and spot</span><span>${square(2)} part right</span><span>${square(0)} missed</span></p>
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
  state.pick = { pitch: favorite(state.session.atBat) }
  state.last = null
  render()
  window.scrollTo({ top: 0 })
}

function choosePitch(pitch: PitchCall): void {
  if (state.phase !== 'calling') return
  state.pick.pitch = pitch
  render()
}

function chooseZone(zone: Zone): void {
  if (state.phase !== 'calling') return
  state.pick.zone = zone
  render()
}

/** ready: the call is in, so he throws it. the result shows once the ball gets there */
function lockIn(): void {
  const { pitch, zone } = state.pick
  if (state.phase !== 'calling' || !pitch || !zone) return
  const s = state.session!
  const ab = s.atBat
  state.last = s.call({ pitch, zone })
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
    state.pick = { pitch: favorite(s.atBat) }
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
  const pitch = target.closest<HTMLElement>('[data-pitch]')?.dataset.pitch
  if (pitch) return choosePitch(pitch as PitchCall)
  // only the zone you're calling on takes clicks, the one on the reveal is a picture
  const zone = target.closest<HTMLElement>('.interactive [data-zone]')?.dataset.zone
  if (zone) return chooseZone(zone as Zone)
})

// keys: letters for pitches (f s c l u h p), 1-9 for zones, arrows for a chase, enter to go
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
  const pitch = PITCH_ORDER.find((c) => PITCHES[c].key === key)
  if (pitch) return choosePitch(pitch)
  if (/^[1-9]$/.test(key)) return chooseZone(key as Zone)
  const chase = ARROWS[e.key]
  if (chase && state.phase === 'calling') {
    e.preventDefault()
    return chooseZone(chase)
  }
})

boot()
