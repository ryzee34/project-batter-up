import './style.css'

import { PERFECT, Session, deal, describe, mulberry32, type Guess, type PitchResult } from './game'
import { PITCHES, PITCH_ORDER, escape, ordinal, pct, zoneLabel } from './labels'
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
  phase: Phase
  pick: Partial<Guess>
  last: PitchResult | null
}

const app = document.querySelector<HTMLElement>('#app')!
let state: State
// one webgl view for the whole visit, moved into each reveal. three.js only loads when
// the first pitch is revealed, so the calling screen stays light
let replay: Replay | null = null
let replayBroken = false

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
    state = { data, summary, booth, session: null, phase: 'title', pick: {}, last: null }
    render()
  } catch (err) {
    app.innerHTML = `<section class="card"><h1>batter up</h1><p>couldn't load the at-bats (${escape(String(err))})</p></section>`
  }
}

// rendering

function render(): void {
  const banner = state.data.synthetic
    ? `<p class="banner">practice data: these at-bats come from a made up league, not real dodgers games yet</p>`
    : ''
  const body = {
    title: renderTitle,
    calling: renderCalling,
    reveal: renderReveal,
    done: renderDone,
  }[state.phase]()
  app.innerHTML = banner + body
  if (state.phase === 'reveal') void mountReplay()
}

async function mountReplay(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#replay')
  const result = state.last
  if (!host || !result) return
  if (replayBroken) return host.remove()
  try {
    if (!replay) {
      const { Replay, webglAvailable } = await import('./replay')
      if (!webglAvailable()) throw new Error('no webgl here')
      replay = new Replay()
    }
    if (!host.isConnected || state.last !== result) return
    host.prepend(replay.canvas)
    host.classList.add('ready')
    replay.play(result.pitch, state.session!.atBat.batter.stands, {
      you: state.pick.zone,
      model: result.pitch.model.call[1],
    })
  } catch (err) {
    console.warn('pitch replay is off:', err)
    replayBroken = true
    host.remove()
  }
}

function renderTitle(): string {
  const s = state.summary
  const beat = s
    ? `<p>the model gets the pitch type right <b>${pct(s.model.pitch_type)}</b> of the time on a season it never saw. picking a pitcher's favorite pitch gets <b>${pct(s.baseline.pitch_type)}</b>.</p>`
    : ''
  return `
    <section class="card title">
      <h1>batter up</h1>
      <p class="lede">call the next pitch in real ${escape(state.data.team)} at-bats from ${state.data.season}, before it's thrown.</p>
      <p>you get the count, the runners, the score, the scouting report and every pitch so far. pick the pitch type and where it's going. a model trained on every pitch since 2023 calls it at the same time.</p>
      ${beat}
      <p class="rules">pitch type ${2} · zone ${1} · both ${PERFECT}</p>
      <button class="primary" data-action="play">play ${AT_BATS_PER_GAME} at-bats</button>
    </section>`
}

function scoreboard(ab: AtBat, p: Pitch): string {
  const [balls, strikes] = p.count.split('-').map(Number)
  const lights = (n: number, of: number, cls: string) =>
    Array.from({ length: of }, (_, i) => `<i class="light ${cls} ${i < n ? 'on' : ''}"></i>`).join('')
  const bases = ab.runners
    .map((on, i) => `<i class="base b${i + 1} ${on ? 'on' : ''}" title="${ordinal(i + 1)}"></i>`)
    .join('')
  const pitching = `${ab.team} ${ab.score.pitching}`
  const batting = `${ab.opponent} ${ab.score.batting}`
  return `
    <header class="scoreboard">
      <div class="inning">${ab.half === 'top' ? '▲' : '▼'} ${ordinal(ab.inning)}</div>
      <div class="score">${ab.home ? `${batting} · ${pitching}` : `${pitching} · ${batting}`}</div>
      <div class="diamond">${bases}</div>
      <div class="count">
        <span>b ${lights(balls, 3, 'ball')}</span>
        <span>s ${lights(strikes, 2, 'strike')}</span>
        <span>o ${lights(ab.outs, 2, 'out')}</span>
      </div>
      <div class="date">${ab.date}</div>
    </header>`
}

