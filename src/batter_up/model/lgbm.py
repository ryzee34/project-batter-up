"""the model: two gradient boosted trees that call the pitch the way a catcher would.

the first tree reads the situation and gives a probability for each pitch type. the
second is told which pitch is coming and gives a probability for each of the ten zones,
so the zone can depend on the pitch (sliders go low and away, fastballs up). multiplying
them gives a chance for every (pitch, zone) pair, and the model's call is the likeliest
pair. that's the one thing it gets to say in the game, same as you.

training never sees the test season. the season before it is held out to decide when to
stop adding trees, then the model is refit on every training season with that many trees.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from batter_up.data.pitches import PITCH_CALLS, ZONES
from batter_up.features import CATEGORICAL, FEATURES, NONE

CATEGORIES: dict[str, list[str]] = {
    "count": [f"{b}-{s}" for b in range(4) for s in range(3)],
    "p_throws": ["L", "R"],
    "stand": ["L", "R"],
    "prev_pitch_call": [*PITCH_CALLS, NONE],
    "prev_zone_call": [*ZONES, NONE],
    "prev2_pitch_call": [*PITCH_CALLS, NONE],
    "prev_game_pitch_call": [*PITCH_CALLS, NONE],
}
assert set(CATEGORIES) == set(CATEGORICAL)

PARAMS = {
    "objective": "multiclass",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_data_in_leaf": 200,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": 7,
}
MAX_ROUNDS = 2000
EARLY_STOP = 50


def matrix(df: pd.DataFrame, pitch: str | pd.Series | None = None) -> pd.DataFrame:
    """the model's view of each pitch. pass pitch to add the pitch type the zone tree uses."""
    x = pd.DataFrame(index=df.index)
    for col in FEATURES:
        if col in CATEGORIES:
            x[col] = pd.Categorical(df[col].astype("object"), categories=CATEGORIES[col])
        else:
            x[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
    if pitch is not None:
        values = pitch if isinstance(pitch, pd.Series) else pd.Series(pitch, index=df.index)
        x["pitch_call"] = pd.Categorical(values.astype("object"), categories=PITCH_CALLS)
    return x


def _codes(values: pd.Series, classes: list[str]) -> np.ndarray:
    codes = pd.Categorical(values, categories=classes).codes
    if (codes < 0).any():
        raise ValueError(f"unknown class in {values.name}")
    return codes


@dataclass
class Prediction:
    pitch: np.ndarray  # (n, pitch types)
    joint: np.ndarray  # (n, pitch types, zones)

    @property
    def zone(self) -> np.ndarray:
        return self.joint.sum(axis=1)

    def calls(self) -> tuple[pd.Series, pd.Series]:
        """the likeliest (pitch, zone) pair for every row."""
        flat = self.joint.reshape(len(self.joint), -1).argmax(axis=1)
        p, z = np.divmod(flat, len(ZONES))
        return (
            pd.Series(np.array(PITCH_CALLS)[p]),
            pd.Series(np.array(ZONES)[z]),
        )


class PitchModel:
    def __init__(self, pitch_tree: lgb.Booster, zone_tree: lgb.Booster):
        self.pitch_tree = pitch_tree
        self.zone_tree = zone_tree

    @staticmethod
    def _train(x, y, n_class, rounds=None, valid=None) -> lgb.Booster:
        params = {**PARAMS, "num_class": n_class}
        data = lgb.Dataset(x, y, free_raw_data=False)
        if valid is None:
            return lgb.train(params, data, num_boost_round=rounds or 100)
        vx, vy = valid
        return lgb.train(
            params,
            data,
            num_boost_round=MAX_ROUNDS,
            valid_sets=[lgb.Dataset(vx, vy, reference=data)],
            callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)],
        )

    @classmethod
    def fit(cls, train: pd.DataFrame, *, rounds: tuple[int, int] | None = None, log=print):
        """train on train. without rounds, the last season in train picks how many trees."""
        y_pitch = _codes(train["pitch_call"], PITCH_CALLS)
        y_zone = _codes(train["zone_call"], ZONES)
        if rounds is None:
            last = train["game_year"].max()
            early = train["game_year"] < last
            if not early.any():
                raise ValueError("need at least two training seasons to pick the tree count")
            fit_part, hold = train[early], train[~early]
            pitch_tree = cls._train(
                matrix(fit_part),
                y_pitch[early.to_numpy()],
                len(PITCH_CALLS),
                valid=(matrix(hold), y_pitch[~early.to_numpy()]),
            )
            zone_tree = cls._train(
                matrix(fit_part, fit_part["pitch_call"]),
                y_zone[early.to_numpy()],
                len(ZONES),
                valid=(matrix(hold, hold["pitch_call"]), y_zone[~early.to_numpy()]),
            )
            rounds = (pitch_tree.best_iteration, zone_tree.best_iteration)
            log(f"held out {last} to pick trees: {rounds[0]} for pitch type, {rounds[1]} for zone")
        pitch_tree = cls._train(matrix(train), y_pitch, len(PITCH_CALLS), rounds=rounds[0])
        zone_tree = cls._train(
            matrix(train, train["pitch_call"]), y_zone, len(ZONES), rounds=rounds[1]
        )
        return cls(pitch_tree, zone_tree)

    def predict(self, df: pd.DataFrame) -> Prediction:
        pitch = self.pitch_tree.predict(matrix(df))
        joint = np.empty((len(df), len(PITCH_CALLS), len(ZONES)))
        for k, call in enumerate(PITCH_CALLS):
            zone = self.zone_tree.predict(matrix(df, call))
            joint[:, k, :] = pitch[:, [k]] * zone
        return Prediction(pitch=pitch, joint=joint)

    def save(self, folder: Path) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        self.pitch_tree.save_model(folder / "pitch_type.txt")
        self.zone_tree.save_model(folder / "zone.txt")

    @classmethod
    def load(cls, folder: Path) -> PitchModel:
        if not (folder / "pitch_type.txt").exists():
            raise SystemExit(f"no model in {folder}, run batter-up train first")
        return cls(
            lgb.Booster(model_file=folder / "pitch_type.txt"),
            lgb.Booster(model_file=folder / "zone.txt"),
        )

    def importance(self, top: int = 10) -> list[tuple[str, float]]:
        gain = self.pitch_tree.feature_importance("gain")
        names = self.pitch_tree.feature_name()
        share = gain / gain.sum()
        order = np.argsort(-share)[:top]
        return [(names[i], float(share[i])) for i in order]


def log_loss(probs: np.ndarray, truth: np.ndarray) -> float:
    picked = probs[np.arange(len(truth)), truth]
    return float(-np.log(np.clip(picked, 1e-9, 1)).mean())


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
