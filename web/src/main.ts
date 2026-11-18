import '@fontsource-variable/inter/wght.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './style.css'

import { PERFECT, Session, deal, describe, mulberry32, type Guess, type PitchResult } from './game'
import { shareCard } from './card'
import { dailyAtBats, dayKey, dayNumber, result, shareText, streak, type Result } from './daily'
import { loadResults, saveResult } from './store'
import { PITCHES, PITCH_ORDER, escape, ordinal, pct, spot, spotPhrase } from './labels'
import type { Replay } from './replay'
import type { AtBat, Commentary, GameData, ModelSummary, Pitch, PitchCall, Zone } from './types'
import { zoneGrid } from './zone'

const AT_BATS_PER_GAME = 3

type Phase = 'title' | 'calling' | 'reveal' | 'done'

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
// one webgl view for the whole visit, moved into each reveal. three.js starts loading in
// the background once you start playing, so the title screen stays small
let replay: Replay | null = null
let replayBroken = false
let replayModule: Promise<typeof import('./replay')> | null = null

function loadReplay(): Promise<typeof import('./replay')> {
  replayModule ??= import('./replay')
  return replayModule
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
    calling: renderCalling,
    reveal: renderReveal,
    done: renderDone,
  }[state.phase]()
  app.dataset.phase = state.phase
  app.innerHTML = banner + body
  if (state.phase === 'reveal') void mountReplay()
  if (state.phase === 'calling' && !replayBroken) void loadReplay().catch(() => undefined)
}