function scouting(ab: AtBat): string {
  const mix = Object.keys(ab.pitcher.mixVsSide).length ? ab.pitcher.mixVsSide : ab.pitcher.mix
  const rows = PITCH_ORDER.filter((c) => (mix[c] ?? 0) > 0)
    .sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0))
    .map(
      (c) => `
      <div class="bar-row">
        <span>${c}</span>
        <span class="bar"><i style="width:${(mix[c] ?? 0) * 100}%;background:${PITCHES[c].color}"></i></span>
        <span>${pct(mix[c] ?? 0)}</span>
      </div>`,
    )
    .join('')
  const side = ab.batter.stands === 'L' ? 'lefties' : 'righties'
  return `
    <div class="matchup">
      <div><b>${escape(ab.pitcher.name)}</b> <span class="muted">${ab.pitcher.throws}HP, ${ab.pitcher.pitchesToday} pitches today</span></div>
      <div>vs <b>${escape(ab.batter.name)}</b> <span class="muted">bats ${ab.batter.stands}</span></div>
      <div class="scouting">
        <p class="muted">his mix vs ${side} before today</p>
        ${rows || '<p class="muted">no history, first time we see him</p>'}
      </div>
    </div>`
}

function pitchLog(history: Pitch[], results: PitchResult[]): string {
  if (!history.length) return '<ol class="log"><li class="muted">first pitch of the at-bat</li></ol>'
  const items = history
    .map((p, i) => {
      const r = results[i]
      return `<li>
        <span class="n">${p.n}</span>
        <span class="chip" style="--c:${PITCHES[p.pitch].color}">${PITCHES[p.pitch].short}</span>
        ${p.mph} · ${zoneLabel(p.zone)} · ${describe(p.result)}
        <span class="marks">${r ? mark(r) : ''}</span>
      </li>`
    })
    .join('')
  return `<ol class="log">${items}</ol>`
}

function mark(r: PitchResult): string {
  const square = (points: number) => (points === PERFECT ? '🟩' : points > 0 ? '🟨' : '⬜')
  return `<span title="you ${r.you.points}, model ${r.model.points}">${square(r.you.points)}${square(r.model.points)}</span>`
}

function pitchButtons(ab: AtBat, selected?: PitchCall): string {
  const mix = ab.pitcher.mix
  const order = [...PITCH_ORDER].sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0))
  return order
    .map((c) => {
      const share = mix[c] ?? 0
      return `<button class="pitch ${selected === c ? 'selected' : ''} ${share === 0 ? 'rare' : ''}"
        data-pitch="${c}" style="--c:${PITCHES[c].color}">
        <b>${c}</b><small>${share ? pct(share) : 'never'}</small>
      </button>`
    })
    .join('')
}

function renderCalling(): string {
  const s = state.session!
  const ab = s.atBat
  const ready = state.pick.pitch && state.pick.zone
  return `
    ${scoreboard(ab, s.pitch)}
    <section class="board">
      <div class="left">
        ${scouting(ab)}
        <h2>this at-bat</h2>
        ${pitchLog(s.history, s.results[s.atBatIndex])}
      </div>
      <div class="right">
        <h2>pitch ${s.pitch.n}, ${s.pitch.count} count. what's coming?</h2>
        <div class="pitches">${pitchButtons(ab, state.pick.pitch)}</div>
        ${zoneGrid({ selected: state.pick.zone, history: s.history, stands: ab.batter.stands }, true)}
        <p class="muted hint">catcher's view. tap the box for a zone, the frame for a chase</p>
        <button class="primary" data-action="call" ${ready ? '' : 'disabled'}>
          ${ready ? `call ${state.pick.pitch}, ${zoneLabel(state.pick.zone!)}` : 'pick a pitch and a spot'}
        </button>
      </div>
    </section>`
}

function verdict(label: string, guess: Guess, points: number): string {
  return `<div class="verdict ${points === PERFECT ? 'perfect' : points ? 'part' : 'miss'}">
    <span>${label}</span><b>${guess.pitch}, ${zoneLabel(guess.zone)}</b><span class="pts">+${points}</span>
  </div>`
}

