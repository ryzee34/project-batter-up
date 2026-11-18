"""everything the model gets to know before a pitch is thrown.

the rule for every feature here is that it only uses what a catcher could know when he
puts the sign down: the situation, the pitches already thrown, and what the pitcher did in
earlier games. tests/test_features.py checks that by changing the future and making sure
nothing about the past moves.
"""

from __future__ import annotations

import pandas as pd

from batter_up.data.pitches import PITCH_CALLS, ZONES

NONE = "none"

SITUATION = [
    "balls",
    "strikes",
    "outs_when_up",
    "inning",
    "on_1b",
    "on_2b",
    "on_3b",
    "score_diff",
    "same_side",
    "n_thruorder_pitcher",
    "pitch_number",
    "pitcher_game_pitches",
]
CATEGORICAL = [
    "count",
    "p_throws",
    "stand",
    "prev_pitch_call",
    "prev_zone_call",
    "prev2_pitch_call",
    "prev_game_pitch_call",
]
MIX = [f"mix_{call}" for call in PITCH_CALLS]
MIX_SIDE = [f"mix_side_{call}" for call in PITCH_CALLS]
HISTORY = ["pitcher_prior_pitches", *MIX, *MIX_SIDE]

FEATURES = SITUATION + CATEGORICAL + HISTORY
TARGETS = ["pitch_call", "zone_call"]


def _prior_mix(df: pd.DataFrame, keys: list[str], prefix: str) -> pd.DataFrame:
    """share of each pitch call over every earlier game, per pitcher (and keys).

    counts are summed per game, accumulated in game order and shifted by one game, so a
    pitch never sees its own game. that keeps the first pitch and the last pitch of a game
    on the same footing, which is how the game will use it.
    """
    onehot = pd.get_dummies(df["pitch_call"]).reindex(columns=PITCH_CALLS, fill_value=0)
    onehot = onehot.astype("int64")
    per_game = (
        pd.concat([df[[*keys, "game_date", "game_pk"]], onehot], axis=1)
        .groupby([*keys, "game_date", "game_pk"], sort=True)[PITCH_CALLS]
        .sum()
        .reset_index()
    )
    prior = per_game.groupby(keys)[PITCH_CALLS].transform(lambda s: s.cumsum().shift(1))
    total = prior.sum(axis=1)
    shares = prior.div(total.where(total > 0), axis=0)
    shares.columns = [f"{prefix}{c}" for c in PITCH_CALLS]
    out = pd.concat([per_game[[*keys, "game_pk"]], shares], axis=1)
    if prefix == "mix_":
        out["pitcher_prior_pitches"] = total.fillna(0).astype("int64")
    return df[[*keys, "game_pk"]].merge(out, on=[*keys, "game_pk"], how="left")


def build_features(pitches: pd.DataFrame) -> pd.DataFrame:
    """add every feature column to a cleaned pitch table. rows come back in game order."""
    df = pitches.sort_values(["game_date", "game_pk", "at_bat_number", "pitch_number"])
    df = df.reset_index(drop=True)

    df["count"] = df["balls"].astype(str) + "-" + df["strikes"].astype(str)
    df["score_diff"] = df["fld_score"] - df["bat_score"]  # from the pitcher's side
    df["same_side"] = (df["p_throws"] == df["stand"]).astype("int64")
    df["inning"] = df["inning"].clip(upper=10)

    plate_app = df.groupby(["game_pk", "at_bat_number"], sort=False)
    df["prev_pitch_call"] = plate_app["pitch_call"].shift(1).fillna(NONE)
    df["prev_zone_call"] = plate_app["zone_call"].shift(1).fillna(NONE)
    df["prev2_pitch_call"] = plate_app["pitch_call"].shift(2).fillna(NONE)

    outing = df.groupby(["game_pk", "pitcher"], sort=False)
    df["pitcher_game_pitches"] = outing.cumcount()
    # the last pitch he threw in this game, even if it was to the batter before
    df["prev_game_pitch_call"] = outing["pitch_call"].shift(1).fillna(NONE)

    mix = _prior_mix(df, ["pitcher"], "mix_")
    side = _prior_mix(df, ["pitcher", "stand"], "mix_side_")
    df[["pitcher_prior_pitches", *MIX]] = mix[["pitcher_prior_pitches", *MIX]].to_numpy()
    df[MIX_SIDE] = side[MIX_SIDE].to_numpy()

    for col in ("on_1b", "on_2b", "on_3b"):
        df[col] = df[col].astype("int64")
    for col in CATEGORICAL:
        df[col] = df[col].astype("string")
    return df


def split_by_season(df: pd.DataFrame, test_season: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """train on every season before test_season, test on test_season. no shuffling, ever."""
    train = df[df["game_year"] < test_season]
    test = df[df["game_year"] == test_season]
    return train, test


__all__ = ["FEATURES", "TARGETS", "ZONES", "build_features", "split_by_season"]
