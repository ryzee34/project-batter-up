"""pick the at-bats the game plays and write them, with the model's calls, as json.

the game is a static site, so everything it shows is decided here: which at-bats, every
pitch in them with its flight numbers for the replay, the pitcher's scouting report as of
that day, and what the model and the baseline would have called before each pitch. only
the test season is used, so every call in the game is one the model makes blind.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from batter_up.data.pitches import PITCH_CALLS, ZONES
from batter_up.features import MIX, MIX_SIDE
from batter_up.model.baseline import FavoritePitch
from batter_up.model.lgbm import PitchModel

# at-bats that end because of the batter. caught stealing, pickoffs and the like end an
# at-bat too, but the des is about someone else and nothing was decided by the pitch
BATTER_EVENTS = {
    "strikeout": "strikeout",
    "strikeout_double_play": "strikeout",
    "walk": "walk",
    "hit_by_pitch": "hit by pitch",
    "single": "single",
    "double": "double",
    "triple": "triple",
    "home_run": "home run",
    "field_out": "out",
    "force_out": "out",
    "grounded_into_double_play": "double play",
    "double_play": "double play",
    "fielders_choice": "fielder's choice",
    "fielders_choice_out": "fielder's choice",
    "sac_fly": "sac fly",
    "field_error": "error",
}

FLIGHT = ["vx0", "vy0", "vz0", "ax", "ay", "az"]


def display_name(savant: str) -> str:
    """savant writes pitchers as "Last, First"."""
    last, _, first = str(savant).partition(", ")
    return f"{first} {last}".strip()


def batter_name(des: str | None) -> str | None:
    """the batter's name is how the play description starts: "Mookie Betts strikes out"."""
    if not isinstance(des, str):
        return None
    words = []
    for word in des.split():
        if re.match(r"^[a-z(]", word):
            break
        words.append(word)
    name = " ".join(words).rstrip(".,")
    return name or None


@dataclass(frozen=True)
class Pick:
    at_bats: int = 40
    team: str = "LAD"
    min_pitches: int = 4
    per_pitcher: int = 4
    per_game: int = 2


def interest(ab: pd.DataFrame) -> float:
    """how much fun an at-bat is to call: long, late, close, runners on, big ending."""
    first, last = ab.iloc[0], ab.iloc[-1]
    score = min(len(ab), 9) * 1.0
    score += 2.0 if first["inning"] >= 7 else 0.0
    score += 2.0 if abs(first["score_diff"]) <= 2 else 0.0
    score += 1.0 * (first["on_1b"] + first["on_2b"] + first["on_3b"])
    score += 2.0 if last["balls"] == 3 and last["strikes"] == 2 else 0.0
    score += {"strikeout": 2.0, "home_run": 3.0, "walk": 0.5}.get(last["events"], 0.0)
    return score


def choose(df: pd.DataFrame, pick: Pick = Pick()) -> list[tuple[int, int]]:
    """the (game_pk, at_bat_number) pairs to play, best first, spread across games."""
    mine = df[df["pitching_team"].eq(pick.team)]
    candidates = []
    for key, ab in mine.groupby(["game_pk", "at_bat_number"], sort=True):
        ab = ab.sort_values("pitch_number")
        if len(ab) < pick.min_pitches:
            continue
        # a pitch we couldn't classify was dropped in cleaning, so the at-bat has a hole
        if ab["pitch_number"].tolist() != list(range(1, len(ab) + 1)):
            continue
        if ab["events"].iloc[-1] not in BATTER_EVENTS:
            continue
        if ab["pitcher"].nunique() != 1 or batter_name(ab["des"].iloc[-1]) is None:
            continue
        candidates.append((interest(ab), key, int(ab["pitcher"].iat[0])))
    # best first, then oldest first so reruns pick the same at-bats
    candidates.sort(key=lambda c: (-c[0], c[1]))
    chosen: list[tuple[int, int]] = []
    pitchers: dict[int, int] = {}
    games: dict[int, int] = {}
    for _, key, pitcher in candidates:
        if pitchers.get(pitcher, 0) >= pick.per_pitcher or games.get(key[0], 0) >= pick.per_game:
            continue
        chosen.append((int(key[0]), int(key[1])))
        pitchers[pitcher] = pitchers.get(pitcher, 0) + 1
        games[key[0]] = games.get(key[0], 0) + 1
        if len(chosen) == pick.at_bats:
            break
    return chosen


def _round(values, digits=3) -> list[float]:
    return [round(float(v), digits) for v in values]


def _mix(row: pd.Series, cols: list[str]) -> dict[str, float]:
    values = row[cols].astype("float64")
    if values.isna().all():
        return {}
    shares = zip(PITCH_CALLS, values.fillna(0), strict=True)
    return {call: round(float(v), 3) for call, v in shares if v >= 0.005}


