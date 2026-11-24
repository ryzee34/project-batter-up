"""the scouting book: what each pitcher in the game has done before, in the real data.

the game hands this to the player as the knowledge to call pitches with. it's built only
from seasons before the test season, the same ones the model trains on, so nothing in it
has seen the at-bats you play. for every pitcher it keeps, split by the batter's side:

- his mix, overall and in each kind of count
- what he throws after each pitch type, in the same at-bat
- where each pitch goes: up, down, or off either side, from the catcher's view

and, for both sides together, where his hand is when each pitch type comes out (his arm
slot), plus how often that alone would name the pitch. that last number is the one real
"tell" in the game, the rest of the tells are made up in the web game.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from batter_up.data.pitches import EDGE

# a pitch has to be at least this much of what he throws to be part of his repertoire
MIN_SHARE = 0.02
# fewer pitches than this in a split and it's left out, the shares would be noise
MIN_SPLIT = 15

# the counts, grouped the way a scouting report talks about them
COUNT_BUCKETS = {
    "first": ["0-0"],
    "early": ["0-1", "1-1"],
    "behind": ["1-0", "2-0", "3-0", "2-1", "3-1"],
    "two strikes": ["0-2", "1-2", "2-2"],
    "full": ["3-2"],
}
BUCKET_OF = {count: name for name, counts in COUNT_BUCKETS.items() for count in counts}

SWINGS = {
    "swinging_strike",
    "swinging_strike_blocked",
    "foul",
    "foul_tip",
    "hit_into_play",
    "foul_bunt",
    "missed_bunt",
}
WHIFFS = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}

# a starter averages at least this many pitches a game
STARTER_PITCHES = 45
# a starter who misses this many bats is an ace, and aces give the least away
ACE_WHIFF = 0.28


def direction(plate_x, plate_z, sz_bot, sz_top) -> np.ndarray:
    """up, down, left or right of the middle of the zone, catcher's view, by whichever
    way it's furthest out, measured in half-zones. left and right become in and away in
    the game, depending on the batter."""
    plate_x = np.asarray(plate_x, dtype="float64")
    plate_z = np.asarray(plate_z, dtype="float64")
    bot = np.asarray(sz_bot, dtype="float64")
    top = np.asarray(sz_top, dtype="float64")
    dx = plate_x / EDGE
    dz = (plate_z - (top + bot) / 2) / ((top - bot) / 2)
    vertical = np.where(dz >= 0, "up", "down")
    side = np.where(dx >= 0, "right", "left")
    out = np.where(np.abs(dz) >= np.abs(dx), vertical, side).astype(object)
    out[np.isnan(dx) | np.isnan(dz)] = None
    return out


def _shares(values: pd.Series, keep: list[str] | None = None) -> dict[str, float]:
    if len(values) < MIN_SPLIT:
        return {}
    shares = values.value_counts(normalize=True)
    if keep is not None:
        shares = shares[shares.index.isin(keep)]
    return {str(k): round(float(v), 3) for k, v in shares.items() if v >= 0.005}


def slot_read(df: pd.DataFrame, repertoire: list[str]) -> float:
    """how often his release point alone names the pitch: each pitch goes to the pitch
    type whose average release is closest, in that type's own spread. in-sample, so it's
    a little kind, but it's about how much the arm slot gives away, not a model."""
    rel = df[df["pitch_call"].isin(repertoire)].dropna(subset=["release_pos_x", "release_pos_z"])
    if rel.empty:
        return 0.0
    stats = rel.groupby("pitch_call")[["release_pos_x", "release_pos_z"]].agg(["mean", "std"])
    pts = rel[["release_pos_x", "release_pos_z"]].to_numpy()
    best = None
    names = list(stats.index)
    for name in names:
        mean = stats.loc[name, [("release_pos_x", "mean"), ("release_pos_z", "mean")]].to_numpy()
        sd = stats.loc[name, [("release_pos_x", "std"), ("release_pos_z", "std")]].to_numpy()
        sd = np.where(np.isnan(sd) | (sd < 0.03), 0.03, sd).astype("float64")
        dist = (((pts - mean.astype("float64")) / sd) ** 2).sum(axis=1) + 2 * np.log(sd).sum()
        best = dist[:, None] if best is None else np.hstack([best, dist[:, None]])
    picked = np.array(names)[best.argmin(axis=1)]
    return round(float((picked == rel["pitch_call"].to_numpy()).mean()), 3)