async function mountReplay(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#replay')
  const result = state.last
  if (!host || !result || replayBroken) return
  try {
    if (!replay) {
      const { Replay, webglAvailable } = await loadReplay()
      if (!webglAvailable()) throw new Error('no webgl here')
      replay = new Replay()
    }
    if (!host.isConnected || state.last !== result) return
    host.prepend(replay.canvas)
    host.classList.add('ready')
    replay.play(result.pitch, {
      you: state.pick.zone,
      model: result.pitch.model.call[1],
    })
  } catch (err) {
    console.warn('pitch replay is off:', err)
    replayBroken = true
    host.classList.add('flat')
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
        <li><b>read the situation</b><span>count, runners, score, and what he's thrown so far</span></li>
        <li><b>call the pitch</b><span>pick what's coming and where it crosses the plate</span></li>
        <li><b>watch it come in</b><span>see the real pitch, with the model's call next to yours</span></li>
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

function pitchPicker(ab: AtBat, selected?: PitchCall): string {
  const mix = mixFor(ab)
  const side = ab.batter.stands === 'L' ? 'lefties' : 'righties'
  const thrown = PITCH_ORDER.filter((c) => (mix[c] ?? 0) > 0).sort((a, b) => mix[b]! - mix[a]!)
  const never = PITCH_ORDER.filter((c) => !thrown.includes(c))
  const top = Math.max(...thrown.map((c) => mix[c]!), 0.01)
  const row = (c: PitchCall) => `
    <button class="pitch ${selected === c ? 'selected' : ''}" data-pitch="${c}"
      style="--c:${PITCHES[c].color}" aria-pressed="${selected === c}">
      <span class="swatch"></span>
      <span class="name">${c}</span>
      <span class="bar"><i style="width:${((mix[c] ?? 0) / top) * 100}%"></i></span>
      <span class="pct">${pct(mix[c] ?? 0)}</span>
      <kbd>${PITCHES[c].key}</kbd>
    </button>`
  const rare = never.length
    ? `<div class="never"><span class="muted small">never thrown to ${side}</span>${never
        .map(
          (c) => `<button class="pitch mini ${selected === c ? 'selected' : ''}" data-pitch="${c}"
            style="--c:${PITCHES[c].color}" aria-pressed="${selected === c}">${c}</button>`,
        )
        .join('')}</div>`
    : ''
  const note = thrown.length
    ? `how often he's thrown each one to ${side} before today`
    : 'no history yet, this is the first time we see him'
  return `<p class="note">${note}</p><div class="pitches">${thrown.map(row).join('')}</div>${rare}`
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

function renderCalling(): string {
  const s = state.session!
  const ab = s.atBat
  const { pitch, zone } = state.pick
  const stands = ab.batter.stands
  const callLabel =
    pitch && zone
      ? `call it: ${pitch}, ${spotPhrase(zone, stands)}`
      : pitch
        ? 'now pick a spot'
        : zone
          ? 'now pick a pitch'
          : 'pick a pitch and a spot'
  return `
    ${scorebug(ab, s.pitch)}
    ${matchup(ab)}
    <h2 class="ask">pitch ${s.pitch.n}, ${s.pitch.count} count. what's coming?</h2>
    <section class="board calling">
      <div class="panel step ${pitch ? 'done' : ''}">
        <h3><span class="num">1</span> pick the pitch ${pitch ? `<em>${pitch}</em>` : ''}</h3>
        ${pitchPicker(ab, pitch)}
      </div>
      <div class="panel step spot ${zone ? 'done' : ''}">
        <h3><span class="num">2</span> pick the spot ${zone ? `<em>${spotPhrase(zone, stands)}</em>` : ''}</h3>
        <p class="note">you're behind the catcher. tap a box in the zone, or chase if it misses</p>
        ${zoneGrid({ selected: zone, history: s.history, stands }, true)}
        <button class="chase-button ${zone === 'chase' ? 'selected' : ''}" data-zone="chase" aria-pressed="${zone === 'chase'}">
          <b>chase</b><span>out of the zone, to get a swing</span><kbd>0</kbd>
        </button>
      </div>
      <div class="panel so-far ${s.history.length ? '' : 'empty'}">
        <h3>this at-bat so far</h3>
        ${pitchLog(ab, s.history, s.results[s.atBatIndex])}
      </div>
    </section>
    <div class="call-bar">
      <button class="primary" data-action="call" ${pitch && zone ? '' : 'disabled'}>${callLabel}</button>
    </div>`
}

// reveal

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

function renderReveal(): string {
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
  const flat = zoneGrid(
    { you: you.zone, model: model.zone, heat: p.model.zone, pitch: p, history: s.history, stands },
    false,
  )
  return `
    ${scorebug(ab, p)}
    ${matchup(ab)}
    <section class="board reveal">
      <div class="stage">
        <div class="replay ${replayBroken ? 'flat' : ''}" id="replay">
          <button class="replay-again" data-action="replay" aria-label="replay the pitch">↻ replay</button>
          <span class="replay-legend"><i class="you"></i>your spot <i class="model"></i>model's spot</span>
          <span class="replay-batter ${stands === 'R' ? 'left' : 'right'}">${stands === 'R' ? 'righty' : 'lefty'} batter</span>
          <div class="replay-flat">${flat}<p class="muted small center">shading is where the model thought it was going</p></div>
        </div>
        <div class="panel model-odds">
          <h3>what the model saw coming</h3>
          ${odds(p)}
        </div>
      </div>
      <div class="result">
        <div class="pitch-card" style="--c:${PITCHES[p.pitch].color}">
          <p class="eyebrow">pitch ${p.n} · ${p.count} count</p>
          <h2>${p.mph} <small>mph</small> ${escape(p.name.toLowerCase())}</h2>
          <p>${spotPhrase(p.zone, stands)} · <b>${describe(p.result)}</b>${p.spin ? ` · ${p.spin} rpm` : ''}</p>
        </div>
        <p class="verdict ${r.you.points === PERFECT ? 'perfect' : r.you.points ? 'part' : 'miss'}">
          <b>+${r.you.points}</b> ${verdictLine(r.you)}
        </p>
        ${compare(r, you, model, stands)}
        ${booth}
        ${ending}
        <div class="call-bar">
          <button class="primary" data-action="next">${nextLabel}</button>
        </div>
      </div>
    </section>`
}

// done

function renderDone(): string {
  const s = state.session!
  const t = s.totals()
  const won =
    t.you > t.model ? 'you beat the model' : t.you === t.model ? 'dead even' : 'the model wins this one'
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
  state.pick = {}
  state.last = null
  render()
  window.scrollTo({ top: 0 })
}

function choosePitch(pitch: PitchCall): void {
  if (state.phase !== 'calling') return
  const first = !state.pick.pitch && !state.pick.zone
  state.pick.pitch = pitch
  render()
  // on a phone the zone is below the fold, so bring it up after the first pick
  if (first && matchMedia('(max-width: 760px)').matches) {
    document.querySelector('.step.spot')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function chooseZone(zone: Zone): void {
  if (state.phase !== 'calling') return
  state.pick.zone = zone
  render()
}

function lockIn(): void {
  const { pitch, zone } = state.pick
  if (state.phase !== 'calling' || !pitch || !zone) return
  state.last = state.session!.call({ pitch, zone })
  state.phase = 'reveal'
  render()
  window.scrollTo({ top: 0 })
}

function next(): void {
  if (state.phase !== 'reveal') return
  if (!state.session!.next()) {
    state.phase = 'done'
    if (state.mode === 'daily') saveResult(todaysResult())
  } else {
    state.phase = 'calling'
    state.pick = {}
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
  if (action === 'replay') return replay?.replay()
  const pitch = target.closest<HTMLElement>('[data-pitch]')?.dataset.pitch
  if (pitch) return choosePitch(pitch as PitchCall)
  // only the live zone takes clicks, the one on the reveal is a picture
  const zone = target.closest<HTMLElement>('.interactive [data-zone], .interactive[data-zone], .chase-button')
    ?.dataset.zone
  if (zone) return chooseZone(zone as Zone)
})

// keys: letters for pitches (f s c l u h p), 1-9 for zones, 0 for chase, enter to go
window.addEventListener('keydown', (e) => {
  if (!state || e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'enter' || key === ' ') {
    e.preventDefault()
    if (state.phase === 'calling') lockIn()
    else if (state.phase === 'reveal') next()
    return
  }
  const pitch = PITCH_ORDER.find((c) => PITCHES[c].key === key)
  if (pitch) return choosePitch(pitch)
  if (/^[1-9]$/.test(key)) return chooseZone(key as Zone)
  if (key === '0') return chooseZone('chase')
})

boot()
