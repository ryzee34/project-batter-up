"""a made up league that writes the same csvs savant does, for practice and for ci.

the real pull is about 800 requests and a few gigabytes, which is too much for ci and for
working on the model or the game without network access. this fakes whole seasons with
the habits real pitchers have (fastballs when behind, breaking balls when ahead, a put
away pitch with two strikes, sliders to same side hitters, changeups to opposite side
ones) so the model has something real-ish to find and every later step can run end to
end. nobody in here is a real player: pitchers are named like "LAD Arm 3".

    BATTER_UP_DATA=data/synthetic uv run batter-up synth
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from batter_up.data.pitches import KEEP

TEAMS = ["LAD", "SF", "SD", "ARI", "COL", "NYY", "ATL", "HOU", "CHC", "PHI"]

# savant code, display name, mph, spin, accelerations in ft/s^2 for a righty seen from
# the catcher (x to his right, z up). lefties mirror x
PITCHES: dict[str, tuple[str, str, float, float, float, float]] = {
    "fastball": ("FF", "4-Seam Fastball", 95.0, 2300, -9.0, -15.0),
    "sinker": ("SI", "Sinker", 94.0, 2150, -16.0, -24.0),
    "cutter": ("FC", "Cutter", 90.0, 2400, 4.0, -26.0),
    "slider": ("SL", "Slider", 86.0, 2500, 9.0, -34.0),
    "curveball": ("CU", "Curveball", 80.0, 2650, 6.0, -45.0),
    "changeup": ("CH", "Changeup", 86.0, 1750, -14.0, -29.0),
    "splitter": ("FS", "Split-Finger", 87.0, 1350, -9.0, -35.0),
}
BREAKING = {"slider", "curveball", "cutter"}
OFFSPEED = {"changeup", "splitter"}
HARD = {"fastball", "sinker"}

ZONE_HALF_WIDTH = 0.83  # ft, half the plate plus a ball
GRAVITY = -32.174


@dataclass
class Pitcher:
    id: int
    team: str
    name: str
    throws: str
    starter: bool
    arsenal: dict[str, float]  # call -> base logit
    putaway: str


@dataclass
class Batter:
    id: int
    team: str
    name: str
    stands: str  # L, R or S


@dataclass
class Team:
    code: str
    starters: list[Pitcher]
    bullpen: list[Pitcher]
    lineup: list[Batter]
    rotation: int = 0


@dataclass
class League:
    teams: dict[str, Team] = field(default_factory=dict)


def make_league(rng: np.random.Generator) -> League:
    league = League()
    pid, bid = 600000, 700000
    for code in TEAMS:
        pitchers = []
        for n in range(1, 12):
            pid += 1
            throws = "L" if rng.random() < 0.3 else "R"
            primary = "fastball" if rng.random() < 0.65 else "sinker"
            pool = ["cutter", "slider", "curveball", "changeup", "splitter"]
            extra = list(rng.choice(pool, size=int(rng.integers(2, 5)), replace=False))
            if primary == "sinker" and rng.random() < 0.5:
                extra.append("fastball")
            arsenal = {primary: 1.2}
            for call in extra:
                arsenal[str(call)] = float(rng.normal(0.0, 0.5))
            putaway = str(max(extra, key=lambda c: arsenal[str(c)]))
            pitchers.append(
                Pitcher(pid, code, f"Arm {n}, {code}", throws, n <= 5, arsenal, putaway)
            )
        lineup = []
        for n in range(1, 14):
            bid += 1
            stands = str(rng.choice(["L", "R", "S"], p=[0.38, 0.52, 0.10]))
            lineup.append(Batter(bid, code, f"{code} Bat {n}", stands))
        league.teams[code] = Team(code, pitchers[:5], pitchers[5:], lineup)
    return league


def _softmax_pick(rng: np.random.Generator, logits: dict) -> str:
    keys = list(logits)
    values = np.array([logits[k] for k in keys])
    p = np.exp(values - values.max())
    return keys[int(rng.choice(len(keys), p=p / p.sum()))]


def choose_pitch(
    rng: np.random.Generator,
    pitcher: Pitcher,
    balls: int,
    strikes: int,
    same_side: bool,
    prev: str | None,
) -> str:
    logits = {}
    for call, base in pitcher.arsenal.items():
        x = base
        if call in HARD:
            x += 0.45 * (balls - strikes)
        if call in BREAKING | OFFSPEED:
            x += 0.35 * strikes - 0.25 * balls
        if strikes == 2 and call == pitcher.putaway:
            x += 0.9
        if call in {"slider", "cutter"}:
            x += 0.5 if same_side else -0.3
        if call in OFFSPEED:
            x += -0.7 if same_side else 0.5
        if prev == call and call not in HARD:
            x -= 0.5
        logits[call] = x
    return _softmax_pick(rng, logits)


def choose_zone(rng: np.random.Generator, call: str, throws: str, balls: int, strikes: int) -> int:
    # columns from the catcher's view: 0 left, 2 right. a righty's arm side is the
    # catcher's left, his glove side the catcher's right
    arm, glove = (0, 2) if throws == "R" else (2, 0)
    logits: dict[int, float] = {}
    for zone in range(1, 10):
        row, col = divmod(zone - 1, 3)
        x = 0.0
        if call == "fastball":
            x += 0.6 if row == 0 else (-0.2 if row == 2 else 0.2)
        elif call == "sinker":
            x += 0.6 * (row == 2) + 0.5 * (col == arm)
        elif call in BREAKING:
            x += 0.7 * (row == 2) + 0.6 * (col == glove)
        else:
            x += 0.8 * (row == 2) + 0.4 * (col == arm)
        x += 0.4 * (zone == 5) * (balls == 3)
        logits[zone] = x
    chase = {"fastball": 0.4, "sinker": 0.3}.get(call, 1.0)
    chase += 0.8 * (strikes == 2) - 1.2 * (balls == 3)
    for corner, (top, right) in {11: (1, 0), 12: (1, 1), 13: (0, 0), 14: (0, 1)}.items():
        x = chase - 0.7
        x += 0.8 * (not top) if call not in {"fastball"} else 0.6 * top
        x += 0.4 * (right == (glove == 2)) if call in BREAKING else 0.0
        logits[corner] = x
    return int(_softmax_pick(rng, logits))


def plate_location(
    rng: np.random.Generator, zone: int, sz_bot: float, sz_top: float
) -> tuple[float, float]:
    third_w = 2 * ZONE_HALF_WIDTH / 3
    third_h = (sz_top - sz_bot) / 3
    if zone <= 9:
        row, col = divmod(zone - 1, 3)
        x = -ZONE_HALF_WIDTH + third_w * (col + rng.uniform(0.05, 0.95))
        z = sz_top - third_h * (row + rng.uniform(0.05, 0.95))
        return x, z
    top = zone in (11, 12)
    right = zone in (12, 14)
    # outside the zone, either past the edge to that side or past the top/bottom
    if rng.random() < 0.5:
        x = (1 if right else -1) * (ZONE_HALF_WIDTH + rng.uniform(0.05, 0.9))
        z = rng.uniform(sz_bot, sz_top) + (0.3 if top else -0.3)
    else:
        x = (1 if right else -1) * rng.uniform(0.0, ZONE_HALF_WIDTH + 0.5)
        z = sz_top + rng.uniform(0.05, 0.9) if top else sz_bot - rng.uniform(0.05, 1.2)
    return x, z


def flight(
    rng: np.random.Generator, call: str, throws: str, plate_x: float, plate_z: float
) -> dict[str, float]:
    """statcast's nine trajectory numbers (at y = 50 ft) for a pitch ending at plate_x/z."""
    code, name, mph, spin, ax, az = PITCHES[call]
    hand = 1 if throws == "R" else -1
    speed = mph + rng.normal(0, 1.2)
    extension = rng.normal(6.4, 0.3)
    release = {
        "release_pos_x": -hand * rng.normal(1.9, 0.3),
        "release_pos_y": 60.5 - extension,
        "release_pos_z": rng.normal(5.8, 0.25),
    }
    ax = ax * hand + rng.normal(0, 1.5)
    az = az + rng.normal(0, 1.5)
    ay = rng.normal(28, 2)
    vy0 = -speed * 5280 / 3600 * 0.93
    # time from y=50 to the front of the plate
    dy = 17 / 12 - 50
    t = (-vy0 - math.sqrt(vy0 * vy0 + 2 * ay * dy)) / ay
    x0 = release["release_pos_x"] * 0.9
    z0 = release["release_pos_z"] - 0.25
    vx0 = (plate_x - x0 - 0.5 * ax * t * t) / t
    vz0 = (plate_z - z0 - 0.5 * az * t * t) / t
    return {
        "pitch_type": code,
        "pitch_name": name,
        "release_speed": round(speed, 1),
        "release_spin_rate": round(spin + rng.normal(0, 80)),
        "release_extension": round(extension, 1),
        **{k: round(v, 2) for k, v in release.items()},
        "vx0": round(vx0, 3),
        "vy0": round(vy0, 3),
        "vz0": round(vz0, 3),
        "ax": round(ax, 3),
        "ay": round(ay, 3),
        "az": round(az, 3),
        "pfx_x": round(0.5 * ax * t * t, 2),
        "pfx_z": round(0.5 * (az - GRAVITY) * t * t, 2),
        "plate_x": round(plate_x, 2),
        "plate_z": round(plate_z, 2),
    }


