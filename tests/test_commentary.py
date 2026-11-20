import json
from types import SimpleNamespace as NS

import pytest

from batter_up import commentary
from batter_up.data.pitches import PITCH_CALLS


def pitch(n, count, call, zone, result="ball"):
    return {
        "n": n,
        "count": count,
        "pitch": call,
        "zone": zone,
        "name": call.title(),
        "mph": 95.1,
        "spin": 2300,
        "result": result,
        "model": {
            "call": ["fastball", "chase_left"],
            "pitch": [1 / len(PITCH_CALLS)] * len(PITCH_CALLS),
            "zone": [1 / 13] * 13,
        },
    }


@pytest.fixture
def payload():
    ab = {
        "id": "20260003-54",
        "date": "2026-04-01",
        "team": "LAD",
        "opponent": "SF",
        "half": "top",
        "inning": 7,
        "outs": 2,
        "runners": [True, False, True],
        "score": {"pitching": 3, "batting": 2},
        "pitcher": {"name": "LAD Arm 1", "throws": "R", "pitchesToday": 88, "mix": {"slider": 0.4}},
        "batter": {"name": "SF Bat 4", "stands": "L"},
        "des": "SF Bat 4 strikes out swinging.",
        "pitches": [
            pitch(1, "0-0", "fastball", "2", "called_strike"),
            pitch(2, "0-1", "slider", "chase_right", "swinging_strike"),
        ],
    }
    return {"pitchCalls": PITCH_CALLS, "atBats": [ab]}


def test_prompt_has_the_situation_and_every_pitch(payload):
    text = commentary.describe_at_bat(payload["atBats"][0], PITCH_CALLS)
    assert "top of the 7, 2 out, runners on first and third" in text
    assert "score LAD 3, SF 2" in text
    assert (
        "1. count 0-0: 95.1 mph fastball, 2300 rpm, up, in the zone, result: called strike" in text
    )
    assert "2. count 0-1" in text
    assert "how it ended (wrap only)" in text


def test_request_asks_for_json_from_the_default_model(payload):
    req = commentary.request(payload["atBats"][0], PITCH_CALLS)
    assert req["custom_id"] == "20260003-54"
    assert req["params"]["model"] == "claude-opus-5-5"
    assert req["params"]["output_config"]["format"]["schema"] == commentary.SCHEMA
    assert "fallbacks" not in req["params"]  # batches don't take them


def test_parse_puts_lines_in_pitch_order_and_rejects_gaps(payload):
    ab = payload["atBats"][0]
    reply = {"pitches": [{"n": 2, "line": " two "}, {"n": 1, "line": "one"}], "wrap": "done"}
    assert commentary.parse(ab, json.dumps(reply)) == {"pitches": ["one", "two"], "wrap": "done"}
    with pytest.raises(ValueError, match="no line for pitch"):
        commentary.parse(ab, json.dumps({"pitches": [{"n": 1, "line": "x"}], "wrap": "w"}))


class FakeBatches:
    def __init__(self, results):
        self.sent = None
        self.polls = 0
        self._results = results

    def create(self, requests):
        self.sent = requests
        return NS(id="msgbatch_1")

    def retrieve(self, batch_id):
        self.polls += 1
        status = "ended" if self.polls > 1 else "in_progress"
        return NS(processing_status=status, request_counts=NS(processing=1))

    def results(self, batch_id):
        return iter(self._results)


def message(text, stop="end_turn"):
    return NS(type="succeeded", message=NS(stop_reason=stop, content=[NS(type="text", text=text)]))


def test_run_sends_one_request_per_at_bat_and_keeps_good_replies(payload):
    good = json.dumps({"pitches": [{"n": 1, "line": "a"}, {"n": 2, "line": "b"}], "wrap": "w"})
    batches = FakeBatches(
        [
            NS(custom_id="20260003-54", result=message(good)),
            NS(custom_id="someone-else", result=message(good)),
        ]
    )
    client = NS(messages=NS(batches=batches))
    logged = []
    out = commentary.run(client, payload, log=logged.append, sleep=lambda _: None)
    assert len(batches.sent) == 1
    assert batches.polls == 2
    assert out["atBats"] == {"20260003-54": {"pitches": ["a", "b"], "wrap": "w"}}
    assert out["batch"] == "msgbatch_1"


def test_refusals_and_errors_are_skipped_not_fatal(payload):
    batches = FakeBatches([NS(custom_id="20260003-54", result=message("{}", stop="refusal"))])
    client = NS(messages=NS(batches=batches))
    logged = []
    out = commentary.run(
        client, payload, batch_id="msgbatch_9", log=logged.append, sleep=lambda _: None
    )
    assert out["atBats"] == {}
    assert batches.sent is None  # picked up an existing batch, sent nothing
    assert any("refusal" in line for line in logged)


def test_prompt_document_has_the_rules_the_shape_and_every_at_bat(payload):
    doc = commentary.prompt_document(payload)
    assert commentary.SYSTEM in doc
    assert '"atBats"' in doc
    assert "### 20260003-54" in doc
    assert "2. count 0-1" in doc


def test_check_finds_missing_short_and_extra_entries(payload):
    good = {"atBats": {"20260003-54": {"pitches": ["a", "b"], "wrap": "w"}}}
    assert commentary.check(payload, good) == []
    short = {"atBats": {"20260003-54": {"pitches": ["a"], "wrap": ""}, "nope": {}}}
    problems = commentary.check(payload, short)
    assert "20260003-54: 1 lines for 2 pitches" in problems
    assert "20260003-54: no wrap" in problems
    assert "nope: not an at-bat in atbats.json" in problems
    assert commentary.check(payload, {"atBats": {}}) == ["20260003-54: no lines"]


def test_spots_are_in_and_away_for_the_batter():
    assert commentary.spot_words("1", "R") == "up and in, in the zone"
    assert commentary.spot_words("1", "L") == "up and away, in the zone"
    assert commentary.spot_words("5", "L") == "middle middle, in the zone"
    assert commentary.spot_words("chase_right", "R") == "out of the zone, off the plate away"
    assert commentary.spot_words("chase_right", "L") == "out of the zone, off the plate inside"
    assert commentary.spot_words("chase_down", "R") == "out of the zone, down"
