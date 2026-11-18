import numpy as np
import pandas as pd
import pytest

from batter_up.data.pitches import PITCH_CALLS, ZONES, clean
from batter_up.features import FEATURES, MIX, build_features, split_by_season
from batter_up.model.baseline import FavoritePitch, score
from tests.conftest import pitch

CODES = ["FF", "SI", "FC", "SL", "CU", "CH", "FS"]


def fake_season(seed=0, games=12, at_bats=8):
    """a few made up games with two pitchers, enough to exercise every feature."""
    rng = np.random.default_rng(seed)
    rows = []
    for g in range(games):
        day = pd.Timestamp("2025-04-01") + pd.Timedelta(days=g)
        for ab in range(1, at_bats + 1):
            pitcher = 100 if ab <= at_bats // 2 else 101
            balls = strikes = 0
            for n in range(1, int(rng.integers(1, 7)) + 1):
                rows.append(
                    pitch(
                        game_pk=1000 + g,
                        game_date=day.date().isoformat(),
                        game_year=2025 if g < games - 3 else 2026,
                        at_bat_number=ab,
                        pitch_number=n,
                        pitcher=pitcher,
                        batter=200 + ab,
                        stand="L" if ab % 2 else "R",
                        balls=balls,
                        strikes=strikes,
                        pitch_type=str(rng.choice(CODES, p=[0.4, 0.1, 0.1, 0.2, 0.1, 0.05, 0.05])),
                        zone=int(rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14])),
                        on_1b=float(rng.integers(0, 2)) or None,
                    )
                )
                if rng.random() < 0.5:
                    balls = min(balls + 1, 3)
                else:
                    strikes = min(strikes + 1, 2)
    return clean(pd.DataFrame(rows))


@pytest.fixture
def season():
    return fake_season()


def test_every_feature_is_built(season):
    df = build_features(season)
    assert set(FEATURES) <= set(df.columns)
    assert len(df) == len(season)


def test_changing_the_future_never_changes_the_past(season):
    """the leakage test. scramble everything from some pitch on, and every feature of
    every earlier pitch has to come out exactly the same."""
    base = build_features(season)
    rng = np.random.default_rng(1)
    for cut in (len(base) // 3, len(base) // 2, len(base) - 5):
        future = base.copy()
        tail = future.index >= cut
        future.loc[tail, "pitch_call"] = rng.choice(PITCH_CALLS, tail.sum())
        future.loc[tail, "zone_call"] = rng.choice(ZONES, tail.sum())
        rebuilt = build_features(future[season.columns])
        pd.testing.assert_frame_equal(
            rebuilt.loc[: cut - 1, FEATURES], base.loc[: cut - 1, FEATURES], check_dtype=False
        )


def test_a_pitch_never_sees_its_own_game_in_the_mix(season):
    df = build_features(season)
    first_game = df[df["game_pk"] == df["game_pk"].min()]
    assert first_game[MIX].isna().all().all()
    assert (first_game["pitcher_prior_pitches"] == 0).all()

    second_game = df[df["game_pk"] == sorted(df["game_pk"].unique())[1]]
    for pitcher, rows in second_game.groupby("pitcher"):
        earlier = df[(df["game_pk"] == df["game_pk"].min()) & (df["pitcher"] == pitcher)]
        expected = earlier["pitch_call"].value_counts(normalize=True)
        for call in PITCH_CALLS:
            assert rows[f"mix_{call}"].nunique() == 1
            assert rows[f"mix_{call}"].iat[0] == pytest.approx(expected.get(call, 0.0))


def test_previous_pitches_stay_inside_the_plate_appearance(season):
    df = build_features(season)
    first_pitches = df[df["pitch_number"] == 1]
    assert (first_pitches["prev_pitch_call"] == "none").all()
    second = df[df["pitch_number"] == 2].iloc[0]
    first = df[
        (df["game_pk"] == second["game_pk"])
        & (df["at_bat_number"] == second["at_bat_number"])
        & (df["pitch_number"] == 1)
    ].iloc[0]
    assert second["prev_pitch_call"] == first["pitch_call"]
    assert second["prev_zone_call"] == first["zone_call"]


def test_split_by_season_keeps_time_order(season):
    train, test = split_by_season(build_features(season), 2026)
    assert set(train["game_year"]) == {2025}
    assert set(test["game_year"]) == {2026}
    assert train["game_date"].max() < test["game_date"].min()


def test_favorite_pitch_baseline():
    plan = [(1, "SL", 14), (1, "SL", 14), (1, "FF", 5), (2, "FF", 5), (2, "FF", 5)]
    rows = [
        pitch(game_pk=g, game_date=f"2025-04-0{g}", pitch_number=n, pitch_type=t, zone=z)
        for n, (g, t, z) in enumerate(plan, start=1)
    ]
    df = build_features(clean(pd.DataFrame(rows)))
    baseline = FavoritePitch.fit(df)
    pitch_call, zone_call = baseline.predict(df)
    # no history in game 1, so the league favorite. game 2 knows he leaned on the slider
    assert pitch_call.tolist() == ["fastball"] * 3 + ["slider"] * 2
    assert zone_call.tolist() == ["5"] * 3 + ["chase"] * 2
    scores = score(df, pitch_call, zone_call)
    assert scores.pitches == 5
    assert scores.pitch_call == pytest.approx(1 / 5)
