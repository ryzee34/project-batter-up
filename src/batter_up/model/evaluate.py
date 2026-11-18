"""how the model does on the season it never saw, next to the favorite pitch baseline."""

from __future__ import annotations

import numpy as np
import pandas as pd

from batter_up.data.pitches import PITCH_CALLS
from batter_up.features import MIX
from batter_up.model.baseline import FavoritePitch, Scores, score
from batter_up.model.lgbm import CATEGORIES, PitchModel, Prediction, log_loss


def mix_probs(df: pd.DataFrame, league: pd.Series) -> np.ndarray:
    """the pitcher's earlier mix as probabilities, the scouting report version of the model."""
    mix = df[MIX].astype("float64").to_numpy()
    fallback = league.reindex(PITCH_CALLS).fillna(0).to_numpy()
    mix = np.where(np.isnan(mix).all(axis=1, keepdims=True), fallback, np.nan_to_num(mix))
    mix = 0.98 * mix + 0.02 / len(PITCH_CALLS)  # nobody is ever 100% sure
    return mix / mix.sum(axis=1, keepdims=True)


def _scores(s: Scores) -> dict:
    return {"pitches": s.pitches, "pitch_type": s.pitch_call, "zone": s.zone_call, "both": s.both}


def evaluate(model: PitchModel, train: pd.DataFrame, test: pd.DataFrame, team: str = "LAD") -> dict:
    test = test.reset_index(drop=True)
    baseline = FavoritePitch.fit(train)
    base_pitch, base_zone = baseline.predict(test)
    pred: Prediction = model.predict(test)
    pitch, zone = pred.calls()

    truth = pd.Categorical(test["pitch_call"], categories=PITCH_CALLS).codes
    league = train["pitch_call"].value_counts(normalize=True)
    report = {
        "test_season": int(test["game_year"].max()),
        "train_seasons": sorted(int(y) for y in train["game_year"].unique()),
        "model": _scores(score(test, pitch, zone)),
        "baseline": _scores(score(test, base_pitch.reset_index(drop=True), base_zone)),
        "pitch_log_loss": {
            "model": log_loss(pred.pitch, truth),
            "pitcher_mix": log_loss(mix_probs(test, league), truth),
        },
        "by_count": {},
        "team": team,
        "team_only": {},
        "importance": model.importance(),
    }
    for count in CATEGORIES["count"]:
        rows = (test["count"] == count).to_numpy()
        if rows.sum() == 0:
            continue
        report["by_count"][count] = {
            "pitches": int(rows.sum()),
            "model": float((pitch[rows] == test["pitch_call"][rows].to_numpy()).mean()),
            "baseline": float((base_pitch.to_numpy()[rows] == test["pitch_call"][rows]).mean()),
        }
    mine = test["pitching_team"].eq(team).to_numpy()
    if mine.any():
        mt = test[mine].reset_index(drop=True)
        report["team_only"] = {
            "model": _scores(score(mt, pitch[mine].reset_index(drop=True), zone[mine])),
            "baseline": _scores(
                score(mt, base_pitch[mine].reset_index(drop=True), base_zone[mine])
            ),
        }
    return report


def lines(report: dict) -> list[str]:
    m, b = report["model"], report["baseline"]
    out = [
        f"tested on {report['test_season']}, {m['pitches']:,} pitches it never saw",
        "                model   favorite pitch",
    ]
    for key, label in (("pitch_type", "pitch type"), ("zone", "zone"), ("both", "both right")):
        out.append(f"  {label:<12} {m[key]:6.1%}   {b[key]:6.1%}")
    ll = report["pitch_log_loss"]
    out.append(f"  log loss     {ll['model']:6.3f}   {ll['pitcher_mix']:6.3f} (his mix as odds)")
    if report["team_only"]:
        tm, tb = report["team_only"]["model"], report["team_only"]["baseline"]
        out.append(f"  {report['team']} pitching only, {tm['pitches']:,} pitches")
        for key, label in (("pitch_type", "pitch type"), ("zone", "zone"), ("both", "both")):
            out.append(f"    {label:<10} {tm[key]:6.1%}   {tb[key]:6.1%}")
    out.append("pitch type by count")
    for count, row in report["by_count"].items():
        out.append(f"  {count}  {row['model']:6.1%}   {row['baseline']:6.1%}   {row['pitches']:,}")
    out.append("what the pitch type tree leans on")
    for name, share in report["importance"]:
        out.append(f"  {name:<24} {share:5.1%}")
    return out