def pitcher_book(df: pd.DataFrame) -> dict:
    """one pitcher's book, from every pitch he threw in the seasons given."""
    df = df.sort_values(["game_date", "game_pk", "at_bat_number", "pitch_number"])
    mix = df["pitch_call"].value_counts(normalize=True)
    repertoire = [str(k) for k, v in mix.items() if v >= MIN_SHARE]
    games = df["game_pk"].nunique()
    per_game = len(df) / max(games, 1)
    swings = df["description"].isin(SWINGS).sum()
    whiff = float(df["description"].isin(WHIFFS).sum() / swings) if swings else 0.0
    starter = per_game >= STARTER_PITCHES
    tier = 3 if starter and whiff >= ACE_WHIFF else 2 if starter else 1

    count = df["balls"].astype(int).astype(str) + "-" + df["strikes"].astype(int).astype(str)
    df = df.assign(
        bucket=count.map(BUCKET_OF),
        prev=df.groupby(["game_pk", "at_bat_number"])["pitch_call"].shift(1),
        way=direction(df["plate_x"], df["plate_z"], df["sz_bot"], df["sz_top"]),
    )

    sides = {}
    for side in ("L", "R"):
        s = df[df["stand"].eq(side)]
        sides[side] = {
            "pitches": int(len(s)),
            "mix": _shares(s["pitch_call"], repertoire),
            "counts": {
                bucket: _shares(s.loc[s["bucket"].eq(bucket), "pitch_call"], repertoire)
                for bucket in COUNT_BUCKETS
            },
            "after": {
                prev: _shares(s.loc[s["prev"].eq(prev), "pitch_call"], repertoire)
                for prev in repertoire
            },
            "location": {
                call: _shares(s.loc[s["pitch_call"].eq(call), "way"].dropna())
                for call in repertoire
            },
        }

    release = {}
    for call in repertoire:
        r = df.loc[df["pitch_call"].eq(call), ["release_pos_x", "release_pos_z"]].dropna()
        if len(r) < 5:
            continue
        release[call] = [
            round(float(r["release_pos_x"].mean()), 3),
            round(float(r["release_pos_z"].mean()), 3),
            round(float(r["release_pos_x"].std()), 3),
            round(float(r["release_pos_z"].std()), 3),
        ]

    return {
        "pitches": int(len(df)),
        "games": int(games),
        "starter": bool(starter),
        "whiff": round(whiff, 3),
        "tier": tier,
        "repertoire": repertoire,
        "favorite": repertoire[0] if repertoire else None,
        "slotRead": slot_read(df, repertoire),
        "release": release,
        "sides": sides,
    }


def scout(pitches: pd.DataFrame, pitcher_ids: list[int], seasons: list[int]) -> dict:
    """the book on every pitcher asked for, from the seasons given. a pitcher with no
    pitches in them gets no book, and the game says it has nothing on him."""
    df = pitches[pitches["game_year"].isin(seasons) & pitches["pitcher"].isin(pitcher_ids)]
    df = df.dropna(subset=["pitch_call"])
    books = {}
    for pid, mine in df.groupby("pitcher"):
        books[str(int(pid))] = pitcher_book(mine)
    return {
        "version": 1,
        "seasons": sorted(int(s) for s in seasons),
        "buckets": COUNT_BUCKETS,
        "pitchers": books,
    }
