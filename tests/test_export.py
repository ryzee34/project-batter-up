import json

import pytest

from batter_up.export import Pick, batter_name, check, choose, display_name, export
from batter_up.features import split_by_season
from batter_up.model.evaluate import evaluate


@pytest.mark.parametrize(
    ("des", "name"),
    [
        ("Mookie Betts strikes out swinging.", "Mookie Betts"),
        ("Ronald Acuña Jr. singles on a line drive to left fielder.", "Ronald Acuña Jr"),
        ("Will Smith walks.", "Will Smith"),
        ("LAD Bat 3 grounds out.", "LAD Bat 3"),
        (None, None),
        ("", None),
    ],
)
def test_batter_name_comes_from_the_play_description(des, name):
    assert batter_name(des) == name


def test_display_name_flips_savants_order():
    assert display_name("Kershaw, Clayton") == "Clayton Kershaw"
    assert display_name("Arm 3, LAD") == "LAD Arm 3"


def test_choose_spreads_at_bats_out(league):
    _, test = split_by_season(league, 2026)
    pick = Pick(at_bats=12, per_pitcher=2, per_game=1)
    chosen = choose(test, pick)
    assert 0 < len(chosen) <= 12
    assert len({game for game, _ in chosen}) == len(chosen)
    rows = test.set_index(["game_pk", "at_bat_number"]).loc[chosen]
    assert set(rows["pitching_team"]) == {"LAD"}
    per_pitcher = rows.reset_index().groupby("pitcher")["at_bat_number"].nunique()
    assert per_pitcher.max() <= 2
    assert choose(test, pick) == chosen  # same picks every run


def test_export_writes_what_the_game_needs(league, league_model):
    train, test = split_by_season(league, 2026)
    metrics = evaluate(league_model, train, test)
    payload, summary = export(league, league_model, 2026, metrics, pick=Pick(at_bats=6))
    check(payload)
    assert payload["season"] == 2026
    assert len(payload["atBats"]) <= 6
    ab = payload["atBats"][0]
    assert ab["pitcher"]["name"].startswith("LAD Arm")
    assert ab["batter"]["name"]
    assert ab["pitches"][0]["count"] == "0-0"
    assert [p["n"] for p in ab["pitches"]] == list(range(1, len(ab["pitches"]) + 1))
    assert summary["model"] == metrics["model"]
    json.dumps(payload)  # nothing numpy left in it
    json.dumps(summary)