SWING_IN_ZONE = {"called_strike": 0.28, "swinging_strike": 0.12, "foul": 0.30, "in_play": 0.30}
SWING_CHASE = {"ball": 0.62, "swinging_strike": 0.18, "foul": 0.12, "in_play": 0.08}
IN_PLAY = {"field_out": 0.68, "single": 0.2, "double": 0.06, "triple": 0.01, "home_run": 0.05}
VERB = {
    "field_out": "grounds out",
    "single": "singles",
    "double": "doubles",
    "triple": "triples",
    "home_run": "homers",
}


def _pick(rng: np.random.Generator, table: dict[str, float]) -> str:
    keys = list(table)
    p = np.array([table[k] for k in keys])
    return keys[int(rng.choice(len(keys), p=p / p.sum()))]


class Game:
    def __init__(self, rng, league: League, game_pk: int, day: date, home: str, away: str):
        self.rng = rng
        self.league = league
        self.game_pk = game_pk
        self.day = day
        self.home, self.away = home, away
        self.rows: list[dict] = []
        self.score = {home: 0, away: 0}
        self.at_bat = 0
        self.lineup_spot = {home: 0, away: 0}
        self.pitcher_state: dict[str, dict] = {}
        for code in (home, away):
            team = league.teams[code]
            starter = team.starters[team.rotation % len(team.starters)]
            team.rotation += 1
            self.pitcher_state[code] = {
                "pitcher": starter,
                "pitches": 0,
                "faced": 0,
                "limit": int(rng.integers(80, 105)),
                "bullpen": list(rng.permutation(len(team.bullpen))),
            }

    def _maybe_change_pitcher(self, fielding: str, inning: int) -> None:
        state = self.pitcher_state[fielding]
        if state["pitches"] < state["limit"] and not (
            not state["pitcher"].starter and state["faced"] >= 4
        ):
            return
        if not state["bullpen"]:
            return
        team = self.league.teams[fielding]
        reliever = team.bullpen[int(state["bullpen"].pop())]
        state.update(pitcher=reliever, pitches=0, faced=0, limit=int(self.rng.integers(15, 30)))

    def play(self) -> list[dict]:
        for inning in range(1, 10):
            for half in ("Top", "Bot"):
                if half == "Bot" and inning == 9 and self.score[self.home] > self.score[self.away]:
                    return self.rows
                self._half_inning(inning, half)
        return self.rows

    def _half_inning(self, inning: int, half: str) -> None:
        batting = self.away if half == "Top" else self.home
        fielding = self.home if half == "Top" else self.away
        outs = 0
        bases = [False, False, False]
        while outs < 3:
            self._maybe_change_pitcher(fielding, inning)
            state = self.pitcher_state[fielding]
            lineup = self.league.teams[batting].lineup[:9]
            batter = lineup[self.lineup_spot[batting] % 9]
            self.lineup_spot[batting] += 1
            self.at_bat += 1
            event = self._plate_appearance(inning, half, outs, bases, batting, fielding, batter)
            state["faced"] += 1
            outs, runs = self._advance(event, outs, bases)
            self.score[batting] += runs
            if half == "Bot" and inning == 9 and self.score[self.home] > self.score[self.away]:
                return

    def _advance(self, event: str, outs: int, bases: list[bool]) -> tuple[int, int]:
        if event in ("strikeout", "field_out"):
            return outs + 1, 0
        if event == "walk":
            runs = 0
            if bases[0]:
                if bases[1]:
                    if bases[2]:
                        runs = 1
                    bases[2] = True
                bases[1] = True
            bases[0] = True
            return outs, runs
        n = {"single": 1, "double": 2, "triple": 3, "home_run": 4}[event]
        runs = 0
        for base in (2, 1, 0):
            if bases[base]:
                bases[base] = False
                if base + n >= 3:
                    runs += 1
                else:
                    bases[base + n] = True
        if n == 4:
            runs += 1
        else:
            bases[n - 1] = True
        return outs, runs

    def _plate_appearance(self, inning, half, outs, bases, batting, fielding, batter) -> str:
        rng = self.rng
        state = self.pitcher_state[fielding]
        pitcher: Pitcher = state["pitcher"]
        stand = batter.stands
        if stand == "S":
            stand = "L" if pitcher.throws == "R" else "R"
        same_side = stand == pitcher.throws
        sz_bot = round(rng.normal(1.6, 0.08), 2)
        sz_top = round(rng.normal(3.4, 0.1), 2)
        balls = strikes = 0
        prev = None
        number = 0
        through_order = 1 + state["faced"] // 9
        while True:
            number += 1
            call = choose_pitch(rng, pitcher, balls, strikes, same_side, prev)
            zone = choose_zone(rng, call, pitcher.throws, balls, strikes)
            plate_x, plate_z = plate_location(rng, zone, sz_bot, sz_top)
            outcome = _pick(rng, SWING_IN_ZONE if zone <= 9 else SWING_CHASE)
            event = None
            if outcome == "ball" and balls == 3:
                event = "walk"
            elif outcome in ("called_strike", "swinging_strike") and strikes == 2:
                event = "strikeout"
            elif outcome == "in_play":
                event = _pick(rng, IN_PLAY)
            description = "hit_into_play" if outcome == "in_play" else outcome
            row = {col: None for col in KEEP}
            row.update(
                game_pk=self.game_pk,
                game_date=self.day.isoformat(),
                game_year=self.day.year,
                at_bat_number=self.at_bat,
                pitch_number=number,
                pitcher=pitcher.id,
                player_name=pitcher.name,
                batter=batter.id,
                p_throws=pitcher.throws,
                stand=stand,
                home_team=self.home,
                away_team=self.away,
                inning=inning,
                inning_topbot=half,
                outs_when_up=outs,
                balls=balls,
                strikes=strikes,
                on_1b=600000 + bases[0] if bases[0] else None,
                on_2b=600000 + bases[1] if bases[1] else None,
                on_3b=600000 + bases[2] if bases[2] else None,
                bat_score=self.score[batting],
                fld_score=self.score[fielding],
                n_thruorder_pitcher=through_order,
                sz_top=sz_top,
                sz_bot=sz_bot,
                zone=zone,
                description=description,
                events=event,
                des=self._des(batter, event),
                **flight(rng, call, pitcher.throws, plate_x, plate_z),
            )
            self.rows.append(row)
            state["pitches"] += 1
            prev = call
            if event:
                return event
            if outcome == "ball":
                balls += 1
            elif outcome in ("called_strike", "swinging_strike") or strikes < 2:
                strikes += 1

    @staticmethod
    def _des(batter: Batter, event: str | None) -> str | None:
        if event is None:
            return None
        if event == "strikeout":
            return f"{batter.name} strikes out swinging."
        if event == "walk":
            return f"{batter.name} walks."
        return f"{batter.name} {VERB[event]}."


def synth_season(year: int, raw_dir: Path, *, games: int = 160, seed: int = 7, log=print):
    """write one fake season as daily csvs in raw_dir/<year>/, like fetch does."""
    rng = np.random.default_rng(seed)  # the same league every season, so pitchers carry over
    league = make_league(rng)
    rng = np.random.default_rng(seed * 1000 + year)
    out = raw_dir / str(year)
    out.mkdir(parents=True, exist_ok=True)
    day = date(year, 4, 1)
    pitches = 0
    for g in range(0, games, len(TEAMS) // 2):
        order = list(rng.permutation(TEAMS))
        rows: list[dict] = []
        for i in range(0, len(order), 2):
            game_pk = year * 10000 + g + i // 2
            rows += Game(rng, league, game_pk, day, str(order[i]), str(order[i + 1])).play()
        # savant lists the newest pitch first, so we do too
        rows.reverse()
        path = out / f"{day.isoformat()}.csv"
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=KEEP)
            writer.writeheader()
            writer.writerows(rows)
        pitches += len(rows)
        day += timedelta(days=1)
    log(f"{year}: {pitches:,} made up pitches in {out}")
    return pitches
