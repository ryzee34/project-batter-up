"""the number the model has to beat.

a catcher who has only scouted the pitcher's numbers would call his favorite pitch, and
call it wherever that pitch usually ends up. if the model can't beat that, it's not
reading the situation at all.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from batter_up.data.pitches import PITCH_CALLS
from batter_up.features import MIX


@dataclass(frozen=True)
class Scores:
    pitches: int
    pitch_call: float
    zone_call: float
    both: float

    def lines(self, name: str) -> list[str]:
        return [
            f"{name} on {self.pitches:,} pitches",
            f"  pitch type   {self.pitch_call:6.1%}",
            f"  zone         {self.zone_call:6.1%}",
            f"  both right   {self.both:6.1%}",
        ]


def score(truth: pd.DataFrame, pitch_call: pd.Series, zone_call: pd.Series) -> Scores:
    pitch_hit = pitch_call.to_numpy() == truth["pitch_call"].to_numpy()
    zone_hit = zone_call.to_numpy() == truth["zone_call"].to_numpy()
    return Scores(
        pitches=len(truth),
        pitch_call=float(pitch_hit.mean()) if len(truth) else 0.0,
        zone_call=float(zone_hit.mean()) if len(truth) else 0.0,
        both=float((pitch_hit & zone_hit).mean()) if len(truth) else 0.0,
    )


@dataclass(frozen=True)
class FavoritePitch:
    """pitcher's most used pitch so far, thrown to the zone that pitch lands in most."""

    league_pitch: str
    zone_by_pitch: dict[str, str]

    @classmethod
    def fit(cls, train: pd.DataFrame) -> FavoritePitch:
        league_pitch = train["pitch_call"].mode().iat[0]
        zones = train.groupby("pitch_call")["zone_call"].agg(lambda s: s.mode().iat[0])
        return cls(league_pitch, zones.to_dict())

    def predict(self, df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
        mix = df[MIX].astype("float64")
        has_history = mix.notna().any(axis=1)
        favorite = mix.fillna(-1).idxmax(axis=1).str.removeprefix("mix_")
        pitch = favorite.where(has_history, self.league_pitch)
        zone = pitch.map(self.zone_by_pitch).fillna(self.zone_by_pitch[self.league_pitch])
        return pitch, zone


__all__ = ["PITCH_CALLS", "FavoritePitch", "Scores", "score"]
