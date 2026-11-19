import numpy as np
import pytest

from batter_up.data.pitches import PITCH_CALLS, ZONES
from batter_up.features import split_by_season
from batter_up.model.evaluate import evaluate, lines
from batter_up.model.lgbm import PitchModel, matrix


@pytest.fixture
def features(league):
    return league


@pytest.fixture
def split(league):
    return split_by_season(league, 2026)


def test_matrix_keeps_categories_fixed_whatever_the_rows_hold(features):
    one = matrix(features.head(1))
    assert list(one["count"].cat.categories) == [f"{b}-{s}" for b in range(4) for s in range(3)]
    assert "pitch_call" not in one
    assert list(matrix(features.head(1), "slider")["pitch_call"]) == ["slider"]


@pytest.fixture
def model(league_model):
    return league_model


def test_probabilities_add_up(model, split):
    _, test = split
    pred = model.predict(test.head(50))
    assert pred.pitch.shape == (50, len(PITCH_CALLS))
    assert pred.joint.shape == (50, len(PITCH_CALLS), len(ZONES))
    np.testing.assert_allclose(pred.pitch.sum(axis=1), 1, atol=1e-6)
    np.testing.assert_allclose(pred.joint.sum(axis=(1, 2)), 1, atol=1e-6)
    np.testing.assert_allclose(pred.joint.sum(axis=2), pred.pitch, atol=1e-6)


def test_the_call_is_the_likeliest_pitch_then_its_likeliest_spot(model, split):
    _, test = split
    pred = model.predict(test.head(20))
    pitch, zone = pred.calls()
    for i in range(20):
        p, z = PITCH_CALLS.index(pitch[i]), ZONES.index(zone[i])
        assert pred.pitch[i, p] == pred.pitch[i].max()
        assert pred.joint[i, p, z] == pred.joint[i, p].max()


def test_early_stopping_holds_out_the_last_training_season(split):
    train, _ = split
    logged = []
    PitchModel.fit(train, log=logged.append)
    assert "held out 2025" in logged[0]


def test_needs_two_seasons_to_pick_trees(split):
    train, _ = split
    with pytest.raises(ValueError, match="two training seasons"):
        PitchModel.fit(train[train["game_year"] == 2025])


def test_the_test_season_never_reaches_training(split, monkeypatch):
    train, test = split
    seen = []
    real = PitchModel._train

    def spy(x, y, n_class, rounds=None, valid=None):
        seen.append(len(x))
        if valid is not None:
            seen.append(len(valid[0]))
        return real(x, y, n_class, rounds=rounds, valid=valid)

    monkeypatch.setattr(PitchModel, "_train", staticmethod(spy))
    PitchModel.fit(train, rounds=(5, 5))
    assert max(seen) == len(train)


def test_save_and_load_give_the_same_calls(model, split, tmp_path):
    _, test = split
    model.save(tmp_path)
    again = PitchModel.load(tmp_path)
    np.testing.assert_allclose(model.predict(test).joint, again.predict(test).joint)


def test_evaluate_reports_model_and_baseline(model, split):
    train, test = split
    report = evaluate(model, train, test)
    assert report["test_season"] == 2026
    assert report["train_seasons"] == [2024, 2025]
    assert report["model"]["pitches"] == len(test)
    assert 0 <= report["model"]["both"] <= report["model"]["pitch_type"] <= 1
    assert report["team_only"]["model"]["pitches"] == int(test["pitching_team"].eq("LAD").sum())
    assert any("favorite pitch" in line for line in lines(report))
