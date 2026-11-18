import pandas as pd
import pytest

from batter_up.data.pitches import KEEP


def pitch(**overrides):
    """one raw savant row with sensible defaults, overridden per test."""
    row = {col: None for col in KEEP}
    row.update(
        game_pk=1,
        game_date="2025-06-01",
        game_year=2025,
        at_bat_number=1,
        pitch_number=1,
        pitcher=100,
        player_name="Pitcher, Some",
        batter=200,
        p_throws="R",
        stand="L",
        home_team="LAD",
        away_team="SF",
        inning=1,
        inning_topbot="Top",
        outs_when_up=0,
        balls=0,
        strikes=0,
        bat_score=0,
        fld_score=0,
        n_thruorder_pitcher=1,
        pitch_type="FF",
        pitch_name="4-Seam Fastball",
        release_speed=96.1,
        zone=5,
        description="called_strike",
    )
    row.update(overrides)
    # savant has a lot more columns than we keep
    row["spin_dir"] = None
    return row


@pytest.fixture
def raw_frame():
    def make(*rows):
        return pd.DataFrame(list(rows))

    return make
