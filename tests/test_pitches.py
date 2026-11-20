import pandas as pd
import pytest

from batter_up.data.pitches import (
    CHASE_DOWN,
    CHASE_LEFT,
    CHASE_RIGHT,
    CHASE_UP,
    PITCH_CALLS,
    build,
    clean,
    zone_call,
)
from tests.conftest import pitch


def test_pitch_calls_are_the_game_options():
    assert PITCH_CALLS == [
        "changeup",
        "curveball",
        "cutter",
        "fastball",
        "sinker",
        "slider",
        "splitter",
    ]


@pytest.mark.parametrize(
    ("zone", "call"),
    [(1, "1"), (5, "5"), (9, "9"), (11, CHASE_UP), (14, CHASE_DOWN), (10, None), (None, None)],
)
def test_zone_call_without_a_location(zone, call):
    assert zone_call(zone) == call


@pytest.mark.parametrize(
    ("zone", "x", "z", "call"),
    [
        (11, -0.2, 3.9, CHASE_UP),  # just left of center but way over the top
        (13, -0.2, 0.4, CHASE_DOWN),  # in the dirt
        (13, -1.6, 1.4, CHASE_LEFT),  # a foot off the plate, a little low
        (12, 1.3, 3.6, CHASE_RIGHT),  # half a foot outside, barely high
        (5, 1.3, 3.6, "5"),  # statcast's zone wins inside the box
    ],
)
def test_a_chase_is_named_for_the_edge_it_missed_most(zone, x, z, call):
    assert zone_call(zone, x, z, 3.4, 1.6) == call


def test_clean_splits_chases_by_side(raw_frame):
    df = clean(
        raw_frame(
            pitch(pitch_number=1, zone=11, plate_x=0.1, plate_z=4.0, sz_top=3.4, sz_bot=1.6),
            pitch(pitch_number=2, zone=14, plate_x=1.5, plate_z=1.5, sz_top=3.4, sz_bot=1.6),
        )
    )
    assert df["zone_call"].tolist() == [CHASE_UP, CHASE_RIGHT]


def test_groups_pitch_types_and_drops_uncallable(raw_frame):
    df = clean(
        raw_frame(
            pitch(pitch_number=1, pitch_type="ST"),
            pitch(pitch_number=2, pitch_type="KC"),
            pitch(pitch_number=3, pitch_type="KN"),  # knuckleball, not callable
            pitch(pitch_number=4, pitch_type="PO"),  # pitchout
            pitch(pitch_number=5, pitch_type=None),
            pitch(pitch_number=6, pitch_type="FF", zone=None),
        )
    )
    assert df["pitch_number"].tolist() == [1, 2]
    assert df["pitch_call"].tolist() == ["slider", "curveball"]


def test_teams_follow_the_half_inning(raw_frame):
    df = clean(
        raw_frame(
            pitch(pitch_number=1, inning_topbot="Top"),
            pitch(at_bat_number=2, inning_topbot="Bot"),
        )
    )
    top, bottom = df.to_dict("records")
    assert (top["pitching_team"], top["batting_team"]) == ("LAD", "SF")
    assert (bottom["pitching_team"], bottom["batting_team"]) == ("SF", "LAD")


def test_runners_become_flags(raw_frame):
    df = clean(raw_frame(pitch(on_1b=665742.0, on_3b=None)))
    row = df.iloc[0]
    assert row["on_1b"] and not row["on_2b"] and not row["on_3b"]


def test_dedupes_and_sorts(raw_frame):
    df = clean(
        raw_frame(
            pitch(at_bat_number=2, pitch_number=1),
            pitch(at_bat_number=1, pitch_number=2),
            pitch(at_bat_number=1, pitch_number=1),
            pitch(at_bat_number=1, pitch_number=1),
        )
    )
    assert list(zip(df["at_bat_number"], df["pitch_number"], strict=True)) == [
        (1, 1),
        (1, 2),
        (2, 1),
    ]


def test_missing_columns_fail_loudly(raw_frame):
    with pytest.raises(ValueError, match="missing columns"):
        clean(raw_frame(pitch()).drop(columns=["zone"]))


def test_build_writes_parquet_per_season(tmp_path, raw_frame):
    raw_dir, out_dir = tmp_path / "raw", tmp_path / "interim"
    (raw_dir / "2025").mkdir(parents=True)
    raw_frame(pitch(), pitch(pitch_number=2)).to_csv(raw_dir / "2025" / "2025-06-01.csv")
    (raw_dir / "2025" / "2025-06-02.csv").write_text("")  # an off day

    written = build(raw_dir, out_dir, [2025, 2024], log=lambda _: None)

    assert [p.name for p in written] == ["pitches_2025.parquet"]
    df = pd.read_parquet(written[0])
    assert len(df) == 2
    assert {"pitch_call", "zone_call", "pitching_team"} <= set(df.columns)