def at_bat_json(ab: pd.DataFrame, pitch_probs, zone_probs, calls, base) -> dict:
    first, last = ab.iloc[0], ab.iloc[-1]
    top = first["inning_topbot"] == "Top"
    pitches = []
    for i, row in enumerate(ab.itertuples(index=False)):
        pitches.append(
            {
                "n": int(row.pitch_number),
                "count": f"{row.balls}-{row.strikes}",
                "pitch": row.pitch_call,
                "zone": row.zone_call,
                "name": row.pitch_name,
                "mph": round(float(row.release_speed), 1),
                "spin": None if pd.isna(row.release_spin_rate) else int(row.release_spin_rate),
                "result": row.description,
                "plate": _round([row.plate_x, row.plate_z], 2),
                "sz": _round([row.sz_bot, row.sz_top], 2),
                "release": _round([row.release_pos_x, row.release_pos_y, row.release_pos_z], 2),
                "flight": _round([getattr(row, c) for c in FLIGHT], 3),
                "model": {
                    "call": [calls[0][i], calls[1][i]],
                    "pitch": _round(pitch_probs[i]),
                    "zone": _round(zone_probs[i]),
                },
                "baseline": [base[0][i], base[1][i]],
            }
        )
    return {
        "id": f"{int(first['game_pk'])}-{int(first['at_bat_number'])}",
        "date": pd.Timestamp(first["game_date"]).date().isoformat(),
        "team": first["pitching_team"],
        "opponent": first["batting_team"],
        "home": bool(first["home_team"] == first["pitching_team"]),
        "inning": int(first["inning"]),
        "half": "top" if top else "bottom",
        "outs": int(first["outs_when_up"]),
        "runners": [bool(first["on_1b"]), bool(first["on_2b"]), bool(first["on_3b"])],
        "score": {"pitching": int(first["fld_score"]), "batting": int(first["bat_score"])},
        "pitcher": {
            "id": int(first["pitcher"]),
            "name": display_name(first["player_name"]),
            "throws": first["p_throws"],
            "pitchesToday": int(first["pitcher_game_pitches"]),
            "mix": _mix(first, MIX),
            "mixVsSide": _mix(first, MIX_SIDE),
        },
        "batter": {
            "id": int(first["batter"]),
            "name": batter_name(last["des"]),
            "stands": first["stand"],
        },
        "result": BATTER_EVENTS[last["events"]],
        "des": last["des"],
        "pitches": pitches,
    }


def export(
    features: pd.DataFrame,
    model: PitchModel,
    test_season: int,
    metrics: dict,
    *,
    pick: Pick = Pick(),
    synthetic: bool = False,
) -> tuple[dict, dict]:
    """(at-bats payload, model summary payload) for the game."""
    train = features[features["game_year"] < test_season]
    test = features[features["game_year"] == test_season]
    chosen = choose(test, pick)
    keys = pd.MultiIndex.from_tuples(chosen, names=["game_pk", "at_bat_number"])
    rows = test.set_index(["game_pk", "at_bat_number"]).loc[keys].reset_index()
    rows = rows.sort_values(["game_date", "game_pk", "at_bat_number", "pitch_number"])
    rows = rows.reset_index(drop=True)

    pred = model.predict(rows)
    pitch_call, zone_call = pred.calls()
    base_pitch, base_zone = FavoritePitch.fit(train).predict(rows)

    at_bats = []
    for _, ab in rows.groupby(["game_pk", "at_bat_number"], sort=False):
        idx = ab.index.to_numpy()
        at_bats.append(
            at_bat_json(
                ab,
                pred.pitch[idx],
                pred.zone[idx],
                (pitch_call[idx].tolist(), zone_call[idx].tolist()),
                (base_pitch[idx].tolist(), base_zone[idx].tolist()),
            )
        )
    payload = {
        "version": 1,
        "synthetic": synthetic,
        "season": test_season,
        "team": pick.team,
        "pitchCalls": PITCH_CALLS,
        "zones": ZONES,
        "atBats": at_bats,
    }
    summary = {
        "version": 1,
        "synthetic": synthetic,
        "testSeason": metrics["test_season"],
        "trainSeasons": metrics["train_seasons"],
        "model": metrics["model"],
        "baseline": metrics["baseline"],
        "team": metrics["team"],
        "teamOnly": metrics["team_only"],
        "byCount": metrics["by_count"],
        "importance": metrics["importance"],
    }
    return payload, summary


def check(payload: dict) -> None:
    """the shape the game relies on. raises on anything it would choke on."""
    assert payload["atBats"], "no at-bats were chosen"
    for ab in payload["atBats"]:
        assert ab["batter"]["name"], ab["id"]
        for p in ab["pitches"]:
            assert p["pitch"] in PITCH_CALLS and p["zone"] in ZONES, ab["id"]
            assert len(p["model"]["pitch"]) == len(PITCH_CALLS)
            assert len(p["model"]["zone"]) == len(ZONES)
            assert np.isclose(sum(p["model"]["pitch"]), 1, atol=0.01)
            assert all(np.isfinite(p["flight"])), ab["id"]