function odds(p: Pitch): string {
  const calls = state.data.pitchCalls
  return calls
    .map((c, i) => ({ c, v: p.model.pitch[i] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(
      ({ c, v }) => `
      <div class="bar-row ${c === p.pitch ? 'hit' : ''}">
        <span>${c}</span>
        <span class="bar"><i style="width:${v * 100}%;background:${PITCHES[c].color}"></i></span>
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
  const you = { pitch: state.pick.pitch!, zone: state.pick.zone! }
  const model = { pitch: p.model.call[0], zone: p.model.call[1] }
  const lines = state.booth?.atBats[ab.id]
  const line = lines?.pitches[s.pitchIndex]
  const booth = line ? `<blockquote class="booth">${escape(line)}</blockquote>` : ''
  const wrap = s.atBatDone && lines?.wrap ? `<blockquote class="booth">${escape(lines.wrap)}</blockquote>` : ''
  const ending = s.atBatDone ? `<p class="ending">${escape(ab.des)}</p>${wrap}` : ''
  const nextLabel = s.done ? 'see how you did' : s.atBatDone ? 'next at-bat' : 'next pitch'
  return `
    ${scoreboard(ab, p)}
    <section class="board">
      <div class="left">
        <div class="truth" style="--c:${PITCHES[p.pitch].color}">
          <span class="muted">pitch ${p.n}</span>
          <h2>${p.mph} mph ${escape(p.name.toLowerCase())}, ${zoneLabel(p.zone)}</h2>
          <p>${describe(p.result)}${p.spin ? ` · ${p.spin} rpm` : ''}</p>
        </div>
        ${booth}
        ${verdict('you', you, r.you.points)}
        ${verdict('model', model, r.model.points)}
        <h3>what the model saw coming</h3>
        ${odds(p)}
        ${ending}
        <button class="primary" data-action="next">${nextLabel}</button>
      </div>
      <div class="right">
        <div class="replay" id="replay">
          <button class="replay-again" data-action="replay" aria-label="replay the pitch">↻ replay</button>
          <span class="replay-legend"><i class="you"></i>you <i class="model"></i>model</span>
        </div>
        <div class="mini">
        ${zoneGrid(
          {
            you: you.zone,
            model: model.zone,
            heat: p.model.zone,
            pitch: p,
            history: s.history,
            stands: ab.batter.stands,
          },
          false,
        )}
        </div>
        <p class="muted hint">shading is where the model thought it was going</p>
      </div>
    </section>`
}

function renderDone(): string {
  const s = state.session!
  const t = s.totals()
  const won = t.you > t.model ? 'you beat the model' : t.you === t.model ? 'dead even' : 'the model wins this one'
  const rows = s.atBats
    .map(
      (ab, i) => `<li><b>${escape(ab.pitcher.name)}</b> vs ${escape(ab.batter.name)}
        <span class="grid">${s.results[i].map(mark).join(' ')}</span>
        <span class="muted">${escape(ab.result)}</span></li>`,
    )
    .join('')
  return `
    <section class="card">
      <h1>${won}</h1>
      <p class="final"><b>${t.you}</b> to <b>${t.model}</b> <span class="muted">out of ${t.perfect}</span></p>
      <p class="muted">left square is you, right is the model. 🟩 nailed it · 🟨 half right · ⬜ missed</p>
      <ol class="recap">${rows}</ol>
      <button class="primary" data-action="play">play again</button>
    </section>`
}

// actions

function startGame(): void {
  const seed = Math.floor(Math.random() * 2 ** 31)
  state.session = new Session(deal(state.data.atBats, AT_BATS_PER_GAME, mulberry32(seed)))
  state.phase = 'calling'
  state.pick = {}
  state.last = null
  render()
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

function lockIn(): void {
  const { pitch, zone } = state.pick
  if (state.phase !== 'calling' || !pitch || !zone) return
  state.last = state.session!.call({ pitch, zone })
  state.phase = 'reveal'
  render()
}

function next(): void {
  if (state.phase !== 'reveal') return
  if (!state.session!.next()) {
    state.phase = 'done'
  } else {
    state.phase = 'calling'
    state.pick = {}
  }
  render()
  window.scrollTo({ top: 0 })
}

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'play') return startGame()
  if (action === 'call') return lockIn()
  if (action === 'next') return next()
  if (action === 'replay') return replay?.replay()
  const pitch = target.closest<HTMLElement>('[data-pitch]')?.dataset.pitch
  if (pitch) return choosePitch(pitch as PitchCall)
  const zone = target.closest<HTMLElement>('[data-zone]')?.dataset.zone
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
    else startGame()
    return
  }
  const pitch = PITCH_ORDER.find((c) => PITCHES[c].key === key)
  if (pitch) return choosePitch(pitch)
  if (/^[1-9]$/.test(key)) return chooseZone(key as Zone)
  if (key === '0') return chooseZone('chase')
})

boot()
