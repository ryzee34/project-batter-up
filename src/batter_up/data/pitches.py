"""turn savant's raw csvs into one tidy table of pitches.

we keep the game situation the pitcher saw before the pitch, what was thrown, and where
it went, and drop everything else. the raw files have about 115 columns, this keeps 45.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import pandas as pd

# savant's pitch codes folded into the calls you can make in the game
PITCH_GROUPS: dict[str, str] = {
    "FF": "fastball",
    "FA": "fastball",
    "SI": "sinker",
    "FT": "sinker",
    "FC": "cutter",
    "SL": "slider",
    "ST": "slider",  # sweeper
    "SV": "slider",  # slurve
    "CU": "curveball",
    "KC": "curveball",
    "CS": "curveball",
    "CH": "changeup",
    "SC": "changeup",  # screwball
    "FS": "splitter",
    "FO": "splitter",  # forkball
}
# knuckleballs, eephus, pitchouts, intentional balls and unknowns aren't something you
# can call, so those pitches are dropped. EP, KN, PO, IN, AB, UN and blanks
PITCH_CALLS = sorted(set(PITCH_GROUPS.values()))

# statcast zones 1-9 are the strike zone, left to right and top to bottom from the
# catcher's view. 11-14 are the corners outside it. a chase is split four ways by the edge
# the ball missed most: up, down, or off the catcher's left or right. the game turns left
# and right into in and away for whoever is batting
CHASE_UP = "chase_up"
CHASE_DOWN = "chase_down"
CHASE_LEFT = "chase_left"
CHASE_RIGHT = "chase_right"
CHASES = [CHASE_UP, CHASE_DOWN, CHASE_LEFT, CHASE_RIGHT]
ZONES = [str(z) for z in range(1, 10)] + CHASES
# half the plate plus the ball, in feet. the same edge statcast draws zones 1-9 with
EDGE = 0.83

KEEP = [
    # who and when
    "game_pk",
    "game_date",
    "game_year",
    "at_bat_number",
    "pitch_number",
    "pitcher",
    "player_name",
    "batter",
    "p_throws",
    "stand",
    "home_team",
    "away_team",
    # the situation before the pitch
    "inning",
    "inning_topbot",
    "outs_when_up",
    "balls",
    "strikes",
    "on_1b",
    "on_2b",
    "on_3b",
    "bat_score",
    "fld_score",
    "n_thruorder_pitcher",
    # the pitch
    "pitch_type",
    "pitch_name",
    "release_speed",
    "release_spin_rate",
    "release_extension",
    "release_pos_x",
    "release_pos_y",
    "release_pos_z",
    "vx0",
    "vy0",
    "vz0",
    "ax",
    "ay",
    "az",
    "pfx_x",
    "pfx_z",
    "plate_x",
    "plate_z",
    "sz_top",
    "sz_bot",
    "zone",
    # what happened
    "description",
    "events",
    "des",
]


def zone_call(
    zone: float | int | None,
    plate_x: float | None = None,
    plate_z: float | None = None,
    sz_top: float | None = None,
    sz_bot: float | None = None,
) -> str | None:
    """the game's spot for one pitch: zones 1-9, or the side of the zone it missed."""
    if zone is None or pd.isna(zone):
        return None
    z = int(zone)
    if 1 <= z <= 9:
        return str(z)
    if not 11 <= z <= 14:
        return None
    where = (plate_x, plate_z, sz_top, sz_bot)
    if any(v is None or pd.isna(v) for v in where):
        # no location, so go by the corner statcast put it in: 11 and 12 are the top
        return CHASE_UP if z in (11, 12) else CHASE_DOWN
    # how far past each edge it was, in feet. the biggest miss names the side
    misses = {
        CHASE_LEFT: -plate_x - EDGE,
        CHASE_RIGHT: plate_x - EDGE,
        CHASE_UP: plate_z - sz_top,
        CHASE_DOWN: sz_bot - plate_z,
    }
    return max(misses, key=misses.__getitem__)


def zone_calls(df: pd.DataFrame) -> pd.Series:
    """zone_call for every row of a savant frame."""
    cols = ["zone", "plate_x", "plate_z", "sz_top", "sz_bot"]
    return pd.Series(
        [zone_call(*row) for row in df[cols].itertuples(index=False, name=None)],
        index=df.index,
        dtype=object,
    )


def read_raw(paths: Iterable[Path]) -> pd.DataFrame:
    frames = []
    for path in paths:
        if path.stat().st_size == 0:
            continue
        frame = pd.read_csv(path, low_memory=False)
        if not frame.empty:
            frames.append(frame)
    if not frames:
        return pd.DataFrame(columns=KEEP)
    return pd.concat(frames, ignore_index=True)


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in KEEP if c not in raw.columns]
    if missing:
        raise ValueError(f"savant csv is missing columns: {', '.join(missing)}")
    df = raw[KEEP].copy()

    df["pitch_call"] = df["pitch_type"].map(PITCH_GROUPS)
    df["zone_call"] = zone_calls(df)
    df = df.dropna(subset=["pitch_call", "zone_call"])

    df["game_date"] = pd.to_datetime(df["game_date"])
    top = df["inning_topbot"].eq("Top")
    df["pitching_team"] = df["home_team"].where(top, df["away_team"])
    df["batting_team"] = df["away_team"].where(top, df["home_team"])
    for base in ("on_1b", "on_2b", "on_3b"):
        # savant puts the runner's player id here, or nothing when the base is empty
        df[base] = df[base].notna()

    # a game can show up in two daily files if it ran past midnight, or in a reran pull
    df = df.drop_duplicates(subset=["game_pk", "at_bat_number", "pitch_number"])
    df = df.sort_values(["game_date", "game_pk", "at_bat_number", "pitch_number"])
    return df.reset_index(drop=True)


def build(raw_dir: Path, out_dir: Path, years: Iterable[int], log=print) -> list[Path]:
    """clean each cached season into data/interim/pitches_<year>.parquet."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for year in years:
        paths = sorted((raw_dir / str(year)).glob("*.csv"))
        if not paths:
            log(f"{year}: nothing downloaded yet, run fetch first")
            continue
        raw = read_raw(paths)
        df = clean(raw)
        out = out_dir / f"pitches_{year}.parquet"
        df.to_parquet(out, index=False)
        log(f"{year}: {len(raw):,} raw pitches, kept {len(df):,} -> {out.name}")
        written.append(out)
    return written
