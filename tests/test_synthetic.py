import math

import pandas as pd
import pytest

from batter_up.data.pitches import KEEP, build
from batter_up.data.synthetic import synth_season


@pytest.fixture(scope="module")
def raw(tmp_path_factory):
    folder = tmp_path_factory.mktemp("raw")
    synth_season(2025, folder, games=10, log=lambda *_: None)
    return folder


def test_writes_daily_csvs_in_savants_shape(raw):
    files = sorted((raw / "2025").glob("*.csv"))
    assert files
    df = pd.read_csv(files[0])
    assert list(df.columns) == KEEP


def test_every_made_up_pitch_survives_cleaning(raw, tmp_path):
    (out,) = build(raw, tmp_path, [2025], log=lambda *_: None)
    clean = pd.read_parquet(out)
    rows = sum(len(pd.read_csv(f)) for f in (raw / "2025").glob("*.csv"))
    assert len(clean) == rows
    # counts only ever move forward inside an at bat
    for _, ab in clean.groupby(["game_pk", "at_bat_number"]):
        assert ab["pitch_number"].tolist() == list(range(1, len(ab) + 1))
        assert ab["balls"].is_monotonic_increasing
        assert ab["strikes"].is_monotonic_increasing
        assert ab["events"].notna().sum() == 1
        assert pd.notna(ab["events"].iloc[-1])


def test_the_flight_numbers_land_on_plate_x_and_z(raw):
    df = pd.concat(pd.read_csv(f) for f in (raw / "2025").glob("*.csv")).head(200)
    for row in df.itertuples():
        # the same math the game uses to replay a pitch from y = 50 ft to the plate
        t = (-row.vy0 - math.sqrt(row.vy0**2 + 2 * row.ay * (17 / 12 - 50))) / row.ay
        x0 = row.release_pos_x * 0.9
        z0 = row.release_pos_z - 0.25
        assert x0 + row.vx0 * t + 0.5 * row.ax * t * t == pytest.approx(row.plate_x, abs=0.02)
        assert z0 + row.vz0 * t + 0.5 * row.az * t * t == pytest.approx(row.plate_z, abs=0.02)
